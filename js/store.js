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

function emptyDb() { return { listes: [], especes: [], lieux: [], taches: [], coches: {} }; }
function dbFromFiles(files) {
  const db = emptyDb();
  for (const [path, f] of Object.entries(files)) {
    let j; try { j = JSON.parse(f.text); } catch (_) { continue; }
    if (path === P.listes) db.listes = j.listes || [];
    else if (path === P.especes) db.especes = j.especes || [];
    else if (path === P.lieux) db.lieux = j.lieux || [];
    else if (path === P.taches) db.taches = j.taches || [];
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
  const cle = cleOfPath(path); return stringifyRows({ liste: cle }, "coches", db.coches[cle] || []);
}

// ---------- operations ----------
// every change is an operation; applying it is idempotent enough to be replayed on a newer server copy
export function opFiles(op) {
  switch (op.kind) {
    case "add-tick": case "set-tick": case "del-tick": return [cochesPath(op.cle)];
    case "add-liste": return [P.listes, cochesPath(op.liste.cle)];
    case "add-espece": case "set-espece": return [P.especes];
    case "add-lieu": return [P.lieux];
    case "set-tache": case "add-tache": return [P.taches];
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
    case "add-espece": if (!db.especes.some((e) => e.id === op.espece.id)) { db.especes.push({ ...op.espece }); db.especes.sort((a, b) => a.n.localeCompare(b.n, "fr")); } break;
    case "set-espece": { const e = db.especes.find((x) => x.id === op.id); if (e) patchObj(e, op.patch); break; }
    case "add-lieu": { db.lieux = db.lieux.filter((l) => l.nom !== op.lieu.nom); db.lieux.unshift({ ...op.lieu }); db.lieux = db.lieux.slice(0, 400); break; }
    case "add-tache": if (!db.taches.some((t) => t.id === op.tache.id)) db.taches.push({ ...op.tache }); break;
    case "set-tache": { const t = db.taches.find((x) => x.id === op.id); if (t) patchObj(t, op.patch); break; }
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
    this.pending = store(PENDING_KEY) || [];
    this.listeners = new Set(); this.state = "idle"; this.error = null; this.flushing = null;
    this._rebuild();
    window.addEventListener("online", () => this.sync());
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.sync(); });
  }
  get ready() { return !!this.cfg.token; }
  get hasData() { return Object.keys(this.files).length > 0; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { this.listeners.forEach((fn) => fn(this)); }
  _status(state, error = null) { this.state = state; this.error = error; this._emit(); }
  _save() { store(CACHE_KEY, { files: this.files, commit: this.commit }); store(PENDING_KEY, this.pending); }
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
    const blobs = {}; (tree.tree || []).forEach((e) => { if (e.type === "blob" && /^data\/.+\.json$/.test(e.path)) blobs[e.path] = e.sha; });
    return { commit: c.sha, tree: c.commit.tree.sha, blobs };
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
          if (!this.pending.length) { this._rebuild(); this._save(); this._status("ok"); return; }
          const ok = await this._push(head);
          if (ok) { this._rebuild(); this._save(); this._status("ok"); return; }
        }
        throw new GitHubError(409, "Le dépôt change trop vite, réessaie.");
      } catch (e) {
        this._rebuild(); this._save();
        this._status(e.status === 0 ? "offline" : "error", e.message);
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
  apply(ops, label) {
    ops = (Array.isArray(ops) ? ops : [ops]).map((op) => ({ ...op, opid: uid(), at: Date.now(), label: op.label || label || "" }));
    this.pending.push(...ops); ops.forEach((op) => applyOp(this.db, op));
    this._save(); this._emit(); this.sync();
  }
  resetCache() { this.files = {}; this.commit = null; this._rebuild(); this._save(); }
}

function commitMessage(ops) {
  const labels = [...new Set(ops.map((o) => o.label).filter(Boolean))];
  const head = labels.length === 1 ? labels[0] : labels.length ? `${labels[0]} (+${labels.length - 1})` : "Mise à jour";
  return labels.length > 1 ? `${head}\n\n${labels.map((l) => "- " + l).join("\n")}` : head;
}
