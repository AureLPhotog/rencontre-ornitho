// Rencontre Ornitho: router, shell and the read-only screens.
import { $, $$, esc, norm, plural, fmtDay, fmtShort, MOIS, MOIS_C, todayIso, yearOf, isFrance, store, toast, srcName, QUALITES, qualite, qTag } from "./util.js";
import { Store } from "./store.js";
import { buildModel, PHOTO_FR, LIFERS, VU } from "./model.js";
import { renderAdd, renderEdit } from "./form.js";
import { mapView, listMap } from "./map.js";
import { photoBox, flickrKey, setFlickrKey } from "./photos.js";
import { exportXlsx, exportJson } from "./export.js";
import { screenLists } from "./lists.js";
import { screenImport } from "./importer.js";
import { distKm, whereIs, lieuDit } from "./geo.js";

export const S = new Store();
export let M = buildModel(S.db);
const UI = Object.assign({ scope: "fr", year: new Date().getFullYear() }, store("ro.ui") || {});
export const saveUI = (patch) => { Object.assign(UI, patch); store("ro.ui", UI); };
export { UI };

const view = $("#view");
S.on(() => {
  M = buildModel(S.db);
  renderStatus();
  const a = document.activeElement; // do not redraw under someone typing; a clicked button is fine
  if (!view.contains(a) || !a.matches("input:not([type=checkbox]):not([type=radio]), textarea, select")) route(true);
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
  [/^#\/journal$/, screenJournal], [/^#\/espece\/([\w-]+)(?:\?(.*))?$/, screenSpecies], [/^#\/ajout(?:\?(.*))?$/, (q) => renderAdd(view, new URLSearchParams(q || ""))],
  [/^#\/coche\/([\w-]+)\/([\w-]+)$/, screenTick], [/^#\/coche\/([\w-]+)\/([\w-]+)\/modifier$/, (cle, id) => renderEdit(view, cle, id)], [/^#\/plus$/, screenMore], [/^#\/calendrier$/, screenCalendar],
  [/^#\/a-faire$/, screenTodo], [/^#\/carte\/([\w-]+)$/, screenListMap], [/^#\/reglages$/, screenSettings], [/^#\/listes$/, () => screenLists(view)], [/^#\/import$/, () => screenImport(view)],
];
let current = "";
export function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function route(soft) {
  const h = location.hash || "#/";
  if (!S.ready && !/^#\/reglages/.test(h)) { location.replace("#/reglages"); return; }
  if (soft && (/^#\/(ajout|coche|listes|import|carte)/.test(h))) return; // never redraw a form while it is open
  if (soft && h === current && document.querySelector(".keep-scroll")) { const y = scrollY; draw(h); scrollTo(0, y); return; }
  draw(h);
}
let onKey = null; // a screen's keyboard shortcuts (species page: arrows)
window.addEventListener("keydown", (e) => { if (onKey) onKey(e); });
function draw(h) {
  onKey = null;
  for (const [re, fn] of ROUTES) { const m = h.match(re); if (m) { current = h; if (fn !== screenSettings && !S.hasData) { loading(); return; } fn(...m.slice(1)); setNav(h); return; } }
  location.replace("#/");
}
window.addEventListener("hashchange", () => { route(); scrollTo(0, 0); });
function setNav(h) { $$("#nav a").forEach((a) => a.setAttribute("aria-current", h.startsWith(a.getAttribute("href")) && (a.getAttribute("href") !== "#/" || h === "#/" || /^#\/(liste|espece)/.test(h)) ? "page" : "false")); }
function loading() {
  view.innerHTML = S.state === "error" || S.state === "offline" ? `<div class="empty"><p>${esc(S.error || "Impossible de lire la base.")}</p><p><a href="#/reglages">Réglages</a></p></div>` : `<div class="empty"><p>Lecture de la base sur GitHub…</p></div>`;
}

// ---------- shared bits ----------
// from: the list the link is shown in, so the species page can go to the previous / next species of that list
const nameLink = (sid, from) => `<a href="#/espece/${esc(sid)}${from ? "?l=" + encodeURIComponent(from) : ""}">${esc(M.name(sid))}</a>${qTag((M.esp.get(sid) || {}).q)}`;
const L = (cle) => M.liste.get(cle) || { nom: cle };
const numOf = (t) => t.n ? `n°${t.n}` : "";
const cstyle = (cle) => `style="--c:${M.color(cle)}"`;
const chip = (cle) => `<span class="chip-s" ${cstyle(cle)}>${esc(L(cle).nom)}</span>`;
// ---------- photos ----------
// a photo of the data repository: the <img> gets its picture when it comes into view
const phImg = (img, alt = "") => `<img class="ph" data-ph="${esc(img)}" data-alt="${esc(alt)}" alt="">`;
let phObs = null;
function hydrate(root) {
  const imgs = $$("img[data-ph]:not([data-done])", root); if (!imgs.length) return;
  const load = (im) => { im.dataset.done = "1"; if (/^https?:/.test(im.dataset.ph)) { im.alt = im.dataset.alt || ""; im.src = im.dataset.ph; return; } S.imageUrl(im.dataset.ph).then((u) => { if (u) { im.alt = im.dataset.alt || ""; im.src = u; } else im.classList.add("ph-none"); }).catch(() => im.classList.add("ph-none")); };
  if (!("IntersectionObserver" in window)) { imgs.forEach(load); return; }
  phObs = phObs || new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { phObs.unobserve(e.target); load(e.target); } }), { rootMargin: "300px" });
  imgs.forEach((im) => phObs.observe(im));
}
// any screen that draws photos gets them loaded, however it was drawn
new MutationObserver(() => hydrate(view)).observe(view, { childList: true, subtree: true });
// several photos of one species (photo of the tick, first photo, best photo): arrows to go from one to the other
export function phSlider(photos, name) {
  if (!photos.length) return "";
  return `<div class="phs" data-i="0">${photos.map((p, i) => `<figure class="phs-f"${i ? " hidden" : ""}>${phImg(p.img || p.url, name)}<figcaption><b>${esc(p.label)}</b>${p.d ? " · " + esc(fmtShort(p.d)) : ""}${p.zone && p.zone !== "France" ? " · " + esc(p.zone) : ""}<small>${esc(p.file || "")}${p.page ? ` · <a href="${esc(p.page)}" target="_blank" rel="noopener">voir sur Flickr</a>` : ""}</small></figcaption></figure>`).join("")}${photos.length > 1 ? `<button type="button" class="phs-b prev" aria-label="Photo précédente">‹</button><button type="button" class="phs-b next" aria-label="Photo suivante">›</button><span class="phs-n">1 / ${photos.length}</span>` : ""}</div>`;
}
export function wirePhotos(root) {
  $$(".phs:not([data-w])", root).forEach((box) => {
    box.dataset.w = "1"; const fs = $$(".phs-f", box);
    const show = (d) => { const i = (+box.dataset.i + d + fs.length) % fs.length; box.dataset.i = i; fs.forEach((f, k) => { f.hidden = k !== i; }); const n = $(".phs-n", box); if (n) n.textContent = `${i + 1} / ${fs.length}`; hydrate(box); };
    $$(".phs-b", box).forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); show(b.classList.contains("prev") ? -1 : 1); }));
  });
  hydrate(root);
}
// a tap on a photo shows it big
document.addEventListener("click", (ev) => {
  const im = ev.target.closest("img.ph[src]"); if (!im || im.closest(".ph-pk")) return;
  const box = document.createElement("div"); box.className = "lightbox"; box.innerHTML = `<img src="${im.src}" alt="${esc(im.alt)}"><button type="button" aria-label="Fermer">×</button>`;
  const close = () => { box.remove(); document.removeEventListener("keydown", esc_); };
  const esc_ = (e) => { if (e.key === "Escape") close(); };
  box.addEventListener("click", close); document.addEventListener("keydown", esc_); document.body.appendChild(box);
});

// in a list, a row opens that tick (toTick); elsewhere it opens the species page
function row(t, { rank, showList = false, from, toTick = false } = {}) {
  const place = t.l && t.l !== t.p ? t.l : "";
  const name = toTick ? `<a href="#/coche/${esc(t.cle)}/${esc(t.id)}">${esc(M.name(t.e))}</a>${qTag((M.esp.get(t.e) || {}).q)}${t.ph ? ' <span class="cap" title="Photo de la coche">📷</span>' : ""}` : nameLink(t.e, from);
  return `<li class="tick"><span class="n" ${cstyle(t.cle)}>${rank != null ? rank : M.rankOf(t)}</span><span class="what">${name}${showList ? " " + chip(t.cle) : ""}${!isFrance(t.p) ? ` <span class="abroad">${esc(t.p)}</span>` : ""}<small>${esc(place)}</small></span><span class="when">${t.d ? esc(fmtShort(t.d)) : "<em>sans date</em>"}</span></li>`;
}

// ---------- home: the lists ----------
function screenHome() {
  const c = (cle) => M.liste.has(cle) ? M.count(cle) : 0;
  const rung = (cle, level, extra = "") => M.liste.has(cle) ? `<a class="rung l${level}" href="#/liste/${cle}"><span class="nm">${esc(L(cle).nom)}</span><b>${c(cle)}</b>${extra}</a>` : "";
  const vu = M.vuOpen();
  const liferAll = new Set([...M.speciesOf(LIFERS).map((t) => t.e), ...vu.ab.map((t) => t.e)]).size;
  const side = (cles) => `<div class="side">${cles.filter((k) => M.liste.has(k)).map((k) => `<a href="#/liste/${k}">${esc(L(k).nom)} <b>${c(k)}</b></a>`).join("")}</div>`;
  const zones = M.listes.filter((l) => l.type === "zone" || l.type === "lieu").map((l) => l.cle);
  const others = M.listes.filter((l) => !["annee", "vu", "zone", "lieu", "photo"].includes(l.type));
  const guy = M.speciesOf("guyane"), gt = (k) => guy.filter((t) => norm(t.t) === k).length;
  const yr = M.years.slice().reverse();
  view.innerHTML = `<div class="screen keep-scroll">
    <section><h2>Mes listes</h2>
      <div class="hsearch"><input class="field" type="search" id="hq" placeholder="Chercher un oiseau (nom, autre nom, nom latin)" autocomplete="off" value="${esc(UI.hq || "")}"><ul class="hres" id="hres" hidden></ul></div>
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
  // search a bird across all lists: where it is ticked, with the name that matched
  const hq = $("#hq"), hres = $("#hres");
  const where = (sid) => { const m = M.bySp.get(sid); return m ? M.listes.filter((l) => m.has(l.cle) && l.type !== "annee").map((l) => chip(l.cle)).join(" ") : '<span class="cap">jamais cochée</span>'; };
  const hdraw = () => {
    const v = hq.value.trim(); saveUI({ hq: v }); const k = norm(v);
    if (!k) { hres.hidden = true; hres.innerHTML = ""; return; }
    const found = M.search(v, 25);
    hres.hidden = false;
    hres.innerHTML = found.map((e) => {
      const alt = norm(e.n).includes(k) ? "" : [...(e.al || []), e.sc, ...(e.scs || [])].filter(Boolean).find((a) => M.matches(k, a));
      return `<li><a href="#/espece/${esc(e.id)}"><b>${esc(e.n)}</b>${qTag(e.q)}${alt ? ` <small class="cap">(${esc(alt)})</small>` : ""}</a><span class="hwhere">${where(e.id)}</span></li>`;
    }).join("") || `<li class="cap">Aucun oiseau trouvé pour « ${esc(v)} ».</li>`;
  };
  hq.addEventListener("input", hdraw); hdraw();
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
    <header class="phead"><a class="back" href="#/">← Listes</a><h1>${esc(l.nom)}</h1><p class="big">${items.length} <small>${plural(items.length, "espèce")}</small> <a class="btn btn-map" href="#/carte/${esc(cle)}">🗺️ Carte</a></p>${l.note ? `<p class="cap">${esc(l.note)}${parent ? ` · comprise dans ${esc(parent.nom)}` : ""}</p>` : ""}</header>
    <div class="tools"><input class="field" type="search" id="q" placeholder="Chercher dans la liste" value="${esc(UI.q || "")}">
      <div class="seg" role="group" aria-label="Trier">${[["n", "N°"], ["date", "Date"], ["nom", "Nom"]].map(([k, t]) => `<button type="button" data-sort="${k}" aria-pressed="${sort === k}">${t}</button>`).join("")}</div></div>
    <ul class="ticks" id="rows">${sorted.map((t) => row(t, { from: cle, toTick: true })).join("")}</ul>
  </div>`;
  const q = $("#q"), rows = $$("#rows li");
  // the species page follows this order (and this search) with its arrows and swipes
  const filter = () => { const k = norm(q.value); rows.forEach((li, i) => { li.hidden = !!k && !M.matches(k, li.textContent) && !M.matchesSp(k, sorted[i].e); }); const shown = sorted.filter((_, i) => !rows[i].hidden); saveUI({ q: q.value, nav: { key: cle, nom: l.nom, ids: shown.map((t) => t.e), refs: shown.map((t) => t.cle + "/" + t.id) } }); };
  q.addEventListener("input", filter); filter();
  $$("[data-sort]").forEach((b) => b.addEventListener("click", () => { saveUI({ sort: b.dataset.sort }); screenList(cle); }));
}

// ---------- one tick ----------
// what was seen that day in that list; the species page is one tap away, and so are the same sighting in the other lists
function screenTick(cle, id) {
  const t = M.ticks.find((x) => x.cle === cle && x.id === id), l = M.liste.get(cle);
  if (!t || !l) { view.innerHTML = '<p class="empty">Cette coche n\'existe plus.</p>'; return; }
  const e = M.esp.get(t.e) || { n: t.e }, rk = M.rankOf(t);
  const photos = M.photosFor(t, { first: withPhotos(l) });
  const twins = t.d ? M.ticks.filter((x) => x !== t && M.sameObs(t, x)) : [];
  view.innerHTML = `<div class="screen">
    <header class="phead"><a class="back" href="javascript:history.back()">← Retour</a>
      <p class="cap">${chip(cle)}${rk ? ` <b>n°${rk}</b>` : ""}</p>
      <h1><a class="sp-link" href="#/espece/${esc(t.e)}?l=${esc(cle)}">${esc(e.n)}</a>${qTag(e.q)}</h1>
      <p class="cap">${e.sc ? `<i>${esc(e.sc)}</i>` : ""}</p></header>
    <a class="btn btn-primary" href="#/espece/${esc(t.e)}?l=${esc(cle)}">Page de l'espèce : toutes les listes et toutes les photos →</a>
    ${photos.length ? `<section class="sp-photos">${phSlider(photos, e.n)}</section>` : ""}
    <ul class="plain tkinfo"><li><b>Date</b> ${t.d ? esc(fmtDay(t.d)) : "<em>sans date</em>"}${t.sd ? ` <small>(${esc(srcName(t.sd))})</small>` : ""}</li>
      <li><b>Lieu</b> ${t.l ? esc(t.l) : "<em>sans nom</em>"}${t.lat != null ? ` · <a href="https://www.openstreetmap.org/?mlat=${t.lat}&mlon=${t.lon}#map=15/${t.lat}/${t.lon}" target="_blank" rel="noopener">${t.lat}, ${t.lon}</a>` : " · <em>sans coordonnées</em>"}${t.sl ? ` <small>(${esc(srcName(t.sl))})</small>` : ""}</li>
      ${!isFrance(t.p) ? `<li><b>Pays</b> ${esc(t.p)}</li>` : ""}${t.t ? `<li><b>Détail</b> ${esc(t.t)}</li>` : ""}
      ${twins.length ? `<li><b>Même observation</b> ${twins.map((x) => `<a class="chip-s" ${cstyle(x.cle)} href="#/coche/${x.cle}/${x.id}">${esc(L(x.cle).nom)}${M.rankOf(x) ? " n°" + M.rankOf(x) : ""}</a>`).join(" ")}</li>` : ""}</ul>
    ${t.lat != null ? '<div class="minimap" id="tkm"></div>' : ""}
    ${t.nph ? `<p class="cap">Marquée « pas de photo de cette coche ». <button type="button" class="linkish" id="tk-unnph">Annuler</button></p>` : ""}
    <div class="row"><a class="btn" href="#/coche/${cle}/${id}/modifier">Modifier la coche</a></div>
    <div id="tk-ph"></div>
  </div>`;
  if (t.lat != null) mapView($("#tkm"), [{ lat: t.lat, lon: t.lon, color: M.color(cle), r: 9, z: 1, html: `<b>${esc(e.n)}</b><br>${esc(t.l || "")}` }]);
  photoBox($("#tk-ph"), { kind: "tick", cle, tick: t }, phSlider);
  wirePhotos(view);
  const un = $("#tk-unnph"); if (un) un.addEventListener("click", () => { S.apply([t, ...twins].filter((x) => x.nph).map((x) => ({ kind: "set-tick", cle: x.cle, id: x.id, patch: { nph: null } })), `Photo à chercher : ${e.n}`); un.parentElement.remove(); toast("Remise dans « Coches sans photo »."); });
  // previous / next tick of the list it was opened from (arrows, swipe, keyboard)
  const nav = UI.nav && UI.nav.refs ? UI.nav : null, at = nav ? nav.refs.indexOf(cle + "/" + id) : -1;
  if (at < 0) return;
  const prev = at > 0 ? nav.refs[at - 1] : null, next = at < nav.refs.length - 1 ? nav.refs[at + 1] : null;
  const nm = (ref) => { const [c, i] = ref.split("/"); const x = M.ticks.find((y) => y.cle === c && y.id === i); return x ? M.name(x.e) : ""; };
  view.firstElementChild.insertAdjacentHTML("afterbegin", `<nav class="spnav" aria-label="Coches de la liste">${prev ? `<a class="spnav-a" href="#/coche/${prev}" data-nav="prev">‹<span>${esc(nm(prev))}</span></a>` : `<span class="spnav-a off">‹</span>`}<span class="spnav-pos">${at + 1} / ${nav.refs.length}<small>${esc(nav.nom)}</small></span>${next ? `<a class="spnav-a nx" href="#/coche/${next}" data-nav="next"><span>${esc(nm(next))}</span>›</a>` : `<span class="spnav-a nx off">›</span>`}</nav>`);
  const move = (ref) => { if (ref) { location.replace("#/coche/" + ref); scrollTo(0, 0); } };
  $$("[data-nav]", view).forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); move(a.dataset.nav === "prev" ? prev : next); }));
  let x0 = null, y0 = null; const scr = view.firstElementChild;
  scr.addEventListener("touchstart", (ev) => { if (ev.target.closest(".minimap, input, textarea, .phs, .phbox")) { x0 = null; return; } x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; }, { passive: true });
  scr.addEventListener("touchend", (ev) => { if (x0 == null) return; const dx = ev.changedTouches[0].clientX - x0, dy = ev.changedTouches[0].clientY - y0; x0 = null; if (Math.abs(dx) > 70 && Math.abs(dy) < 50) move(dx < 0 ? next : prev); }, { passive: true });
  onKey = (ev) => { if (ev.target.closest("input, textarea, select")) return; if (ev.key === "ArrowLeft") move(prev); if (ev.key === "ArrowRight") move(next); };
}

