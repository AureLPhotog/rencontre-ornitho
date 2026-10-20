// Import from Faune-France, eBird or cocheurs: read the file, match species, propose what to add or complete.
import { $, $$, esc, norm, cap, uid, plural, fmtShort, isFrance, yearOf, toast, srcName } from "./util.js";
import { S, M, go } from "./app.js";
import { PHOTO_FR, LIFERS, VU } from "./model.js";
import { deptFromPlace, communeFromPlace, deptByName, listCovers, placeAt, distKm } from "./geo.js";
import { loadXlsx } from "./export.js";
import { makeMatcher } from "./taxo.js";

// ---------- reading files ----------
async function readText(file) {
  const buf = await file.arrayBuffer();
  let t = new TextDecoder("utf-8").decode(buf);
  if (t.includes("�")) t = new TextDecoder("windows-1252").decode(buf); // cocheurs exports are Windows-encoded
  return t.replace(/^﻿/, "");
}
function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || "";
  const sep = [";", "\t", ","].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === sep) { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}
async function readRows(file) {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    const X = await loadXlsx(), wb = X.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
    return X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
  }
  return parseCsv(await readText(file));
}
const ENT = { eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", agrave: "à", acirc: "â", auml: "ä", icirc: "î", iuml: "ï", ocirc: "ô", ouml: "ö", ucirc: "û", ugrave: "ù", uuml: "ü", ccedil: "ç", oelig: "œ", aelig: "æ", Eacute: "É", Egrave: "È", amp: "&", apos: "'", quot: '"', nbsp: " " };
const unent = (s) => String(s ?? "").replace(/&(#\d+|[a-zA-Z]+);/g, (m, k) => k[0] === "#" ? String.fromCharCode(+k.slice(1)) : ENT[k] ?? m);
function toIso(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return d.toISOString().slice(0, 10); }
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/))) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? +n.toFixed(6) : null; };
const COUNTRY_FIX = { GF: "Guyane", GP: "Guadeloupe", MQ: "Martinique", RE: "La Réunion", YT: "Mayotte", PM: "Saint-Pierre-et-Miquelon" };
const countryName = (code) => { if (!code || code === "FR") return ""; if (COUNTRY_FIX[code]) return COUNTRY_FIX[code]; try { return new Intl.DisplayNames(["fr"], { type: "region" }).of(code) || code; } catch (_) { return code; } };

// ---------- species matching: the Latin name first (see taxo.js) ----------
const matcher = () => { const m = makeMatcher(M.db.especes); return (name, sci) => { const r = m(unent(name), unent(sci)); return r ? r.id : null; }; };

// one observation = { sid, name, d, l, p, lat, lon, dep, commune }
function fromFauneFrance(rows) {
  const h = rows[0].map((x) => String(x).trim().toUpperCase()), c = (k) => h.indexOf(k);
  if (c("NAME_SPECIES") < 0 || c("DATE") < 0) throw new Error("Ce n'est pas un export Faune-France (colonnes NAME_SPECIES et DATE introuvables).");
  return rows.slice(1).map((r) => {
    const place = String(r[c("PLACE")] || "").trim(), com = String(r[c("MUNICIPALITY")] || "").trim(), dep = String(r[c("COUNTY")] || "").trim().padStart(2, "0");
    const country = String(r[c("COUNTRY")] || "France").trim();
    return { name: r[c("NAME_SPECIES")], sci: r[c("LATIN_SPECIES")], d: toIso(r[c("DATE")]), l: place ? `${place} (${com}${dep ? ", " + dep : ""})` : com,
      p: isFrance(country) ? "" : country, lat: num(r[c("COORD_LAT")]), lon: num(r[c("COORD_LON")]), dep: isFrance(country) ? dep : null, commune: com };
  });
}
function fromEbird(rows) {
  const h = rows[0].map((x) => String(x).trim()), c = (k) => h.indexOf(k);
  if (c("Scientific Name") < 0 || c("Date") < 0) throw new Error("Ce n'est pas un export eBird « My eBird Data » (colonnes Scientific Name et Date introuvables).");
  return rows.slice(1).map((r) => {
    const st = String(r[c("State/Province")] || ""), cc = st.split("-")[0], fr = cc === "FR";
    return { name: r[c("Common Name")], sci: r[c("Scientific Name")], d: toIso(r[c("Date")]), l: String(r[c("Location")] || "").trim(), p: countryName(cc),
      lat: num(r[c("Latitude")]), lon: num(r[c("Longitude")]), dep: fr ? deptByName(r[c("County")]) : null, commune: null };
  });
}
function fromCocheurs(rows) {
  const h = rows[0].map((x) => String(x).trim().toUpperCase()), c = (k) => h.indexOf(k);
  if (c("ESPECE") < 0) throw new Error("Ce n'est pas un export cocheurs (colonne ESPECE introuvable).");
  return rows.slice(1).map((r) => {
    const lieu = unent(r[c("LIEU")] || ""), parts = lieu.split(",").map((x) => x.trim()).filter(Boolean);
    return { name: unent(r[c("ESPECE")]), sci: unent(r[c("ESPECE_LAT")] || "").replace(/\(.*?\)/g, ""), d: toIso(r[c("DATE")]), l: parts.slice(0, 3).join(", "), p: "",
      lat: num(r[c("Y")]), lon: num(r[c("X")]), dep: deptFromPlace(lieu), commune: parts[2] || null };
  });
}

