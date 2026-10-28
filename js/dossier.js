// Ticking a list from a folder of photos: each photo names its species in its keywords (or its folder, or the start
// of its file name); the earliest photo of each species that fits the list makes the tick, with its date, time, GPS
// and the photo itself. What the app already has stays as it is: a species already in the list only gets what its
// tick lacks (an undated tick its date, a tick without photo the photo).
import { $, $$, esc, norm, plural, fmtShort, toast, uid } from "./util.js";
import { S, M, go } from "./app.js";
import { readMeta, shrink, speciesOfKeyword } from "./photos.js";
import { whereIs, outsideOf, nameAt } from "./geo.js";

// the species of a photo: its keywords first (XMP or IPTC), then its title, then its folders (deepest first), then the first words of its name
function speciesOf(file, meta) {
  const ks = [...new Set((meta.keywords || []).flatMap((k) => k.split(/[|>]/)).map((k) => speciesOfKeyword(k)).filter(Boolean))];
  if (ks.length) return ks;
  // the title (« 380 Goéland d'Audouin » : the number in front is left out)
  if (meta.title) { const s = speciesOfKeyword(meta.title.replace(/^\s*\d+[\s._-]*/, "")); if (s) return [s]; }
  const dirs = String(file.webkitRelativePath || "").split("/").slice(0, -1).reverse();
  for (const d of dirs) { const s = speciesOfKeyword(d.replace(/^\d+[\s._-]+/, "")); if (s) return [s]; }
  const w = file.name.replace(/\.[^.]+$/, "").split(/[\s_-]+/).filter(Boolean);
  for (let n = Math.min(6, w.length); n >= 1; n--) { const s = speciesOfKeyword(w.slice(0, n).join(" ")); if (s) return [s]; }
  return [];
}

// read every photo (only the start of the file: the metadata), then one proposal per species
export async function readFolder(files, l, progress) {
  const photos = [], noSp = [], noDate = [];
  files = files.filter((f) => /\.jpe?g$/i.test(f.name));
  for (let i = 0; i < files.length; i++) {
    progress(`Lecture des photos… ${i + 1} / ${files.length}`);
    const f = files[i]; let meta;
    try { meta = readMeta(await f.slice(0, 1 << 19).arrayBuffer()); } catch (_) { continue; }
    const sps = speciesOf(f, meta);
    if (!sps.length) { noSp.push(f.name); continue; }
    if (!meta.d) { noDate.push(f.name); continue; }
    sps.forEach((sid) => photos.push({ f, sid, ...meta }));
  }
  const bySp = new Map(); photos.forEach((p) => { if (!bySp.has(p.sid)) bySp.set(p.sid, []); bySp.get(p.sid).push(p); });
  const props = [], kept = [], wcache = new Map();
  const where = async (p) => { const k = p.lat.toFixed(3) + "," + p.lon.toFixed(3); if (!wcache.has(k)) wcache.set(k, await whereIs(p.lat, p.lon)); return wcache.get(k); };
  const needsArea = !!(l.deps || l.communes || l.lieux || l.type === "pays" || l.pays);
  let n = 0;
  for (const [sid, ps] of bySp) {
    progress(`Choix des photos… ${++n} / ${bySp.size}`);
    ps.sort((a, b) => (a.d + (a.h || "")).localeCompare(b.d + (b.h || "")));
    let cands = ps.filter((p) => l.type !== "annee" || p.d.slice(0, 4) === String(l.annee));
    let pick = null, why = "";
    for (const p of cands) {
      if (needsArea && p.lat != null) { const out = outsideOf(l, await where(p), p, p.d); if (out) { why = why || out; continue; } }
      pick = p; break;
    }
    const t = M.tick(sid, l.cle);
    if (!pick) { kept.push({ sid, why: l.type === "annee" && !cands.length ? `pas de photo en ${l.annee}` : `hors de ${l.nom} (${why})` }); continue; }
    if (!t) { props.push({ kind: "add", sid, p: pick, count: ps.length, noGps: pick.lat == null && needsArea }); continue; }
    // already in the list: the app has the say; only what is missing
    if (!t.d) { props.push({ kind: "date", sid, p: pick, t, count: ps.length }); continue; }
    const own = ps.find((p) => p.d === t.d);
    if (!M.photosFor(t).length && !t.nph && own) { props.push({ kind: "photo", sid, p: own, t, count: ps.length }); continue; }
    kept.push({ sid, why: pick.d < t.d ? `déjà cochée le ${fmtShort(t.d)} (photo plus ancienne du ${fmtShort(pick.d)} : l'appli garde sa date)` : `déjà cochée le ${fmtShort(t.d)}` });
  }
  props.sort((a, b) => (a.p.d + (a.p.h || "")).localeCompare(b.p.d + (b.p.h || "")));
  return { props, kept, noSp, noDate, total: files.length };
}