// ---------- one list on a map ----------
// every list has its map; the photos show only on the Lifers, Photo France and the country lists (Guyane, Suisse, Espagne…)
const withPhotos = (l) => l.cle === LIFERS || l.cle === PHOTO_FR || l.type === "pays";
function screenListMap(cle) {
  const l = M.liste.get(cle); if (!l) return go("#/");
  const ph = withPhotos(l), photosOf = (t) => M.photosFor(t, { first: ph });
  const items = M.speciesOf(cle), placed = items.filter((t) => t.lat != null), color = M.color(cle);
  view.innerHTML = `<div class="screen screen-map"><header class="phead"><a class="back" href="#/liste/${esc(cle)}">← ${esc(l.nom)}</a><h1>Carte · ${esc(l.nom)}</h1>
    <p class="cap">${placed.length} ${plural(placed.length, "coche")} sur la carte${items.length > placed.length ? ` · ${items.length - placed.length} sans coordonnées` : ""}. ${ph ? "Touche un point pour voir l'espèce et la photo de cette coche." : "Touche un point pour voir l'espèce."}</p></header>
    <div class="bigmap" id="lm"></div></div>`;
  // ticks on the very same point (same GPS fix, same named place) share one marker: its popup goes from one species to the next
  const groups = new Map();
  placed.forEach((t) => { const k = t.lat.toFixed(5) + "," + t.lon.toFixed(5); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
  const card = (t) => { const rk = M.rankOf(t); return `<b class="pop-n">${rk ? "n°" + rk + " · " : ""}${esc(M.name(t.e))}</b><small>${t.d ? esc(fmtDay(t.d)) : "sans date"}${t.l ? " · " + esc(t.l) : ""}${t.t ? " · " + esc(t.t) : ""}</small>${phSlider(photosOf(t), M.name(t.e)) || (ph ? '<p class="cap">Pas de photo de ce jour-là dans l\'appli.</p>' : "")}<span class="pop-links"><a class="linkish" href="#/coche/${esc(cle)}/${esc(t.id)}">La coche</a> · <a class="linkish" href="#/espece/${esc(t.e)}?l=${esc(cle)}">L'espèce</a></span>`; };
  const pts = [...groups.values()].map((ts) => {
    ts.sort((a, b) => (M.rankOf(a) || 1e9) - (M.rankOf(b) || 1e9) || (a.d || "").localeCompare(b.d || ""));
    return { lat: ts[0].lat, lon: ts[0].lon, count: ts.length, color: !ph || ts.some((t) => photosOf(t).length) ? color : "#9AA5A0", html: () => ts.length === 1 ? `<div class="pop">${card(ts[0])}</div>`
      : `<div class="pop pop-g" data-i="0"><div class="pop-head"><button type="button" class="pop-b" data-d="-1" aria-label="Espèce précédente">‹</button><span class="pop-c">1 / ${ts.length} ${plural(ts.length, "espèce")} à ce point</span><button type="button" class="pop-b" data-d="1" aria-label="Espèce suivante">›</button></div>
        <ul class="pop-list">${ts.map((t, i) => `<li><button type="button" data-k="${i}" class="${i ? "" : "on"}">${M.rankOf(t) ? M.rankOf(t) + " · " : ""}${esc(M.name(t.e))}</button></li>`).join("")}</ul>
        ${ts.map((t, i) => `<div class="pop-card"${i ? " hidden" : ""}>${card(t)}</div>`).join("")}</div>` };
  });
  listMap($("#lm"), pts, (el, popup) => {
    const fit = (root) => $$("img[data-ph]", root).forEach((im) => im.addEventListener("load", () => popup.update(), { once: true }));
    const g = $(".pop-g:not([data-w])", el);
    if (g) {
      g.dataset.w = "1"; const cards = $$(".pop-card", g), keys = $$("[data-k]", g);
      const show = (i) => { i = (i + cards.length) % cards.length; g.dataset.i = i; cards.forEach((c, k) => { c.hidden = k !== i; }); keys.forEach((b, k) => b.classList.toggle("on", k === i)); $(".pop-c", g).textContent = `${i + 1} / ${cards.length} espèces à ce point`; wirePhotos(cards[i]); fit(cards[i]); popup.update(); };
      $$(".pop-b", g).forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); show(+g.dataset.i + +b.dataset.d); }));
      keys.forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); show(+b.dataset.k); }));
      wirePhotos(cards[0]); fit(cards[0]);
    } else { wirePhotos(el); fit(el); }
  });
}