// ---------- proposals ----------
// kinds: add (new tick), date (undated tick gets a date), earlier (an earlier date than the app's), place (coordinates or place missing)
function propose(obs, source, target) {
  const P = [], push = (x) => P.push({ id: P.length, ...x });
  const zones = M.listes.filter((l) => l.deps || l.communes), spots = M.listes.filter((l) => l.lieux && l.lieux.length);
  const byKey = new Map(); // first observation per (list, species) or (year list, scope, species)
  const keep = (k, o) => { const cur = byKey.get(k); if (!cur || (o.d && (!cur.d || o.d < cur.d))) byKey.set(k, o); };
  const valid = obs.filter((o) => o.sid);
  if (source === "cocheurs") valid.forEach((o) => keep(target + "|" + o.sid, o));
  else for (const o of valid) {
    const fr = isFrance(o.p);
    if (o.d) keep(`yl${yearOf(o.d)}|${fr ? "fr" : "x"}|${o.sid}`, o);
    if (fr) zones.forEach((l) => { if (listCovers(l, o)) keep(l.cle + "|" + o.sid, o); });
    // garden, office: a sighting within the list's radius (300 m unless set) of their spot on that date (and not before the first spot)
    if (fr && o.d && o.lat != null) spots.forEach((l) => {
      const f = placeAt(l, o.d), first = (l.lieux || []).map((x) => x.depuis).filter(Boolean).sort()[0];
      if (f && (!first || o.d >= first) && distKm(f, o) <= (l.rayon || 300) / 1000) keep(l.cle + "|" + o.sid, { ...o, l: f.nom || o.l, lat: f.lat, lon: f.lon });
    });
    else M.listes.filter((l) => l.type === "pays" && norm(l.nom) === norm(o.p)).forEach((l) => keep(l.cle + "|" + o.sid, o));
    keep(VU + "|" + (fr ? "fr" : "x") + "|" + o.sid, o);
  }
  for (const [k, o] of byKey) {
    const parts = k.split("|"), cle = parts[0], sid = parts[parts.length - 1], scope = parts.length === 3 ? parts[1] : null;
    const l = M.liste.get(cle), isYear = /^yl\d{4}$/.test(cle), year = isYear ? +cle.slice(2) : null;
    if (isYear && !l && year < Math.max(...M.years)) continue; // no new year list for years before the ones kept
    const ticks = ((M.bySp.get(sid) || new Map()).get(cle) || []).filter((t) => !scope || cle === VU || (scope === "fr" ? isFrance(t.p) : !isFrance(t.p)));
    const hasPF = M.inList(sid, PHOTO_FR), hasLif = M.inList(sid, LIFERS);
    if (cle === VU) { // seen without photo: only while never photographed
      if (ticks.length || (scope === "fr" ? hasPF : hasLif)) continue;
      push({ kind: "add", cle, sid, o, checked: true, why: scope === "fr" ? "jamais photographiée en France" : "jamais photographiée" }); continue;
    }
    const t = ticks[0];
    if (!t) {
      const ok = source === "cocheurs" || (isYear ? (scope === "fr" ? hasPF : hasLif) : (l && l.type === "pays") || hasPF);
      push({ kind: "add", cle, sid, o, checked: ok, why: ok ? "nouvelle" : scope === "x" ? "pas encore de lifer photo" : "pas encore de photo France", newList: isYear && !l ? year : null });
    } else if (!t.d && o.d) push({ kind: "date", cle, sid, o, t, checked: true, why: `date manquante dans l'appli : ${fmtShort(o.d)}` });
    else if (o.d && t.d && o.d !== t.d) push({ kind: "earlier", cle, sid, o, t, checked: false, why: `${source === "cocheurs" ? "cocheurs" : "première donnée"} ${fmtShort(o.d)} · appli ${fmtShort(t.d)} (${srcName(t.sd)})`, hide: o.d > t.d && source !== "cocheurs" });
    else if (t.lat == null && o.lat != null) push({ kind: "place", cle, sid, o, t, checked: true, why: `coordonnées manquantes${t.l ? ` · appli : ${t.l} (${srcName(t.sl)})` : ""}` });
  }
  // ticks of the same species and day, anywhere, without coordinates: the observation gives them
  if (source !== "cocheurs") {
    const byDay = new Map(); valid.forEach((o) => { if (o.d && o.lat != null) byDay.set(o.sid + "|" + o.d, o); });
    for (const t of M.ticks) if (t.d && t.lat == null) { const o = byDay.get(t.e + "|" + t.d); if (o && !P.some((x) => x.t === t)) push({ kind: "place", cle: t.cle, sid: t.e, o, t, checked: true, why: `coordonnées manquantes, même jour${t.l ? ` · appli : ${t.l} (${srcName(t.sl)})` : ""}` }); }
  }
  return P.filter((x) => !x.hide);
}

