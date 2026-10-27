// The database lives as JSON files in a private GitHub repository.
// The app keeps the last version it read from GitHub (the "server" copy) plus the changes not yet sent
// (the "pending" operations). What you see is server + pending. Sending builds ONE commit for all pending
// changes: if someone (another device) committed in between, the changes are replayed on the newer files,
// so nothing is overwritten.
import { b64decode, stringifyRows, store, uid } from "./util.js";

const API = "https://api.github.com";
const CFG_KEY = "ro.config", CACHE_KEY = "ro.cache.v1", PENDING_KEY = "ro.pending.v1";
export const DEFAULT_CFG = { owner: "AureLPhotog", repo: "rencontre-ornitho-data", branch: "main", token: "" };

export class GitHubError extends Error { constructor(status, message) { super(message); this.status = status; } }

// ---------- files <-> database ----------
const P = { listes: "data/listes.json", especes: "data/especes.json", lieux: "data/lieux.json", taches: "data/a-faire.json" };
const cochesPath = (cle) => `data/coches/${cle}.json`;
const cleOfPath = (path) => (path.match(/^data\/coches\/([a-z0-9-]+)\.json$/) || [])[1];
// what an outside source (Faune-France, eBird) says, kept from the last import: species -> [[date, place, lat, lon], …]
const sourcePath = (k) => `data/sources/${k}.json`;
const srcOfPath = (path) => (path.match(/^data\/sources\/([a-z0-9-]+)\.json$/) || [])[1];

function emptyDb() { return { listes: [], especes: [], lieux: [], taches: [], coches: {}, sources: {}, photos: {}, vign: {} }; }
function dbFromFiles(files) {
  const db = emptyDb();
  for (const [path, f] of Object.entries(files)) {
    let j; try { j = JSON.parse(f.text); } catch (_) { continue; }
    if (path === P.listes) db.listes = j.listes || [];
    else if (path === P.especes) db.especes = j.especes || [];
    else if (path === P.lieux) db.lieux = j.lieux || [];
    else if (path === P.taches) db.taches = j.taches || [];
    else if (srcOfPath(path)) db.sources[srcOfPath(path)] = j;
    else if (path === "data/ref/photos.json") db.photos = j.especes || {}; // the days you have photos of each species (read only)
    else if (path === "data/ref/vignettes.json") db.vign = j.especes || {}; // species -> { p: first photos [date, time, image, original file, zone], b: best }
    else { const cle = cleOfPath(path); if (cle) db.coches[cle] = j.coches || []; }
  }
  db.listes.forEach((l) => { if (!db.coches[l.cle]) db.coches[l.cle] = []; });
  return db;
}
function fileText(db, path) {
  if (path === P.listes) return JSON.stringify({ version: 1, listes: db.listes }, null, 1) + "\n";
  if (path === P.especes) return stringifyRows({ version: 1 }, "especes", db.especes);
  if (path === P.lieux) return stringifyRows({ version: 1 }, "lieux", db.lieux);
  if (path === P.taches) return stringifyRows({ version: 1 }, "taches", db.taches);
  const k = srcOfPath(path);
  if (k) { const s = db.sources[k] || {}, sp = s.especes || {}; return `{"version":1,"source":${JSON.stringify(k)},"maj":${JSON.stringify(s.maj || "")},"especes":{\n${Object.keys(sp).sort().map((e) => JSON.stringify(e) + ":" + JSON.stringify(sp[e])).join(",\n")}\n}}\n`; }
  const cle = cleOfPath(path); return stringifyRows({ liste: cle }, "coches", db.coches[cle] || []);
}

