// Rencontre Ornitho: router, shell and the read-only screens.
import { $, $$, esc, norm, plural, fmtDay, fmtShort, MOIS, MOIS_C, todayIso, yearOf, isFrance, store, toast } from "./util.js";
import { Store } from "./store.js";
import { buildModel, PHOTO_FR, LIFERS, VU } from "./model.js";
import { renderAdd, renderEdit } from "./form.js";
import { mapView } from "./map.js";
import { exportXlsx, exportJson } from "./export.js";
import { screenLists } from "./lists.js";
import { screenImport } from "./importer.js";

export const S = new Store();
export let M = buildModel(S.db);
const UI = Object.assign({ scope: "fr", year: new Date().getFullYear() }, store("ro.ui") || {});
export const saveUI = (patch) => { Object.assign(UI, patch); store("ro.ui", UI); };
export { UI };

const view = $("#view");
S.on(() => {
  M = buildModel(S.db);
  renderStatus();
  if (!view.contains(document.activeElement) || document.activeElement === document.body) route(true);
});

// ---------- status ----------
function renderStatus() {
  const el = $("#status"), n = S.pending.length;
  const text = { busy: "Envoi…", ok: n ? `${n} en attente` : "À jour", offline: `Hors ligne${n ? ` · ${n} en attente` : ""}`, error: "Erreur", idle: n ? `${n} en attente` : "" }[S.state] || "";
  el.dataset.state = S.state; $(".status-text", el).textContent = text;
  el.title = S.error || (n ? `${n} ${plural(n, "changement")} pas encore envoyé${n > 1 ? "s" : ""} sur GitHub` : "Tout est enregistré sur GitHub");
}
$("#status").addEventListener("click", () => { if (S.error) toast(S.error, "error"); S.sync(); });