// ---------- screen ----------
export function screenImport(view) {
  const zl = M.listes.filter((l) => l.type !== "annee");
  view.innerHTML = `<div class="screen"><header class="phead"><a class="back" href="#/plus">← Plus</a><h1>Importer</h1>
    <p class="cap">L'appli lit le fichier, reconnaît les espèces et te propose ce qu'elle peut ajouter ou compléter. Rien n'est enregistré avant que tu valides.</p></header>
    <form class="panel" id="imp">
      <div class="seg wide3" role="group" aria-label="Source"><button type="button" data-src="ff" aria-pressed="true">Faune-France</button><button type="button" data-src="ebird" aria-pressed="false">eBird</button><button type="button" data-src="cocheurs" aria-pressed="false">cocheurs</button></div>
      <p class="cap" id="imp-help"></p>
      <label id="imp-target-w" hidden>Liste cocheurs importée<select class="field" id="imp-target">${zl.map((l) => `<option value="${l.cle}">${esc(l.nom)}</option>`).join("")}</select></label>
      <label class="btn file-label">Choisir le fichier<input type="file" id="imp-file" accept=".csv,.txt,.xlsx,.xls"></label>
      <p class="msg" id="imp-msg"></p>
    </form><div id="imp-res"></div></div>`;
  let src = "ff";
  const HELP = { ff: "Sur faune-france.org : Mes données › Exporter, format Excel. Les données de toutes tes années servent à dater et localiser tes coches, et à proposer les espèces manquantes dans tes year lists, régions, départements et Ouessant.",
    ebird: "Sur ebird.org : Mon eBird › Télécharger mes données. Tu reçois un fichier CSV par e-mail ; garde-le tel quel.",
    cocheurs: "Sur cocheurs : exporte une liste en CSV, puis choisis ci-dessous à quelle liste de l'appli elle correspond." };
  const setSrc = (s) => { src = s; $$("[data-src]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.src === s))); $("#imp-help").textContent = HELP[s]; $("#imp-target-w").hidden = s !== "cocheurs"; };
  $$("[data-src]").forEach((b) => b.addEventListener("click", () => setSrc(b.dataset.src))); setSrc("ff");
  $("#imp-file").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    const msg = $("#imp-msg"); msg.className = "msg"; msg.textContent = `Lecture de ${f.name}…`;
    try {
      const rows = await readRows(f); if (rows.length < 2) throw new Error("Le fichier est vide.");
      const obs = (src === "ff" ? fromFauneFrance : src === "ebird" ? fromEbird : fromCocheurs)(rows);
      const ctx = { src, target: $("#imp-target").value, file: f.name, obs };
      run(ctx);
    } catch (err) { msg.className = "msg bad"; msg.textContent = err.message; }
  });
}