// ---------- year list ----------
// day of the year (0-based) of an ISO date, and the number of days in that year
const doy = (iso) => { const [Y, m, d] = iso.split("-").map(Number); return Math.round((Date.UTC(Y, m - 1, d) - Date.UTC(Y, 0, 1)) / 864e5); };
const daysIn = (y) => (new Date(y, 1, 29).getMonth() === 1 ? 366 : 365);
const diffTxt = (d) => (d > 0 ? "+" + d : d < 0 ? "−" + -d : "=");
const diffCls = (d) => (d > 0 ? "up" : d < 0 ? "down" : "");

function yearChart(year, series, cur, endX, todayX) {
  const W = 480, H = 230, Lm = 34, Rm = 46, T = 14, B = 26, days = daysIn(year);
  const all = [cur.at(-1) || { v: 0 }, ...series.flatMap((s) => s.pts.slice(-1))].map((p) => p.v);
  const yMax = Math.max(50, Math.ceil(Math.max(...all) / 50) * 50);
  const x = (d) => Lm + (d / days) * (W - Lm - Rm), y = (v) => T + (1 - v / yMax) * (H - T - B);
  let g = "";
  for (let v = 0; v <= yMax; v += yMax > 300 ? 100 : 50) g += `<line class="grid" x1="${Lm}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${Lm - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  "JFMAMJJASOND".split("").forEach((m, i) => { const s0 = doy(`${year}-${String(i + 1).padStart(2, "0")}-01`), e0 = i < 11 ? doy(`${year}-${String(i + 2).padStart(2, "0")}-01`) : days; g += `<text class="axis" x="${(x(s0) + x(e0)) / 2}" y="${H - 6}" text-anchor="middle">${m}</text>`; });
  const path = (pts, end) => { let p = `M${x(0)},${y(0)}`; pts.forEach((c) => { p += ` H${x(c.x).toFixed(1)} V${y(c.v).toFixed(1)}`; }); return p + (end != null ? ` H${x(end).toFixed(1)}` : ""); };
  const past = series.map((s) => `<path class="past" d="${path(s.pts, days - 1)}"><title>${s.year}</title></path>`).join("");
  const endV = cur.length ? cur[cur.length - 1].v : 0;
  const today = todayX != null ? `<line class="today" x1="${x(todayX)}" x2="${x(todayX)}" y1="${T}" y2="${y(0)}"/>` : "";
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Espèces cumulées au fil de l'année ${year}, comparées aux autres années">${g}${today}${past}
    <path class="line" d="${path(cur, endX)}"/><circle class="end" cx="${x(endX)}" cy="${y(endV)}" r="4.5"/><text class="endlabel" x="${x(endX) + 7}" y="${y(endV) + 6}">${endV}</text></svg>
    <p class="cap">Trait bleu : ${year}. Traits gris : autres années. Pointillé : aujourd'hui.</p></div>`;
}

function screenYear(y) {
  const years = M.years; const year = +(y || UI.year || years[years.length - 1]);
  if (!years.includes(year)) return go(`#/annee/${years[years.length - 1]}`);
  saveUI({ year });
  const scope = UI.scope, list = M.yearList(year, scope), thisYear = new Date().getFullYear(), past = year < thisYear;
  // the comparison date: today's day and month (31 December once a year is over and we look at this year)
  const md = todayIso().slice(5), dateLbl = fmtDay(`2000-${md}`, false);
  const series = years.map((yy) => {
    const l = M.yearList(yy, scope), dated = l.filter((t) => t.d).sort((a, b) => a.d.localeCompare(b.d));
    const pts = []; dated.forEach((t, i) => { const dx = doy(t.d); if (pts.length && pts[pts.length - 1].x === dx) pts[pts.length - 1].v = i + 1; else pts.push({ x: dx, v: i + 1 }); });
    return { year: yy, pts, at: dated.filter((t) => t.d.slice(5) <= md).length, full: yy < thisYear ? l.length : null, total: l.length };
  });
  const me = series.find((s) => s.year === year), others = series.filter((s) => s.year !== year);
  const cur = past ? me.at : list.length;
  const rows = series.map((s) => ({ y: s.year, at: s.year === year ? cur : s.at, full: s.full }));
  const rank = rows.slice().sort((a, b) => b.at - a.at).findIndex((r) => r.y === year) + 1;
  const prev = others.find((s) => s.year === year - 1), best = others.reduce((m, r) => (!m || r.at > m.at ? r : m), null);
  const lines = [];
  if (prev) lines.push(`<span class="${diffCls(cur - prev.at)}">${diffTxt(cur - prev.at)}</span> par rapport à ${prev.year} (${prev.at})`);
  if (best) lines.push(cur > best.at ? `Record battu : ${best.year} était ton meilleur score à cette date (${best.at})` : cur === best.at ? `À égalité avec ${best.year}, ton record à cette date` : `Record à cette date : ${best.at} en ${best.year} (<span class="down">${diffTxt(cur - best.at)}</span>)`);
  const head = rank === 1 ? "Ta meilleure year list" : `${rank}e meilleure year list`;
  const abroad = scope === "monde" ? list.filter((t) => !isFrance(t.p)) : [];
  const byC = {}; abroad.forEach((t) => { byC[t.p] = (byC[t.p] || 0) + 1; });
  const abroadTxt = abroad.length ? ` Dont ${abroad.length} à l'étranger (${Object.entries(byC).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${esc(c)} ${n}`).join(", ")}).` : "";
  // chart: this year up to today (or the whole year when it is over)
  const curPts = past ? me.pts : me.pts;
  const todayX = !past ? doy(todayIso()) : null, endX = past ? daysIn(year) - 1 : todayX;
  const maxAt = Math.max(1, ...rows.map((r) => r.at));
  // stats
  const dated = list.filter((t) => t.d), byDay = new Map(); dated.forEach((t) => byDay.set(t.d, (byDay.get(t.d) || 0) + 1));
  const bestDay = [...byDay].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const elapsed = past ? daysIn(year) : doy(todayIso()) + 1;
  const last = dated.slice().sort((a, b) => b.d.localeCompare(a.d) || (b.rank - a.rank))[0];
  const groups = new Map(); [...list.filter((t) => t.d).reverse(), ...list.filter((t) => !t.d)].forEach((t) => { const k = t.d || ""; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
  view.innerHTML = `<div class="screen keep-scroll">
    <div class="tools"><select class="field" id="yl-year" aria-label="Année" style="max-width:120px">${years.slice().reverse().map((x) => `<option ${x === year ? "selected" : ""}>${x}</option>`).join("")}</select>
      <div class="seg" role="group" aria-label="Portée"><button type="button" data-scope="fr" aria-pressed="${scope === "fr"}">France</button><button type="button" data-scope="monde" aria-pressed="${scope === "monde"}">France et étranger</button></div></div>
    <div class="hero"><b>${past ? list.length : cur}</b><div><h1>Year list ${year}${scope === "fr" ? " · France" : ""}</h1>
      <p>${past ? `Total de l'année.${abroadTxt}<br><strong>Au ${esc(dateLbl)} ${year} : ${cur} espèces</strong>, ${rank === 1 ? "ta meilleure year list à cette date" : `${rank}e sur ${rows.length} années à cette date`}.` : `<strong>${head} au ${esc(dateLbl)}</strong>, sur ${rows.length} années.${abroadTxt}`}${lines.length ? "<br>" + lines.join("<br>") : ""}</p></div></div>
    ${yearChart(year, others, curPts, endX, todayX)}
    <div><h3 class="minor">Au ${esc(dateLbl)}, les autres années</h3><div class="tblwrap"><table class="cmp"><thead><tr><th>Année</th><th>Espèces</th><th>Écart</th><th>Total final</th></tr></thead><tbody>
      ${rows.slice().sort((a, b) => b.y - a.y).map((r) => `<tr${r.y === year ? ' class="cur"' : ""}><td><a href="#/annee/${r.y}">${r.y}</a></td><td><span class="cbar"><i style="width:${((r.at / maxAt) * 100).toFixed(0)}%"></i></span>${r.at}</td><td>${r.y === year ? "" : `<span class="${diffCls(cur - r.at)}">${diffTxt(cur - r.at)}</span>`}</td><td>${r.full == null ? "en cours" : r.full}</td></tr>`).join("")}
    </tbody></table></div><p class="cap">Écart : ${year} moins l'année en question, au même jour.</p></div>
    ${dated.length ? `<div class="stats"><div class="stat"><span class="k">Jours de coche</span><span class="v">${byDay.size}<small> / ${elapsed} j</small></span><span class="s">${Math.round((byDay.size / elapsed) * 100)} % des jours ${past ? "de l'année" : "écoulés"}</span></div>
      <div class="stat"><span class="k">Meilleure journée</span><span class="v">${bestDay[1]}<small> coches</small></span><span class="s">${esc(fmtDay(bestDay[0]))}</span></div>
      <div class="stat"><span class="k">Dernière coche</span><span class="v">${esc(M.name(last.e))}</span><span class="s">n°${last.rank} · ${esc(fmtDay(last.d, false))}</span></div></div>` : ""}
    ${[...groups].map(([d, ts]) => `<section class="day"><h3 class="minor">${d ? esc(fmtDay(d)) : "Date inconnue"} · ${ts.length}</h3><ul class="ticks">${ts.map((t) => row(t, { rank: t.rank, from: "yl" + year, toTick: true })).join("")}</ul></section>`).join("") || `<p class="empty">Aucune coche pour ${year}.</p>`}
  </div>`;
  saveUI({ nav: { key: "yl" + year, nom: `YL ${year}`, ids: [...groups].flatMap(([, ts]) => ts.map((t) => t.e)), refs: [...groups].flatMap(([, ts]) => ts.map((t) => t.cle + "/" + t.id)) } });
  $$("[data-scope]").forEach((b) => b.addEventListener("click", () => { saveUI({ scope: b.dataset.scope }); screenYear(year); }));
  $("#yl-year").addEventListener("change", (e) => go(`#/annee/${e.target.value}`));
}