// ---------- operations ----------
// every change is an operation; applying it is idempotent enough to be replayed on a newer server copy
export function opFiles(op) {
  switch (op.kind) {
    case "add-tick": case "set-tick": case "del-tick": return [cochesPath(op.cle)];
    case "add-liste": return [P.listes, cochesPath(op.liste.cle)];
    case "set-liste": return [P.listes];
    case "add-espece": case "set-espece": return [P.especes];
    case "add-lieu": return [P.lieux];
    case "set-tache": case "add-tache": return [P.taches];
    case "set-source": return [sourcePath(op.source)];
    default: return [];
  }
}
const patchObj = (o, patch) => { for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined || v === "") delete o[k]; else o[k] = v; } return o; };
export function applyOp(db, op) {
  switch (op.kind) {
    case "add-tick": { const a = (db.coches[op.cle] = db.coches[op.cle] || []); if (!a.some((t) => t.id === op.tick.id)) a.push({ ...op.tick }); break; }
    case "set-tick": { const t = (db.coches[op.cle] || []).find((x) => x.id === op.id); if (t) patchObj(t, op.patch); break; }
    case "del-tick": { const a = db.coches[op.cle]; if (a) db.coches[op.cle] = a.filter((t) => t.id !== op.id); break; }
    case "add-liste": if (!db.listes.some((l) => l.cle === op.liste.cle)) { db.listes.push({ ...op.liste }); db.coches[op.liste.cle] = db.coches[op.liste.cle] || []; } break;
    case "set-liste": { const l = db.listes.find((x) => x.cle === op.cle); if (l) patchObj(l, op.patch); break; }
    case "add-espece": if (!db.especes.some((e) => e.id === op.espece.id)) { db.especes.push({ ...op.espece }); db.especes.sort((a, b) => a.n.localeCompare(b.n, "fr")); } break;
    case "set-espece": { const e = db.especes.find((x) => x.id === op.id); if (e) patchObj(e, op.patch); break; }
    case "add-lieu": { db.lieux = db.lieux.filter((l) => l.nom !== op.lieu.nom); db.lieux.unshift({ ...op.lieu }); db.lieux = db.lieux.slice(0, 400); break; }
    case "add-tache": if (!db.taches.some((t) => t.id === op.tache.id)) db.taches.push({ ...op.tache }); break;
    case "set-tache": { const t = db.taches.find((x) => x.id === op.id); if (t) patchObj(t, op.patch); break; }
    case "set-source": db.sources[op.source] = op.data; break;
  }
  return db;
}