const KIND = { add: "nouvelle", date: "date manquante dans l'appli", photo: "photo manquante dans l'appli" };
export function showFolder(el, l, res, onDone) {
  const { props, kept, noSp, noDate, total } = res;
  el.innerHTML = `<section class="panel"><h3 class="minor">Dossier : ${total} ${plural(total, "photo")} lue${total > 1 ? "s" : ""}</h3>
    ${props.length ? `<p class="cap">Une ligne par espèce : sa plus ancienne photo qui convient à ${esc(l.nom)}${l.type === "annee" ? ` (prise en ${l.annee})` : ""}. Date, heure et GPS viennent de la photo ; le nom du lieu est trouvé d'après le GPS.</p>
    <label class="chk"><input type="checkbox" id="fd-ph" checked> Mettre aussi la photo sur la coche (copie réduite envoyée dans ta base)</label>
    <ul class="ticks bulk">${props.map((x, i) => `<li><label class="chk"><input type="checkbox" data-fd="${i}" checked><span><b>${esc(M.name(x.sid))}</b> <small class="cap">${esc(KIND[x.kind])}${x.noGps ? " · sans GPS : lieu à vérifier" : ""}</small><small class="cap">${esc(fmtShort(x.p.d))}${x.p.h ? " " + esc(x.p.h) : ""} · ${esc(x.p.f.name)}${x.p.lat != null ? ` · ${x.p.lat}, ${x.p.lon}` : ""}${x.count > 1 ? ` · ${x.count} photos de l'espèce` : ""}</small></span></label></li>`).join("")}</ul>
    <div class="row"><button class="btn btn-primary" id="fd-go" type="button">Enregistrer ${props.length} ${plural(props.length, "coche")}</button></div><p class="msg" id="fd-msg"></p>` : '<p class="cap">Rien à ajouter à cette liste avec ces photos.</p>'}
    ${kept.length ? `<details><summary>${kept.length} ${plural(kept.length, "espèce")} sans changement</summary><ul class="cap">${kept.map((x) => `<li>${esc(M.name(x.sid))} : ${esc(x.why)}</li>`).join("")}</ul></details>` : ""}
    ${noSp.length ? `<details><summary>${noSp.length} ${plural(noSp.length, "photo")} sans espèce reconnue</summary><p class="cap">Ni mot-clé, ni dossier, ni début de nom de fichier ne donne une espèce de ta base.</p><ul class="cap">${noSp.slice(0, 200).map((n) => `<li>${esc(n)}</li>`).join("")}</ul></details>` : ""}
    ${noDate.length ? `<details><summary>${noDate.length} ${plural(noDate.length, "photo")} sans date de prise de vue</summary><ul class="cap">${noDate.slice(0, 200).map((n) => `<li>${esc(n)}</li>`).join("")}</ul></details>` : ""}</section>`;
  const go_ = $("#fd-go", el); if (!go_) return;
  go_.addEventListener("click", async () => {
    const sel = $$("[data-fd]", el).filter((i) => i.checked).map((i) => props[+i.dataset.fd]); if (!sel.length) { toast("Rien de sélectionné."); return; }
    const withPh = $("#fd-ph", el).checked, msg = $("#fd-msg", el); go_.disabled = true;
    const ops = []; let num = l.numerotee ? M.nextNum(l.cle) : 0, i = 0, fails = 0;
    for (const x of sel) {
      msg.textContent = `${withPh ? "Envoi des photos et " : ""}recherche des lieux… ${++i} / ${sel.length}`;
      const p = x.p, id = x.t ? x.t.id : `${l.cle}-${uid()}`;
      const place = {};
      if (p.lat != null && (!x.t || x.t.lat == null)) { place.lat = p.lat; place.lon = p.lon; place.sl = "photo"; if (!x.t || !x.t.l) { const n = await nameAt(p.lat, p.lon).catch(() => null); if (n && n.l) place.l = n.l; if (n && n.p) place.p = n.p; } }
      let ph = null;
      if (withPh && (!x.t || !x.t.ph)) {
        try { const img = `data/photos/listes/${l.cle}/${id}.jpg`; await S.putImage(img, await shrink(p.f), `Photo de la coche : ${M.name(x.sid)} (${l.nom}, ${fmtShort(p.d)})`); ph = { img, d: p.d, h: p.h || null, file: p.f.name, src: "dossier" }; }
        catch (e) { fails++; console.error(e); }
      }
      const when = x.kind === "photo" ? {} : { d: p.d, ...(p.h ? { h: p.h, sh: "photo" } : {}) };
      if (x.kind === "add") ops.push({ kind: "add-tick", cle: l.cle, tick: { id, e: x.sid, ...when, ...place, ...(ph ? { ph } : {}), ...(l.numerotee ? { n: num++ } : {}) }, src: "photo" });
      else ops.push({ kind: "set-tick", cle: l.cle, id, patch: { ...when, ...place, ...(ph ? { ph, nph: null } : {}) }, src: "photo" });
      // the photo of the observation: also on the same sighting in the other lists that have none
      if (ph) M.ticks.filter((y) => y.e === x.sid && y.d === p.d && y.cle !== l.cle && !y.ph && !y.nph).forEach((y) => ops.push({ kind: "set-tick", cle: y.cle, id: y.id, patch: { ph } }));
    }
    S.apply(ops, `${l.nom} : ${sel.length} ${plural(sel.length, "coche")} d'après un dossier de photos`);
    toast(`${sel.length} ${plural(sel.length, "coche")} ${sel.length > 1 ? "enregistrées" : "enregistrée"}${fails ? ` ; ${fails} ${plural(fails, "photo")} pas ${fails > 1 ? "envoyées" : "envoyée"}` : ""}. « Annuler » dans À faire pour revenir en arrière.`);
    onDone();
  });
}