// a name for a place known only by its coordinates: the same observation in another list,
// a named tick within 300 m, else the commune (geo.api.gouv.fr, Nominatim abroad)
async function nameFor(t) {
  const named = M.ticks.filter((x) => x.l && x.lat != null && !["France", "Guyane", "Espagne"].includes(x.l));
  const same = named.find((x) => x.e === t.e && t.d && x.d === t.d && distKm(x, t) < 2);
  if (same) return { l: same.l, sl: same.sl || null };
  let best = null, bd = 0.3; for (const x of named) { const d = distKm(x, t); if (d < bd) { bd = d; best = x; } }
  if (best) return { l: best.l, sl: best.sl || null };
  for (const x of M.db.lieux || []) if (x.lat != null && distKm(x, t) < 0.3) return { l: x.nom, sl: "appli" };
  const w = await whereIs(t.lat, t.lon);
  const ld = !w || w.fr || w.mer ? await lieuDit(t.lat, t.lon, w && w.commune) : null;
  if (ld) return { l: w && w.commune ? `${ld.name} (${w.commune}${w.dep ? ", " + w.dep : ""})` : ld.name, sl: "ign" };
  if (w && w.commune) return { l: w.fr && w.dep ? `${w.commune} (${w.dep})` : w.commune, sl: "geo" };
  if (w && w.pays && !w.mer) return { l: w.pays, sl: "geo" };
  return null;
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
      <select class="field" id="jm"><option value="">Tout</option><option value="coords" ${F.miss === "coords" ? "selected" : ""}>Sans coordonnées</option><option value="lieu" ${F.miss === "lieu" ? "selected" : ""}>Sans lieu</option><option value="date" ${F.miss === "date" ? "selected" : ""}>Sans date</option></select></div>
    <p class="cap" id="jc"></p><div class="row" id="jname" hidden><button class="btn" id="jname-go" type="button"></button><span class="cap">D'abord une coche de la même observation ou une coche déjà nommée à moins de 300 m, sinon le lieu-dit de l'IGN le plus proche (à 1,5 km au plus, ou l'étang si le point est dedans), sinon la commune.</span></div><ul class="ticks" id="jr"></ul><button class="btn" id="more" hidden>Afficher plus</button></div>`;
  let shown = 200;
  const draw = () => {
    const k = norm(F.q);
    const res = M.ticks.filter((t) => (!F.cle || t.cle === F.cle) && (!F.year || (F.year === "none" ? !t.d : yearOf(t.d) === +F.year)) && (!F.miss || (F.miss === "coords" ? t.lat == null : F.miss === "date" ? !t.d : !t.l))
      && (!k || norm(`${t.l || ""} ${t.p || ""} ${t.t || ""}`).includes(k) || M.matchesSp(k, t.e)))
      .sort((a, b) => (b.d || "").localeCompare(a.d || "") || (b.n || 0) - (a.n || 0));
    $("#jc").textContent = `${res.length} ${plural(res.length, "coche")}`;
    $("#jr").innerHTML = res.slice(0, shown).map((t) => `<li class="tick link" data-edit="${t.cle}/${t.id}"><span class="n" ${cstyle(t.cle)}>${M.rankOf(t)}</span><span class="what"><b>${esc(M.name(t.e))}</b>${qTag((M.esp.get(t.e) || {}).q)} ${chip(t.cle)}${!isFrance(t.p) ? ` <span class="abroad">${esc(t.p)}</span>` : ""}<small>${esc(t.l || "")}${t.lat == null ? ' <span class="miss">sans coordonnées</span>' : ""}${t.t ? " · " + esc(t.t) : ""}</small></span><span class="when">${t.d ? esc(fmtShort(t.d)) : "<em>sans date</em>"}</span></li>`).join("");
    $("#more").hidden = res.length <= shown;
    unnamed = F.miss === "lieu" ? res.filter((t) => t.lat != null) : [];
    $("#jname").hidden = !unnamed.length; $("#jname-go").textContent = `Nommer ${unnamed.length} ${plural(unnamed.length, "lieu", "lieux")} d'après les coordonnées`;
  };
  let unnamed = [];
  $("#jname-go").addEventListener("click", async () => {
    const b = $("#jname-go"); b.disabled = true; const ops = []; let i = 0;
    for (const t of unnamed) {
      b.textContent = `Recherche… ${++i}/${unnamed.length}`;
      const n = await nameFor(t); if (n) ops.push({ kind: "set-tick", cle: t.cle, id: t.id, patch: { l: n.l, sl: n.sl } });
    }
    b.disabled = false;
    if (!ops.length) { toast("Aucun lieu trouvé (pas de réseau ?)."); draw(); return; }
    S.apply(ops, `Lieux nommés d'après les coordonnées : ${ops.length} ${plural(ops.length, "coche")}`); toast(`${ops.length} ${plural(ops.length, "lieu", "lieux")} ${ops.length > 1 ? "nommés" : "nommé"}.`);
  });
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
function screenSpecies(sid, q) {
  const e = M.esp.get(sid); if (!e) return go("#/");
  // previous / next species of the list we came from (arrows, swipe left or right, keyboard arrows)
  const from = new URLSearchParams(q || "").get("l"), nav = UI.nav && UI.nav.key === from ? UI.nav : null;
  const at = nav ? nav.ids.indexOf(sid) : -1, prev = at > 0 ? nav.ids[at - 1] : null, next = at >= 0 && at < nav.ids.length - 1 ? nav.ids[at + 1] : null;
  const to = (id) => `#/espece/${encodeURIComponent(id)}?l=${encodeURIComponent(from)}`;
  const navBar = at >= 0 ? `<nav class="spnav" aria-label="Espèces de la liste">${prev ? `<a class="spnav-a" href="${to(prev)}" data-nav="prev" aria-label="Espèce précédente : ${esc(M.name(prev))}">‹<span>${esc(M.name(prev))}</span></a>` : `<span class="spnav-a off">‹</span>`}<span class="spnav-pos">${at + 1} / ${nav.ids.length}<small>${esc(nav.nom)}</small></span>${next ? `<a class="spnav-a nx" href="${to(next)}" data-nav="next" aria-label="Espèce suivante : ${esc(M.name(next))}"><span>${esc(M.name(next))}</span>›</a>` : `<span class="spnav-a nx off">›</span>`}</nav>` : "";
  const m = M.bySp.get(sid) || new Map();
  const st = (e.st || []).map((v, i) => v ? `${["Nicheur", "Hivernant", "De passage", "Occasionnel"][i]} ${esc(v)}` : "").filter(Boolean).join(" · ");
  const blocks = M.listes.filter((l) => m.has(l.cle)).map((l) => `<li><b>${esc(l.nom)}</b> ${m.get(l.cle).map((t) => `<span class="tk">${t.n ? `n°${t.n} · ` : ""}${t.d ? esc(fmtDay(t.d)) : "sans date"}${t.l ? ` · ${t.lat != null ? `<a href="https://www.openstreetmap.org/?mlat=${t.lat}&mlon=${t.lon}#map=15/${t.lat}/${t.lon}" target="_blank" rel="noopener">${esc(t.l)}</a>` : esc(t.l)}` : ""}${!isFrance(t.p) ? ` · ${esc(t.p)}` : ""}${t.t ? ` · ${esc(t.t)}` : ""}${t.ph ? ' · <span title="Photo de la coche">📷</span>' : ""} <a class="linkish" href="#/coche/${l.cle}/${t.id}">voir la coche</a></span>`).join("")}</li>`).join("");
  // one point per place: Photo France in green, the lifer in red, everything else in blue
  const byPlace = new Map();
  [...m.values()].flat().filter((t) => t.lat != null).forEach((t) => { const k = t.lat.toFixed(5) + "," + t.lon.toFixed(5); if (!byPlace.has(k)) byPlace.set(k, []); byPlace.get(k).push(t); });
  const pts = [...byPlace.values()].map((ts) => {
    const lif = ts.some((t) => t.cle === LIFERS), pf = ts.some((t) => t.cle === PHOTO_FR);
    const style = lif && pf ? { color: "#D7263D", stroke: "#2E9B4F", r: 10, z: 3 } : lif ? { color: "#D7263D", r: 9, z: 2 } : pf ? { color: "#2E9B4F", r: 9, z: 2 } : { color: "#0A7895", r: 6, z: 0 };
    // the photo taken at that point (photo of the tick, or first photo of that day on the photo lists)
    const seen = new Set(), photos = [];
    ts.forEach((t) => M.photosFor(t, { first: withPhotos(L(t.cle)) }).forEach((p) => { const k = p.img || p.url; if (!seen.has(k)) { seen.add(k); photos.push({ ...p, label: t.ph ? `Photo de la coche · ${L(t.cle).nom}` : "Photo de ce jour-là" }); } }));
    return { lat: ts[0].lat, lon: ts[0].lon, ...style, html: `<div class="pop">${phSlider(photos, e.n)}<div class="pop-ticks">${ts.map((t) => `<a class="chip-s" ${cstyle(t.cle)} href="#/coche/${t.cle}/${t.id}">${esc(L(t.cle).nom)}${M.rankOf(t) ? " n°" + M.rankOf(t) : ""}</a>`).join(" ")}</div><small>${[...new Set(ts.map((t) => t.d ? fmtShort(t.d) : ""))].filter(Boolean).join(", ")}${ts[0].l ? " · " + esc(ts[0].l) : ""}</small></div>` };
  });
  view.innerHTML = `<div class="screen">
    ${navBar}<header class="phead"><a class="back" href="javascript:history.back()">← Retour</a><h1>${esc(e.n)}</h1><p class="cap">${[e.sc ? `<i>${esc(e.sc)}</i>` : "", e.fa ? esc(e.fa) : ""].filter(Boolean).join(" · ")}${e.lr ? ` · Liste rouge mondiale <span class="lr lr-${esc(String(e.lr).slice(0, 2).toLowerCase())}">${esc(e.lr)}</span>` : ""}</p>${st ? `<p class="cap">Statut en France : ${st}</p>` : ""}<div class="qrow"><span class="cap">Qualité photo</span><div class="qpick" role="group" aria-label="Qualité photo">${QUALITES.map((x) => `<button type="button" class="qtag${e.q === x.v ? " on" : ""}" style="--c:${x.c}" data-q="${esc(x.v)}" aria-pressed="${e.q === x.v}">${x.court}</button>`).join("")}</div>${e.q && !qualite(e.q) ? `<small class="cap">(${esc(e.q)})</small>` : ""}</div></header>
    ${(() => { const ph = M.allPhotos(sid); return ph.length ? `<section class="sp-photos">${phSlider(ph, e.n)}</section>` : ""; })()}
    ${blocks ? `<ul class="plain">${blocks}</ul>` : `<p class="empty">Pas encore cochée.</p>`}
    ${pts.length ? `<div><div class="minimap" id="mm"></div><p class="maplegend"><span style="--c:#D7263D"></span>lifer photo <span style="--c:#2E9B4F"></span>photo France <span style="--c:#D7263D;--s:#2E9B4F"></span>les deux au même endroit <span style="--c:#0A7895"></span>autres listes</p></div>` : ""}
    <a class="btn btn-primary" href="#/ajout?e=${encodeURIComponent(sid)}">Ajouter une coche pour cette espèce</a>
    <details class="panel" id="sp-best-d"><summary>${M.bestPhoto(sid) ? "Changer la meilleure photo" : "Ajouter une meilleure photo (best of)"}</summary><div id="sp-best"></div></details>
    <details class="panel"><summary>Noms de l'espèce</summary>
      <form id="names" class="form"><label>Nom<input class="field" id="n-n" value="${esc(e.n)}"></label>
        <label>Nom latin <small>(la référence pour les imports)</small><input class="field" id="n-sc" value="${esc(e.sc || "")}"></label>
        <label>Autres noms <small>(séparés par des virgules : Petit Chevalier, Lesser Yellowlegs…)</small><input class="field" id="n-al" value="${esc((e.al || []).join(", "))}"></label>
        <label>Autres noms latins <small>(anciens ou d'autres nomenclatures)</small><input class="field" id="n-scs" value="${esc((e.scs || []).join(", "))}"></label>
        <div class="row"><button class="btn btn-primary" type="submit">Enregistrer les noms</button></div></form></details>
  </div>`;
  if (pts.length) { const mm = mapView($("#mm"), pts); if (mm) mm.on("popupopen", (ev) => { const el = ev.popup.getElement(); wirePhotos(el); $$("img[data-ph]", el).forEach((im) => im.addEventListener("load", () => ev.popup.update(), { once: true })); }); }
  photoBox($("#sp-best"), { kind: "best", sid }, phSlider);
  wirePhotos(view);
  // moving between species replaces the page in the history, so « Retour » goes back to the list
  const move = (id) => { if (id) { location.replace(to(id)); scrollTo(0, 0); } };
  $$("[data-nav]").forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); move(a.dataset.nav === "prev" ? prev : next); }));
  if (at >= 0) {
    let x0 = null, y0 = null;
    const scr = view.firstElementChild;
    scr.addEventListener("touchstart", (ev) => { if (ev.target.closest(".minimap, input, textarea, details[open]")) { x0 = null; return; } x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; }, { passive: true });
    scr.addEventListener("touchend", (ev) => { if (x0 == null) return; const dx = ev.changedTouches[0].clientX - x0, dy = ev.changedTouches[0].clientY - y0; x0 = null; if (Math.abs(dx) > 70 && Math.abs(dy) < 50) move(dx < 0 ? next : prev); }, { passive: true });
    onKey = (ev) => { if (ev.target.closest("input, textarea, select")) return; if (ev.key === "ArrowLeft") move(prev); if (ev.key === "ArrowRight") move(next); };
  }
  $$("[data-q]").forEach((b) => b.addEventListener("click", () => { const v = e.q === b.dataset.q ? null : b.dataset.q; S.apply({ kind: "set-espece", id: sid, patch: { q: v } }, `Qualité photo : ${e.n} → ${v || "aucune"}`); toast(v ? `Qualité : ${qualite(v).court}.` : "Qualité retirée."); }));
  $("#names").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const list = (v) => v.split(/\s*[,;]\s*/).map((x) => x.trim()).filter(Boolean);
    const patch = { n: $("#n-n").value.trim() || e.n, sc: $("#n-sc").value.trim() || null, al: list($("#n-al").value), scs: list($("#n-scs").value) };
    if (!patch.al.length) patch.al = null; if (!patch.scs.length) patch.scs = null;
    S.apply({ kind: "set-espece", id: sid, patch }, `Noms : ${patch.n}`); toast("Noms enregistrés.");
  });
}