// ---------- the store ----------
export class Store {
  constructor() {
    this.cfg = { ...DEFAULT_CFG, ...(store(CFG_KEY) || {}) };
    const c = store(CACHE_KEY) || {};
    this.files = c.files || {};          // path -> { sha, text } as last read from GitHub
    this.commit = c.commit || null;      // commit those files come from
    this.images = c.images || {};        // image path -> blob sha (the photos are fetched only when shown)
    this.pending = store(PENDING_KEY) || [];
    this.undos = store(UNDO_KEY) || [];
    this.listeners = new Set(); this.state = "idle"; this.error = null; this.flushing = null;
    this._rebuild();
    window.addEventListener("online", () => this.sync());
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.sync(); });
  }
  get ready() { return !!this.cfg.token; }
  get hasData() { return Object.keys(this.files).length > 0; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { this.listeners.forEach((fn) => { try { fn(this); } catch (e) { console.error(e); this.errorAt = String(e.stack || "").split("\n").filter((l) => /\.js/.test(l)).slice(0, 3).map((l) => (l.match(/([\w-]+\.js)(?:\?[^:]*)?:(\d+):(\d+)/) || []).slice(1).join(":")).filter(Boolean).join(" ← "); this.renderError = e; } }); }
  _status(state, error = null) { this.state = state; this.error = error; this._emit(); }
  _save() { store(CACHE_KEY, { files: this.files, commit: this.commit, images: this.images }); store(PENDING_KEY, this.pending); }
  _rebuild() { const db = dbFromFiles(this.files); this.pending.forEach((op) => applyOp(db, op)); this.db = db; }
  setConfig(cfg) { this.cfg = { ...this.cfg, ...cfg }; store(CFG_KEY, this.cfg); }

  async gh(method, path, body) {
    let res;
    try {
      res = await fetch(API + path, { method, cache: "no-store", headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.cfg.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch (_) { throw new GitHubError(0, "GitHub est injoignable (pas de réseau ?)."); }
    if (res.status === 204) return null;
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = res.status === 401 ? "La clé d'accès GitHub est refusée (expirée ou mal copiée)."
        : res.status === 404 ? "Dépôt introuvable avec cette clé : vérifie son nom et que la clé y a accès."
        : res.status === 403 && /rate limit/i.test(j.message || "") ? "Trop de requêtes vers GitHub, réessaie dans quelques minutes."
        : res.status === 403 ? "La clé d'accès n'a pas le droit d'écrire dans ce dépôt (permission Contents : Read and write)."
        : j.message || `Erreur GitHub ${res.status}`;
      throw new GitHubError(res.status, msg);
    }
    return j;
  }
  repoPath(p) { return `/repos/${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}${p}`; }
  async testAccess() { const r = await this.gh("GET", this.repoPath("")); if (!r.permissions || !r.permissions.push) throw new GitHubError(403, "La clé peut lire le dépôt mais pas y écrire."); return r; }

  async _head() {
    const c = await this.gh("GET", this.repoPath(`/commits/${encodeURIComponent(this.cfg.branch)}`));
    const tree = await this.gh("GET", this.repoPath(`/git/trees/${c.commit.tree.sha}?recursive=1`));
    const blobs = {}, images = {};
    (tree.tree || []).forEach((e) => { if (e.type !== "blob") return; if (/^data\/.+\.json$/.test(e.path)) blobs[e.path] = e.sha; else if (/^data\/photos\/.+\.jpe?g$/i.test(e.path)) images[e.path] = e.sha; });
    return { commit: c.sha, tree: c.commit.tree.sha, blobs, images };
  }
  async _blob(sha) { const b = await this.gh("GET", this.repoPath(`/git/blobs/${sha}`)); return b64decode(b.content); }
  // bring the server copy up to date with the files of `head`
  async _pull(head) {
    const next = {};
    for (const [path, sha] of Object.entries(head.blobs)) next[path] = this.files[path] && this.files[path].sha === sha ? this.files[path] : { sha, text: await this._blob(sha) };
    this.files = next; this.commit = head.commit;
  }

  // read what changed on GitHub, then send what is waiting
  async sync() {
    if (!this.ready || this.flushing) return this.flushing;
    this.flushing = (async () => {
      try {
        this._status("busy");
        for (let attempt = 0; attempt < 4; attempt++) {
          const head = await this._head();
          if (head.commit !== this.commit) await this._pull(head);
          this.images = head.images || {};
          if (!this.pending.length) { this._rebuild(); this._save(); this._status("ok"); return; }
          const ok = await this._push(head);
          if (ok) { this._rebuild(); this._save(); this._status("ok"); return; }
        }
        throw new GitHubError(409, "Le dépôt change trop vite, réessaie.");
      } catch (e) {
        try { this._rebuild(); this._save(); } catch (_) {}
        this.errorAt = e.status === undefined ? String(e.stack || "").split("\n").filter((l) => /\.js/.test(l)).slice(0, 3).map((l) => (l.match(/([\w-]+\.js)(?:\?[^:]*)?:(\d+):(\d+)/) || []).slice(1).join(":")).filter(Boolean).join(" ← ") : "";
        try { this._status(e.status === 0 ? "offline" : "error", e.message); } catch (_) {}
      } finally { this.flushing = null; }
    })();
    return this.flushing;
  }
  async _push(head) {
    const ops = this.pending.slice();
    const db = dbFromFiles(this.files); ops.forEach((op) => applyOp(db, op));
    const paths = [...new Set(ops.flatMap(opFiles))];
    const entries = [];
    for (const path of paths) {
      const text = fileText(db, path);
      if (this.files[path] && this.files[path].text === text) continue;
      const blob = await this.gh("POST", this.repoPath("/git/blobs"), { content: text, encoding: "utf-8" });
      entries.push({ path, mode: "100644", type: "blob", sha: blob.sha, _text: text });
    }
    if (entries.length) {
      const tree = await this.gh("POST", this.repoPath("/git/trees"), { base_tree: head.tree, tree: entries.map(({ _text, ...e }) => e) });
      const commit = await this.gh("POST", this.repoPath("/git/commits"), { message: commitMessage(ops), tree: tree.sha, parents: [head.commit] });
      try { await this.gh("PATCH", this.repoPath(`/git/refs/heads/${encodeURIComponent(this.cfg.branch)}`), { sha: commit.sha, force: false }); }
      catch (e) { if (e.status === 422 || e.status === 409) return false; throw e; } // someone committed meanwhile: replay
      entries.forEach((e) => { this.files[e.path] = { sha: e.sha, text: e._text }; });
      this.commit = commit.sha;
    }
    this.pending = this.pending.slice(ops.length);
    return true;
  }

  // record changes locally (they show at once), then send them
  // each change remembers how to put things back (« Annuler »): the old values of what it changes, newest last
  apply(ops, label, { undo = false } = {}) {
    ops = (Array.isArray(ops) ? ops : [ops]).map((op) => stampSource({ ...op, opid: uid(), at: Date.now(), label: op.label || label || "" }));
    const back = [];
    ops.forEach((op) => { const inv = inverseOp(this.db, op); if (inv) back.unshift(inv); applyOp(this.db, op); });
    this.pending.push(...ops);
    if (!undo && back.length) { this.undos = [...this.undos, { label: label || ops[0].label, at: Date.now(), ops: back }].slice(-30); store(UNDO_KEY, this.undos); }
    this._save(); this._emit(); this.sync();
  }
  undoLast() {
    const u = this.undos[this.undos.length - 1]; if (!u) return null;
    this.undos = this.undos.slice(0, -1); store(UNDO_KEY, this.undos);
    this.apply(u.ops, `Annulé : ${u.label}`, { undo: true });
    return u;
  }
  // a photo of the private repository, as an object URL: read once from GitHub, then kept in the browser
  async imageUrl(path) {
    const sha = this.images[path]; if (!sha) return null;
    this._img = this._img || new Map();
    if (this._img.has(sha)) return this._img.get(sha);
    const p = (async () => {
      const key = `https://ro-photos.invalid/${sha}.jpg`;
      let cache = null; try { cache = await caches.open("ro-photos-v1"); } catch (_) {}
      let blob = cache ? await cache.match(key).then((r) => (r ? r.blob() : null)).catch(() => null) : null;
      if (!blob) {
        const b = await this.gh("GET", this.repoPath(`/git/blobs/${sha}`));
        const bin = atob((b.content || "").replace(/\s/g, "")), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        blob = new Blob([bytes], { type: "image/jpeg" });
        if (cache) cache.put(key, new Response(blob, { headers: { "Content-Type": "image/jpeg" } })).catch(() => {});
      }
      return URL.createObjectURL(blob);
    })();
    this._img.set(sha, p); p.catch(() => this._img.delete(sha));
    return p;
  }
  // send one photo to the repository at once (its own commit); a photo already there is replaced
  async putImage(path, blob, message) {
    const bytes = new Uint8Array(await blob.arrayBuffer()); let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const url = this.repoPath(`/contents/${path.split("/").map(encodeURIComponent).join("/")}`);
    const send = (sha) => this.gh("PUT", url, { message, content: btoa(bin), branch: this.cfg.branch, ...(sha ? { sha } : {}) });
    let r;
    try { r = await send(this.images[path]); }
    catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      // the file changed (or exists) without us knowing its version: ask for it and try again
      const cur = await this.gh("GET", `${url}?ref=${encodeURIComponent(this.cfg.branch)}`).catch(() => null);
      r = await send(cur && cur.sha);
    }
    const sha = r.content.sha; this.images[path] = sha; this._save();
    this._img = this._img || new Map(); this._img.set(sha, Promise.resolve(URL.createObjectURL(blob)));
    try { const c = await caches.open("ro-photos-v1"); await c.put(`https://ro-photos.invalid/${sha}.jpg`, new Response(blob, { headers: { "Content-Type": "image/jpeg" } })); } catch (_) {}
    return sha;
  }
  resetCache() { this.files = {}; this.commit = null; this._rebuild(); this._save(); }
}

// every tick says where its date (sd) and its place (sl) come from: op.src, or a change made in the app
// (a patch that sets sd or sl itself keeps them)
const PLACE = ["l", "lat", "lon"];
const UNDO_KEY = "ro.undo";
// the operation that puts back what op is about to change (null when there is nothing to put back)
function inverseOp(db, op) {
  const prev = (o, patch) => { if (!o || !patch) return null; const p = {}; for (const k of Object.keys(patch)) p[k] = o[k] === undefined ? null : JSON.parse(JSON.stringify(o[k])); return p; };
  switch (op.kind) {
    case "set-tick": { const t = (db.coches[op.cle] || []).find((x) => x.id === op.id); const p = prev(t, op.patch); return p && { kind: "set-tick", cle: op.cle, id: op.id, patch: p }; }
    case "set-espece": { const p = prev(db.especes.find((x) => x.id === op.id), op.patch); return p && { kind: "set-espece", id: op.id, patch: p }; }
    case "set-liste": { const p = prev(db.listes.find((x) => x.cle === op.cle), op.patch); return p && { kind: "set-liste", cle: op.cle, patch: p }; }
    case "set-tache": { const p = prev(db.taches.find((x) => x.id === op.id), op.patch); return p && { kind: "set-tache", id: op.id, patch: p }; }
    case "add-tick": return (db.coches[op.cle] || []).some((t) => t.id === op.tick.id) ? null : { kind: "del-tick", cle: op.cle, id: op.tick.id };
    case "del-tick": { const t = (db.coches[op.cle] || []).find((x) => x.id === op.id); return t ? { kind: "add-tick", cle: op.cle, tick: JSON.parse(JSON.stringify(t)) } : null; }
    default: return null; // new lists, species, places, tasks and sources stay (harmless)
  }
}
function stampSource(op) {
  const s = op.src || "appli";
  if (op.kind === "add-tick") {
    const t = (op.tick = { ...op.tick });
    if (t.d && !t.sd) t.sd = s;
    if ((t.l || t.lat != null) && !t.sl) t.sl = s;
  } else if (op.kind === "set-tick" && op.patch) {
    const p = (op.patch = { ...op.patch });
    if ("d" in p && !("sd" in p)) p.sd = p.d ? s : null;
    if ("d" in p && !("h" in p)) { p.h = null; p.sh = null; } // a new day: the time of the old one no longer holds
    if (PLACE.some((k) => k in p) && !("sl" in p)) p.sl = p.l || p.lat != null ? s : null;
  }
  delete op.src;
  return op;
}
function commitMessage(ops) {
  const labels = [...new Set(ops.map((o) => o.label).filter(Boolean))];
  const head = labels.length === 1 ? labels[0] : labels.length ? `${labels[0]} (+${labels.length - 1})` : "Mise à jour";
  return labels.length > 1 ? `${head}\n\n${labels.map((l) => "- " + l).join("\n")}` : head;
}