// ---------- router ----------
const ROUTES = [
  [/^#?\/?$/, screenHome], [/^#\/liste\/([\w-]+)(?:\?.*)?$/, screenList], [/^#\/annee(?:\/(\d{4}))?$/, screenYear],
  [/^#\/journal$/, screenJournal], [/^#\/espece\/([\w-]+)$/, screenSpecies], [/^#\/ajout(?:\?(.*))?$/, (q) => renderAdd(view, new URLSearchParams(q || ""))],
  [/^#\/coche\/([\w-]+)\/([\w-]+)$/, (cle, id) => renderEdit(view, cle, id)], [/^#\/plus$/, screenMore], [/^#\/calendrier$/, screenCalendar],
  [/^#\/a-faire$/, screenTodo], [/^#\/reglages$/, screenSettings], [/^#\/listes$/, () => screenLists(view)], [/^#\/import$/, () => screenImport(view)],
];
let current = "";
export function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function route(soft) {
  const h = location.hash || "#/";
  if (!S.ready && !/^#\/reglages/.test(h)) { location.replace("#/reglages"); return; }
  if (soft && (/^#\/(ajout|coche|listes|import)/.test(h))) return; // never redraw a form while it is open
  if (soft && h === current && document.querySelector(".keep-scroll")) { const y = scrollY; draw(h); scrollTo(0, y); return; }
  draw(h);
}
function draw(h) {
  for (const [re, fn] of ROUTES) { const m = h.match(re); if (m) { current = h; if (fn !== screenSettings && !S.hasData) { loading(); return; } fn(...m.slice(1)); setNav(h); return; } }
  location.replace("#/");
}
window.addEventListener("hashchange", () => { route(); scrollTo(0, 0); });
function setNav(h) { $$("#nav a").forEach((a) => a.setAttribute("aria-current", h.startsWith(a.getAttribute("href")) && (a.getAttribute("href") !== "#/" || h === "#/" || /^#\/(liste|espece)/.test(h)) ? "page" : "false")); }
function loading() {
  view.innerHTML = S.state === "error" || S.state === "offline" ? `<div class="empty"><p>${esc(S.error || "Impossible de lire la base.")}</p><p><a href="#/reglages">Réglages</a></p></div>` : `<div class="empty"><p>Lecture de la base sur GitHub…</p></div>`;
}

// ---------- shared bits ----------
const nameLink = (sid) => `<a href="#/espece/${esc(sid)}">${esc(M.name(sid))}</a>`;
const L = (cle) => M.liste.get(cle) || { nom: cle };
const numOf = (t) => t.n ? `n°${t.n}` : "";
const cstyle = (cle) => `style="--c:${M.color(cle)}"`;
const chip = (cle) => `<span class="chip-s" ${cstyle(cle)}>${esc(L(cle).nom)}</span>`;
function row(t, { rank, showList = false } = {}) {
  const place = t.l && t.l !== t.p ? t.l : "";
  return `<li class="tick"><span class="n" ${cstyle(t.cle)}>${rank != null ? rank : M.rankOf(t)}</span><span class="what">${nameLink(t.e)}${showList ? " " + chip(t.cle) : ""}${!isFrance(t.p) ? ` <span class="abroad">${esc(t.p)}</span>` : ""}<small>${esc(place)}</small></span><span class="when">${t.d ? esc(fmtShort(t.d)) : "<em>sans date</em>"}</span></li>`;
}

// ---------- home: the lists ----------
function screenHome() {
  const c = (cle) => M.liste.has(cle) ? M.count(cle) : 0;
  const rung = (cle, level, extra = "") => M.liste.has(cle) ? `<a class="rung l${level}" href="#/liste/${cle}"><span class="nm">${esc(L(cle).nom)}</span><b>${c(cle)}</b>${extra}</a>` : "";
  const vu = M.vuOpen();
  const liferAll = new Set([...M.speciesOf(LIFERS).map((t) => t.e), ...vu.ab.map((t) => t.e)]).size;
  const side = (cles) => `<div class="side">${cles.filter((k) => M.liste.has(k)).map((k) => `<a href="#/liste/${k}">${esc(L(k).nom)} <b>${c(k)}</b></a>`).join("")}</div>`;
  const zones = M.listes.filter((l) => l.type === "zone").map((l) => l.cle);
  const others = M.listes.filter((l) => !["annee", "vu"].includes(l.type) && ![LIFERS, PHOTO_FR, "aura", "rhone", "jardin", "bureau", "ouessant"].includes(l.cle));
  const guy = M.speciesOf("guyane"), gt = (k) => guy.filter((t) => norm(t.t) === k).length;
  const yr = M.years.slice().reverse();
  view.innerHTML = `<div class="screen keep-scroll">
    <section><h2>Mes listes</h2>
      <div class="ladder">
        ${rung(LIFERS, 0, `<small>${liferAll} en comptant les espèces vues ou entendues à l'étranger</small>`)}
        ${rung(PHOTO_FR, 1)}
        ${rung("aura", 2)}
        ${rung("rhone", 3)}
        ${side(["jardin", "bureau"])}
      </div>
      ${side(["ouessant", ...zones.filter((z) => !["aura", "rhone", "jardin", "bureau", "ouessant"].includes(z))])}
    </section>
    ${others.length ? `<section><h3 class="minor">Voyages</h3>${others.map((l) => `<a class="rung" href="#/liste/${l.cle}"><span class="nm">${esc(l.nom)}</span><b>${c(l.cle)}</b>${l.cle === "guyane" ? `<small>${gt("vu")} vues, ${gt("entendu")} entendues, le reste en photo</small>` : ""}</a>`).join("")}</section>` : ""}
    <section><h3 class="minor">Vu ou entendu, pas encore photographié</h3>
      <a class="rung" href="#/liste/vu?f=fr"><span class="nm">En France, pas encore en photo France</span><b>${vu.fr.length}</b></a>
      <a class="rung" href="#/liste/vu?f=ab"><span class="nm">À l'étranger, jamais photographiées</span><b>${vu.ab.length}</b></a>
    </section>
    <section><h3 class="minor">Year lists</h3><div class="years">${yr.map((y) => { const fr = M.yearList(y, "fr").length, w = M.yearList(y, "monde").length; return `<a href="#/annee/${y}"><span>${y}</span><b>${fr}</b>${w !== fr ? `<small>${w} avec l'étranger</small>` : ""}</a>`; }).join("")}</div></section>
  </div>`;
}

// ---------- one list ----------
function screenList(cle) {
  const l = M.liste.get(cle); if (!l) return go("#/");
  const f = new URLSearchParams(location.hash.split("?")[1] || "").get("f");
  let items = M.speciesOf(cle);
  if (cle === VU && f) { const v = M.vuOpen(); const keep = new Set((f === "fr" ? v.fr : v.ab).map((t) => t.e)); items = items.filter((t) => keep.has(t.e)); }
  const sort = UI.sort || (l.numerotee ? "n" : "date");
  const sorted = items.slice().sort(sort === "nom" ? (a, b) => M.name(a.e).localeCompare(M.name(b.e), "fr") : sort === "n" ? (a, b) => (M.rankOf(a) || 1e9) - (M.rankOf(b) || 1e9) : (a, b) => (b.d || "").localeCompare(a.d || ""));
  const parent = l.dans && M.liste.get(l.dans);
  view.innerHTML = `<div class="screen keep-scroll">
    <header class="phead"><a class="back" href="#/">← Listes</a><h1>${esc(l.nom)}</h1><p class="big">${items.length} <small>${plural(items.length, "espèce")}</small></p>${l.note ? `<p class="cap">${esc(l.note)}${parent ? ` · comprise dans ${esc(parent.nom)}` : ""}</p>` : ""}</header>
    <div class="tools"><input class="field" type="search" id="q" placeholder="Chercher dans la liste" value="${esc(UI.q || "")}">
      <div class="seg" role="group" aria-label="Trier">${[["n", "N°"], ["date", "Date"], ["nom", "Nom"]].map(([k, t]) => `<button type="button" data-sort="${k}" aria-pressed="${sort === k}">${t}</button>`).join("")}</div></div>
    <ul class="ticks" id="rows">${sorted.map((t) => row(t)).join("")}</ul>
  </div>`;
  const q = $("#q"), rows = $$("#rows li");
  const filter = () => { const k = norm(q.value); saveUI({ q: q.value }); rows.forEach((li) => { li.hidden = k && !norm(li.textContent).includes(k); }); };
  q.addEventListener("input", filter); filter();
  $$("[data-sort]").forEach((b) => b.addEventListener("click", () => { saveUI({ sort: b.dataset.sort }); screenList(cle); }));
}

// ---------- year list ----------
function screenYear(y) {
  const years = M.years; const year = +(y || UI.year || years[years.length - 1]);
  if (!years.includes(year)) return go(`#/annee/${years[years.length - 1]}`);
  saveUI({ year });
  const scope = UI.scope, list = M.yearList(year, scope);
  const now = new Date(), past = year < now.getFullYear();
  // same date last year, for comparison
  const md = todayIso().slice(5), prev = M.years.includes(year - 1) ? M.yearList(year - 1, scope).filter((t) => t.d && t.d.slice(5) <= md).length : null;
  const atDate = past ? list.filter((t) => t.d && t.d.slice(5) <= md).length : null;
  const abroad = scope === "monde" ? list.filter((t) => !isFrance(t.p)) : [];
  const byC = {}; abroad.forEach((t) => { byC[t.p] = (byC[t.p] || 0) + 1; });
  const groups = new Map(); [...list.filter((t) => t.d).reverse(), ...list.filter((t) => !t.d)].forEach((t) => { const k = t.d || ""; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
  view.innerHTML = `<div class="screen keep-scroll">
    <div class="tools"><div class="seg" role="group" aria-label="Année">${years.map((x) => `<a href="#/annee/${x}" aria-pressed="${x === year}">${x}</a>`).join("")}</div>
      <div class="seg" role="group" aria-label="Portée"><button type="button" data-scope="fr" aria-pressed="${scope === "fr"}">France</button><button type="button" data-scope="monde" aria-pressed="${scope === "monde"}">France et étranger</button></div></div>
    <div class="hero"><b>${list.length}</b><div><p><strong>${past ? "Total de l'année" : `En ${year}`}</strong>${scope === "monde" ? ", étranger compris" : ", en France"}</p>
      ${atDate != null ? `<p>Au ${esc(fmtDay(year + "-" + md, false))} ${year} : <strong>${atDate}</strong> espèces</p>` : prev != null ? `<p>Au même jour en ${year - 1} : <strong>${prev}</strong>${list.length > prev ? ` <span class="up">+${list.length - prev}</span>` : list.length < prev ? ` <span class="down">${list.length - prev}</span>` : ""}</p>` : ""}
      ${abroad.length ? `<p>Dont ${abroad.length} à l'étranger (${Object.entries(byC).map(([c, n]) => `${esc(c)} ${n}`).join(", ")})</p>` : ""}</div></div>
    ${[...groups].map(([d, ts]) => `<section class="day"><h3 class="minor">${d ? esc(fmtDay(d)) : "Date inconnue"} · ${ts.length}</h3><ul class="ticks">${ts.map((t) => row(t, { rank: t.rank })).join("")}</ul></section>`).join("") || `<p class="empty">Aucune coche pour ${year}.</p>`}
  </div>`;
  $$("[data-scope]").forEach((b) => b.addEventListener("click", () => { saveUI({ scope: b.dataset.scope }); screenYear(year); }));
}

// ---------- journal ----------
function screenJournal() {
  const F = Object.assign({ q: "", cle: "", year: "", miss: "" }, UI.jf || {});
  const lists = M.listes;
  const years = [...new Set(M.ticks.map((t) => yearOf(t.d)).filter(Boolean))].sort((a, b) => b - a);
  view.innerHTML = `<div class="screen">
    <h2>Journal</h2>
    <div class="filters"><input class="field" type="search" id="jq" placeholder="Espèce, lieu, détail…" value="${esc(F.q)}">
      <select class="field" id="jl"><option value="">Toutes les listes</option>${lists.map((l) => `<option value="${l.cle}" ${F.cle === l.cle ? "selected" : ""}>${esc(l.nom)}</option>`).join("")}</select>
      <select class="field" id="jy"><option value="">Toutes les années</option>${years.map((y) => `<option ${+F.year === y ? "selected" : ""}>${y}</option>`).join("")}<option value="none" ${F.year === "none" ? "selected" : ""}>Sans date</option></select>
      <select class="field" id="jm"><option value="">Tout</option><option value="coords" ${F.miss === "coords" ? "selected" : ""}>Sans coordonnées</option><option value="lieu" ${F.miss === "lieu" ? "selected" : ""}>Sans lieu</option></select></div>
    <p class="cap" id="jc"></p><ul class="ticks" id="jr"></ul><button class="btn" id="more" hidden>Afficher plus</button></div>`;
  let shown = 200;
  const draw = () => {
    const k = norm(F.q);
    const res = M.ticks.filter((t) => (!F.cle || t.cle === F.cle) && (!F.year || (F.year === "none" ? !t.d : yearOf(t.d) === +F.year)) && (!F.miss || (F.miss === "coords" ? t.lat == null : !t.l))
      && (!k || norm(`${M.name(t.e)} ${t.l || ""} ${t.p || ""} ${t.t || ""}`).includes(k)))
      .sort((a, b) => (b.d || "").localeCompare(a.d || "") || (b.n || 0) - (a.n || 0));
    $("#jc").textContent = `${res.length} ${plural(res.length, "coche")}`;
    $("#jr").innerHTML = res.slice(0, shown).map((t) => `<li class="tick link" data-edit="${t.cle}/${t.id}"><span class="n" ${cstyle(t.cle)}>${M.rankOf(t)}</span><span class="what"><b>${esc(M.name(t.e))}</b> ${chip(t.cle)}${!isFrance(t.p) ? ` <span class="abroad">${esc(t.p)}</span>` : ""}<small>${esc(t.l || "")}${t.lat == null ? ' <span class="miss">sans coordonnées</span>' : ""}${t.t ? " · " + esc(t.t) : ""}</small></span><span class="when">${t.d ? esc(fmtShort(t.d)) : "<em>sans date</em>"}</span></li>`).join("");
    $("#more").hidden = res.length <= shown;
  };
  const set = (p) => { Object.assign(F, p); saveUI({ jf: F }); shown = 200; draw(); };
  $("#jq").addEventListener("input", (e) => set({ q: e.target.value }));
  $("#jl").addEventListener("change", (e) => set({ cle: e.target.value }));
  $("#jy").addEventListener("change", (e) => set({ year: e.target.value }));
  $("#jm").addEventListener("change", (e) => set({ miss: e.target.value }));
  $("#more").addEventListener("click", () => { shown += 300; draw(); });
  $("#jr").addEventListener("click", (e) => { const li = e.target.closest("[data-edit]"); if (li) go(`#/coche/${li.dataset.edit}`); });
  draw();
}

// ---------- one species ----------
function screenSpecies(sid) {
  const e = M.esp.get(sid); if (!e) return go("#/");
  const m = M.bySp.get(sid) || new Map();
  const st = (e.st || []).map((v, i) => v ? `${["Nicheur", "Hivernant", "De passage", "Occasionnel"][i]} ${esc(v)}` : "").filter(Boolean).join(" · ");
  const blocks = M.listes.filter((l) => m.has(l.cle)).map((l) => `<li><b>${esc(l.nom)}</b> ${m.get(l.cle).map((t) => `<span class="tk">${t.n ? `n°${t.n} · ` : ""}${t.d ? esc(fmtDay(t.d)) : "sans date"}${t.l ? ` · ${t.lat != null ? `<a href="https://www.openstreetmap.org/?mlat=${t.lat}&mlon=${t.lon}#map=15/${t.lat}/${t.lon}" target="_blank" rel="noopener">${esc(t.l)}</a>` : esc(t.l)}` : ""}${!isFrance(t.p) ? ` · ${esc(t.p)}` : ""}${t.t ? ` · ${esc(t.t)}` : ""} <a class="linkish" href="#/coche/${l.cle}/${t.id}">modifier</a></span>`).join("")}</li>`).join("");
  const pts = [...m.values()].flat().filter((t) => t.lat != null).map((t) => ({ lat: t.lat, lon: t.lon, html: `${esc(L(t.cle).nom)} · ${esc(t.d ? fmtShort(t.d) : "")}<br>${esc(t.l || "")}` }));
  view.innerHTML = `<div class="screen">
    <header class="phead"><a class="back" href="javascript:history.back()">← Retour</a><h1>${esc(e.n)}</h1><p class="cap">${[e.sc ? `<i>${esc(e.sc)}</i>` : "", e.fa ? esc(e.fa) : ""].filter(Boolean).join(" · ")}${e.lr ? ` · Liste rouge mondiale <span class="lr lr-${esc(String(e.lr).slice(0, 2).toLowerCase())}">${esc(e.lr)}</span>` : ""}</p>${st ? `<p class="cap">Statut en France : ${st}</p>` : ""}${e.q ? `<p class="cap">Qualité photo : ${esc(e.q)}</p>` : ""}</header>
    ${blocks ? `<ul class="plain">${blocks}</ul>` : `<p class="empty">Pas encore cochée.</p>`}
    ${pts.length ? `<div class="minimap" id="mm"></div>` : ""}
    <a class="btn btn-primary" href="#/ajout?e=${encodeURIComponent(sid)}">Ajouter une coche pour cette espèce</a>
  </div>`;
  if (pts.length) mapView($("#mm"), pts);
}

// ---------- more ----------
function screenMore() {
  const c = M.checks(), open = M.db.taches.filter((t) => !t.fait).length;
  view.innerHTML = `<div class="screen"><h2>Plus</h2><nav class="menu">
    <a href="#/calendrier"><b>Calendrier des coches photo</b><small>Toutes les années superposées</small></a>
    <a href="#/a-faire"><b>À faire</b><small>${open} ${plural(open, "tâche")} · ${c.undated.length} coches sans date · ${c.yearMissing.length + c.nested.length} incohérences</small></a>
    <a href="#/listes"><b>Mes listes</b><small>Créer une liste région, département, lieu ou pays ; couleurs</small></a>
    <a href="#/import"><b>Importer</b><small>Faune-France, eBird ou cocheurs : compléter dates, lieux et espèces</small></a>
    <button type="button" id="xx"><b>Exporter en Excel</b><small>Toutes les coches, les espèces et les listes</small></button>
    <button type="button" id="xj"><b>Sauvegarde complète (.json)</b><small>Copie exacte de la base</small></button>
    <a href="#/reglages"><b>Réglages</b><small>Clé d'accès GitHub, dépôt, cache</small></a>
  </nav><p class="cap">La base est dans le dépôt privé <a href="https://github.com/${esc(S.cfg.owner)}/${esc(S.cfg.repo)}/commits/${esc(S.cfg.branch)}" target="_blank" rel="noopener">${esc(S.cfg.owner)}/${esc(S.cfg.repo)}</a> : chaque modification y est enregistrée, avec son historique.</p></div>`;
  $("#xx").addEventListener("click", () => exportXlsx(M).catch((e) => toast(e.message, "error")));
  $("#xj").addEventListener("click", () => exportJson(S.db));
}

// ---------- calendar of Photo France ticks ----------
export const CAL_COLORS = ["#F3E79B", "#F2C462", "#B9D36E", "#7CC17A", "#3FAE8E", "#2A9BA8", "#2C7FB8", "#3B5BA5", "#4B3F8F", "#6A3285", "#8E2A73", "#B0254F"];
function screenCalendar() {
  const days = M.calendar(), DIM = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const sel = UI.calDay || todayIso().slice(5);
  const color = (n) => CAL_COLORS[Math.min(n, 12) - 1];
  const ink = (n) => n >= 7 ? "#fff" : "#1F2933";
  let grid = `<div class="cal" role="grid"><span></span>${Array.from({ length: 31 }, (_, i) => `<span class="dh">${i + 1}</span>`).join("")}`;
  for (let m = 0; m < 12; m++) {
    grid += `<span class="mh">${MOIS_C[m]}</span>`;
    for (let d = 1; d <= 31; d++) {
      const k = `${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, n = (days.get(k) || []).length;
      grid += d > DIM[m] ? `<span class="off"></span>` : `<button type="button" data-day="${k}" class="${k === sel ? "sel" : ""}" style="${n ? `background:${color(n)};color:${ink(n)}` : ""}" aria-label="${d} ${MOIS[m]} : ${n} ${plural(n, "coche")}">${n || ""}</button>`;
    }
  }
  grid += "</div>";
  const ts = (days.get(sel) || []).slice().sort((a, b) => a.d.localeCompare(b.d));
  const [sm, sd] = sel.split("-").map(Number);
  const total = [...days.values()].reduce((s, a) => s + a.length, 0);
  view.innerHTML = `<div class="screen"><h2>Calendrier des coches photo France</h2><p class="cap">Toutes tes années superposées : chaque case dit combien de coches photo France tu as faites à cette date (${total} en tout). Touche une case.</p>
    <div class="calwrap">${grid}</div>
    <div class="legend">${CAL_COLORS.map((c, i) => `<span style="background:${c};color:${ink(i + 1)}">${i === 11 ? "12+" : i + 1}</span>`).join("")}</div>
    <section><h3 class="minor">${sd === 1 ? "1er" : sd} ${MOIS[sm - 1]} · ${ts.length} ${plural(ts.length, "coche")}</h3><ul class="ticks">${ts.map((t) => row(t, { rank: t.n })).join("") || '<li class="cap">Aucune coche photo France à cette date.</li>'}</ul></section></div>`;
  $$("[data-day]").forEach((b) => b.addEventListener("click", () => { saveUI({ calDay: b.dataset.day }); screenCalendar(); }));
}

// ---------- to do ----------
function screenTodo() {
  const c = M.checks(), tasks = M.db.taches;
  const cats = [...new Set(tasks.map((t) => t.cat))];
  const und = new Map(); c.undated.forEach((t) => { if (!und.has(t.cle)) und.set(t.cle, []); und.get(t.cle).push(t); });
  view.innerHTML = `<div class="screen keep-scroll"><h2>À faire</h2>
    ${c.placeMismatch.length ? `<section><h3 class="minor">Même observation, lieux différents</h3><p class="cap">Même espèce, même jour, mais pas le même lieu selon la liste. « Aligner » reprend partout le lieu le plus précis.</p><div class="row"><button class="btn btn-primary" id="align-all">Tout aligner (${c.placeMismatch.length})</button></div><ul class="todo">
      ${c.placeMismatch.slice(0, 60).map((x, i) => `<li><span>${nameLink(x.src.e)} · ${esc(fmtShort(x.src.d))}<small>${chip(x.src.cle)} ${esc(x.src.l || (x.src.lat != null ? x.src.lat + ", " + x.src.lon : ""))} · ailleurs : ${x.others.map((t) => `${chip(t.cle)} ${esc(t.l || (t.lat != null ? "coordonnées différentes" : "sans lieu"))}`).join(" ")}</small></span><button class="btn" data-align="${i}">Aligner</button></li>`).join("")}</ul></section>` : ""}
    ${c.yearMissing.length || c.nested.length ? `<section><h3 class="minor">Incohérences trouvées dans la base</h3><ul class="todo">
      ${c.yearMissing.map((x) => `<li><span>${nameLink(x.t.e)} a une coche datée de ${x.year} (${esc(L(x.t.cle).nom)}, ${esc(fmtShort(x.t.d))}) mais n'est pas dans la year list ${x.year}.</span> <button class="btn" data-addyl="${x.t.cle}/${x.t.id}">Ajouter à ${x.year}</button></li>`).join("")}
      ${c.nested.map((x) => `<li><span>${nameLink(x.t.e)} est dans ${esc(L(x.liste).nom)} mais pas dans ${esc(L(x.parent).nom)}.</span> <a class="btn" href="#/espece/${esc(x.t.e)}">Voir</a></li>`).join("")}
    </ul></section>` : ""}
    <section><h3 class="minor">Coches sans date</h3><p class="cap">${[...und].map(([k, a]) => `<a href="#" data-undated="${k}">${esc(L(k).nom)} ${a.length}</a>`).join(" · ") || "Aucune."}</p>
      <h3 class="minor">Coches sans coordonnées</h3><p class="cap">${[...c.noCoords].filter(([k]) => !["jardin", "bureau"].includes(k)).map(([k, n]) => `<a href="#" data-nocoords="${k}">${esc(L(k).nom)} ${n}</a>`).join(" · ") || "Aucune."}</p></section>
    ${cats.map((cat) => `<section><h3 class="minor">${esc(cat)}</h3><ul class="todo">${tasks.filter((t) => t.cat === cat).map((t) => `<li class="${t.fait ? "done" : ""}"><label class="chk"><input type="checkbox" data-task="${esc(t.id)}" ${t.fait ? "checked" : ""}><span><b>${esc(t.esp || "")}</b>${t.esp ? " · " : ""}${esc(t.quoi)}${t.liste ? ` <span class="chip-s">${esc(t.liste)}</span>` : ""}${t.det ? `<small>${esc(t.det)}</small>` : ""}</span></label></li>`).join("")}</ul></section>`).join("")}
  </div>`;
  $$("[data-task]").forEach((i) => i.addEventListener("change", () => { const t = tasks.find((x) => x.id === i.dataset.task); S.apply({ kind: "set-tache", id: t.id, patch: { fait: i.checked || null } }, `${i.checked ? "Fait" : "À refaire"} : ${t.esp ? t.esp + " · " : ""}${t.quoi}`); }));
  $$("[data-undated]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); saveUI({ jf: { q: "", cle: a.dataset.undated, year: "none", miss: "" } }); go("#/journal"); }));
  $$("[data-nocoords]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); saveUI({ jf: { q: "", cle: a.dataset.nocoords, year: "", miss: "coords" } }); go("#/journal"); }));
  const alignOps = (x) => x.others.map((t) => ({ kind: "set-tick", cle: t.cle, id: t.id, patch: { l: x.src.l || null, lat: x.src.lat ?? null, lon: x.src.lon ?? null, p: x.src.p || null } }));
  $$("[data-align]").forEach((b) => b.addEventListener("click", () => { const x = c.placeMismatch[+b.dataset.align]; S.apply(alignOps(x), `Lieu aligné : ${M.name(x.src.e)} (${fmtShort(x.src.d)})`); }));
  const aa = $("#align-all"); if (aa) aa.addEventListener("click", () => { S.apply(c.placeMismatch.flatMap(alignOps), `Lieux alignés : ${c.placeMismatch.length} observations`); toast("Lieux alignés."); });
  $$("[data-addyl]").forEach((b) => b.addEventListener("click", () => {
    const [cle, id] = b.dataset.addyl.split("/"), t = (M.db.coches[cle] || []).find((x) => x.id === id); if (!t) return;
    const y = yearOf(t.d); const tick = { id: `yl${y}-${Date.now().toString(36)}`, e: t.e, d: t.d }; ["l", "p", "lat", "lon"].forEach((k) => { if (t[k] != null) tick[k] = t[k]; });
    S.apply({ kind: "add-tick", cle: "yl" + y, tick }, `Ajout : ${M.name(t.e)} (YL ${y})`); toast(`${M.name(t.e)} ajoutée à ${y}.`);
  }));
}

// ---------- settings ----------
function screenSettings() {
  const c = S.cfg, first = !S.ready;
  view.innerHTML = `<div class="screen"><h2>${first ? "Bienvenue dans Rencontre Ornitho" : "Réglages"}</h2>
    ${first ? `<p>Ta base est dans un dépôt GitHub privé. Pour que l'appli puisse la lire et l'enregistrer depuis cet appareil, colle ici une clé d'accès GitHub. Elle reste sur cet appareil.</p>` : ""}
    <form class="panel" id="cfg">
      <label>Clé d'accès GitHub<input class="field" type="password" id="tok" autocomplete="off" placeholder="github_pat_…" value="${esc(c.token)}"></label>
      <details ${first ? "open" : ""}><summary>Créer la clé (2 minutes)</summary><ol class="steps">
        <li>Ouvre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com › Settings › Fine-grained tokens › Generate new token</a>.</li>
        <li>Nom : « Rencontre Ornitho ». Expiration : la plus longue proposée.</li>
        <li>Repository access : <b>Only select repositories</b> › <b>${esc(c.repo)}</b>.</li>
        <li>Permissions › Repository permissions › <b>Contents : Read and write</b>.</li>
        <li>Generate token, copie la clé et colle-la ci-dessus.</li></ol></details>
      <div class="row3"><label>Compte<input class="field" id="own" value="${esc(c.owner)}"></label><label>Dépôt<input class="field" id="rep" value="${esc(c.repo)}"></label><label>Branche<input class="field" id="br" value="${esc(c.branch)}"></label></div>
      <div class="row"><button class="btn btn-primary" type="submit">Enregistrer et tester</button></div><p class="msg" id="cmsg"></p>
    </form>
    ${!first ? `<section class="panel"><p>${S.pending.length ? `${S.pending.length} ${plural(S.pending.length, "changement")} pas encore ${S.pending.length > 1 ? "envoyés" : "envoyé"}.` : "Tout est envoyé sur GitHub."} ${S.error ? `<br><span class="miss">${esc(S.error)}</span>` : ""}</p>
      <div class="row"><button class="btn" id="sync" type="button">Synchroniser maintenant</button><button class="btn" id="reload" type="button">Relire toute la base</button></div>
      <p class="cap">« Relire toute la base » vide la copie gardée sur cet appareil et la relit sur GitHub. Les changements pas encore envoyés sont gardés.</p></section>` : ""}
  </div>`;
  $("#cfg").addEventListener("submit", async (e) => {
    e.preventDefault(); const msg = $("#cmsg");
    S.setConfig({ token: $("#tok").value.trim(), owner: $("#own").value.trim(), repo: $("#rep").value.trim(), branch: $("#br").value.trim() || "main" });
    msg.className = "msg"; msg.textContent = "Test de la clé…";
    try { await S.testAccess(); msg.className = "msg ok"; msg.textContent = "Clé valide, lecture de la base…"; await S.sync(); if (S.state === "ok") go("#/"); else msg.textContent = S.error || ""; }
    catch (err) { msg.className = "msg bad"; msg.textContent = err.message; }
  });
  const sb = $("#sync"); if (sb) sb.addEventListener("click", () => S.sync());
  const rb = $("#reload"); if (rb) rb.addEventListener("click", () => { S.resetCache(); S.sync(); go("#/"); });
}

// ---------- start ----------
renderStatus(); route();
if (S.ready) S.sync();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