// ---------- more ----------
function screenMore() {
  const c = M.checks(), open = M.db.taches.map(taskView).filter((v) => !v.done).length;
  view.innerHTML = `<div class="screen"><h2>Plus</h2><nav class="menu">
    <a href="#/calendrier"><b>Calendrier des coches photo</b><small>Toutes les années superposées</small></a>
    <a href="#/a-faire"><b>À faire</b><small>${open} ${plural(open, "tâche")} · ${c.undated.length} coches sans date · ${c.yearMissing.length + c.nested.length + c.srcDate.length + c.photoEarlier.length + c.zoneFirst.length} incohérences</small></a>
    <a href="#/listes"><b>Mes listes</b><small>Créer une liste région, département, lieu ou pays ; couleurs</small></a>
    <a href="#/import"><b>Importer</b><small>Faune-France, eBird ou cocheurs : compléter dates, lieux et espèces</small></a>
    <button type="button" id="xx"><b>Exporter en Excel</b><small>Toutes les coches, les espèces et les listes</small></button>
    <button type="button" id="xj"><b>Sauvegarde complète (.json)</b><small>Copie exacte de la base</small></button>
    <a href="#/reglages"><b>Réglages</b><small>Clé d'accès GitHub, clé Flickr, dépôt, cache</small></a>
  </nav><p class="cap">La base est dans le dépôt privé <a href="https://github.com/${esc(S.cfg.owner)}/${esc(S.cfg.repo)}/commits/${esc(S.cfg.branch)}" target="_blank" rel="noopener">${esc(S.cfg.owner)}/${esc(S.cfg.repo)}</a> : chaque modification y est enregistrée, avec son historique.</p></div>`;
  $("#xx").addEventListener("click", () => exportXlsx(M).catch((e) => toast(e.message, "error")));
  $("#xj").addEventListener("click", () => exportJson(S.db));
}