// match the species, propose, show; runs again after a name is associated by hand
function run(ctx) {
  const match = matcher(); ctx.unknown = new Map();
  ctx.obs.forEach((o) => { o.sid = match(o.name, o.sci); if (!o.sid) { const k = cap(unent(o.name)); const u = ctx.unknown.get(k) || { n: 0, sci: unent(o.sci || "").trim() }; u.n++; ctx.unknown.set(k, u); } });
  const msg = $("#imp-msg"); msg.className = "msg ok"; msg.textContent = `${ctx.obs.length} ${plural(ctx.obs.length, "ligne")} lues, ${ctx.obs.filter((o) => o.sid).length} reconnues.`;
  review($("#imp-res"), propose(ctx.obs, ctx.src, ctx.target), ctx);
}
const KIND = { add: "Ajouter", date: "Dater", earlier: "Date différente", place: "Localiser" };
function review(el, props, ctx) {
  const groups = new Map(); props.forEach((p) => { if (!groups.has(p.cle)) groups.set(p.cle, []); groups.get(p.cle).push(p); });
  const order = [...groups.keys()].sort((a, b) => M.listes.findIndex((l) => l.cle === a) - M.listes.findIndex((l) => l.cle === b));
  const nom = (cle) => (M.liste.get(cle) || { nom: "YL " + cle.slice(2) }).nom;
  const line = (p) => `<label class="chk prop"><input type="checkbox" data-p="${p.id}" ${p.checked ? "checked" : ""}><span><b>${esc(M.name(p.sid))}</b> · ${KIND[p.kind]} <small>${esc(p.why)}${p.o.l ? " · " + esc(p.o.l) : ""}${p.o.d && p.kind === "add" ? " · " + fmtShort(p.o.d) : ""}</small></span></label>`;
  el.innerHTML = `${ctx.src === "cocheurs" ? cocheursMissing(ctx) : ""}
    ${ctx.unknown.size ? `<details class="panel" ${ctx.unknown.size < 15 ? "open" : ""}><summary>${ctx.unknown.size} ${plural(ctx.unknown.size, "nom")} non reconnu${ctx.unknown.size > 1 ? "s" : ""}, ignoré${ctx.unknown.size > 1 ? "s" : ""} pour l'instant</summary>
      <p class="cap">Si c'est une espèce que tu as sous un autre nom, associe-la : l'appli retiendra ce nom et ce nom latin pour les prochains imports. Les hybrides et les « sp. » restent ignorés.</p>
      <datalist id="dl-sp">${M.db.especes.map((e) => `<option value="${esc(e.n)}">`).join("")}</datalist>
      <ul class="plain">${[...ctx.unknown].map(([n, u], i) => `<li class="lrow"><span class="grow"><b>${esc(n)}</b> <small class="cap">${u.sci ? `<i>${esc(u.sci)}</i> · ` : ""}${u.n} ${plural(u.n, "ligne")}</small></span>
        <input class="field" list="dl-sp" data-assoc="${i}" placeholder="C'est…" style="max-width:220px"></li>`).join("")}</ul></details>` : ""}
    ${props.length ? order.map((cle) => { const g = groups.get(cle); return `<section class="panel"><div class="row between"><h3 class="minor" style="margin:0"><span class="chip-s" style="--c:${M.color(cle) || "#9A7400"}">${esc(nom(cle))}</span> ${g.length} ${plural(g.length, "proposition")}</h3><button type="button" class="linkish" data-all="${cle}">tout cocher / décocher</button></div>
      <div class="props">${g.slice(0, 400).map(line).join("")}${g.length > 400 ? `<p class="cap">… et ${g.length - 400} autres, comptées si le groupe est coché.</p>` : ""}</div></section>`; }).join("")
      + `<div class="row sticky-act"><button class="btn btn-primary btn-lg" id="imp-go" type="button">Enregistrer la sélection</button><span class="cap" id="imp-count"></span></div>`
      : `<p class="empty">Rien à ajouter ni à compléter : l'appli a déjà tout ce que contient ce fichier.</p>`}`;
  const byId = new Map(props.map((p) => [String(p.id), p])); // ids are not positions: hidden proposals were filtered out
  const count = () => { const n = props.filter((p) => p.checked).length; const c = $("#imp-count"); if (c) c.textContent = `${n} ${plural(n, "changement")} sélectionné${n > 1 ? "s" : ""}`; };
  $$("[data-p]", el).forEach((i) => i.addEventListener("change", () => { byId.get(i.dataset.p).checked = i.checked; count(); }));
  $$("[data-all]", el).forEach((b) => b.addEventListener("click", () => { const g = groups.get(b.dataset.all), on = !g.every((p) => p.checked); g.forEach((p) => { p.checked = on; }); $$("[data-p]", el).forEach((i) => { i.checked = byId.get(i.dataset.p).checked; }); count(); }));
  count();
  const unk = [...ctx.unknown];
  $$("[data-assoc]", el).forEach((i) => i.addEventListener("change", () => {
    const e = M.db.especes.find((x) => norm(x.n) === norm(i.value)); if (!e) { toast("Choisis une espèce de la liste."); return; }
    const [name, u] = unk[+i.dataset.assoc];
    const patch = {};
    if (norm(name) !== norm(e.n) && !(e.al || []).some((a) => norm(a) === norm(name))) patch.al = [...(e.al || []), name];
    if (u.sci && norm(u.sci) !== norm(e.sc) && !(e.scs || []).some((a) => norm(a) === norm(u.sci))) patch.scs = [...(e.scs || []), u.sci];
    if (Object.keys(patch).length) S.apply({ kind: "set-espece", id: e.id, patch }, `Autre nom : ${name}${u.sci ? " (" + u.sci + ")" : ""} = ${e.n}`);
    toast(`« ${name} » associé à ${e.n}.`); setTimeout(() => run(ctx), 50);
  }));
  const go2 = $("#imp-go"); if (go2) go2.addEventListener("click", () => apply(props.filter((p) => p.checked), ctx));
}
function cocheursMissing(ctx) {
  const inFile = new Set(ctx.obs.filter((o) => o.sid).map((o) => o.sid));
  const miss = M.speciesOf(ctx.target).filter((t) => !inFile.has(t.e));
  return miss.length ? `<details class="panel"><summary>${miss.length} ${plural(miss.length, "espèce")} de l'appli absente${miss.length > 1 ? "s" : ""} de ce fichier cocheurs (à saisir dans cocheurs)</summary><ul class="cap">${miss.map((t) => `<li>${esc(M.name(t.e))} · ${t.d ? fmtShort(t.d) : "sans date"}${t.l ? " · " + esc(t.l) : ""}${t.lat != null ? ` · ${t.lat}, ${t.lon}` : ""}</li>`).join("")}</ul></details>` : "";
}
const fixedSpot = (l) => !!(l && l.lieux && l.lieux.length);
function apply(sel, ctx) {
  if (!sel.length) { toast("Rien de sélectionné."); return; }
  const ops = [], newYears = new Set(), next = {};
  const place = (o) => ({ l: o.l || null, lat: o.lat, lon: o.lon, p: o.p || null });
  for (const p of sel.slice().sort((a, b) => (a.o.d || "9").localeCompare(b.o.d || "9"))) {
    const l = M.liste.get(p.cle);
    if (p.kind === "add") {
      if (!l && /^yl\d{4}$/.test(p.cle) && !newYears.has(p.cle)) { newYears.add(p.cle); const y = +p.cle.slice(2); ops.push({ kind: "add-liste", liste: { cle: p.cle, nom: `YL ${y}`, dans: null, type: "annee", annee: y, couleur: "#9A7400" } }); }
      const tick = { id: `${p.cle}-${uid()}`, e: p.sid }; if (p.o.d) tick.d = p.o.d;
      if (l && l.numerotee) { next[p.cle] = next[p.cle] || M.nextNum(p.cle); tick.n = next[p.cle]++; }
      Object.entries(place(p.o)).forEach(([k, v]) => { if (v != null && v !== "") tick[k] = v; });
      if (fixedSpot(l) && (tick.l || tick.lat != null)) tick.sl = "fixe";
      ops.push({ kind: "add-tick", cle: p.cle, tick, src: ctx.src });
    } else if (p.kind === "date" || p.kind === "earlier") {
      const pl = p.t.lat == null || p.kind === "earlier" ? place(p.o) : {};
      if (Object.keys(pl).length && fixedSpot(l)) pl.sl = "fixe";
      ops.push({ kind: "set-tick", cle: p.cle, id: p.t.id, patch: { d: p.o.d, ...pl }, src: ctx.src });
    } else if (p.kind === "place") ops.push({ kind: "set-tick", cle: p.cle, id: p.t.id, patch: { ...place(p.o), ...(fixedSpot(l) ? { sl: "fixe" } : {}) }, src: ctx.src });
  }
  const label = { ff: "Import Faune-France", ebird: "Import eBird", cocheurs: `Import cocheurs (${(M.liste.get(ctx.target) || {}).nom})` }[ctx.src];
  S.apply(ops, `${label} : ${sel.length} ${plural(sel.length, "changement")}`);
  toast(`${sel.length} ${plural(sel.length, "changement")} enregistré${sel.length > 1 ? "s" : ""}.`);
  go("#/journal");
}