// ---------- calendar of Photo France ticks ----------
// 12 steps, from one tick (pale yellow) to 12 and more (crimson)
export const CAL_COLORS = ["#F3E79B", "#F2C462", "#B9D36E", "#7CC17A", "#3FAE8E", "#2A9BA8", "#2C7FB8", "#3B5BA5", "#4B3F8F", "#6A3285", "#8E2A73", "#B0254F"];
function screenCalendar() {
  const days = M.calendar(), DIM = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const sel = UI.calDay || todayIso().slice(5);
  const color = (n) => CAL_COLORS[Math.min(n, 12) - 1];
  const ink = (n) => n >= 7 ? "#fff" : "#1F2933";
  const today = todayIso().slice(5);
  let grid = `<div class="cal" role="grid"><span></span>${Array.from({ length: 31 }, (_, i) => `<span class="dh">${i === 0 || (i + 1) % 5 === 0 ? i + 1 : ""}</span>`).join("")}`;
  for (let m = 0; m < 12; m++) {
    grid += `<span class="mh">${MOIS_C[m]}</span>`;
    for (let d = 1; d <= 31; d++) {
      const k = `${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, n = (days.get(k) || []).length;
      grid += d > DIM[m] ? `<span class="off"></span>` : `<button type="button" data-day="${k}" class="${[k === sel ? "sel" : "", k === today ? "today" : ""].join(" ").trim()}" style="${n ? `background:${color(n)};color:${ink(n)}` : ""}" aria-label="${d} ${MOIS[m]} : ${n} ${plural(n, "coche")}">${n || ""}</button>`;
    }
  }
  grid += "</div>";
  const ts = (days.get(sel) || []).slice().sort((a, b) => a.d.localeCompare(b.d));
  const [sm, sd] = sel.split("-").map(Number);
  const total = [...days.values()].reduce((s, a) => s + a.length, 0);
  // records: best single day, best year, best month (all years together)
  const pf = (M.db.coches[PHOTO_FR] || []).filter((t) => t.d), byDate = new Map(), byYear = new Map(), byMonth = new Array(12).fill(0);
  pf.forEach((t) => { byDate.set(t.d, (byDate.get(t.d) || 0) + 1); const yy = t.d.slice(0, 4); byYear.set(yy, (byYear.get(yy) || 0) + 1); byMonth[+t.d.slice(5, 7) - 1]++; });
  const bestD = [...byDate].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0], bestY = [...byYear].sort((a, b) => b[1] - a[1])[0], bm = byMonth.indexOf(Math.max(...byMonth));
  const stats = pf.length ? `<div class="stats"><div class="stat"><span class="k">Meilleure journée</span><span class="v">${bestD[1]}<small> coches</small></span><span class="s">${esc(fmtDay(bestD[0]))}</span></div>
    <div class="stat"><span class="k">Meilleure année</span><span class="v">${bestY[0]}</span><span class="s">${bestY[1]} nouvelles espèces</span></div>
    <div class="stat"><span class="k">Meilleur mois</span><span class="v">${MOIS[bm]}</span><span class="s">${byMonth[bm]} coches, toutes années</span></div></div>` : "";
  view.innerHTML = `<div class="screen"><h2>Calendrier des coches photo France</h2><p class="cap">Toutes tes années superposées : la couleur d'une case dit combien de coches photo France tu as faites à cette date, de 1 à 12 et plus (${total} en tout). Touche une case pour voir les espèces.</p>${stats}
    <div class="calwrap">${grid}</div>
    <div class="legend">${CAL_COLORS.map((c, i) => `<span class="lv" style="background:${c};color:${ink(i + 1)}">${i === 11 ? "12+" : i + 1}</span>`).join("")}<span class="leg-today"><i class="sq ring"></i> aujourd'hui</span></div>
    <section><h3 class="minor">Un ${sd === 1 ? "1er" : sd} ${MOIS[sm - 1]} · ${ts.length} ${plural(ts.length, "coche photo", "coches photo")}</h3><ul class="ticks">${ts.map((t) => row(t, { rank: t.n })).join("") || '<li class="cap">Aucune coche photo France à cette date.</li>'}</ul></section></div>`;
  $$("[data-day]").forEach((b) => b.addEventListener("click", () => { saveUI({ calDay: b.dataset.day }); screenCalendar(); }));
}

// ---------- to do ----------
// each task is checked against the base as it is now: a task whose cause has gone (date changed, tick removed…) is done
const tickLine = (tk) => tk ? `${tk.n ? "n°" + tk.n + " · " : ""}${tk.d ? fmtShort(tk.d) : "sans date"}${tk.l ? " · " + esc(tk.l) : ""}${tk.lat != null ? ` · ${tk.lat}, ${tk.lon}` : ""}` : "";
function taskView(t) {
  const tk = t.sid && t.cle ? M.tick(t.sid, t.cle) : null, gone = t.sid && t.cle && !tk;
  const who = t.sid ? `${nameLink(t.sid)} ${t.cle ? chip(t.cle) : ""}` : t.cle ? chip(t.cle) : "";
  const act = (a, label, primary) => `<button class="btn${primary ? " btn-primary" : ""}" data-act="${esc(t.id)}:${a}">${label}</button>`;
  const edit = tk ? `<a class="btn" href="#/coche/${tk.cle}/${tk.id}/modifier">Corriger</a>` : "";
  let done = !!t.fait || gone, body = "", btns = "";
  if (t.kind === "check") {
    done = done || Object.entries(t.watch || {}).some(([k, v]) => (tk[k] ?? null) !== v);
    body = `${esc(t.quoi)}<small>${esc(t.det || "")}${t.det ? " · " : ""}aujourd'hui : ${tickLine(tk)}</small>`; btns = act("ok", "C'est bon") + edit;
  } else if (t.kind === "choose-date") {
    done = done || tk.d === t.other;
    body = `${tk.d ? `Appli <b>${fmtShort(tk.d)}</b> · ${esc(t.src || "cocheurs")} <b>${fmtShort(t.other)}</b>` : `Pas de date dans l'appli · ${esc(t.src || "cocheurs")} <b>${fmtShort(t.other)}</b>`}<small>${t.det ? esc(t.det) + " · " : ""}${tickLine(tk)}</small>`;
    btns = (tk.d ? act("keep", `Garder ${fmtShort(tk.d)}`) : "") + act("take", `${tk.d ? "Prendre" : "Reporter"} ${fmtShort(t.other)}`, !tk.d);
  } else if (t.kind === "cocheurs") {
    body = `${esc(t.quoi)}<small>${tickLine(tk)}</small>`; btns = act("ok", "Fait dans cocheurs");
  } else { body = `${esc(t.quoi)}${t.det ? `<small>${esc(t.det)}</small>` : ""}`; btns = act("ok", "Fait"); }
  const ph = tk && !done ? M.photosFor(tk).find((p) => p.d === tk.d) : null; // the photo of that tick, to recognise the place
  return { done, html: `<li${ph ? ' class="has-ph"' : ""}>${ph ? `<span class="td-ph">${phImg(ph.img, M.name(tk.e))}</span>` : ""}<span>${who}${who ? "<br>" : ""}${body}</span><span class="row">${btns}</span></li>` };
}
function taskAct(id, a) {
  const t = M.db.taches.find((x) => x.id === id); if (!t) return;
  const label = `${t.sid ? M.name(t.sid) + " · " : ""}${t.quoi || "date"}`;
  if (a === "ok") return S.apply({ kind: "set-tache", id, patch: { fait: true } }, `Fait : ${label}`);
  if (a === "keep") return S.apply({ kind: "set-tache", id, patch: { fait: true, det: t.src === "photos" ? `date de l'appli gardée (${t.det || "photo"})` : `date de l'appli gardée : à corriger dans ${t.src || "cocheurs"}` } }, `Date gardée : ${label}`);
  if (a === "take") {
    const tk = M.tick(t.sid, t.cle); if (!tk) return;
    // the first sighting moves to that day: its place comes from a tick of the same day, or is to be completed
    const same = M.ticks.find((x) => x.e === t.sid && x.d === t.other && x !== tk && (x.lat != null || x.l));
    // a photo date usually corrects only the day: without a tick on that day, the place stays
    const patch = !same && t.src === "photos" ? { d: t.other } : { d: t.other, l: same ? same.l || null : null, lat: same ? same.lat ?? null : null, lon: same ? same.lon ?? null : null, sl: same ? same.sl || null : null };
    // the same observation in the other lists (same species, same old date) moves with it, so the dates stay linked:
    // a photo date holds for every list of that observation; a cocheurs date only for the lists inside that one
    const inside = new Set(M.descendants ? M.descendants(t.cle) : []);
    const twins = tk.d ? M.ticks.filter((x) => x !== tk && M.sameObs(tk, x) && (t.src === "photos" || inside.has(x.cle)) && M.sameYearOk(x, t.other)) : [];
    const src = t.src === "photos" ? "photo" : "cocheurs";
    S.apply([tk, ...twins].map((x) => ({ kind: "set-tick", cle: x.cle, id: x.id, patch, src })).concat({ kind: "set-tache", id, patch: { fait: true } }), `Date reprise de ${t.src || "cocheurs"} : ${M.name(t.sid)} (${L(t.cle).nom}${twins.length ? ` et ${twins.length} autre${twins.length > 1 ? "s" : ""} liste${twins.length > 1 ? "s" : ""}` : ""}, ${fmtShort(t.other)})`);
    toast(same ? "Date et lieu repris." : t.src === "photos" ? "Date reprise ; le lieu ne change pas." : "Date reprise ; le lieu de ce jour-là est à compléter.");
  }
}
// the chip of the category being read is highlighted, and kept visible in the bar
let tdLast = -1;
function tdSpy() {
  const nav = $("#tdnav"); if (!nav || nav.dataset.tabs) return;
  const secs = $$(".screen > section[id^='td-']", view); let cur = 0;
  secs.forEach((s, i) => { if (s.getBoundingClientRect().top < 180) cur = i; });
  if (cur === tdLast && nav.querySelector(".on")) return; tdLast = cur;
  $$("[data-td]", nav).forEach((a) => a.classList.toggle("on", +a.dataset.td === cur));
  const a = nav.querySelector(".on"); if (a) nav.scrollTo({ left: a.offsetLeft - 16, behavior: "smooth" });
}
window.addEventListener("scroll", () => { if ($("#tdnav")) tdSpy(); }, { passive: true });
function screenTodo() {
  // one list to work on (or all): every category keeps only what concerns that list
  const sel = M.liste.has(UI.tdList) ? UI.tdList : "", on = (cle) => !sel || cle === sel, anyOn = (ts) => !sel || ts.some((t) => t.cle === sel);
  const all = M.checks(), c = { ...all,
    outside: all.outside.filter((x) => on(x.t.cle)), photoEarlier: all.photoEarlier.filter((x) => anyOn(x.ticks)), srcDate: all.srcDate.filter((x) => anyOn(x.ticks)),
    badNum: all.badNum.filter((x) => on(x.cle)), placeMismatch: all.placeMismatch.filter((x) => anyOn([x.src, ...x.others])),
    yearWrong: all.yearWrong.filter((t) => on(t.cle)), yearMissing: all.yearMissing.filter((x) => on(x.t.cle) || on("yl" + x.year)), nested: all.nested.filter((x) => on(x.liste) || on(x.parent)),
    undated: all.undated.filter((t) => on(t.cle)), zoneFirst: all.zoneFirst.filter((x) => on(x.zone) || on(x.first.cle)) };
  // ticks without GPS point or without place name, one row per observation (species and day)
  const ng = new Map();
  for (const t of M.ticks) {
    if (t.lat != null && t.l) continue;
    const k = t.d ? t.e + "|" + t.d : t.cle + "|" + t.id; if (!ng.has(k)) ng.set(k, []); ng.get(k).push(t);
  }
  c.noPlace = [...ng.values()].filter(anyOn).map((ts) => ({ ts, e: ts[0].e, d: ts[0].d, gps: ts.some((t) => t.lat == null), name: ts.some((t) => !t.l), main: (sel && ts.find((t) => t.cle === sel)) || ts[0] }))
    .sort((a, b) => (b.d || "").localeCompare(a.d || "") || M.name(a.e).localeCompare(M.name(b.e), "fr"));
  // photo ticks with no photo in the app, one row per observation (the photo is shared by its lists)
  const nphG = new Map();
  for (const t of M.ticks) {
    if (!t.d || t.cle === VU || /^(vu|entendu)/i.test(t.t || "")) continue;
    const k = t.e + "|" + t.d; if (!nphG.has(k)) nphG.set(k, []);
    const gs = nphG.get(k), g = gs.find((x) => M.sameObs(x[0], t)); if (g) g.push(t); else gs.push([t]);
  }
  // the year lists can be left out (they hold most of these): then an observation ticked only in year lists is not shown
  const isYL = (cle) => (L(cle).type === "annee") || /^yl\d{4}$/.test(cle), withYL = UI.nphYL === true || (sel && isYL(sel));
  c.noPhoto = [...nphG.values()].flat().filter((ts) => !ts.some((t) => t.ph || t.nph) && !M.firstPhotos(ts[0].e).some((p) => p.d === ts[0].d)).filter(anyOn)
    .map((ts) => (withYL ? ts : ts.filter((t) => !isYL(t.cle)))).filter((ts) => ts.length)
    .map((ts) => ({ ts, main: (sel && ts.find((t) => t.cle === sel)) || ts.find((t) => t.cle === LIFERS) || ts[0], folder: M.photoOn(ts[0].e, ts[0].d) }))
    .sort((a, b) => (b.ts[0].d || "").localeCompare(a.ts[0].d || "") || M.name(a.ts[0].e).localeCompare(M.name(b.ts[0].e), "fr"));
  const tasks = M.db.taches.filter((t) => !sel || t.cle === sel);
  const cats = [...new Set(M.db.taches.map((t) => t.cat))];
  const und = new Map(); c.undated.forEach((t) => { if (!und.has(t.cle)) und.set(t.cle, []); und.get(t.cle).push(t); });
  view.innerHTML = `<div class="screen keep-scroll"><h2>À faire</h2>
    <div class="tdbar"><label class="tdlist">Liste<select class="field" id="tdl"><option value="">Toutes les listes</option>${M.listes.map((l) => `<option value="${l.cle}" ${l.cle === sel ? "selected" : ""}>${esc(l.nom)}</option>`).join("")}</select></label>
    <nav class="tdnav" id="tdnav" aria-label="Catégories"></nav></div>
    ${c.outside.length ? `<section data-n="${c.outside.length}"><h3 class="minor">Coches hors de leur liste</h3><p class="cap">Le lieu de ces coches n'est pas dans le secteur de la liste. Corrige le lieu, ou supprime la coche si elle n'a rien à faire là.</p><ul class="todo">${c.outside.slice(0, 80).map((x) => `<li><span>${nameLink(x.t.e)} ${chip(x.t.cle)}<small>${esc(x.t.l || "")} · ${esc(x.why)}</small></span><a class="btn" href="#/coche/${x.t.cle}/${x.t.id}/modifier">Corriger</a></li>`).join("")}</ul></section>` : ""}
    ${c.zoneFirst.length ? `<section data-n="${c.zoneFirst.length}"><h3 class="minor">Première donnée de la zone · ${c.zoneFirst.length}</h3><p class="cap">Une liste de région, de département ou de commune commence à ta première photo prise dans la zone, quelle que soit la liste qui la porte (Photo France, Lifers, year list, Rhône, Jardin…). Ici, une coche placée dans la zone est plus ancienne que celle de la liste, ou la liste n'a pas encore l'espèce.</p><ul class="todo">
      ${c.zoneFirst.map((x, i) => `<li><span>${nameLink(x.e)} ${chip(x.zone)}<small>${x.zt ? `${esc(L(x.zone).nom)} <b>${esc(fmtShort(x.zt.d))}</b> · ` : `pas dans ${esc(L(x.zone).nom)} · `}${chip(x.first.cle)} <b>${esc(fmtShort(x.first.d))}</b>${x.first.l ? " · " + esc(x.first.l) : ""}</small></span><span class="row"><button class="btn" data-zftake="${i}">${x.zt ? "Prendre " + esc(fmtShort(x.first.d)) : "Ajouter à " + esc(L(x.zone).nom)}</button>${x.zt ? `<button class="btn" data-zfkeep="${i}">Garder ${esc(fmtShort(x.zt.d))}</button>` : ""}</span></li>`).join("")}</ul></section>` : ""}
    ${c.photoEarlier.length ? `<section data-n="${c.photoEarlier.length}"><h3 class="minor">Une photo plus ancienne que la coche · ${c.photoEarlier.length}</h3><p class="cap">Tes dossiers photos ont l'espèce avant la date de la coche (Photo France : ta toute première photo ; year list : ta première photo de l'année). La photo fait foi. « Prendre » met la date de la photo (Photo France : avec le lifer du même jour ; year list : elle seule) ; le lieu vient d'une coche de ce jour-là, sinon il est à compléter. « Garder » confirme la date de l'appli.</p><ul class="todo">
      ${c.photoEarlier.map((x, i) => `<li><span>${nameLink(x.e)} ${[...new Set(x.ticks.map((t) => t.cle))].map(chip).join(" ")}<small>appli <b>${esc(fmtShort(x.d))}</b> · photo <b>${esc(fmtShort(x.photo[0]))}</b>${x.photo[2] ? " · " + esc(x.photo[2].split("/").pop()) : ""}</small></span><span class="row"><button class="btn" data-phtake="${i}">Prendre ${esc(fmtShort(x.photo[0]))}</button><button class="btn" data-phkeep="${i}">Garder ${esc(fmtShort(x.d))}</button></span></li>`).join("")}</ul></section>` : ""}
    ${c.srcDate.length ? `<section data-n="${c.srcDate.length}"><h3 class="minor">Pas d'accord avec Faune-France / eBird · ${c.srcDate.length}</h3><p class="cap">Soit ton dernier import n'a pas l'espèce ce jour-là mais l'a à quelques jours près (40 au plus), soit il l'a le même jour mais à plus de 20 km : souvent une erreur de date ou de lieu. « Prendre » reprend la date et le lieu de la source dans toutes les listes de cette observation ; « Garder » confirme ce qu'a l'appli.</p><ul class="todo">
      ${c.srcDate.slice(0, 200).map((x, i) => `<li><span>${nameLink(x.e)} ${[...new Set(x.ticks.map((t) => t.cle))].map(chip).join(" ")}<small>appli <b>${esc(fmtShort(x.d))}</b> (${esc(srcName(x.ticks[0].sd))})${x.ticks[0].l ? " · " + esc(x.ticks[0].l) : ""} · ${x.near.src === "ff" ? "Faune-France" : "eBird"} ${x.lieu ? `le même jour, <b>à ${x.km} km</b>` : `<b>${esc(fmtShort(x.near.d))}</b>`}${x.near.l ? " · " + esc(x.near.l) : ""}</small></span><span class="row"><button class="btn" data-sdtake="${i}">${x.lieu ? "Prendre ce lieu" : "Prendre " + esc(fmtShort(x.near.d))}</button><button class="btn" data-sdkeep="${i}">Garder ${x.lieu ? "le lieu" : esc(fmtShort(x.d))}</button></span></li>`).join("")}${c.srcDate.length > 200 ? `<li><span class="cap">… et ${c.srcDate.length - 200} autres, qui s'afficheront au fur et à mesure.</span></li>` : ""}</ul></section>` : ""}
    ${c.badNum.map((x) => `<section data-n="${x.moves.length}"><h3 class="minor">${esc(L(x.cle).nom)} : numéros pas dans l'ordre des dates</h3><p class="cap">${x.moves.length} ${plural(x.moves.length, "coche")} à renuméroter. Les coches datées sont remises dans l'ordre chronologique ; une coche sans date garde son numéro.</p><div class="row"><button class="btn btn-primary" data-renum="${x.cle}">Renuméroter par date</button></div><ul class="todo">${x.moves.slice(0, 12).map((m) => `<li><span>${nameLink(m.t.e)} · ${esc(fmtShort(m.t.d))}<small>n°${m.t.n} → n°${m.to}</small></span></li>`).join("")}${x.moves.length > 12 ? `<li><span class="cap">… et ${x.moves.length - 12} autres</span></li>` : ""}</ul></section>`).join("")}
    ${c.placeMismatch.length ? `<section data-n="${c.placeMismatch.length}"><h3 class="minor">Même observation, lieux différents</h3><p class="cap">Même espèce, même jour, mais pas le même lieu selon la liste. « Aligner » reprend partout le lieu le plus précis.</p><div class="row"><button class="btn btn-primary" id="align-all">Tout aligner (${c.placeMismatch.length})</button></div><ul class="todo">
      ${c.placeMismatch.slice(0, 60).map((x, i) => `<li><span>${nameLink(x.src.e)} · ${esc(fmtShort(x.src.d))}<small>${chip(x.src.cle)} ${esc(x.src.l || (x.src.lat != null ? x.src.lat + ", " + x.src.lon : ""))} · ailleurs : ${x.others.map((t) => `${chip(t.cle)} ${esc(t.l || (t.lat != null ? "coordonnées différentes" : "sans lieu"))}`).join(" ")}</small></span><button class="btn" data-align="${i}">Aligner</button></li>`).join("")}</ul></section>` : ""}
    ${c.yearMissing.length || c.nested.length || c.yearWrong.length ? `<section data-n="${c.yearMissing.length + c.nested.length + c.yearWrong.length}"><h3 class="minor">Incohérences trouvées dans la base</h3><ul class="todo">
      ${c.yearWrong.map((t) => `<li><span>${nameLink(t.e)} est dans ${esc(L(t.cle).nom)} mais datée du ${esc(fmtShort(t.d))}.</span> <a class="btn" href="#/coche/${t.cle}/${t.id}/modifier">Corriger</a></li>`).join("")}
      ${c.yearMissing.map((x) => `<li><span>${nameLink(x.t.e)} a une coche datée de ${x.year} (${esc(L(x.t.cle).nom)}, ${esc(fmtShort(x.t.d))}) mais n'est pas dans la year list ${x.year}.</span> <button class="btn" data-addyl="${x.t.cle}/${x.t.id}">Ajouter à ${x.year}</button></li>`).join("")}
      ${c.nested.map((x) => `<li><span>${nameLink(x.t.e)} est dans ${esc(L(x.liste).nom)} mais pas dans ${esc(L(x.parent).nom)}.</span> <a class="btn" href="#/espece/${esc(x.t.e)}">Voir</a></li>`).join("")}
    </ul></section>` : ""}
    <section data-n="${c.noPlace.length}"><h3 class="minor">Sans GPS ou sans lieu · ${c.noPlace.length}</h3><p class="cap">Une ligne par observation (même espèce, même jour), avec les listes concernées. « Corriger » ouvre la coche ; coche « même observation » dans le formulaire pour que les autres listes suivent.</p>${c.noPlace.length ? `<ul class="todo">${c.noPlace.slice(0, 150).map((x) => `<li><span>${nameLink(x.e)} ${[...new Set(x.ts.map((t) => t.cle))].map(chip).join(" ")}<small>${x.d ? esc(fmtShort(x.d)) : "sans date"}${x.main.l ? " · " + esc(x.main.l) : ""} · <span class="miss">${[x.gps ? "sans GPS" : "", x.name ? "sans nom de lieu" : ""].filter(Boolean).join(", ")}</span></small></span><a class="btn" href="#/coche/${x.main.cle}/${x.main.id}/modifier">Corriger</a></li>`).join("")}${c.noPlace.length > 150 ? `<li><span class="cap">… et ${c.noPlace.length - 150} autres, qui s'afficheront au fur et à mesure.</span></li>` : ""}</ul>` : '<p class="cap">Tout est placé.</p>'}</section>
    <section data-n="${c.noPhoto.length}"><h3 class="minor">Coches sans photo · ${c.noPhoto.length}</h3>${sel && isYL(sel) ? "" : `<div class="seg" role="group" aria-label="Year lists"><button type="button" data-nphyl="0" aria-pressed="${!withYL}">Sans les year lists</button><button type="button" data-nphyl="1" aria-pressed="${withYL}">Avec les year lists</button></div>`}<p class="cap">Une ligne par observation : sa photo vaut pour toutes ses listes. « Ajouter une photo » ouvre la coche ; « Pas de photo » la sort d'ici pour de bon. 📁 : ton dossier Liste a des photos de l'espèce ce jour-là.</p>${c.noPhoto.length ? `<ul class="todo">${c.noPhoto.slice(0, 150).map((x, i) => `<li><span>${nameLink(x.main.e)}${x.folder ? ' <span title="Photos ce jour-là dans ton dossier Liste">📁</span>' : ""} ${[...new Set(x.ts.map((t) => t.cle))].map(chip).join(" ")}<small>${esc(fmtShort(x.main.d))}${x.main.l ? " · " + esc(x.main.l) : ""}</small></span><span class="row"><a class="btn" href="#/coche/${x.main.cle}/${x.main.id}">Ajouter une photo</a><button class="btn" data-noph="${i}">Pas de photo</button></span></li>`).join("")}${c.noPhoto.length > 150 ? `<li><span class="cap">… et ${c.noPhoto.length - 150} autres : choisis une liste en haut pour les voir.</span></li>` : ""}</ul>` : '<p class="cap">Toutes tes coches photo ont leur photo.</p>'}</section>
    <section data-n="${c.undated.length}"><h3 class="minor">Coches sans date</h3><p class="cap">${[...und].map(([k, a]) => `<a href="#" data-undated="${k}">${esc(L(k).nom)} ${a.length}</a>`).join(" · ") || "Aucune."}</p></section>
    ${cats.map((cat) => { const vs = tasks.filter((t) => t.cat === cat).map(taskView), open = vs.filter((v) => !v.done), shut = vs.length - open.length;
      return `<section data-n="${open.length}"><h3 class="minor">${esc(cat)} · ${open.length}${shut ? ` <span class="cap">(${shut} ${plural(shut, "réglée")})</span>` : ""}</h3>${open.length ? `<ul class="todo">${open.map((v) => v.html).join("")}</ul>` : '<p class="cap">Tout est réglé.</p>'}</section>`; }).join("")}
  </div>`;
  // index of the categories: one chip per section, with what is left in it; a tap goes there
  const secs = $$(".screen > section", view);
  $$("[data-nphyl]", view).forEach((b) => b.addEventListener("click", () => { saveUI({ nphYL: b.dataset.nphyl === "1" }); const y = scrollY; screenTodo(); scrollTo(0, y); }));
  $$("[data-noph]", view).forEach((b) => b.addEventListener("click", () => {
    const x = c.noPhoto[+b.dataset.noph]; if (!x) return;
    S.apply(x.ts.map((t) => ({ kind: "set-tick", cle: t.cle, id: t.id, patch: { nph: true } })), `Pas de photo : ${M.name(x.main.e)} (${fmtShort(x.main.d)})`);
    toast("Noté : pas de photo pour cette coche.");
  }));
  // one category at a time: the chips are tabs (the ones with nothing left are hidden), the open one is remembered
  const info = secs.map((sec) => {
    const h = sec.querySelector("h3"); const title = (h ? h.firstChild.textContent : "").replace(/\s*·\s*\d+\s*$/, "").trim();
    const short = title.replace(/ : numéros pas dans l'ordre des dates$/, " : numéros").replace(/^Pas d'accord avec /, "").replace(/^Même observation, lieux différents$/, "Lieux différents").replace(/^Coches hors de leur liste$/, "Hors de leur liste").replace(/^Dates différentes appli \/ cocheurs$/, "Dates cocheurs").replace(/^Incohérences trouvées dans la base$/, "Incohérences").replace(/^Une photo plus ancienne que la coche$/, "Photo plus ancienne").replace(/^Sans GPS ou sans lieu$/, "Sans GPS / lieu").replace(/^Première donnée de la zone$/, "Première de la zone");
    return { sec, title, short, n: +sec.dataset.n || 0 };
  });
  const live = info.filter((x) => x.n), done = info.length - live.length;
  const cur = live.find((x) => x.title === UI.tdTab) || live[0];
  info.forEach((x) => { x.sec.hidden = x !== cur; });
  const nav = $("#tdnav"); nav.dataset.tabs = "1";
  nav.innerHTML = live.map((x, i) => `<a href="#" data-td="${i}" class="${x === cur ? "on" : ""}" title="${esc(x.title)}">${esc(x.short)}<b>${x.n}</b></a>`).join("")
    + (done ? `<span class="td-done">✓ ${done} ${plural(done, "catégorie")} à jour</span>` : "") + (live.length ? "" : '<span class="td-done">Tout est à jour 🎉</span>');
  $$("[data-td]", nav).forEach((a) => a.addEventListener("click", (ev) => {
    ev.preventDefault(); const x = live[+a.dataset.td]; saveUI({ tdTab: x.title });
    info.forEach((y) => { y.sec.hidden = y !== x; }); $$("[data-td]", nav).forEach((b) => b.classList.toggle("on", b === a));
    const top = $(".tdbar").getBoundingClientRect().top; if (top < 0 || scrollY > 0) scrollTo({ top: 0 });
  }));
  const onChip = nav.querySelector(".on"); if (onChip) nav.scrollLeft = Math.max(0, onChip.offsetLeft - 16);
  $$("[data-act]").forEach((b) => b.addEventListener("click", () => { const [id, a] = b.dataset.act.split(":"); taskAct(id, a); }));
  $$("[data-task]").forEach((i) => i.addEventListener("change", () => { const t = tasks.find((x) => x.id === i.dataset.task); S.apply({ kind: "set-tache", id: t.id, patch: { fait: i.checked || null } }, `${i.checked ? "Fait" : "À refaire"} : ${t.esp ? t.esp + " · " : ""}${t.quoi}`); }));
  $$("[data-undated]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); saveUI({ jf: { q: "", cle: a.dataset.undated, year: "none", miss: "" } }); go("#/journal"); }));
  $("#tdl").addEventListener("change", (e) => { saveUI({ tdList: e.target.value }); tdLast = -1; screenTodo(); });
  const alignOps = (x) => x.others.map((t) => ({ kind: "set-tick", cle: t.cle, id: t.id, patch: { l: x.src.l || null, lat: x.src.lat ?? null, lon: x.src.lon ?? null, p: x.src.p || null, sl: x.src.sl || null } }));
  $$("[data-align]").forEach((b) => b.addEventListener("click", () => { const x = c.placeMismatch[+b.dataset.align]; S.apply(alignOps(x), `Lieu aligné : ${M.name(x.src.e)} (${fmtShort(x.src.d)})`); }));
  $$("[data-zftake]").forEach((b) => b.addEventListener("click", () => { const x = c.zoneFirst[+b.dataset.zftake], f = x.first;
    const data = { d: f.d, l: f.l || null, lat: f.lat ?? null, lon: f.lon ?? null, h: f.h || null, sh: f.sh || null, sd: f.sd || null, sl: f.sl || null, vf: null };
    if (x.zt) S.apply({ kind: "set-tick", cle: x.zone, id: x.zt.id, patch: data }, `${L(x.zone).nom} : ${M.name(x.e)} au ${fmtShort(f.d)} (première donnée de la zone)`);
    else { const l = M.liste.get(x.zone), tick = { id: `${x.zone}-${Date.now().toString(36)}`, e: x.e }; Object.entries(data).forEach(([k, v]) => { if (v != null) tick[k] = v; }); if (l.numerotee) tick.n = M.nextNum(x.zone);
      S.apply({ kind: "add-tick", cle: x.zone, tick }, `Ajout : ${M.name(x.e)} (${l.nom}, ${fmtShort(f.d)})`); }
    toast(x.zt ? "Date et lieu repris." : "Ajoutée ; pense à renuméroter si besoin."); }));
  $$("[data-zfkeep]").forEach((b) => b.addEventListener("click", () => { const x = c.zoneFirst[+b.dataset.zfkeep]; S.apply({ kind: "set-tick", cle: x.zone, id: x.zt.id, patch: { vf: x.zt.d } }, `Date confirmée : ${M.name(x.e)} (${L(x.zone).nom}, ${fmtShort(x.zt.d)})`); }));
  $$("[data-phtake]").forEach((b) => b.addEventListener("click", () => { const x = c.photoEarlier[+b.dataset.phtake];
    // the place of the old day does not hold for the new one: a tick of that day gives it, else it is to be filled
    const same = M.ticks.find((t) => t.e === x.e && t.d === x.photo[0] && (t.l || t.lat != null));
    const place = same ? { l: same.l || null, lat: same.lat ?? null, lon: same.lon ?? null, p: same.p || null, sl: same.sl || null } : { l: null, lat: null, lon: null, sl: null };
    S.apply(x.ticks.filter((t) => M.sameYearOk(t, x.photo[0])).map((t) => ({ kind: "set-tick", cle: t.cle, id: t.id, patch: { d: x.photo[0], h: x.photo[1] || null, sh: x.photo[1] ? "photo" : null, vf: null, ...place }, src: "photo" })), `Date de la photo : ${M.name(x.e)} (${fmtShort(x.d)} → ${fmtShort(x.photo[0])})`); toast(same ? "Date de la photo reprise, lieu repris de la coche de ce jour-là." : "Date de la photo reprise ; le lieu de ce jour-là est à compléter (Sans GPS / lieu)."); }));
  $$("[data-phkeep]").forEach((b) => b.addEventListener("click", () => { const x = c.photoEarlier[+b.dataset.phkeep];
    S.apply(x.ticks.map((t) => ({ kind: "set-tick", cle: t.cle, id: t.id, patch: { vf: x.d } })), `Date confirmée : ${M.name(x.e)} (${fmtShort(x.d)})`); }));
  $$("[data-sdtake]").forEach((b) => b.addEventListener("click", () => { const x = c.srcDate[+b.dataset.sdtake], n = x.near;
    const patch = { d: n.d, vf: null, ...(n.l || n.lat != null ? { l: n.l || null, lat: n.lat ?? null, lon: n.lon ?? null, p: null } : {}) };
    S.apply(x.ticks.filter((t) => M.sameYearOk(t, n.d)).map((t) => ({ kind: "set-tick", cle: t.cle, id: t.id, patch, src: n.src })), `Date reprise de ${n.src === "ff" ? "Faune-France" : "eBird"} : ${M.name(x.e)} (${fmtShort(x.d)} → ${fmtShort(n.d)})`); toast("Date et lieu repris dans toutes les listes de cette observation."); }));
  $$("[data-sdkeep]").forEach((b) => b.addEventListener("click", () => { const x = c.srcDate[+b.dataset.sdkeep];
    S.apply(x.ticks.map((t) => ({ kind: "set-tick", cle: t.cle, id: t.id, patch: { vf: x.d } })), `Date confirmée : ${M.name(x.e)} (${fmtShort(x.d)})`); }));
  $$("[data-renum]").forEach((b) => b.addEventListener("click", () => { const cle = b.dataset.renum, mv = M.renumber(cle); S.apply(mv.map((m) => ({ kind: "set-tick", cle, id: m.t.id, patch: { n: m.to } })), `${L(cle).nom} : ${mv.length} coches renumérotées par date`); toast("Numéros remis dans l'ordre des dates."); }));
  const aa = $("#align-all"); if (aa) aa.addEventListener("click", () => { S.apply(c.placeMismatch.flatMap(alignOps), `Lieux alignés : ${c.placeMismatch.length} observations`); toast("Lieux alignés."); });
  $$("[data-addyl]").forEach((b) => b.addEventListener("click", () => {
    const [cle, id] = b.dataset.addyl.split("/"), t = (M.db.coches[cle] || []).find((x) => x.id === id); if (!t) return;
    const y = yearOf(t.d); const tick = { id: `yl${y}-${Date.now().toString(36)}`, e: t.e, d: t.d }; ["l", "p", "lat", "lon", "sd", "sl"].forEach((k) => { if (t[k] != null) tick[k] = t[k]; });
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
    <section class="panel"><span class="lab">Thème</span><div class="seg" id="thm"><button class="btn" type="button" data-t="auto">Auto</button><button class="btn" type="button" data-t="light">☀ Clair</button><button class="btn" type="button" data-t="dark">☾ Sombre</button></div></section>
    ${!first ? `<form class="panel" id="flk"><label>Clé API Flickr <small>(pour ajouter une photo par un lien Flickr)</small><input class="field" id="flkey" autocomplete="off" placeholder="32 caractères" value="${esc(flickrKey())}"></label>
      <details><summary>Obtenir la clé (gratuite)</summary><ol class="steps"><li>Ouvre <a href="https://www.flickr.com/services/apps/create/apply/" target="_blank" rel="noopener">flickr.com › App Garden › Create an app</a> et choisis « non-commercial ».</li><li>Nom : « Rencontre Ornitho », une phrase de description, valide.</li><li>Copie la « Key » (pas le « Secret ») et colle-la ci-dessus.</li></ol></details>
      <div class="row"><button class="btn" type="submit">Enregistrer la clé Flickr</button></div><p class="cap">Elle reste sur cet appareil.</p></form>
    <section class="panel"><p>${S.pending.length ? `${S.pending.length} ${plural(S.pending.length, "changement")} pas encore ${S.pending.length > 1 ? "envoyés" : "envoyé"}.` : "Tout est envoyé sur GitHub."} ${S.error ? `<br><span class="miss">${esc(S.error)}</span>` : ""}</p>
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
  view.querySelectorAll("#thm button").forEach((b) => b.addEventListener("click", () => setTheme(b.dataset.t))); paintTheme();
  const sb = $("#sync"); if (sb) sb.addEventListener("click", () => S.sync());
  const fk = $("#flk"); if (fk) fk.addEventListener("submit", (e) => { e.preventDefault(); setFlickrKey($("#flkey").value); toast("Clé Flickr enregistrée."); });
  const rb = $("#reload"); if (rb) rb.addEventListener("click", () => { S.resetCache(); S.sync(); go("#/"); });
}

// ---------- thème clair / sombre ----------
const darkMQ = matchMedia("(prefers-color-scheme: dark)");
function themePref() { try { const t = localStorage.getItem("ro.theme"); return t === "light" || t === "dark" ? t : "auto"; } catch { return "auto"; } }
function themeIsDark() { const p = themePref(); return p === "dark" || (p === "auto" && darkMQ.matches); }
function setTheme(t) {
  try { if (t === "auto") localStorage.removeItem("ro.theme"); else localStorage.setItem("ro.theme", t); } catch {}
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  paintTheme();
}
function paintTheme() {
  const dark = themeIsDark(), b = $("#theme");
  if (b) { b.textContent = dark ? "☀" : "☾"; const l = dark ? "Passer au thème clair" : "Passer au thème sombre"; b.title = l; b.setAttribute("aria-label", l); }
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = dark ? "#0E1A17" : "#0A7895";
  document.querySelectorAll("#thm button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.t === themePref())));
}
$("#theme")?.addEventListener("click", () => setTheme(themeIsDark() ? "light" : "dark"));
darkMQ.addEventListener?.("change", paintTheme);
paintTheme();

// ---------- start ----------
renderStatus(); route();
if (S.ready) S.sync();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
