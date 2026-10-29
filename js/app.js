// Rencontre Ornitho: router, shell and the read-only screens.
import { $, $$, esc, norm, plural, fmtDay, fmtShort, MOIS, MOIS_C, todayIso, yearOf, isFrance, store, toast, srcName, QUALITES, qualite, qTag, byFr, cmp, uid } from "./util.js";
import { Store } from "./store.js";
import { buildModel, PHOTO_FR, LIFERS, VU } from "./model.js";
import { renderAdd, renderEdit } from "./form.js";
import { mapView, listMap, dropMaps, mapPicker } from "./map.js";
import { photoBox, flickrKey, setFlickrKey } from "./photos.js";
import { exportXlsx, exportJson } from "./export.js";
import { screenLists } from "./lists.js";
import { screenImport } from "./importer.js";
import { whereIs, outsideOf, nameAt, deptFromPlace, communeFromPlace, listCovers, onOuessant, distKm, countryLists } from "./geo.js";
import { readFolder, showFolder } from "./dossier.js";

export const S = new Store();
export let M = buildModel(S.db);
const UI = Object.assign({ scope: "fr", year: new Date().getFullYear() }, store("ro.ui") || {});
export const saveUI = (patch) => { Object.assign(UI, patch); store("ro.ui", UI); };
export { UI };

const view = $("#view"); window.__roBooted = true;
// a date that changes (or a tick added) in a numbered list: its numbers follow the dates again, at once
S.afterApply = (ops) => {
  const cles = [...new Set(ops.filter((o) => (o.kind === "set-tick" && o.patch && "d" in o.patch) || o.kind === "add-tick" || o.kind === "del-tick").map((o) => o.cle))]
    .filter((cle) => (S.db.listes.find((l) => l.cle === cle) || {}).numerotee);
  if (!cles.length) return [];
  const m = buildModel(S.db);
  return cles.flatMap((cle) => m.renumber(cle).map((x) => ({ kind: "set-tick", cle, id: x.t.id, patch: { n: x.to } })));
};
// where an error comes from (file:line of the first frames), to be able to fix it from a screenshot
export const errWhere = (e) => String((e && e.stack) || "").split("\n").filter((l) => /\.js/.test(l)).slice(0, 3).map((l) => (l.match(/([\w-]+\.js)(?:\?[^:]*)?:(\d+):(\d+)/) || []).slice(1).join(":")).filter(Boolean).join(" ← ");
// the model is rebuilt and the screen redrawn only when the base itself changed (a change of yours, or one read from
// GitHub); the sending status (busy, ok, offline) only updates the status button
let seenV = -1, saveErrShown = false;
S.on(() => {
  const changed = S.version !== seenV;
  if (changed) {
    seenV = S.version;
    // a model that cannot be built from the base must not block sending the changes to GitHub
    try { M = buildModel(S.db); } catch (e) { console.error(e); toast(`Erreur dans la base : ${e.message} (${errWhere(e)})`, "error"); }
  }
  renderStatus();
  if (S.saveError && !saveErrShown) { saveErrShown = true; toast(S.saveError, "error"); } else if (!S.saveError) saveErrShown = false;
  if (!changed && !/^#\/reglages/.test(location.hash)) return;
  const a = document.activeElement; // do not redraw under someone typing; a clicked button is fine
  if (!view.contains(a) || !a.matches("input:not([type=checkbox]):not([type=radio]), textarea, select")) route(true);
});

// ---------- status ----------
function renderStatus() {
  const el = $("#status"), n = S.pending.length;
  const text = { busy: "Envoi…", ok: n ? `${n} en attente` : "À jour", offline: `Hors ligne${n ? ` · ${n} en attente` : ""}`, error: "Erreur", idle: n ? `${n} en attente` : "" }[S.state] || "";
  el.dataset.state = S.saveError ? "error" : S.state; $(".status-text", el).textContent = S.saveError ? "Mémoire pleine" : text;
  el.title = S.saveError || S.error || (n ? `${n} ${plural(n, "changement")} pas encore envoyé${n > 1 ? "s" : ""} sur GitHub` : "Tout est enregistré sur GitHub");
}
$("#status").addEventListener("click", () => { if (S.error) toast(S.error + (S.errorAt ? ` (${S.errorAt})` : ""), "error"); S.sync(); });

// ---------- router ----------
const ROUTES = [
  [/^#?\/?$/, screenHome], [/^#\/liste\/([\w-]+)(?:\?.*)?$/, screenList], [/^#\/annee(?:\/(\d{4}))?$/, screenYear],
  [/^#\/journal$/, screenJournal], [/^#\/album$/, screenAlbum], [/^#\/especes$/, screenAllSpecies], [/^#\/espece\/([\w-]+)(?:\?(.*))?$/, screenSpecies], [/^#\/ajout(?:\?(.*))?$/, (q) => renderAdd(view, new URLSearchParams(q || ""))],
  [/^#\/coche\/([\w-]+)\/([\w-]+)$/, screenTick], [/^#\/liste\/([\w-]+)\/plusieurs$/, screenBulk], [/^#\/lieux$/, screenPlaces], [/^#\/lieu\?(.*)$/, screenPlace], [/^#\/coche\/([\w-]+)\/([\w-]+)\/modifier$/, (cle, id) => renderEdit(view, cle, id)], [/^#\/plus$/, screenMore], [/^#\/calendrier$/, screenCalendar],
  [/^#\/a-faire$/, screenTodo], [/^#\/carte\/([\w-]+)$/, screenListMap], [/^#\/reglages$/, screenSettings], [/^#\/listes$/, () => screenLists(view)], [/^#\/import$/, () => screenImport(view)],
];
let current = "";
export function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function route(soft) {
  const h = location.hash || "#/";
  if (!S.ready && !/^#\/reglages/.test(h)) { location.replace("#/reglages"); return; }
  if (soft && (/^#\/(ajout|coche|listes|import|carte)/.test(h) || /\/plusieurs$/.test(h) || /^#\/lieu\?/.test(h))) return; // never redraw a form while it is open
  if (soft && h === current && document.querySelector(".keep-scroll")) { const y = scrollY; draw(h); scrollTo(0, y); return; }
  draw(h);
}
// a screen that fails says so (instead of a blank page), with what to send to fix it
function showError(err, where) {
  console.error(err);
  const st = errWhere(err) || String((err && err.stack) || "").split("\n").slice(0, 4).join("\n");
  view.innerHTML = `<div class="screen"><h2>Oups, cet écran a planté</h2><p>Écran : <code>${esc(where || location.hash)}</code></p><pre class="errbox">${esc(String((err && err.message) || err))}\n${esc(st)}</pre><p class="cap">Fais une capture de cet écran pour Claude.</p><div class="row"><button class="btn btn-primary" type="button" id="err-reload">Recharger l'appli</button><a class="btn" href="#/">Retour aux listes</a></div></div>`;
  $("#err-reload").addEventListener("click", () => location.reload());
}
window.addEventListener("error", (e) => { if (!view.firstElementChild) showError(e.error || e.message, location.hash); });
window.addEventListener("unhandledrejection", (e) => { if (!view.firstElementChild) showError(e.reason, location.hash); });
let onKey = null; // a screen's keyboard shortcuts (species page: arrows)
window.addEventListener("keydown", (e) => { if (onKey) onKey(e); });
function draw(h) {
  onKey = null;
  setTimeout(dropMaps, 0); // the maps of the screen being replaced
  for (const [re, fn] of ROUTES) { const m = h.match(re); if (m) { current = h; if (fn !== screenSettings && !S.hasData) { loading(); return; } try { fn(...m.slice(1)); } catch (err) { showError(err, h); } setNav(h); return; } }
  location.replace("#/");
}
window.addEventListener("hashchange", () => { if ((location.hash || "#/") === current && view.firstElementChild) return; route(); scrollTo(0, 0); }); // already drawn (opened by a button)
// a photo added or removed in a photo box: the whole screen shows it
window.addEventListener("ro-redraw", () => { const y = scrollY; draw(location.hash); scrollTo(0, y); });
// the + button on the form already open: a fresh form (a link to the page you are on does nothing by itself)
document.querySelector("#nav .add").addEventListener("click", (e) => { if (location.hash === "#/ajout") { e.preventDefault(); draw("#/ajout"); scrollTo(0, 0); } });
// the tab of the screen: a species opened from the Espèces tab stays under it, the other lists and species under Listes
function setNav(h) {
  const tab = /^#\/especes|^#\/espece\/[^?]*\?l=especes/.test(h) ? "#/especes" : /^#\/?$|^#\/(liste|espece|coche|carte)/.test(h) ? "#/" : (h.match(/^#\/[a-z-]+/) || [""])[0];
  $$("#nav a").forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === tab || (tab === "#/annee" && a.getAttribute("href") === "#/annee") ? "page" : "false"));
}
function loading() {
  view.innerHTML = S.state === "error" || S.state === "offline" ? `<div class="empty"><p>${esc(S.error || "Impossible de lire la base.")}</p><p><a href="#/reglages">Réglages</a></p></div>` : `<div class="empty"><p>Lecture de la base sur GitHub…</p></div>`;
}

// ---------- shared bits ----------
// from: the list the link is shown in, so the species page can go to the previous / next species of that list
const nameLink = (sid, from) => `<a href="#/espece/${esc(sid)}${from ? "?l=" + encodeURIComponent(from) : ""}">${esc(M.name(sid))}</a>${qTag(M.spQ(sid))}`;
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
// del: the species, to offer « Supprimer » on each photo
// tag: for each photo, the label to show and change in one tap ({ cur, host }), or null
export function phSlider(photos, name, { del, tag } = {}) {
  if (!photos.length) return "";
  return `<div class="phs" data-i="0">${photos.map((p, i) => `<figure class="phs-f"${i ? " hidden" : ""} data-when="${esc(p.d ? fmtDay(p.d) + (p.h ? " à " + p.h : "") : "")}">${phImg(p.img || p.url, name)}<figcaption><b>${esc(p.label)}</b>${qTag(p.q)}${p.d ? " · " + esc(fmtShort(p.d)) + (p.h ? " à " + esc(p.h) : "") : ""}${p.nv ? ' · <span class="miss">date non vérifiée</span>' : ""}${p.zone && p.zone !== "France" ? " · " + esc(p.zone) : ""}<small>${esc(p.file || "")}${p.page ? ` · <a href="${esc(p.page)}" target="_blank" rel="noopener">voir sur Flickr</a>` : ""}${del ? ` · <button type="button" class="linkish ph-x" data-phdel="${esc(p.img || p.url)}" data-sid="${esc(del)}">Supprimer</button>` : ""}</small>${(() => { const t = tag && tag(p); return t ? qPick(t.cur, t.host, "Étiquette de cette photo") : ""; })()}</figcaption></figure>`).join("")}${photos.length > 1 ? `<button type="button" class="phs-b prev" aria-label="Photo précédente">‹</button><button type="button" class="phs-b next" aria-label="Photo suivante">›</button><span class="phs-n">1 / ${photos.length}</span>` : ""}</div>`;
}
export function wirePhotos(root) {
  $$(".phs:not([data-w])", root).forEach((box) => {
    box.dataset.w = "1"; const fs = $$(".phs-f", box);
    const show = (d) => { const i = (+box.dataset.i + d + fs.length) % fs.length; box.dataset.i = i; fs.forEach((f, k) => { f.hidden = k !== i; }); const n = $(".phs-n", box); if (n) n.textContent = `${i + 1} / ${fs.length}`; hydrate(box); };
    $$(".phs-b", box).forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); show(b.classList.contains("prev") ? -1 : 1); }));
  });
  hydrate(root);
}
// « Supprimer » on a photo: a second tap confirms; the photo goes from everywhere it shows (best of, ticks, Liste folder)
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-phdel]"); if (!b) return;
  ev.stopPropagation();
  if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Confirmer la suppression"; b.classList.add("armed"); setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "Supprimer"; b.classList.remove("armed"); } }, 4000); return; }
  const sid = b.dataset.sid, ops = M.deletePhotoOps(sid, b.dataset.phdel);
  if (!ops.length) { toast("Cette photo n'est enregistrée nulle part."); return; }
  const n = ops.filter((o) => o.kind === "set-tick").length;
  S.apply(ops, `Photo supprimée : ${M.name(sid)}${n ? ` (${n} ${plural(n, "coche")})` : ""}`);
  toast("Photo supprimée. « Annuler » dans À faire pour la remettre.");
  const y = scrollY; draw(location.hash); scrollTo(0, y);
}, true);
// a tap on a photo shows it big
document.addEventListener("click", (ev) => {
  const im = ev.target.closest("img.ph[src]"); if (!im || im.closest(".ph-pk")) return;
  // under the photo: the species, the day and the time it was taken (when known)
  const f = im.closest("figure"), when = f && f.dataset.when, file = f && $("figcaption small", f), sp = im.dataset.alt || im.alt || "";
  const fname = f && f.dataset.file != null ? f.dataset.file : file && file.firstChild && file.firstChild.nodeType === 3 ? file.firstChild.textContent.replace(/ · $/, "") : "";
  const cap = [sp ? (f && f.dataset.sid ? `<a href="#/espece/${esc(f.dataset.sid)}"><b>${esc(sp)}</b></a>` : `<b>${esc(sp)}</b>`) : "", when ? esc(when) + (/ à \d/.test(when) ? "" : " · heure inconnue") : "", fname ? esc(fname) : ""].filter(Boolean).join(" · ");
  const box = document.createElement("div"); box.className = "lightbox"; box.innerHTML = `<img src="${im.src}" alt="${esc(im.alt)}">${cap ? `<p class="lb-cap">${cap}</p>` : ""}<button type="button" aria-label="Fermer">×</button>`;
  const close = () => { box.remove(); document.removeEventListener("keydown", esc_); };
  const esc_ = (e) => { if (e.key === "Escape") close(); };
  box.addEventListener("click", close); document.addEventListener("keydown", esc_); document.body.appendChild(box);
});

// in a list, a row opens that tick (toTick); elsewhere it opens the species page
function row(t, { rank, showList = false, from, toTick = false } = {}) {
  const place = t.l && t.l !== t.p ? t.l : "";
  const name = toTick ? `<a href="#/coche/${esc(t.cle)}/${esc(t.id)}">${esc(M.name(t.e))}</a>${qTag(t.q)}${qTag(M.bestQ(t.e), "best")}${M.photosFor(t).length ? ' <span class="cap" title="Photo de la coche">📷</span>' : ""}` : nameLink(t.e, from);
  return `<li class="tick"><span class="n" ${cstyle(t.cle)}>${rank != null ? rank : M.rankOf(t)}</span><span class="what">${name}${showList ? " " + chip(t.cle) : ""}${!isFrance(t.p) ? ` <span class="abroad">${esc(t.p)}</span>` : ""}<small>${esc(place)}</small></span><span class="when">${t.d ? esc(fmtShort(t.d)) : "<em>sans date</em>"}</span></li>`;
}

// ---------- home: the lists ----------
function screenHome() {
  const c = (cle) => M.liste.has(cle) ? M.count(cle) : 0;
  const lastOf = (cle) => { let b = null; for (const t of (M.db.coches[cle] || [])) if (t.d && (!b || t.d > b.d || (t.d === b.d && (t.n || 0) > (b.n || 0)))) b = t; return b; };
  // one compact row per list: colour, name, the last tick, the count; depth draws the nesting (France ⊃ AURA ⊃ Rhône…)
  const lrow = (cle, depth = 0, sub) => {
    if (!M.liste.has(cle)) return "";
    const lt = lastOf(cle);
    const note = sub || (lt ? `${esc(M.name(lt.e))} · ${esc(fmtShort(lt.d))}` : "");
    return `<a class="lrow d${depth}" href="#/liste/${cle}" style="--c:${M.color(cle)}"><i></i><span class="lr-nm">${esc(L(cle).nom)}${note ? `<small>${note}</small>` : ""}</span><b>${c(cle)}</b></a>`;
  };
  const vu = M.vuOpen();
  const liferAll = new Set([...M.speciesOf(LIFERS).map((t) => t.e), ...vu.ab.map((t) => t.e)]).size;
  const zones = M.listes.filter((l) => l.type === "zone" || l.type === "lieu").map((l) => l.cle);
  const others = M.listes.filter((l) => !["annee", "vu", "zone", "lieu", "photo"].includes(l.type));
  // the trips: each country, followed by its parts (La Palma under Espagne)
  const voyages = (ls) => { const out = [], put = (l) => { out.push(l); ls.filter((x) => x.dans === l.cle).forEach(put); }; ls.filter((l) => !ls.some((x) => x.cle === l.dans)).forEach(put); return out; };
  const guy = M.speciesOf("guyane"), gt = (k) => guy.filter((t) => norm(t.t) === k).length;
  // this year against the same day of the other years
  const today = todayIso(), y0 = +today.slice(0, 4), md = today.slice(5);
  const atDay = (y) => M.yearList(y, "fr").filter((t) => t.d && t.d.slice(5) <= md).length;
  const ys = M.years.slice();
  const now = M.yearList(y0, "fr").length, prev = ys.includes(y0 - 1) ? atDay(y0 - 1) : null;
  view.innerHTML = `<div class="screen keep-scroll home2">
    <div class="hsearch"><input class="field" type="search" id="hq" placeholder="Oiseau, date, lieu, n° de photo…" autocomplete="off" value="${esc(UI.hq || "")}"><div class="hres2" id="hres" hidden></div></div>
    ${ys.includes(y0) ? `<a class="ynow" href="#/annee/${y0}"><span><small>Year list ${y0} · France</small><b>${now}</b> espèces</span>${prev != null ? `<span class="ydiff ${now >= prev ? "up" : "down"}">${now >= prev ? "+" : "−"}${Math.abs(now - prev)}<small>vs ${y0 - 1} à la même date</small></span>` : ""}</a>` : ""}
    <section class="lgroup"><h3 class="minor">Listes photo</h3>
      ${lrow(LIFERS, 0, `${liferAll} avec les vues / entendues à l'étranger`)}
      ${lrow(PHOTO_FR, 1)}${lrow("aura", 2)}${lrow("rhone", 3)}${lrow("jardin", 4)}${lrow("bureau", 4)}
      ${["ouessant", ...zones.filter((z) => !["aura", "rhone", "jardin", "bureau", "ouessant"].includes(z))].map((z) => lrow(z, 2)).join("")}
    </section>
    ${others.length ? `<section class="lgroup"><h3 class="minor">Voyages</h3>${voyages(others).map((l) => lrow(l.cle, M.chain(l.cle).length - 1, l.cle === "guyane" ? `${c(l.cle) - gt("vu") - gt("entendu")} en photo · ${gt("vu")} vues · ${gt("entendu")} entendues` : null)).join("")}</section>` : ""}
    <section class="lgroup tophoto"><h3 class="minor">À photographier</h3><div class="tp">
      <a href="#/liste/vu?f=fr"><b>${vu.fr.length}</b><span>en France<small>vues / entendues</small></span></a>
      <a href="#/liste/vu?f=ab"><b>${vu.ab.length}</b><span>à l'étranger<small>jamais en photo</small></span></a>
    </div></section>
    <section><h3 class="minor">Year lists</h3><div class="years">${ys.slice().reverse().map((y) => { const fr = M.yearList(y, "fr").length, w = M.yearList(y, "monde").length; return `<a href="#/annee/${y}"><span>${y}</span><b>${fr}</b>${w !== fr ? `<small>${w} avec l'étranger</small>` : ""}</a>`; }).join("")}</div></section>
  </div>`;
  // search across everything (birds, dates, places, photo numbers), the same as on the Espèces tab
  const hq = $("#hq"), hres = $("#hres");
  const hdraw = () => {
    const v = hq.value.trim(); saveUI({ hq: v });
    if (!v) { hres.hidden = true; hres.innerHTML = ""; return; }
    hres.hidden = false; hres.innerHTML = resultsHtml(findAll(v), { max: 25 });
  };
  let htm = null; hq.addEventListener("input", () => { clearTimeout(htm); htm = setTimeout(hdraw, 150); }); hdraw();
}


// ---------- search everywhere: birds, dates, places, photo numbers ----------
const MOIS_N = MOIS.map(norm), MOIS_CN = MOIS_C.map((m) => norm(m));
const pad2 = (n) => String(n).padStart(2, "0");
const monthOf = (w) => { const i = MOIS_N.indexOf(w); if (i >= 0) return i + 1; const j = MOIS_CN.findIndex((m) => m && (w === m || (w.length >= 3 && m.startsWith(w) && MOIS_N[MOIS_CN.indexOf(m)].startsWith(w)))); return j >= 0 ? j + 1 : 0; };
// a date written in any usual way: 11/05/2019, 11.05.2019, 2019-05-11, 11/05 (every year), 05/2019, mai 2019, 11 mai, 2019
function parseWhen(k) {
  const w = k.split(" ").filter(Boolean), num = (x) => /^\d+$/.test(x), y4 = (x) => /^(19|20)\d\d$/.test(x);
  const day = (d, m, y) => (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31 ? { d, m, y } : null);
  let r = null;
  if (w.length === 3 && w.every(num)) r = y4(w[0]) ? day(w[2], w[1], w[0]) : y4(w[2]) ? day(w[0], w[1], w[2]) : null;
  else if (w.length === 2 && w.every(num)) r = y4(w[1]) && +w[0] <= 12 ? { m: w[0], y: w[1] } : y4(w[0]) && +w[1] <= 12 ? { m: w[1], y: w[0] } : !y4(w[0]) && !y4(w[1]) ? day(w[0], w[1]) : null;
  else if (w.length === 1 && y4(w[0])) r = { y: w[0] };
  else if (w.length >= 1 && w.length <= 3) {
    const mi = w.findIndex((x) => !num(x)), m = mi >= 0 ? monthOf(w[mi]) : 0;
    if (m && w.every((x, i) => i === mi || num(x))) { const rest = w.filter((_, i) => i !== mi), y = rest.find(y4), d = rest.find((x) => !y4(x)); r = d ? day(d, m, y) : { m, y }; }
  }
  if (!r) return null;
  const D = r.d && pad2(r.d), Mo = r.m && pad2(r.m);
  const test = (iso) => !!iso && (!r.y || iso.slice(0, 4) === r.y) && (!Mo || iso.slice(5, 7) === Mo) && (!D || iso.slice(8, 10) === D);
  const mo = Mo && MOIS[+r.m - 1], de = (w) => (/^[aeiouh]/.test(w) ? "d'" : "de ") + w;
  const label = D ? `du ${+r.d === 1 ? "1er" : +r.d} ${mo}${r.y ? " " + r.y : " (toutes les années)"}` : Mo ? `${de(mo)}${r.y ? " " + r.y : " (toutes les années)"}` : `de ${r.y}`;
  return { test, label };
}
// all the photos the app knows, with their original file names: for « 5030 », « DSC_5030 », « CR5_4777 »
function photoIndex() {
  if (M._phIdx) return M._phIdx;
  const out = [], seen = new Set();
  for (const sid of M.bySp.keys()) for (const p of M.allPhotos(sid)) { if (!p.file) continue; const k = sid + "|" + (M.picKey(p) || p.img || p.url); if (seen.has(k)) continue; seen.add(k); out.push({ sid, p, f: " " + norm(p.file) + " " }); }
  return (M._phIdx = out);
}
export function findAll(q) {
  const k = norm(q); if (!k) return null;
  const when = parseWhen(k), hasLetters = /[a-z]/.test(k), digits = /\d/.test(k);
  // birds by name (French, other names, Latin), unless the text is clearly a date or a number
  const species = !when && hasLetters ? M.search(q, 40) : [];
  // ticks: of that date; or whose place, country or detail has the text
  let ticks = [];
  if (when) ticks = M.ticks.filter((t) => when.test(t.d));
  else if (hasLetters && k.length >= 3) { M._txt = M._txt || new Map(M.ticks.map((t) => [t, " " + norm(`${t.l || ""} ${isFrance(t.p) ? "" : t.p} ${t.t || ""}`) + " "])); ticks = M.ticks.filter((t) => M._txt.get(t).includes(k)); }
  ticks.sort((a, b) => cmp(b.d || "", a.d || "") || cmp(a.cle, b.cle));
  // photos by the number or the name of the original file
  const photos = digits && k.replace(/\D/g, "").length >= 3 ? photoIndex().filter((x) => x.f.includes(" " + k) || (/^\d+$/.test(k) && x.f.includes(k + " ")) || x.f.includes(" " + k.replace(/ /g, ""))) : [];
  return { k, when, species, ticks, photos };
}
// the rows: a species (photo, name, labels, its lists), a tick (list, date, place), a photo (picture, file, date)
// the label of the photo shown, to change in one tap: the best-of photo's (species), else the lifer photo's
// (the observation's ticks); host: what the buttons change
const qPick = (cur, host, what = "") => `<span class="qpick qmini" data-qs="${esc(host)}">${what ? `<span class="qwhat">${esc(what)}</span>` : ""}${QUALITES.map((x) => `<button type="button" class="qtag${cur === x.v ? " on" : ""}" style="--c:${x.c}" data-qv="${esc(x.v)}" aria-pressed="${cur === x.v}" title="${esc(x.v)}">${x.court}</button>`).join("")}</span>`;
const samePic2 = (a, b) => !!(a && b && ((a.img || a.url) === (b.img || b.url) || (M.picKey(a) && M.picKey(a) === M.picKey(b))));
// a tap on a label: set it (or remove it if it was the one), for the species or the whole observation
function wireQuickTags(root) {
  root.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-qv]"), host = b && b.closest("[data-qs]"); if (!host) return;
    ev.preventDefault(); ev.stopPropagation();
    // the screen is redrawn after the change: the photo sliders stay on the photo you were looking at
    const at = $$(".phs", view).map((x) => +x.dataset.i || 0), y = scrollY;
    setTimeout(() => { $$(".phs", view).forEach((x, k) => { const i = at[k] || 0, fs = $$(".phs-f", x); if (!i || i >= fs.length) return; x.dataset.i = i; fs.forEach((f, j) => { f.hidden = j !== i; }); const n = $(".phs-n", x); if (n) n.textContent = `${i + 1} / ${fs.length}`; hydrate(x); }); scrollTo(0, y); }, 0);
    const val = b.dataset.qv, on = b.classList.contains("on"), v = on ? null : val, ops = [], names = [];
    for (const h of host.dataset.qs.split(";")) {
      const [kind, ref] = h.split("|");
      if (kind === "best") { const e = M.esp.get(ref); if ((e.q || null) !== v) ops.push({ kind: "set-espece", id: ref, patch: { q: v } }); names.push("best of"); continue; }
      const [c, i] = ref.split("/"), t = M.tickOf(c, i); if (!t) continue;
      const obs = [t, ...(t.d ? M.ticks.filter((x) => x !== t && M.sameObs(t, x)) : [])];
      obs.filter((x) => (x.q || null) !== v).forEach((x) => ops.push({ kind: "set-tick", cle: x.cle, id: x.id, patch: { q: v } })); names.push(...obs.map((x) => L(x.cle).nom));
    }
    const sid = (host.dataset.qs.match(/best\|([\w-]+)/) || [])[1] || (M.tickOf(...(host.dataset.qs.match(/obs\|([\w-]+)\/([\w-]+)/) || []).slice(1)) || {}).e;
    if (ops.length) S.apply(ops, `Étiquette photo : ${M.name(sid)} (${names.join(", ")}) → ${v || "aucune"}`);
    toast(v ? `Étiquette : ${qualite(v).court}.` : "Étiquette retirée.");
  }, true);
}
const spThumb = (sid) => { const p = M.allPhotos(sid)[0]; return `<span class="sp-th">${p ? phImg(p.img || p.url, M.name(sid)) : ""}</span>`; };
function spRow(e, from) {
  const m = M.bySp.get(e.id) || new Map(), lif = M.tick(e.id, LIFERS);
  const ls = M.listes.filter((l) => m.has(l.cle) && l.type !== "annee"), yl = M.listes.filter((l) => m.has(l.cle) && l.type === "annee").length;
  const sub = lif ? `Lifer n°${lif.n || M.rankOf(lif)} · ${lif.d ? fmtShort(lif.d) : "sans date"}${lif.l ? " · " + esc(lif.l) : ""}` : m.has(VU) ? "vue ou entendue, pas encore en photo" : m.size ? "" : "jamais cochée";
  return `<li class="sprow">${spThumb(e.id)}<span class="what"><a href="#/espece/${esc(e.id)}${from ? "?l=" + from : ""}">${esc(e.n)}</a>${qTag(M.spQ(e.id))}<small>${sub}</small><span class="hwhere">${ls.map((l) => chip(l.cle)).join(" ")}${yl ? ` <span class="chip-s yl">${yl} YL</span>` : ""}</span></span></li>`;
}
// the same observation in several lists (same species, same day): one row, with all its lists
function groupObs(ticks) {
  const out = [], by = new Map();
  for (const t of ticks) { const k = t.e + "|" + (t.d || t.cle + t.id); const gs = by.get(k) || []; const g = t.d && gs.find((x) => M.sameObs(x[0], t)); if (g) g.push(t); else { const n = [t]; gs.push(n); out.push(n); } by.set(k, gs); }
  return out;
}
const RANK = (cle) => (cle === LIFERS ? 0 : cle === PHOTO_FR ? 1 : (M.liste.get(cle) || {}).type === "annee" ? 9 : 5);
const obsRow = (ts) => { ts = ts.slice().sort((a, b) => RANK(a.cle) - RANK(b.cle)); const t = ts.find((x) => x.l) || ts[0], main = ts[0], ph = M.photosFor(main)[0];
  return `<li class="sprow"><span class="sp-th">${ph ? phImg(ph.img || ph.url, M.name(t.e)) : ""}</span><span class="what"><a href="#/coche/${esc(main.cle)}/${esc(main.id)}">${esc(M.name(t.e))}</a>${qTag(main.q)}<small>${t.d ? esc(fmtShort(t.d)) : "sans date"}${t.l ? " · " + esc(t.l) : ""}${!isFrance(t.p) ? " · " + esc(t.p) : ""}${t.t ? " · " + esc(t.t) : ""}</small><span class="hwhere">${ts.map((x) => `<a class="chip-s" ${cstyle(x.cle)} href="#/coche/${esc(x.cle)}/${esc(x.id)}">${esc(L(x.cle).nom)}${M.rankOf(x) ? " n°" + M.rankOf(x) : ""}</a>`).join(" ")}</span></span></li>`; };
const photoRow = (x) => `<li class="sprow"><span class="sp-th">${phImg(x.p.img || x.p.url, M.name(x.sid))}</span><span class="what"><a href="#/espece/${esc(x.sid)}">${esc(M.name(x.sid))}</a>${qTag(x.p.q)}<small>${esc(x.p.file)} · ${x.p.d ? esc(fmtShort(x.p.d)) : "sans date"}${x.p.h ? " " + esc(x.p.h) : ""}</small><small>${esc(x.p.label || "")}</small></span></li>`;
export function resultsHtml(r, { max = 60, from } = {}) {
  if (!r) return "";
  const sec = (title, n, rows, cls = "ticks") => n ? `<section class="sres"><h3 class="minor">${title} · ${n}</h3><ul class="${cls}">${rows}</ul>${n > max ? `<p class="cap">… et ${n - max} autres : précise ta recherche.</p>` : ""}</section>` : "";
  const html = sec("Oiseaux", r.species.length, r.species.slice(0, max).map((e) => spRow(e, from)).join(""), "ticks splist")
    + (() => { const obs = groupObs(r.ticks); return sec(r.when ? `Observations ${esc(r.when.label)}` : "Observations à ce lieu ou avec ce détail", obs.length, obs.slice(0, max).map(obsRow).join(""), "ticks splist"); })()
    + sec("Photos dont le fichier correspond", r.photos.length, r.photos.slice(0, max).map(photoRow).join(""), "ticks splist");
  return html || `<p class="cap">Rien trouvé pour « ${esc(r.k)} ». Essaie un nom d'oiseau, une date (11/05/2019, mai 2019), un lieu ou un numéro de photo.</p>`;
}

// ---------- all the species ----------
// ---------- Album: every photo the app knows, the photos of one list, the best of each species ----------
function albumPhotos(f, cle) {
  const out = [], seen = new Set();
  const add = (sid, p, label, q) => {
    if (!p) return; const k = M.picKey(p) || p.img || p.url; if (!k || seen.has(k)) return; seen.add(k);
    out.push({ ...p, sid, label: label || p.label || "", q: q !== undefined ? q : p.q });
  };
  const owned = M.db.especes.filter((e) => M.bySp.has(e.id));
  if (f === "best") owned.forEach((e) => add(e.id, M.bestPhoto(e.id), "Meilleure photo", M.bestQ(e.id)));
  else if (f === "liste") (M.db.coches[cle] || []).forEach((t) => add(t.e, M.photosFor({ ...t, cle })[0], `${L(cle).nom}${t.n ? " n°" + t.n : ""}`, t.q || undefined));
  // all: the photos shown on the species pages, then the other photos of the Liste folder (one per day)
  else owned.forEach((e) => { M.allPhotos(e.id).forEach((p) => add(e.id, p)); M.firstPhotos(e.id).forEach((p) => add(e.id, p, "Dossier Liste")); });
  return out;
}
function screenAlbum() {
  const A = Object.assign({ f: "all", cle: LIFERS, q: "", s: "date" }, UI.album || {});
  const lists = M.listes.filter((l) => (M.db.coches[l.cle] || []).length);
  view.innerHTML = `<div class="screen keep-scroll"><h2>Album</h2>
    <div class="tools"><div class="seg" role="group" aria-label="Photos">${[["all", "Toutes"], ["best", "Best of"], ["liste", "D'une liste"]].map(([k, t]) => `<button type="button" data-alf="${k}" aria-pressed="${A.f === k}">${t}</button>`).join("")}</div>
      <select class="field" id="al-l" ${A.f === "liste" ? "" : "hidden"}>${lists.map((l) => `<option value="${l.cle}" ${l.cle === A.cle ? "selected" : ""}>${esc(l.nom)}</option>`).join("")}</select></div>
    <div class="tools"><select class="field" id="al-q"><option value="">Toutes les étiquettes</option>${QUALITES.map((x) => `<option value="${esc(x.v)}" ${x.v === A.q ? "selected" : ""}>${esc(x.court)}</option>`).join("")}<option value="-" ${A.q === "-" ? "selected" : ""}>Sans étiquette</option></select>
      <div class="seg" role="group" aria-label="Trier">${[["date", "Récentes"], ["old", "Anciennes"], ["nom", "Espèce"]].map(([k, t]) => `<button type="button" data-als="${k}" aria-pressed="${A.s === k}">${t}</button>`).join("")}</div></div>
    <p class="cap" id="al-n"></p><div class="album" id="al-g"></div><div class="row"><button type="button" class="btn" id="al-more" hidden>Voir plus</button></div></div>`;
  let ps = [], shown = 0;
  const card = (p) => `<figure class="al-f" data-when="${esc(p.d ? fmtDay(p.d) + (p.h ? " à " + p.h : "") : "")}" data-file="${esc(p.file || "")}" data-sid="${esc(p.sid)}">${phImg(p.img || p.url, M.name(p.sid))}<figcaption><a href="#/espece/${esc(p.sid)}">${esc(M.name(p.sid))}</a>${qTag(p.q)}<small>${p.d ? esc(fmtShort(p.d)) : "sans date"}${p.label ? " · " + esc(p.label) : ""}</small></figcaption></figure>`;
  const more = () => { const n = Math.min(ps.length, shown + 90); $("#al-g").insertAdjacentHTML("beforeend", ps.slice(shown, n).map(card).join("")); shown = n; $("#al-more").hidden = shown >= ps.length; if (!$("#al-more").hidden) $("#al-more").textContent = `Voir plus (${ps.length - shown})`; };
  const redraw = () => {
    saveUI({ album: A });
    ps = albumPhotos(A.f, A.cle).filter((p) => !A.q || (A.q === "-" ? !p.q : p.q === A.q));
    ps.sort(A.s === "nom" ? (a, b) => byFr(M.name(a.sid), M.name(b.sid)) || cmp(a.d || "", b.d || "") : A.s === "old" ? (a, b) => cmp((a.d || "9") + (a.h || ""), (b.d || "9") + (b.h || "")) : (a, b) => cmp((b.d || "") + (b.h || ""), (a.d || "") + (a.h || "")));
    $("#al-n").textContent = `${ps.length} ${plural(ps.length, "photo")} · ${new Set(ps.map((p) => p.sid)).size} ${plural(new Set(ps.map((p) => p.sid)).size, "espèce")}`;
    $("#al-g").innerHTML = ""; shown = 0; more();
  };
  $$("[data-alf]").forEach((b) => b.addEventListener("click", () => { A.f = b.dataset.alf; $$("[data-alf]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); $("#al-l").hidden = A.f !== "liste"; redraw(); }));
  $$("[data-als]").forEach((b) => b.addEventListener("click", () => { A.s = b.dataset.als; $$("[data-als]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); redraw(); }));
  $("#al-l").addEventListener("change", (e) => { A.cle = e.target.value; redraw(); });
  $("#al-q").addEventListener("change", (e) => { A.q = e.target.value; redraw(); });
  $("#al-more").addEventListener("click", more);
  redraw();
}
function screenAllSpecies() {
  const F = Object.assign({ f: "cochees", s: "nom" }, UI.spf || {});
  view.innerHTML = `<div class="screen keep-scroll"><h2>Espèces</h2>
    <input class="field" type="search" id="sq" placeholder="Oiseau, date, lieu, n° de photo…" autocomplete="off" value="${esc(UI.sq || "")}">
    <div class="tools" id="sp-tools"><div class="seg" role="group" aria-label="Espèces">${[["cochees", "Cochées"], ["photo", "En photo"], ["vu", "Pas encore en photo"]].map(([k, t]) => `<button type="button" data-spf="${k}" aria-pressed="${F.f === k}">${t}</button>`).join("")}</div>
      <div class="seg" role="group" aria-label="Trier">${[["nom", "Nom"], ["famille", "Famille"], ["lifer", "Lifer"]].map(([k, t]) => `<button type="button" data-sps="${k}" aria-pressed="${F.s === k}">${t}</button>`).join("")}</div></div>
    <p class="cap" id="sp-n"></p><div id="sp-res"></div>
    <p class="cap" id="sp-help">Recherche : un oiseau (nom, autre nom, nom latin), une date (11/05/2019, 11/05, mai 2019, 2019), un lieu, ou le numéro d'une photo (5030, DSC_5030).</p></div>`;
  const all = M.db.especes.filter((e) => M.bySp.has(e.id));
  const list = () => {
    let es = all.filter((e) => F.f === "photo" ? M.inList(e.id, LIFERS) : F.f === "vu" ? !M.inList(e.id, LIFERS) : true);
    const lifD = (e) => (M.tick(e.id, LIFERS) || {}).d || "";
    es = es.slice().sort(F.s === "lifer" ? (a, b) => cmp(lifD(b), lifD(a)) || byFr(a.n, b.n) : F.s === "famille" ? (a, b) => (!a.fa - !b.fa) || byFr(a.fa || "", b.fa || "") || byFr(a.n, b.n) : (a, b) => byFr(a.n, b.n));
    return es;
  };
  const draw = () => {
    const q = $("#sq").value.trim(); saveUI({ sq: q });
    $("#sp-tools").hidden = !!q;
    if (q) { const r = findAll(q); $("#sp-n").textContent = ""; $("#sp-res").innerHTML = resultsHtml(r, { max: 150, from: "especes" }); saveUI({ nav: { key: "especes", nom: "Recherche", ids: r.species.map((e) => e.id), refs: r.ticks.map((t) => t.cle + "/" + t.id) } }); return; }
    const es = list();
    $("#sp-n").textContent = `${es.length} ${plural(es.length, "espèce")}${F.f === "cochees" ? ` · ${M.speciesOf(LIFERS).length} en photo` : ""}`;
    let html = "";
    if (F.s === "famille") { const g = new Map(); es.forEach((e) => { const k = e.fa || "Famille inconnue"; if (!g.has(k)) g.set(k, []); g.get(k).push(e); }); html = [...g].map(([fa, xs]) => `<section class="sres"><h3 class="minor">${esc(fa)} · ${xs.length}</h3><ul class="ticks splist">${xs.map((e) => spRow(e, "especes")).join("")}</ul></section>`).join(""); }
    else html = `<ul class="ticks splist">${es.map((e) => spRow(e, "especes")).join("")}</ul>`;
    $("#sp-res").innerHTML = html;
    saveUI({ nav: { key: "especes", nom: "Espèces", ids: es.map((e) => e.id) } });
  };
  let tm = null; $("#sq").addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(draw, 150); });
  $$("[data-spf]").forEach((b) => b.addEventListener("click", () => { F.f = b.dataset.spf; saveUI({ spf: F }); $$("[data-spf]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); }));
  $$("[data-sps]").forEach((b) => b.addEventListener("click", () => { F.s = b.dataset.sps; saveUI({ spf: F }); $$("[data-sps]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); }));
  draw();
}

// ---------- one list ----------
const SORT_ASC = { n: true, nom: true, date: false };
function sortAsc(k) { const d = (UI.dirs || {})[k]; return d ? d === "asc" : SORT_ASC[k]; }
function dirBtn(asc, compact) { const t = asc ? "Ordre croissant" : "Ordre décroissant"; return `<button type="button" class="btn dirbtn${compact ? " dir-c" : ""}" id="dir" title="${t} (toucher pour inverser)" aria-label="${t} (toucher pour inverser)">${compact ? (asc ? "↑" : "↓") : asc ? "↑ Croissant" : "↓ Décroissant"}</button>`; }
function screenList(cle) {
  const l = M.liste.get(cle); if (!l) return go("#/");
  const f = new URLSearchParams(location.hash.split("?")[1] || "").get("f");
  let items = M.speciesOf(cle);
  if (cle === VU && f) { const v = M.vuOpen(); const keep = new Set((f === "fr" ? v.fr : v.ab).map((t) => t.e)); items = items.filter((t) => keep.has(t.e)); }
  // a numbered list is in date order (À faire flags any number out of order), so it sorts by n° or by name; the others by date or name
  const opts = l.numerotee ? [["n", "N°"], ["nom", "Nom"]] : [["date", "Date"], ["nom", "Nom"]];
  const sort = UI.sort === "nom" ? "nom" : l.numerotee ? "n" : "date";
  // each sort keeps its own direction (by default: n° and name ascending, date newest first); missing values stay at the end
  const asc = sortAsc(sort), sg = asc ? 1 : -1;
  const sorted = items.slice().sort(sort === "nom" ? (a, b) => sg * byFr(M.name(a.e), M.name(b.e))
    : sort === "n" ? (a, b) => { const x = M.rankOf(a), y = M.rankOf(b); return !x || !y ? (!x) - (!y) : sg * (x - y); }
    : (a, b) => !a.d || !b.d ? (!a.d) - (!b.d) : sg * cmp(a.d, b.d));
  const parent = l.dans && M.liste.get(l.dans);
  view.innerHTML = `<div class="screen keep-scroll">
    <header class="phead"><a class="back" href="#/">← Listes</a><h1>${esc(l.nom)}</h1><p class="big">${items.length} <small>${plural(items.length, "espèce")}</small> <a class="btn btn-map" href="#/carte/${esc(cle)}">🗺️ Carte</a> <a class="btn btn-map" href="#/liste/${esc(cle)}/plusieurs">＋ Plusieurs</a></p>${l.note ? `<p class="cap">${esc(l.note)}${parent ? ` · comprise dans ${esc(parent.nom)}` : ""}</p>` : ""}${l.photosAttente ? '<p class="cap">📷 Photos en attente : À faire ne les demande pas encore (Plus › Mes listes pour changer).</p>' : ""}</header>
    <div class="tools lt"><input class="field" type="search" id="q" placeholder="Chercher dans la liste" value="${esc(UI.q || "")}">
      <div class="seg" role="group" aria-label="Trier">${opts.map(([k, t]) => `<button type="button" data-sort="${k}" aria-pressed="${sort === k}">${t}</button>`).join("")}</div>${dirBtn(asc, true)}</div>
    <ul class="ticks" id="rows">${sorted.map((t) => row(t, { from: cle, toTick: true })).join("")}</ul>
  </div>`;
  const q = $("#q"), rows = $$("#rows li");
  // the species page follows this order (and this search) with its arrows and swipes
  const filter = () => { const k = norm(q.value); rows.forEach((li, i) => { li.hidden = !!k && !M.matches(k, li.textContent) && !M.matchesSp(k, sorted[i].e); }); const shown = sorted.filter((_, i) => !rows[i].hidden); saveUI({ q: q.value, nav: { key: cle, nom: l.nom, ids: shown.map((t) => t.e), refs: shown.map((t) => t.cle + "/" + t.id) } }); };
  q.addEventListener("input", filter); filter();
  $$("[data-sort]").forEach((b) => b.addEventListener("click", () => { saveUI({ sort: b.dataset.sort }); screenList(cle); }));
  $("#dir").addEventListener("click", () => { saveUI({ dirs: { ...(UI.dirs || {}), [sort]: asc ? "desc" : "asc" } }); screenList(cle); });
}

// ---------- several ticks at once in one list ----------
// tick the species seen, nothing else: they go in without date or place, À faire asks for them afterwards
function screenBulk(cle) {
  const l = M.liste.get(cle); if (!l) return go("#/");
  const sel = new Set(), all = M.db.especes.slice().sort((a, b) => byFr(a.n, b.n)), inList = (id) => M.inList(id, cle);
  const already = all.filter((e) => inList(e.id)).length;
  view.innerHTML = `<div class="screen"><header class="phead"><a class="back" href="#/liste/${esc(cle)}">← ${esc(l.nom)}</a><h1>Cocher plusieurs espèces</h1>
    <p class="cap">Coche les espèces à ajouter à ${esc(l.nom)}. En bas, tu peux leur donner une date et un lieu, ou passer : À faire te demandera ensuite ce qui manque (date, GPS, photo).${l.numerotee ? " Les numéros suivent les dates ; sans date, ils prennent la suite dans l'ordre où tu coches." : ""} ${already} ${plural(already, "espèce")} déjà dans la liste ${already > 1 ? "ne sont" : "n'est"} pas proposée${already > 1 ? "s" : ""}.</p></header>
    <div class="row"><label class="btn">📁 Depuis un dossier de photos<input type="file" id="b-dir" accept="image/jpeg" multiple webkitdirectory hidden></label><label class="btn">🖼 Choisir des photos<input type="file" id="b-files" accept="image/jpeg" multiple hidden></label></div>
    <p class="cap">Les photos doivent avoir le nom de l'espèce en mot-clé (sinon le nom du dossier ou le début du nom du fichier). Chaque espèce est cochée avec la date, l'heure et le GPS de sa plus ancienne photo qui convient à la liste.</p>
    <div id="b-fold"></div>
    <input class="field" type="search" id="bq" placeholder="Chercher un oiseau" autocomplete="off">
    <label class="chk"><input type="checkbox" id="b-seen"> Seulement les espèces déjà cochées dans une autre liste</label>
    <ul class="ticks bulk" id="brows"></ul>
    <section class="panel" id="b-when"><h3 class="minor">Date et lieu, pour toutes <small class="cap">(facultatif)</small></h3>
      <p class="cap">Laisse vide pour passer : À faire te les demandera plus tard.</p>
      <label>Date<input class="field" type="date" id="b-d" max="${todayIso()}"></label>
      <label>Lieu<input class="field" id="b-l" placeholder="Nom du lieu (rempli tout seul si tu touches la carte)" autocomplete="off"></label>
      <div class="minimap" id="b-map"></div><p class="cap" id="b-pt">Touche la carte (ou ◎ pour ta position) pour placer le point.</p></section>
    <div class="row sticky-act"><button class="btn btn-primary btn-lg" id="b-go" type="button" disabled>Ajouter</button><span class="cap" id="b-n"></span></div></div>`;
  const where = (id) => { const m = M.bySp.get(id); return m ? M.listes.filter((x) => m.has(x.cle) && x.type !== "annee").map((x) => x.nom).join(", ") : ""; };
  const count = () => { const n = sel.size; $("#b-go").disabled = !n; $("#b-go").textContent = n ? `Ajouter ${n} ${plural(n, "coche")} à ${l.nom}` : "Ajouter"; $("#b-n").textContent = n ? [...sel].map((id) => M.name(id)).join(", ") : ""; };
  const draw = () => {
    const k = norm($("#bq").value), seen = $("#b-seen").checked;
    // searching: the best matches first, those already in the list shown (greyed) so you know why they cannot be ticked
    const es = (k ? M.search($("#bq").value, 60) : all.filter((e) => !inList(e.id))).filter((e) => !seen || M.bySp.has(e.id));
    $("#brows").innerHTML = es.map((e) => { const has = inList(e.id); return `<li${has ? ' class="off"' : ""}><label class="chk"><input type="checkbox" data-b="${esc(e.id)}" ${sel.has(e.id) ? "checked" : ""}${has ? " disabled" : ""}><span><b>${esc(e.n)}</b>${e.sc ? ` <i class="cap">${esc(e.sc)}</i>` : ""}<small class="cap">${has ? `déjà dans ${esc(l.nom)}` : esc(where(e.id) || "jamais cochée")}</small></span></label></li>`; }).join("") || '<li class="cap">Aucune espèce trouvée.</li>';
  };
  // date and place for the whole selection; a list with a fixed spot (garden, office) starts on it
  const pt = { lat: null, lon: null, p: null }, spot = l.lieux && l.lieux.length ? l.lieux[l.lieux.length - 1] : null;
  let autoName = "";
  const setPt = (lat, lon) => { pt.lat = lat; pt.lon = lon; $("#b-pt").textContent = lat == null ? "Pas de point." : `Point : ${lat}, ${lon}`; };
  const mp = mapPicker($("#b-map"), spot ? { lat: spot.lat, lon: spot.lon } : {}, async (lat, lon) => {
    if (lat == null) return; setPt(lat, lon);
    const li = $("#b-l"); if (li.value && li.value !== autoName) return; // a name you typed stays
    const r = await nameAt(lat, lon), name = r && r.l; pt.p = r ? r.p : null;
    if (name && (!li.value || li.value === autoName)) { li.value = autoName = name; }
  });
  if (spot) { setPt(spot.lat, spot.lon); $("#b-l").value = autoName = spot.nom || ""; }
  $("#bq").addEventListener("input", draw); $("#b-seen").addEventListener("change", draw);
  // a folder (or a choice) of photos
  const fold = async (ev) => {
    const files = [...ev.target.files]; ev.target.value = ""; if (!files.length) return;
    const el = $("#b-fold"); el.innerHTML = '<p class="msg" id="b-fmsg"></p>';
    try { const res = await readFolder(files, l, (t) => { const m = $("#b-fmsg"); if (m) m.textContent = t; }); showFolder(el, l, res, () => go("#/liste/" + cle)); el.scrollIntoView({ block: "start" }); }
    catch (e) { el.innerHTML = `<p class="msg bad">${esc(e.message)}</p>`; }
  };
  $("#b-dir").addEventListener("change", fold); $("#b-files").addEventListener("change", fold);
  $("#brows").addEventListener("change", (ev) => { const i = ev.target.closest("[data-b]"); if (!i) return; if (i.checked) sel.add(i.dataset.b); else sel.delete(i.dataset.b); count(); });
  $("#b-go").addEventListener("click", () => {
    if (!sel.size) return; let n = l.numerotee ? M.nextNum(cle) : 0;
    const d = $("#b-d").value || null, nom = $("#b-l").value.trim() || null;
    if (d && l.type === "annee" && d.slice(0, 4) !== String(l.annee)) { toast(`La date doit être en ${l.annee} pour ${l.nom}.`, "error"); return; }
    const place = { ...(d ? { d } : {}), ...(nom ? { l: nom } : {}), ...(pt.lat != null ? { lat: pt.lat, lon: pt.lon } : {}), ...(pt.p ? { p: pt.p } : {}), ...(spot && pt.lat === spot.lat && pt.lon === spot.lon ? { sl: "fixe" } : {}) };
    const ops = [...sel].map((e) => ({ kind: "add-tick", cle, tick: { id: `${cle}-${uid()}`, e, ...place, ...(l.numerotee ? { n: n++ } : {}) } }));
    S.apply(ops, `${l.nom} : ${ops.length} ${plural(ops.length, "coche")} ajoutée${ops.length > 1 ? "s" : ""} (${[...sel].map((id) => M.name(id)).join(", ")})`);
    toast(`${ops.length} ${plural(ops.length, "coche")} ajoutée${ops.length > 1 ? "s" : ""} à ${l.nom}. « Annuler » dans À faire pour revenir en arrière.`);
    go("#/liste/" + cle);
  });
  draw(); count();
}

// ---------- places: one name at one point, shared by many ticks ----------
const ptKey = (t) => (t.lat != null ? `${(+t.lat).toFixed(5)},${(+t.lon).toFixed(5)}` : "");
const placeHref = (t) => `#/lieu?n=${encodeURIComponent(t.l || "")}&p=${encodeURIComponent(ptKey(t))}`;
function placeGroups() {
  const g = new Map();
  for (const t of M.ticks) { if (!t.l && t.lat == null) continue; const k = (t.l || "") + "|" + ptKey(t); if (!g.has(k)) g.set(k, { l: t.l || "", p: ptKey(t), lat: t.lat, lon: t.lon, ts: [] }); g.get(k).ts.push(t); }
  return [...g.values()];
}
// the zone of a place, as your lists cut the world: the zone lists right under Photo France (AURA, Ouessant, Corse…),
// then the rest of France, then the country lists (Guyane, Espagne…), then the other countries
function placeZone(x) {
  const fr = x.ts.filter((t) => isFrance(t.p)).length >= x.ts.length / 2;
  if (!fr) { const c = (x.ts.find((t) => !isFrance(t.p)) || {}).p || "Étranger"; const pl = countryLists(M.listes, c, x.ts.find((t) => t.lat != null)).sort((a, b) => !!b.bbox - !!a.bbox)[0]; return pl ? pl.cle : "pays:" + c; }
  const tops = M.listes.filter((l) => l.dans === PHOTO_FR && (l.deps || l.communes || l.lieux));
  const dep = deptFromPlace(x.l), commune = communeFromPlace(x.l);
  for (const z of tops) {
    const inside = new Set([z.cle, ...M.descendants(z.cle)]);
    if (x.ts.some((t) => inside.has(t.cle))) return z.cle;
    if ((dep || commune) && listCovers(z, { dep, commune })) return z.cle;
    if (z.cle === "ouessant" && x.lat != null && onOuessant(x.lat, x.lon)) return z.cle;
  }
  return "france";
}
function screenPlaces() {
  const all = placeGroups(), by = UI.lby === "nb" ? "nb" : "zone";
  const total = (xs) => xs.reduce((s, x) => s + x.ts.length, 0);
  const zoneName = (z) => z === "france" ? "France, ailleurs" : z.startsWith("pays:") ? z.slice(5) : L(z).nom;
  const zoneOrder = (z) => { const i = M.listes.findIndex((l) => l.cle === z); return z === "france" ? 500 : z.startsWith("pays:") ? 2000 : (M.liste.get(z) || {}).type === "pays" ? 1000 + i : i; };
  view.innerHTML = `<div class="screen keep-scroll"><header class="phead"><a class="back" href="#/plus">← Plus</a><h1>Lieux</h1><p class="cap">${new Set(all.map((x) => x.l)).size} noms de lieux, ${all.length} points. Un nom avec plusieurs points est signalé : ce sont peut-être des endroits différents, ou un point mal placé.</p></header>
    <input class="field" type="search" id="lq" placeholder="Chercher un lieu" value="${esc(UI.lq || "")}">
    <div class="seg" role="group" aria-label="Classer"><button type="button" data-lby="zone" aria-pressed="${by === "zone"}">Par zone</button><button type="button" data-lby="nb" aria-pressed="${by === "nb"}">Par nombre de coches</button></div>
    <div id="lrows"></div></div>`;
  const nameRows = (xs) => { const byName = new Map(); xs.forEach((x) => { if (!byName.has(x.l)) byName.set(x.l, []); byName.get(x.l).push(x); });
    return [...byName].sort((a, b) => total(b[1]) - total(a[1])).map(([n, ys]) => `<li><b>${n ? esc(n) : "<em>sans nom</em>"}</b>${ys.length > 1 ? ` <span class="miss">${ys.length} points</span>` : ""}${ys.map((x) => `<small><a href="#/lieu?n=${encodeURIComponent(x.l)}&p=${encodeURIComponent(x.p)}">${x.p ? esc(x.p.replace(",", ", ")) : "sans coordonnées"}</a> · ${x.ts.length} ${plural(x.ts.length, "coche")}</small>`).join("")}</li>`).join(""); };
  const draw = () => {
    const k = norm($("#lq").value); saveUI({ lq: $("#lq").value });
    const xs = all.filter((x) => !k || norm(x.l).includes(k));
    if (by === "nb") { $("#lrows").innerHTML = `<ul class="ticks bulk">${nameRows(xs) || '<li class="cap">Aucun lieu.</li>'}</ul>`; return; }
    const g = new Map(); xs.forEach((x) => { const z = x.zone || (x.zone = placeZone(x)); if (!g.has(z)) g.set(z, []); g.get(z).push(x); });
    const count = (ys) => { const n = new Set(ys.map((x) => x.l)).size, c = total(ys); return `${n} ${plural(n, "lieu", "lieux")} · ${c} ${plural(c, "coche")}`; };
    const block = (z, ys, label, cls = "") => `<details class="sres zone${cls}" ${k || UI.lopen === z || (UI.lopen || "").startsWith(z + "/") ? "open" : ""} data-z="${esc(z)}"><summary>${label} ${count(ys)}</summary><ul class="ticks bulk">${nameRows(ys)}</ul></details>`;
    const sorted = [...g].sort((a, b) => zoneOrder(a[0]) - zoneOrder(b[0]) || byFr(zoneName(a[0]), zoneName(b[0])));
    // France holds its zones (AURA, Ouessant, Corse…) and the places elsewhere in France; then the countries
    const frz = sorted.filter(([z]) => z === "france" || (M.liste.get(z) && M.liste.get(z).dans === PHOTO_FR)), abroad = sorted.filter((e) => !frz.includes(e));
    const frAll = frz.flatMap(([, ys]) => ys);
    const fr = frAll.length ? `<details class="sres zone" ${k || (UI.lopen || "").startsWith("fr") ? "open" : ""} data-z="fr"><summary><span class="chip-s" ${cstyle(PHOTO_FR)}>France</span> ${count(frAll)}</summary>${frz.map(([z, ys]) => block("fr/" + z, ys, z === "france" ? '<span class="chip-s">Ailleurs en France</span>' : `<span class="chip-s" ${cstyle(z)}>${esc(zoneName(z))}</span>`, " sub")).join("")}</details>` : "";
    $("#lrows").innerHTML = fr + abroad.map(([z, ys]) => block(z, ys, `<span class="chip-s" ${z.startsWith("pays:") ? "" : cstyle(z)}>${esc(zoneName(z))}</span>`)).join("") || '<p class="cap">Aucun lieu.</p>';
    $$("details.zone", view).forEach((d) => d.addEventListener("toggle", (ev) => { ev.stopPropagation(); if (d.open) saveUI({ lopen: d.dataset.z }); }));
  };
  $("#lq").addEventListener("input", draw);
  $$("[data-lby]").forEach((b) => b.addEventListener("click", () => { saveUI({ lby: b.dataset.lby }); screenPlaces(); }));
  draw();
}
function screenPlace(q) {
  const P = new URLSearchParams(q || ""), n = P.get("n") || "", pk = P.get("p") || "";
  const all = placeGroups(), g = all.find((x) => x.l === n && x.p === pk);
  if (!g) { view.innerHTML = `<div class="screen"><a class="back" href="#/lieux">← Lieux</a><p class="empty">Plus aucune coche à ce lieu.</p></div>`; return; }
  const same = all.filter((x) => x !== g && x.l && x.l === n);
  const lists = [...new Set(g.ts.map((t) => t.cle))];
  view.innerHTML = `<div class="screen"><header class="phead"><a class="back" href="javascript:history.back()">← Retour</a><h1>${n ? esc(n) : "Lieu sans nom"}</h1>
    <p class="cap">${g.ts.length} ${plural(g.ts.length, "coche")} à ce point (${lists.map((c) => esc(L(c).nom)).join(", ")})${g.p ? " · " + esc(g.p.replace(",", ", ")) : " · sans coordonnées"}</p></header>
    ${same.length ? `<p class="tkwarn">« ${esc(n)} » est aussi à ${same.length > 1 ? "d'autres points" : "un autre point"} : ${same.map((x) => `<a href="#/lieu?n=${encodeURIComponent(x.l)}&p=${encodeURIComponent(x.p)}">${x.p ? esc(x.p.replace(",", ", ")) : "sans coordonnées"} (${x.ts.length} ${plural(x.ts.length, "coche")})</a>`).join(", ")}.</p>` : ""}
    <section class="panel"><h3 class="minor">Renommer ou repositionner</h3>
      <label>Nom<input class="field" id="pl-n" value="${esc(n)}"></label>
      <div class="minimap tall" id="pl-map"></div><p class="cap" id="pl-pt">Touche la carte ou déplace l'épingle pour mettre le bon point (◎ : ta position).</p>
      ${same.length ? `<label class="chk"><input type="checkbox" id="pl-all"> Appliquer aussi aux ${same.reduce((s, x) => s + x.ts.length, 0)} coches de « ${esc(n)} » aux autres points (un seul lieu)</label>` : ""}
      <div class="row"><button class="btn btn-primary" id="pl-go" type="button" disabled>Enregistrer pour les ${g.ts.length} ${plural(g.ts.length, "coche")}</button></div></section>
    <h3 class="minor">Les coches</h3><ul class="ticks">${g.ts.slice().sort((a, b) => cmp(b.d || "", a.d || "")).map((t) => row(t, { showList: true, toTick: true })).join("")}</ul></div>`;
  const pt = { lat: g.lat ?? null, lon: g.lon ?? null };
  mapPicker($("#pl-map"), g.lat != null ? { lat: g.lat, lon: g.lon } : {}, (lat, lon) => { if (lat == null) return; pt.lat = lat; pt.lon = lon; $("#pl-pt").textContent = `Nouveau point : ${lat}, ${lon}`; check(); });
  const all_ = $("#pl-all");
  const targets = () => [...g.ts, ...(all_ && all_.checked ? same.flatMap((x) => x.ts) : [])];
  const check = () => { const nn = $("#pl-n").value.trim(), moved = pt.lat != null && (pt.lat !== g.lat || pt.lon !== g.lon); const k = targets().length; $("#pl-go").disabled = !(moved || nn !== n || (all_ && all_.checked)); $("#pl-go").textContent = `Enregistrer pour les ${k} ${plural(k, "coche")}`; };
  $("#pl-n").addEventListener("input", check); if (all_) all_.addEventListener("change", check);
  $("#pl-go").addEventListener("click", () => {
    const nn = $("#pl-n").value.trim() || null, ts = targets();
    const patch = { l: nn, ...(pt.lat != null ? { lat: pt.lat, lon: pt.lon } : {}) };
    S.apply(ts.map((t) => ({ kind: "set-tick", cle: t.cle, id: t.id, patch })), `Lieu ${n ? "« " + n + " »" : ""} ${nn !== n ? `renommé « ${nn} » et ` : ""}repositionné : ${ts.length} ${plural(ts.length, "coche")}`);
    // the place list of the form follows
    if (nn && pt.lat != null) S.apply({ kind: "add-lieu", lieu: { nom: nn, lat: pt.lat, lon: pt.lon } }, `Lieu enregistré : ${nn}`);
    toast(`${ts.length} ${plural(ts.length, "coche")} ${ts.length > 1 ? "mises" : "mise"} à jour. « Annuler » dans À faire pour revenir en arrière.`);
    location.replace(`#/lieu?n=${encodeURIComponent(nn || "")}&p=${encodeURIComponent(pt.lat != null ? `${(+pt.lat).toFixed(5)},${(+pt.lon).toFixed(5)}` : pk)}`);
  });
}

// ---------- one tick ----------
// what was seen that day in that list; the species page is one tap away, and so are the same sighting in the other lists
function screenTick(cle, id) {
  const t = M.tickOf(cle, id), l = M.liste.get(cle);
  if (!t || !l) { view.innerHTML = '<p class="empty">Cette coche n\'existe plus.</p>'; return; }
  const e = M.esp.get(t.e) || { n: t.e }, rk = M.rankOf(t);
  // the photo of the observation, whatever the list: the same sighting shares its photo in all its lists
  const photos = M.photosFor(t);
  const twins = t.d ? M.ticks.filter((x) => x !== t && M.sameObs(t, x)) : [];
  const renumAll = l.numerotee && t.d ? M.renumber(cle) : [], renumMv = renumAll.find((m) => m.t.id === t.id);
  // the species in the other lists, made by another sighting (a year list only of the same year; not « vu »)
  const others = t.d ? M.ticks.filter((x) => x.e === t.e && x.cle !== cle && x.cle !== VU && !twins.includes(x) && !(x.d === t.d && M.sameObs(t, x)) && M.sameYearOk(x, t.d)) : [];
  view.innerHTML = `<div class="screen">
    <header class="phead"><a class="back" href="javascript:history.back()">← Retour</a>
      <p class="cap">${chip(cle)}${rk ? ` <b>n°${rk}</b>` : ""}</p>
      <h1><a class="sp-link" href="#/espece/${esc(t.e)}?l=${esc(cle)}">${esc(e.n)}</a>${qTag(t.q)}${qTag(M.bestQ(t.e), "best")}</h1>
      <p class="cap">${e.sc ? `<i>${esc(e.sc)}</i>` : ""}</p></header>
    <a class="btn btn-primary" href="#/espece/${esc(t.e)}?l=${esc(cle)}">Page de l'espèce : toutes les listes et toutes les photos →</a>
    ${photos.length ? `<section class="sp-photos">${phSlider(photos, e.n, { del: t.e })}</section>` : ""}
    <div class="qrow"><span class="cap">Étiquette de la photo de cette coche${twins.length ? " (vaut aussi pour la même observation dans ses autres listes)" : ""}</span><div class="qpick" role="group" aria-label="Étiquette de la photo">${QUALITES.map((x) => `<button type="button" class="qtag${t.q === x.v ? " on" : ""}" style="--c:${x.c}" data-tq="${esc(x.v)}" aria-pressed="${t.q === x.v}">${x.court}</button>`).join("")}</div>${M.bestQ(t.e) ? `<span class="cap">Photo best of de l'espèce : ${qTag(M.bestQ(t.e), "best")}</span>` : ""}</div>
    <ul class="plain tkinfo"><li><b>Date</b> ${t.d ? esc(fmtDay(t.d)) : "<em>sans date</em>"}${t.sd ? ` <small>(${esc(srcName(t.sd))})</small>` : ""}</li>
      <li><b>Lieu</b> ${t.l ? esc(t.l) : "<em>sans nom</em>"}${t.lat != null ? ` · <a href="https://www.openstreetmap.org/?mlat=${t.lat}&mlon=${t.lon}#map=15/${t.lat}/${t.lon}" target="_blank" rel="noopener">${t.lat}, ${t.lon}</a>` : " · <em>sans coordonnées</em>"}${t.sl ? ` <small>(${esc(srcName(t.sl))})</small>` : ""}${t.l || t.lat != null ? ` <a class="linkish" href="${placeHref(t)}">repositionner ce lieu</a>` : ""}</li>
      ${!isFrance(t.p) ? `<li><b>Pays</b> ${esc(t.p)}</li>` : ""}${t.t ? `<li><b>Détail</b> ${esc(t.t)}</li>` : ""}
      ${twins.length ? `<li><b>Même observation</b> ${twins.map((x) => `<a class="chip-s" ${cstyle(x.cle)} href="#/coche/${x.cle}/${x.id}">${esc(L(x.cle).nom)}${M.rankOf(x) ? " n°" + M.rankOf(x) : ""}</a>`).join(" ")}</li>` : ""}</ul>
    ${t.lat != null ? '<div class="minimap" id="tkm"></div>' : ""}
    ${t.nph ? `<p class="cap">Marquée « pas de photo de cette coche ». <button type="button" class="linkish" id="tk-unnph">Annuler</button></p>` : ""}
    ${renumMv ? `<p class="tkwarn">Le n°${t.n} n'est plus dans l'ordre des dates : par date, cette coche serait n°${renumMv.to}. <button type="button" class="btn" id="tk-renum">Renuméroter ${esc(l.nom)} par date</button><small class="cap">${renumAll.length} ${plural(renumAll.length, "coche")} ${renumAll.length > 1 ? "changent" : "change"} de numéro.</small></p>` : ""}
    <div class="row"><a class="btn" href="#/coche/${cle}/${id}/modifier">Modifier la coche</a></div>
    ${others.length ? `<section class="panel"><h3 class="minor">L'espèce dans tes autres listes</h3><p class="cap">Une autre observation y fait la coche. « Remplacer » y met celle-ci à la place (date, lieu, photo), en gardant la coche de la liste.</p><ul class="todo">${others.map((x) => `<li><span>${chip(x.cle)}<small>${tickLine(x) || "sans date ni lieu"}</small></span><span class="row"><button type="button" class="btn" data-repl="${x.cle}/${x.id}">Remplacer par celle-ci</button></span></li>`).join("")}</ul></section>` : ""}
    <div id="tk-ph"></div>
  </div>`;
  if (t.lat != null) mapView($("#tkm"), [{ lat: t.lat, lon: t.lon, color: M.color(cle), r: 9, z: 1, html: `<b>${esc(e.n)}</b><br>${esc(t.l || "")}` }]);
  photoBox($("#tk-ph"), { kind: "tick", cle, tick: t }, phSlider);
  wirePhotos(view);
  $$("[data-tq]").forEach((b) => b.addEventListener("click", () => { const v = t.q === b.dataset.tq ? null : b.dataset.tq; S.apply([t, ...twins].filter((x) => (x.q || null) !== v).map((x) => ({ kind: "set-tick", cle: x.cle, id: x.id, patch: { q: v } })), `Étiquette photo : ${e.n} (${[t, ...twins].map((x) => L(x.cle).nom).join(", ")}) → ${v || "aucune"}`); toast(v ? `Étiquette : ${qualite(v).court}.` : "Étiquette retirée."); const y = scrollY; screenTick(cle, id); scrollTo(0, y); }));
  const rn = $("#tk-renum"); if (rn) rn.addEventListener("click", () => { const mv = M.renumber(cle); S.apply(mv.map((m) => ({ kind: "set-tick", cle, id: m.t.id, patch: { n: m.to } })), `${l.nom} : ${mv.length} coches renumérotées par date`); toast("Numéros remis dans l'ordre des dates."); const y = scrollY; screenTick(cle, id); scrollTo(0, y); });
  // put this sighting in place of another list's tick (its number stays; the numbers follow the dates again)
  $$("[data-repl]").forEach((b) => b.addEventListener("click", async () => {
    if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Confirmer le remplacement"; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "Remplacer par celle-ci"; } }, 4000); return; }
    const [oc, oid] = b.dataset.repl.split("/"), o = M.tickOf(oc, oid), ol = L(oc); if (!o) return;
    if (t.lat != null) { b.disabled = true; b.textContent = "Vérification du lieu…"; const out = outsideOf(ol, await whereIs(t.lat, t.lon), t, t.d); if (out) { toast(`Pas dans ${ol.nom} : ${out}.`, "error"); b.disabled = false; delete b.dataset.armed; b.textContent = "Remplacer par celle-ci"; return; } }
    const patch = {}; ["d", "h", "sh", "sd", "l", "lat", "lon", "sl", "p", "ph", "q", "t"].forEach((k) => { patch[k] = t[k] ?? null; }); patch.nph = null; patch.vf = null;
    S.apply({ kind: "set-tick", cle: oc, id: oid, patch }, `${ol.nom} : ${e.n} remplacée par l'observation du ${fmtShort(t.d)}${t.l ? " (" + t.l + ")" : ""} (avant : ${o.d ? fmtShort(o.d) : "sans date"})`);
    toast(`${ol.nom} : coche remplacée par celle-ci.`); const y = scrollY; screenTick(cle, id); scrollTo(0, y);
  }));
  const un = $("#tk-unnph"); if (un) un.addEventListener("click", () => { S.apply([t, ...twins].filter((x) => x.nph).map((x) => ({ kind: "set-tick", cle: x.cle, id: x.id, patch: { nph: null } })), `Photo à chercher : ${e.n}`); un.parentElement.remove(); toast("Remise dans « Coches sans photo »."); });
  // previous / next tick of the list it was opened from (arrows, swipe, keyboard)
  const nav = UI.nav && UI.nav.refs ? UI.nav : null, at = nav ? nav.refs.indexOf(cle + "/" + id) : -1;
  if (at < 0) return;
  const prev = at > 0 ? nav.refs[at - 1] : null, next = at < nav.refs.length - 1 ? nav.refs[at + 1] : null;
  const nm = (ref) => { const [c, i] = ref.split("/"); const x = M.tickOf(c, i); return x ? M.name(x.e) : ""; };
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
    ts.sort((a, b) => (M.rankOf(a) || 1e9) - (M.rankOf(b) || 1e9) || cmp(a.d || "", b.d || ""));
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
    const l = M.yearList(yy, scope), dated = l.filter((t) => t.d).sort((a, b) => cmp(a.d, b.d));
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
  const bestDay = [...byDay].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0];
  const elapsed = past ? daysIn(year) : doy(todayIso()) + 1;
  const last = dated.slice().sort((a, b) => cmp(b.d, a.d) || (b.rank - a.rank))[0];
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
    <p class="cap" id="jc"></p><ul class="ticks" id="jr"></ul><button class="btn" id="more" hidden>Afficher plus</button></div>`;
  let shown = 200;
  const draw = () => {
    const k = norm(F.q);
    const res = M.ticks.filter((t) => (!F.cle || t.cle === F.cle) && (!F.year || (F.year === "none" ? !t.d : yearOf(t.d) === +F.year)) && (!F.miss || (F.miss === "coords" ? t.lat == null : F.miss === "date" ? !t.d : !t.l))
      && (!k || norm(`${t.l || ""} ${t.p || ""} ${t.t || ""}`).includes(k) || M.matchesSp(k, t.e)))
      .sort((a, b) => cmp(b.d || "", a.d || "") || (b.n || 0) - (a.n || 0));
    $("#jc").textContent = `${res.length} ${plural(res.length, "coche")}`;
    $("#jr").innerHTML = res.slice(0, shown).map((t) => `<li class="tick link" data-edit="${t.cle}/${t.id}"><span class="n" ${cstyle(t.cle)}>${M.rankOf(t)}</span><span class="what"><b>${esc(M.name(t.e))}</b>${qTag((M.esp.get(t.e) || {}).q)} ${chip(t.cle)}${!isFrance(t.p) ? ` <span class="abroad">${esc(t.p)}</span>` : ""}<small>${esc(t.l || "")}${t.lat == null ? ' <span class="miss">sans coordonnées</span>' : ""}${t.t ? " · " + esc(t.t) : ""}</small></span><span class="when">${t.d ? esc(fmtShort(t.d)) : "<em>sans date</em>"}</span></li>`).join("");
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

// the label of one photo of a species: the best-of photo's is the species' (best of); a photo that is the photo of
// a tick is that observation's (lifer first); a photo tied to no tick has none
const photoTag = (sid) => {
  const best = M.bestPhoto(sid), ticks = [...(M.bySp.get(sid) || new Map()).values()].flat().sort((a, b) => (a.cle === LIFERS ? -1 : 0) - (b.cle === LIFERS ? -1 : 0));
  return (p) => {
    // one picture can be the best of and the photo of a tick: its label goes to both
    const t = ticks.find((x) => samePic2(M.photosFor(x)[0], p)), b = samePic2(p, best);
    if (!t && !b) return null;
    return { cur: b ? M.bestQ(sid) : t.q || null, host: [b ? "best|" + sid : "", t ? "obs|" + t.cle + "/" + t.id : ""].filter(Boolean).join(";") };
  };
};
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
  const blocks = M.listes.filter((l) => m.has(l.cle)).map((l) => `<li><b>${esc(l.nom)}</b> ${m.get(l.cle).map((t) => `<span class="tk">${t.n ? `n°${t.n} · ` : ""}${t.d ? esc(fmtDay(t.d)) : "sans date"}${t.l ? ` · ${t.lat != null ? `<a href="https://www.openstreetmap.org/?mlat=${t.lat}&mlon=${t.lon}#map=15/${t.lat}/${t.lon}" target="_blank" rel="noopener">${esc(t.l)}</a>` : esc(t.l)}` : ""}${!isFrance(t.p) ? ` · ${esc(t.p)}` : ""}${t.t ? ` · ${esc(t.t)}` : ""}${M.photosFor(t).length ? ' · <span title="Photo de la coche">📷</span>' : ""} <a class="linkish" href="#/coche/${l.cle}/${t.id}">voir la coche</a></span>`).join("")}</li>`).join("");
  // one point per place: Photo France in green, the lifer in red, everything else in blue
  const byPlace = new Map();
  [...m.values()].flat().filter((t) => t.lat != null).forEach((t) => { const k = t.lat.toFixed(5) + "," + t.lon.toFixed(5); if (!byPlace.has(k)) byPlace.set(k, []); byPlace.get(k).push(t); });
  const pts = [...byPlace.values()].map((ts) => {
    const lif = ts.some((t) => t.cle === LIFERS), pf = ts.some((t) => t.cle === PHOTO_FR);
    const style = lif && pf ? { color: "#D7263D", stroke: "#2E9B4F", r: 10, z: 3 } : lif ? { color: "#D7263D", r: 9, z: 2 } : pf ? { color: "#2E9B4F", r: 9, z: 2 } : { color: "#0A7895", r: 6, z: 0 };
    // the photo taken at that point (photo of the tick, or first photo of that day on the photo lists)
    const seen = new Set(), photos = [];
    ts.forEach((t) => M.photosFor(t, { first: withPhotos(L(t.cle)) }).forEach((p) => { const k = M.picKey(p) || p.img || p.url; if (!seen.has(k)) { seen.add(k); photos.push({ ...p, label: t.ph ? `Photo de la coche · ${L(t.cle).nom}` : "Photo de ce jour-là" }); } }));
    return { lat: ts[0].lat, lon: ts[0].lon, ...style, html: `<div class="pop">${phSlider(photos, e.n)}<div class="pop-ticks">${ts.map((t) => `<a class="chip-s" ${cstyle(t.cle)} href="#/coche/${t.cle}/${t.id}">${esc(L(t.cle).nom)}${M.rankOf(t) ? " n°" + M.rankOf(t) : ""}</a>`).join(" ")}</div><small>${[...new Set(ts.map((t) => t.d ? fmtShort(t.d) : ""))].filter(Boolean).join(", ")}${ts[0].l ? " · " + esc(ts[0].l) : ""}</small></div>` };
  });
  view.innerHTML = `<div class="screen">
    ${navBar}<header class="phead"><a class="back" href="javascript:history.back()">← Retour</a><h1>${esc(e.n)}</h1><p class="cap">${[e.sc ? `<i>${esc(e.sc)}</i>` : "", e.fa ? esc(e.fa) : ""].filter(Boolean).join(" · ")}${e.lr ? ` · Liste rouge mondiale <span class="lr lr-${esc(String(e.lr).slice(0, 2).toLowerCase())}">${esc(e.lr)}</span>` : ""}</p>${st ? `<p class="cap">Statut en France : ${st}</p>` : ""}<p class="cap">Étiquette best of : ${e.q ? (qualite(e.q) ? qTag(e.q, "best") : esc(e.q)) : M.liferQ(sid) ? `aucune, l'espèce prend celle de la photo lifer ${qTag(M.liferQ(sid))}` : "aucune"}${e.q && !M.bestPhoto(sid) ? ` <small>(du Sheet : pas encore de photo best of dans l'appli)</small>` : ""}</p>${e.compte ? `<p class="tkwarn">⚠ ${esc(e.compte)}</p>` : ""}</header>
    ${(() => { const ph = M.allPhotos(sid); return ph.length ? `<section class="sp-photos">${phSlider(ph, e.n, { del: sid, tag: photoTag(sid) })}</section>` : ""; })()}
    ${blocks ? `<ul class="plain">${blocks}</ul>` : `<p class="empty">Pas encore cochée.</p>`}
    ${pts.length ? `<div><div class="minimap" id="mm"></div><p class="maplegend"><span style="--c:#D7263D"></span>lifer photo <span style="--c:#2E9B4F"></span>photo France <span style="--c:#D7263D;--s:#2E9B4F"></span>les deux au même endroit <span style="--c:#0A7895"></span>autres listes</p></div>` : ""}
    <a class="btn btn-primary" href="#/ajout?e=${encodeURIComponent(sid)}">Ajouter une coche pour cette espèce</a>
    <details class="panel" id="sp-best-d"><summary>${M.bestPhoto(sid) ? "Changer la meilleure photo" : "Ajouter une meilleure photo (best of)"}</summary><div id="sp-best"></div></details>
    <details class="panel"><summary>Noms de l'espèce</summary>
      <form id="names" class="form"><label>Nom<input class="field" id="n-n" value="${esc(e.n)}"></label>
        <label>Nom latin <small>(la référence pour les imports)</small><input class="field" id="n-sc" value="${esc(e.sc || "")}"></label>
        <label>Autres noms <small>(séparés par des virgules : Petit Chevalier, Lesser Yellowlegs…)</small><input class="field" id="n-al" value="${esc((e.al || []).join(", "))}"></label>
        <label>Autres noms latins <small>(anciens ou d'autres nomenclatures)</small><input class="field" id="n-scs" value="${esc((e.scs || []).join(", "))}"></label>
        <label>Règle de coche <small>(ex. : sauvage seulement dans les Pyrénées et en Corse ; les photos ailleurs ne comptent pas)</small><input class="field" id="n-cp" value="${esc(e.compte || "")}"></label>
        <div class="row"><button class="btn btn-primary" type="submit">Enregistrer les noms</button></div></form></details>
  </div>`;
  if (pts.length) { const mm = mapView($("#mm"), pts); if (mm) mm.on("popupopen", (ev) => { const el = ev.popup.getElement(); wirePhotos(el); $$("img[data-ph]", el).forEach((im) => im.addEventListener("load", () => ev.popup.update(), { once: true })); }); }
  photoBox($("#sp-best"), { kind: "best", sid }, phSlider);
  wirePhotos(view); wireQuickTags(view.firstElementChild);
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
  $("#names").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const list = (v) => v.split(/\s*[,;]\s*/).map((x) => x.trim()).filter(Boolean);
    const patch = { n: $("#n-n").value.trim() || e.n, sc: $("#n-sc").value.trim() || null, al: list($("#n-al").value), scs: list($("#n-scs").value), compte: $("#n-cp").value.trim() || null };
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
    <a href="#/lieux"><b>Lieux</b><small>Tous tes lieux : renommer ou repositionner un lieu pour toutes ses coches</small></a>
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
  const ts = (days.get(sel) || []).slice().sort((a, b) => cmp(a.d, b.d));
  const [sm, sd] = sel.split("-").map(Number);
  const total = [...days.values()].reduce((s, a) => s + a.length, 0);
  // records: best single day, best year, best month (all years together)
  const pf = (M.db.coches[PHOTO_FR] || []).filter((t) => t.d), byDate = new Map(), byYear = new Map(), byMonth = new Array(12).fill(0);
  pf.forEach((t) => { byDate.set(t.d, (byDate.get(t.d) || 0) + 1); const yy = t.d.slice(0, 4); byYear.set(yy, (byYear.get(yy) || 0) + 1); byMonth[+t.d.slice(5, 7) - 1]++; });
  const bestD = [...byDate].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0], bestY = [...byYear].sort((a, b) => b[1] - a[1])[0], bm = byMonth.indexOf(Math.max(...byMonth));
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
const TRJ_NAMES = new Map(); // names of the places of « tes trajets », found once
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
  } else if (t.kind === "choose-date" && !tk) {
    body = `Dates différentes : la coche n'existe plus<small>${esc(t.src || "cocheurs")} ${t.other ? fmtShort(t.other) : ""}</small>`; // removed tick: nothing to choose any more
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
    undated: all.undated.filter((t) => on(t.cle)), paysMissing: all.paysMissing.filter((x) => on(x.t.cle) || on(x.pays)), zoneFirst: all.zoneFirst.filter((x) => on(x.zone) || on(x.first.cle)) };
  // ticks without GPS point or without place name, one row per observation (species and day)
  const ng = new Map();
  for (const t of M.ticks) {
    if (t.lat != null && t.l) continue;
    const k = t.d ? t.e + "|" + t.d : t.cle + "|" + t.id; if (!ng.has(k)) ng.set(k, []); ng.get(k).push(t);
  }
  c.noPlace = [...ng.values()].filter(anyOn).map((ts) => ({ ts, e: ts[0].e, d: ts[0].d, gps: ts.some((t) => t.lat == null), name: ts.some((t) => !t.l), main: (sel && ts.find((t) => t.cle === sel)) || ts[0] }))
    .sort((a, b) => cmp(b.d || "", a.d || "") || byFr(M.name(a.e), M.name(b.e)));
  // ticks without GPS on a day of your Google Maps history (Vos trajets): the places you stopped at that day,
  // the position at the time of the tick or of its photo, and the places of the other ticks of that day
  const TRJ = (M.db.sources || {}).trajets || {}, tj = TRJ.jours || {};
  const trjG = new Map();
  for (const t of M.ticks) { if (t.lat != null || !t.d || !tj[t.d]) continue; const k = t.e + "|" + t.d; const gs = trjG.get(k) || []; const g = gs.find((x) => M.sameObs(x[0], t)); if (g) g.push(t); else gs.push([t]); trjG.set(k, gs); }
  // « Corriger la position »: a map to put the right point yourself, then validate it
  const fixRow = (kind, i) => `<span class="trj-p"><button class="btn" data-fix="${kind}|${i}">Corriger la position</button><span><small>choisir un meilleur point sur la carte</small></span></span><div class="trj-fix" id="fix-${kind}-${i}" hidden></div>`;
  const phoneGap = (g) => (g ? `point enregistré par ton téléphone ${g} min avant ou après` : "point enregistré par ton téléphone à la même minute");
  const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : `${m} min`);
  c.trajets = [...trjG.values()].flat().filter(anyOn).map((ts) => {
    const d = ts[0].d, cands = [], add = (x) => { if (!cands.some((y) => Math.abs(y.lat - x.lat) < 0.003 && Math.abs(y.lon - x.lon) < 0.003)) cands.push(x); };
    const pt = (TRJ.points || {})[ts[0].e + "|" + d]; if (pt) add({ lat: pt[1], lon: pt[2], why: `ton téléphone à ${pt[0]}, heure de ${pt[3] === "photo" ? "ta photo" : "la coche"} · ${phoneGap(pt[4])}` });
    M.ticks.filter((x) => x.d === d && x.lat != null && x.e !== ts[0].e).forEach((x) => add({ lat: x.lat, lon: x.lon, l: x.l, why: `comme ${M.name(x.e)} (${L(x.cle).nom})` }));
    // no time for this tick (nor its photo): the places where your phone stayed that day (5 min or more, home left out)
    if (!pt) tj[d].forEach(([a, b, lat, lon, typ, m]) => add({ lat, lon, why: `ton téléphone est resté là ${a}–${b}${m ? " · " + fmtMin(m) : ""}${typ ? " · " + typ : ""}` }));
    return { ts, main: (sel && ts.find((t) => t.cle === sel)) || ts[0], cands: cands.slice(0, 6), home: pt ? null : tj[d].reduce((n, x) => n + (x[5] || 0), 0) };
  }).sort((a, b) => cmp(b.ts[0].d, a.ts[0].d));
  // ticks whose GPS your phone never came near (3 km) that whole day (Vos trajets: pt[5] = 0, pt[6] = the closest it
  // came), with where it was at the time of the tick or of its photo: one row per observation; « Garder » sets vg
  const trjFar = new Map(), kmBetween = (a, b) => distKm(a, b), RECALC = new Set(TRJ.recalc || []);
  for (const t of M.ticks) {
    if (t.lat == null || !t.d || t.vg || ["appli", "fixe", "obn"].includes(t.sl)) continue;
    const pt = (TRJ.points || {})[t.e + "|" + t.d]; if (!pt || pt[4] > 10) continue;
    const km = kmBetween(t, { lat: pt[1], lon: pt[2] }), old = t.sl === "trajets" && RECALC.has(t.e + "|" + t.d);
    // placed from your trajets by an earlier (less exact) calculation: offered again when your phone says otherwise;
    // otherwise only when your phone never passed within 3 km of the tick's GPS that day (pt[5])
    if (old ? km <= 0.3 : pt[5] || km <= 1) continue;
    const k = t.e + "|" + t.d; const gs = trjFar.get(k) || []; const g = gs.find((x) => M.sameObs(x.ts[0], t)); if (g) g.ts.push(t); else gs.push({ ts: [t], pt, km, old }); trjFar.set(k, gs);
  }
  c.trjFar = [...trjFar.values()].flat().filter((x) => anyOn(x.ts)).map((x) => ({ ...x, main: (sel && x.ts.find((t) => t.cle === sel)) || x.ts[0] })).sort((a, b) => b.km - a.km);
  // photo ticks with no photo in the app, one row per observation (the photo is shared by its lists)
  const nphG = new Map();
  for (const t of M.ticks) {
    if (!t.d || t.cle === VU || /^(vu|entendu)/i.test(t.t || "")) continue;
    const k = t.e + "|" + t.d; if (!nphG.has(k)) nphG.set(k, []);
    const gs = nphG.get(k), g = gs.find((x) => M.sameObs(x[0], t)); if (g) g.push(t); else gs.push([t]);
  }
  // a photo is needed only in the photo lists (Lifers, Photo France, countries): the local lists (region, department,
  // island, garden…) and the year lists count a sighting once the species is photographed in France. By default an
  // observation shows only if one of its lists needs the photo; « toutes les listes » shows the others too
  const isYL = (cle) => (L(cle).type === "annee") || /^yl\d{4}$/.test(cle), needsPh = (cle) => ["photo", "pays"].includes(L(cle).type);
  const withYL = UI.nphYL === true || (sel && !needsPh(sel));
  // a list whose photos are still being processed (Guyane): its observations are not asked for a photo yet
  const waiting = (ts) => ts.some((t) => L(t.cle).photosAttente);
  c.noPhoto = [...nphG.values()].flat().filter((ts) => !waiting(ts) && !ts.some((t) => t.ph || t.nph) && !M.firstPhotos(ts[0].e).some((p) => p.d === ts[0].d)).filter(anyOn)
    .filter((ts) => withYL || ts.some((t) => needsPh(t.cle)))
    .map((ts) => ({ ts, main: (sel && ts.find((t) => t.cle === sel)) || ts.find((t) => t.cle === LIFERS) || ts[0], folder: M.photoOn(ts[0].e, ts[0].d) }))
    .sort((a, b) => cmp(b.ts[0].d || "", a.ts[0].d || "") || byFr(M.name(a.ts[0].e), M.name(b.ts[0].e)));
  // photos without a label (étiquette): the photo of an observation (its own, or the Liste folder's of that day),
  // one row per observation; and best-of photos
  const samePic = (a, b) => !!(a && b && ((a.img || a.url) === (b.img || b.url) || (M.picKey(a) && M.picKey(a) === M.picKey(b))));
  const isBest = (sid, ph) => samePic(M.bestPhoto(sid), ph) && !!(M.esp.get(sid) || {}).q;
  c.noTag = [...nphG.values()].flat().filter((ts) => !waiting(ts) && !ts.some((t) => t.q)).map((ts) => ({ ts, ph: M.photosFor(ts[0])[0] })).filter((x) => x.ph && anyOn(x.ts) && !isBest(x.ts[0].e, x.ph))
    .map((x) => ({ ...x, shown: withYL ? x.ts : x.ts.filter((t) => !isYL(t.cle)) })).filter((x) => x.shown.length)
    .sort((a, b) => cmp(b.ts[0].d || "", a.ts[0].d || "") || byFr(M.name(a.ts[0].e), M.name(b.ts[0].e)));
  // the photo of an observation that is also the best of: one row, its label goes to both
  c.noTag.forEach((x) => { if (samePic(M.esp.get(x.ts[0].e).best, x.ph)) x.alsoBest = x.ts[0].e; });
  if (!sel) [...M.esp.values()].filter((e) => e.best && !e.q && !c.noTag.some((x) => x.alsoBest === e.id)).forEach((e) => c.noTag.unshift({ best: e.id, ph: e.best }));
  const tasks = M.db.taches.filter((t) => !sel || t.cle === sel);
  const cats = [...new Set(M.db.taches.map((t) => t.cat))];
  const und = new Map(); c.undated.forEach((t) => { if (!und.has(t.cle)) und.set(t.cle, []); und.get(t.cle).push(t); });
  const lastUndo = S.undos[S.undos.length - 1];
  view.innerHTML = `<div class="screen keep-scroll"><div class="tdhead"><h2>À faire</h2>${lastUndo ? `<button type="button" class="btn undo" id="td-undo" title="Annuler : ${esc(lastUndo.label)}">↶ Annuler<small>${esc(lastUndo.label)}</small></button>` : ""}</div>
    <div class="tdbar"><label class="tdlist">Liste<select class="field" id="tdl"><option value="">Toutes les listes</option>${M.listes.map((l) => `<option value="${l.cle}" ${l.cle === sel ? "selected" : ""}>${esc(l.nom)}</option>`).join("")}</select></label>
    <label class="tdlist">Critère<select class="field" id="tdc"></select></label>
    <nav class="tdnav" id="tdnav" aria-label="Catégories"></nav></div>
    ${c.outside.length ? `<section data-n="${c.outside.length}"><h3 class="minor">Coches hors de leur liste</h3><p class="cap">Le lieu de ces coches n'est pas dans le secteur de la liste. Corrige le lieu, ou supprime la coche si elle n'a rien à faire là.</p><ul class="todo">${c.outside.slice(0, 80).map((x) => `<li><span>${nameLink(x.t.e)} ${chip(x.t.cle)}<small>${esc(x.t.l || "")} · ${esc(x.why)}</small></span><a class="btn" href="#/coche/${x.t.cle}/${x.t.id}/modifier">Corriger</a></li>`).join("")}</ul></section>` : ""}
    ${c.zoneFirst.length ? `<section data-n="${c.zoneFirst.length}"><h3 class="minor">Première photo · ${c.zoneFirst.length}</h3><p class="cap">Ton lifer est ta toute première photo de l'espèce, où que ce soit (un voyage, une year list…) ; ta Photo France, la première en France ; une liste de région, de département ou de commune, ta première photo prise dans la zone. Ici, une coche d'une autre liste est plus ancienne, ou la liste n'a pas encore l'espèce. « Prendre » met la date, le lieu, le pays et la photo de cette coche ; « Garder » confirme la date actuelle.</p><ul class="todo">
      ${c.zoneFirst.map((x, i) => `<li><span>${nameLink(x.e)} ${chip(x.zone)}${(x.also || []).map((y) => " " + chip(y.zone)).join("")}<small>${[{ zone: x.zone, zt: x.zt }, ...(x.also || [])].map((y) => (y.zt ? `${esc(L(y.zone).nom)} <b>${esc(fmtShort(y.zt.d))}</b> · ` : `pas dans ${esc(L(y.zone).nom)} · `)).join("")}première photo : ${chip(x.first.cle)} <b>${esc(fmtShort(x.first.d))}</b>${x.first.l ? " · " + esc(x.first.l) : ""}</small></span><span class="row"><button class="btn" data-zftake="${i}">${x.zt ? "Prendre " + esc(fmtShort(x.first.d)) : "Ajouter à " + esc(L(x.zone).nom)}</button>${x.zt ? `<button class="btn" data-zfkeep="${i}">${x.also ? "Garder les dates" : "Garder " + esc(fmtShort(x.zt.d))}</button>` : ""}</span></li>`).join("")}</ul></section>` : ""}
    ${c.photoEarlier.length ? `<section data-n="${c.photoEarlier.length}"><h3 class="minor">Une photo plus ancienne que la coche · ${c.photoEarlier.length}</h3><p class="cap">Tes dossiers photos ont l'espèce avant la date de la coche (Photo France : ta toute première photo ; year list : ta première photo de l'année). La photo fait foi. « Prendre » met la date de la photo (Photo France : avec le lifer du même jour ; year list : elle seule) ; le lieu vient d'une coche de ce jour-là, sinon il est à compléter. « Garder » confirme la date de l'appli.</p><ul class="todo">
      ${c.photoEarlier.map((x, i) => `<li><span>${nameLink(x.e)} ${[...new Set(x.ticks.map((t) => t.cle))].map(chip).join(" ")}<small>appli <b>${esc(fmtShort(x.d))}</b> · photo <b>${esc(fmtShort(x.photo[0]))}</b>${x.photo[2] ? " · " + esc(x.photo[2].split("/").pop()) : ""}</small></span><span class="row"><button class="btn" data-phtake="${i}">Prendre ${esc(fmtShort(x.photo[0]))}</button><button class="btn" data-phkeep="${i}">Garder ${esc(fmtShort(x.d))}</button></span></li>`).join("")}</ul></section>` : ""}
    ${c.srcDate.length ? `<section data-n="${c.srcDate.length}"><h3 class="minor">Pas d'accord avec Faune-France / eBird · ${c.srcDate.length}</h3><p class="cap">Soit ton dernier import n'a pas l'espèce ce jour-là mais l'a à quelques jours près (40 au plus), soit il l'a le même jour mais à plus de 20 km : souvent une erreur de date ou de lieu. « Prendre » reprend la date et le lieu de la source dans toutes les listes de cette observation ; « Garder » confirme ce qu'a l'appli.</p><ul class="todo">
      ${c.srcDate.slice(0, 200).map((x, i) => `<li><span>${nameLink(x.e)} ${[...new Set(x.ticks.map((t) => t.cle))].map(chip).join(" ")}<small>appli <b>${esc(fmtShort(x.d))}</b> (${esc(srcName(x.ticks[0].sd))})${x.ticks[0].l ? " · " + esc(x.ticks[0].l) : ""} · ${x.near.src === "ff" ? "Faune-France" : "eBird"} ${x.lieu ? `le même jour, <b>à ${x.km} km</b>` : `<b>${esc(fmtShort(x.near.d))}</b>`}${x.near.l ? " · " + esc(x.near.l) : ""}</small></span><span class="row"><button class="btn" data-sdtake="${i}">${x.lieu ? "Prendre ce lieu" : "Prendre " + esc(fmtShort(x.near.d))}</button><button class="btn" data-sdkeep="${i}">Garder ${x.lieu ? "le lieu" : esc(fmtShort(x.d))}</button></span></li>`).join("")}${c.srcDate.length > 200 ? `<li><span class="cap">… et ${c.srcDate.length - 200} autres, qui s'afficheront au fur et à mesure.</span></li>` : ""}</ul></section>` : ""}
    ${c.badNum.map((x) => `<section data-n="${x.moves.length}"><h3 class="minor">${esc(L(x.cle).nom)} : numéros pas dans l'ordre des dates</h3><p class="cap">${x.moves.length} ${plural(x.moves.length, "coche")} à renuméroter. Les coches mal placées sont remises à leur date ; les autres, avec ou sans date, gardent leur ordre.</p><div class="row"><button class="btn btn-primary" data-renum="${x.cle}">Renuméroter par date</button></div><ul class="todo">${x.moves.slice(0, 12).map((m) => `<li><span>${nameLink(m.t.e)} · ${esc(fmtShort(m.t.d))}<small>n°${m.t.n} → n°${m.to}</small></span></li>`).join("")}${x.moves.length > 12 ? `<li><span class="cap">… et ${x.moves.length - 12} autres</span></li>` : ""}</ul></section>`).join("")}
    ${c.placeMismatch.length ? `<section data-n="${c.placeMismatch.length}"><h3 class="minor">Même observation, lieux différents</h3><p class="cap">Même espèce, même jour, mais pas le même lieu selon la liste. « Aligner » reprend partout le lieu le plus précis.</p><div class="row"><button class="btn btn-primary" id="align-all">Tout aligner (${c.placeMismatch.length})</button></div><ul class="todo">
      ${c.placeMismatch.slice(0, 60).map((x, i) => `<li><span>${nameLink(x.src.e)} · ${esc(fmtShort(x.src.d))}<small>${chip(x.src.cle)} ${esc(x.src.l || (x.src.lat != null ? x.src.lat + ", " + x.src.lon : ""))} · ailleurs : ${x.others.map((t) => `${chip(t.cle)} ${esc(t.l || (t.lat != null ? "coordonnées différentes" : "sans lieu"))}`).join(" ")}</small></span><button class="btn" data-align="${i}">Aligner</button></li>`).join("")}</ul></section>` : ""}
    ${c.paysMissing.length ? `<section data-n="${c.paysMissing.length}"><h3 class="minor">Pas dans la liste du pays · ${c.paysMissing.length}</h3><p class="cap">Une coche a été faite dans un pays qui a sa liste, mais l'espèce n'est pas dans cette liste. « Ajouter » la met dans la liste du pays avec la date, le lieu et la photo de cette coche.</p><ul class="todo">
      ${c.paysMissing.map((x, i) => `<li><span>${nameLink(x.t.e)} ${chip(x.t.cle)}<small>${esc(x.t.p)} · ${x.t.d ? esc(fmtShort(x.t.d)) : "sans date"}${x.t.l ? " · " + esc(x.t.l) : ""}</small></span><button class="btn" data-addpays="${i}">Ajouter à ${esc(L(x.pays).nom)}</button></li>`).join("")}</ul></section>` : ""}
    ${c.yearMissing.length || c.nested.length || c.yearWrong.length ? `<section data-n="${c.yearMissing.length + c.nested.length + c.yearWrong.length}"><h3 class="minor">Incohérences trouvées dans la base</h3><ul class="todo">
      ${c.yearWrong.map((t) => `<li><span>${nameLink(t.e)} est dans ${esc(L(t.cle).nom)} mais datée du ${esc(fmtShort(t.d))}.</span> <a class="btn" href="#/coche/${t.cle}/${t.id}/modifier">Corriger</a></li>`).join("")}
      ${c.yearMissing.map((x) => `<li><span>${nameLink(x.t.e)} a une coche datée de ${x.year} (${esc(L(x.t.cle).nom)}, ${esc(fmtShort(x.t.d))}) mais n'est pas dans la year list ${x.year}.</span> <button class="btn" data-addyl="${x.t.cle}/${x.t.id}">Ajouter à ${x.year}</button></li>`).join("")}
      ${c.nested.map((x) => `<li><span>${nameLink(x.t.e)} est dans ${esc(L(x.liste).nom)} mais pas dans ${esc(L(x.parent).nom)}.</span> <a class="btn" href="#/espece/${esc(x.t.e)}">Voir</a></li>`).join("")}
    </ul></section>` : ""}
    ${c.trajets.length ? `<section data-n="${c.trajets.length}"><h3 class="minor">Lieu d'après tes trajets · ${c.trajets.length}</h3><p class="cap">Coches sans GPS un jour où ton historique Google Maps (Vos trajets) sait où tu étais. D'abord la position de ton téléphone à l'heure de la coche ou de sa photo, puis les lieux des autres coches de ce jour-là ; si la coche n'a pas d'heure, les endroits où ton téléphone est resté 5 min ou plus ce jour-là (du plus long au plus court, maison exclue). « Prendre » met ce point (et son nom si la coche n'en a pas) dans toutes les listes de l'observation.</p><ul class="todo">
      ${c.trajets.slice(0, 120).map((x, i) => `<li class="trj"><span>${nameLink(x.main.e)} ${[...new Set(x.ts.map((t) => t.cle))].map(chip).join(" ")}<small>${esc(fmtShort(x.main.d))}${x.main.l ? " · " + esc(x.main.l) : ""}</small><span class="trj-c">${x.home != null && x.home < 30 ? `<small class="warn">${x.home ? `Ton téléphone n'est presque pas sorti de chez toi ce jour-là (${x.home} min ailleurs)` : "Ton téléphone n'a pas quitté ta maison ce jour-là"} : la date est peut-être fausse, ou tu n'avais pas ton téléphone.</small>` : ""}${x.cands.map((p, k) => `<span class="trj-p"><button class="btn" data-trj="${i}|${k}">Prendre</button><span><b data-nm="${p.lat},${p.lon}">${esc(p.l || `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`)}</b> <a class="linkish" href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=15/${p.lat}/${p.lon}" target="_blank" rel="noopener">carte</a><small>${x.cands.length > 1 ? `n°${k + 1} · ` : ""}${esc(p.why)}</small></span></span>`).join("")}${fixRow("trj", i)}</span></span></li>`).join("")}</ul></section>` : ""}
    ${c.trjFar.length ? `<section data-n="${c.trjFar.length}"><h3 class="minor">GPS loin de tes trajets · ${c.trjFar.length}</h3><p class="cap">La position de ton téléphone à l'heure de la coche ou de sa photo (ses points enregistrés, pas les arrêts de Google) ne colle pas avec le GPS de la coche : soit ton téléphone n'est jamais passé à moins de 3 km de ce GPS ce jour-là (point approximatif comme une commune, mauvaise date, ou oiseau vu de loin, en mer par exemple), soit la coche avait été placée d'après tes trajets par un ancien calcul moins exact. « Prendre » met la position de ton téléphone à cette heure-là dans toutes les listes de l'observation ; « Garder » confirme le GPS actuel.</p><ul class="todo">
      ${c.trjFar.slice(0, 150).map((x, i) => `<li class="trj"><span>${nameLink(x.main.e)} ${[...new Set(x.ts.map((t) => t.cle))].map(chip).join(" ")}<small>${esc(fmtShort(x.main.d))} · actuel : ${esc(x.main.l || `${x.main.lat}, ${x.main.lon}`)}${x.main.sl ? ` (${esc(srcName(x.main.sl))})` : ""}</small><span class="trj-c"><span class="trj-p"><button class="btn" data-far="${i}">Prendre</button><span><b data-nm="${x.pt[1]},${x.pt[2]}">${x.pt[1].toFixed(4)}, ${x.pt[2].toFixed(4)}</b> <a class="linkish" href="https://www.openstreetmap.org/?mlat=${x.pt[1]}&mlon=${x.pt[2]}#map=15/${x.pt[1]}/${x.pt[2]}" target="_blank" rel="noopener">carte</a><small>ton téléphone à ${esc(x.pt[0])}, heure de ${x.pt[3] === "photo" ? "ta photo" : "la coche"} · ${phoneGap(x.pt[4])} · à ${x.km < 10 ? x.km.toFixed(1) : Math.round(x.km)} km du GPS actuel${x.old ? " (placé par l'ancien calcul)" : ""}${x.pt[6] != null ? ` · au plus près dans la journée : ${x.pt[6] < 10 ? x.pt[6].toFixed(1) : Math.round(x.pt[6])} km` : ""}</small></span></span><span class="trj-p"><button class="btn" data-farkeep="${i}">Garder</button><span><small>le GPS actuel est le bon</small></span></span>${fixRow("far", i)}</span></span></li>`).join("")}${c.trjFar.length > 150 ? `<li><span class="cap">… et ${c.trjFar.length - 150} autres : choisis une liste en haut pour les voir.</span></li>` : ""}</ul></section>` : ""}
    <section data-n="${c.noPlace.length}"><h3 class="minor">Sans GPS ou sans lieu · ${c.noPlace.length}</h3><p class="cap">Une ligne par observation (même espèce, même jour), avec les listes concernées. « Corriger » ouvre la coche ; coche « même observation » dans le formulaire pour que les autres listes suivent.</p>${c.noPlace.length ? `<ul class="todo">${c.noPlace.slice(0, 150).map((x) => `<li><span>${nameLink(x.e)} ${[...new Set(x.ts.map((t) => t.cle))].map(chip).join(" ")}<small>${x.d ? esc(fmtShort(x.d)) : "sans date"}${x.main.l ? " · " + esc(x.main.l) : ""} · <span class="miss">${[x.gps ? "sans GPS" : "", x.name ? "sans nom de lieu" : ""].filter(Boolean).join(", ")}</span></small></span><a class="btn" href="#/coche/${x.main.cle}/${x.main.id}/modifier">Corriger</a></li>`).join("")}${c.noPlace.length > 150 ? `<li><span class="cap">… et ${c.noPlace.length - 150} autres, qui s'afficheront au fur et à mesure.</span></li>` : ""}</ul>` : '<p class="cap">Tout est placé.</p>'}</section>
    <section data-n="${c.noPhoto.length}"><h3 class="minor">Coches sans photo · ${c.noPhoto.length}</h3>${sel && !needsPh(sel) ? "" : `<div class="seg" role="group" aria-label="Listes"><button type="button" data-nphyl="0" aria-pressed="${!withYL}">Listes photo seulement</button><button type="button" data-nphyl="1" aria-pressed="${withYL}">Toutes les listes</button></div>`}<p class="cap">Listes photo seulement : les observations de Lifers, Photo France et des pays, les seules où la photo est exigée (les listes locales et les year lists comptent une observation quand l'espèce est déjà en photo France). Une ligne par observation : sa photo vaut pour toutes ses listes. « Ajouter une photo » ouvre la coche ; « Pas de photo » la sort d'ici pour de bon. 📁 : ton dossier Liste a des photos de l'espèce ce jour-là.</p>${c.noPhoto.length ? `<ul class="todo">${c.noPhoto.slice(0, 150).map((x, i) => `<li><span>${nameLink(x.main.e)}${x.folder ? ' <span title="Photos ce jour-là dans ton dossier Liste">📁</span>' : ""} ${[...new Set(x.ts.map((t) => t.cle))].map(chip).join(" ")}<small>${esc(fmtShort(x.main.d))}${x.main.l ? " · " + esc(x.main.l) : ""}</small></span><span class="row"><button type="button" class="btn" data-goph="${x.main.cle}/${x.main.id}">Ajouter une photo</button><button class="btn" data-noph="${i}">Pas de photo</button></span></li>`).join("")}${c.noPhoto.length > 150 ? `<li><span class="cap">… et ${c.noPhoto.length - 150} autres : choisis une liste en haut pour les voir.</span></li>` : ""}</ul>` : '<p class="cap">Toutes tes coches photo ont leur photo.</p>'}</section>
    <section data-n="${c.noTag.length}"><h3 class="minor">Photos sans étiquette · ${c.noTag.length}</h3>${sel && isYL(sel) ? "" : `<div class="seg" role="group" aria-label="Year lists"><button type="button" data-nphyl="0" aria-pressed="${!withYL}">Sans les year lists</button><button type="button" data-nphyl="1" aria-pressed="${withYL}">Avec les year lists</button></div>`}<p class="cap">Une ligne par photo : l'étiquette vaut pour l'observation dans toutes ses listes. Touche l'étiquette qui convient.</p>${c.noTag.length ? `<ul class="todo">${c.noTag.slice(0, 120).map((x, i) => `<li class="has-ph"><span class="td-ph">${phImg(x.ph.img || x.ph.url, M.name(x.best || x.ts[0].e))}</span><span>${x.best ? `<a href="#/espece/${esc(x.best)}">${esc(M.name(x.best))}</a> <span class="chip-s">best of</span>` : `<a href="#/espece/${esc(x.ts[0].e)}">${esc(M.name(x.ts[0].e))}</a>${x.alsoBest ? ' <span class="chip-s">best of</span>' : ""} ${[...new Set(x.shown.map((t) => t.cle))].map(chip).join(" ")}`}<small>${esc(x.ph.d ? fmtShort(x.ph.d) : x.ts ? fmtShort(x.ts[0].d) : "")}${x.ph.file ? " · " + esc(x.ph.file) : ""}</small></span><span class="qpick">${QUALITES.map((q) => `<button type="button" class="qtag" style="--c:${q.c}" data-qset="${i}|${esc(q.v)}">${q.court}</button>`).join("")}</span></li>`).join("")}${c.noTag.length > 120 ? `<li><span class="cap">… et ${c.noTag.length - 120} autres : choisis une liste en haut pour les voir.</span></li>` : ""}</ul>` : '<p class="cap">Toutes tes photos ont leur étiquette.</p>'}</section>
    <section data-n="${c.undated.length}"><h3 class="minor">Coches sans date</h3><p class="cap">${[...und].map(([k, a]) => `<a href="#" data-undated="${k}">${esc(L(k).nom)} ${a.length}</a>`).join(" · ") || "Aucune."}</p></section>
    ${cats.map((cat) => { const vs = tasks.filter((t) => t.cat === cat).map(taskView), open = vs.filter((v) => !v.done), shut = vs.length - open.length;
      return `<section data-n="${open.length}"><h3 class="minor">${esc(cat)} · ${open.length}${shut ? ` <span class="cap">(${shut} ${plural(shut, "réglée")})</span>` : ""}</h3>${open.length ? `<ul class="todo">${open.map((v) => v.html).join("")}</ul>` : '<p class="cap">Tout est réglé.</p>'}</section>`; }).join("")}
  </div>`;
  // index of the categories: one chip per section, with what is left in it; a tap goes there
  const secs = $$(".screen > section", view);
  $$("[data-nphyl]", view).forEach((b) => b.addEventListener("click", () => { saveUI({ nphYL: b.dataset.nphyl === "1" }); const y = scrollY; screenTodo(); scrollTo(0, y); }));
  $$("[data-qset]", view).forEach((b) => b.addEventListener("click", () => {
    const [i, v] = b.dataset.qset.split("|"), x = c.noTag[+i]; if (!x) return;
    if (x.best) S.apply({ kind: "set-espece", id: x.best, patch: { q: v } }, `Étiquette best of : ${M.name(x.best)} → ${v}`);
    else S.apply([...x.ts.map((t) => ({ kind: "set-tick", cle: t.cle, id: t.id, patch: { q: v } })), ...(x.alsoBest ? [{ kind: "set-espece", id: x.alsoBest, patch: { q: v } }] : [])], `Étiquette photo : ${M.name(x.ts[0].e)} (${fmtShort(x.ts[0].d)})${x.alsoBest ? " et best of" : ""} → ${v}`);
    toast(`Étiquette : ${qualite(v).court}.`);
  }));
  // « Ajouter une photo » opens the tick's page and, in the same tap, the file picker of its photo box
  $$("[data-goph]", view).forEach((b) => b.addEventListener("click", () => {
    const h = "#/coche/" + b.dataset.goph; draw(h); location.hash = h; scrollTo(0, 0);
    const box = $("#tk-ph"), inp = box && box.querySelector(".ph-file");
    if (inp) { box.scrollIntoView({ block: "center" }); inp.click(); }
  }));
  $$("[data-noph]", view).forEach((b) => b.addEventListener("click", () => {
    const x = c.noPhoto[+b.dataset.noph]; if (!x) return;
    S.apply(x.ts.map((t) => ({ kind: "set-tick", cle: t.cle, id: t.id, patch: { nph: true } })), `Pas de photo : ${M.name(x.main.e)} (${fmtShort(x.main.d)})`);
    toast("Noté : pas de photo pour cette coche.");
  }));
  // one category at a time: the chips are tabs (the ones with nothing left are hidden), the open one is remembered
  const info = secs.map((sec) => {
    const h = sec.querySelector("h3"); const title = (h ? h.firstChild.textContent : "").replace(/\s*·\s*\d+\s*$/, "").trim();
    const short = title.replace(/ : numéros pas dans l'ordre des dates$/, " : numéros").replace(/^Pas d'accord avec /, "").replace(/^Même observation, lieux différents$/, "Lieux différents").replace(/^Coches hors de leur liste$/, "Hors de leur liste").replace(/^Dates différentes appli \/ cocheurs$/, "Dates cocheurs").replace(/^Incohérences trouvées dans la base$/, "Incohérences").replace(/^Une photo plus ancienne que la coche$/, "Photo plus ancienne").replace(/^Sans GPS ou sans lieu$/, "Sans GPS / lieu").replace(/^Première donnée de la zone$/, "Première de la zone").replace(/^Pas dans la liste du pays$/, "Liste du pays").replace(/^Lieu d'après tes trajets$/, "Tes trajets").replace(/^GPS loin de tes trajets$/, "GPS loin des trajets");
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
  // the same choice as a menu: every criterion with what is left in it
  const tdc = $("#tdc");
  tdc.innerHTML = live.map((x, i) => `<option value="${i}" ${x === cur ? "selected" : ""}>${esc(x.title)} (${x.n})</option>`).join("") || '<option>Tout est à jour</option>';
  tdc.addEventListener("change", () => { const a = $(`[data-td="${tdc.value}"]`, nav); if (a) a.click(); });
  $$("[data-td]", nav).forEach((a) => a.addEventListener("click", () => { tdc.value = a.dataset.td; }));
  $$("[data-act]").forEach((b) => b.addEventListener("click", () => { const [id, a] = b.dataset.act.split(":"); taskAct(id, a); }));
  $$("[data-task]").forEach((i) => i.addEventListener("change", () => { const t = tasks.find((x) => x.id === i.dataset.task); S.apply({ kind: "set-tache", id: t.id, patch: { fait: i.checked || null } }, `${i.checked ? "Fait" : "À refaire"} : ${t.esp ? t.esp + " · " : ""}${t.quoi}`); }));
  $$("[data-undated]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); saveUI({ jf: { q: "", cle: a.dataset.undated, year: "none", miss: "" } }); go("#/journal"); }));
  $("#tdl").addEventListener("change", (e) => { saveUI({ tdList: e.target.value }); tdLast = -1; screenTodo(); });
  const alignOps = (x) => x.others.map((t) => ({ kind: "set-tick", cle: t.cle, id: t.id, patch: { l: x.src.l || null, lat: x.src.lat ?? null, lon: x.src.lon ?? null, p: x.src.p || null, sl: x.src.sl || null } }));
  $$("[data-align]").forEach((b) => b.addEventListener("click", () => { const x = c.placeMismatch[+b.dataset.align]; S.apply(alignOps(x), `Lieu aligné : ${M.name(x.src.e)} (${fmtShort(x.src.d)})`); }));
  $$("[data-zftake]").forEach((b) => b.addEventListener("click", () => { const x = c.zoneFirst[+b.dataset.zftake], f = x.first;
    const data = { d: f.d, l: f.l || null, lat: f.lat ?? null, lon: f.lon ?? null, h: f.h || null, sh: f.sh || null, sd: f.sd || null, sl: f.sl || null, vf: null };
    // the lifer (or the Photo France) moves to another sighting: its country and its photo come with it
    const own = (zone) => zone === LIFERS || zone === PHOTO_FR || (M.liste.get(zone) || {}).type === "pays";
    const ops = [], names = [];
    for (const { zone, zt } of [{ zone: x.zone, zt: x.zt }, ...(x.also || [])]) {
      names.push(L(zone).nom);
      const pd = own(zone) ? { ...data, p: f.p || null, ph: f.ph || null, nph: null } : data;
      if (zt) ops.push({ kind: "set-tick", cle: zone, id: zt.id, patch: pd });
      else { const l = M.liste.get(zone), tick = { id: `${zone}-${Date.now().toString(36)}`, e: x.e }; Object.entries(pd).forEach(([k, v]) => { if (v != null) tick[k] = v; }); if (l.numerotee) tick.n = M.nextNum(zone); ops.push({ kind: "add-tick", cle: zone, tick }); }
    }
    S.apply(ops, `${names.join(", ")} : ${M.name(x.e)} au ${fmtShort(f.d)} (première photo)`);
    toast(x.zt ? "Date, lieu et photo repris ; pense à renuméroter si besoin." : "Ajoutée ; pense à renuméroter si besoin."); }));
  $$("[data-zfkeep]").forEach((b) => b.addEventListener("click", () => { const x = c.zoneFirst[+b.dataset.zfkeep];
    const all = [{ zone: x.zone, zt: x.zt }, ...(x.also || [])].filter((y) => y.zt);
    S.apply(all.map(({ zone, zt }) => ({ kind: "set-tick", cle: zone, id: zt.id, patch: { vf: zt.d } })), `Date confirmée : ${M.name(x.e)} (${all.map((y) => L(y.zone).nom).join(", ")})`); }));
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
  const ub = $("#td-undo"); if (ub) ub.addEventListener("click", () => { const u = S.undoLast(); if (u) toast(`Annulé : ${u.label}`); });
  $$("[data-renum]").forEach((b) => b.addEventListener("click", () => { const cle = b.dataset.renum, mv = M.renumber(cle); S.apply(mv.map((m) => ({ kind: "set-tick", cle, id: m.t.id, patch: { n: m.to } })), `${L(cle).nom} : ${mv.length} coches renumérotées par date`); toast("Numéros remis dans l'ordre des dates."); }));
  const aa = $("#align-all"); if (aa) aa.addEventListener("click", () => { S.apply(c.placeMismatch.flatMap(alignOps), `Lieux alignés : ${c.placeMismatch.length} observations`); toast("Lieux alignés."); });
  // the names of the places of « tes trajets », one after the other (only the ones shown)
  (async () => { for (const el of $$("[data-nm]", view)) { if (!el.isConnected || el.closest("[hidden]")) continue; const [la, lo] = el.dataset.nm.split(",").map(Number); if (!/^-?\d/.test(el.textContent)) continue; const n = TRJ_NAMES.get(el.dataset.nm) || await nameAt(la, lo).catch(() => null); if (n && n.l) { TRJ_NAMES.set(el.dataset.nm, n); el.textContent = n.l; } } })();
  $$("[data-trj]").forEach((b) => b.addEventListener("click", async () => {
    const [i, k] = b.dataset.trj.split("|").map(Number), x = c.trajets[i], p = x && x.cands[k]; if (!p) return;
    b.disabled = true; b.textContent = "…";
    const n = p.l ? { l: p.l, p: null } : TRJ_NAMES.get(`${p.lat},${p.lon}`) || await nameAt(p.lat, p.lon).catch(() => null);
    const ops = x.ts.filter((t) => t.lat == null).map((t) => ({ kind: "set-tick", cle: t.cle, id: t.id, patch: { lat: p.lat, lon: p.lon, ...(!t.l && n && n.l ? { l: n.l } : {}), ...(n && n.p && !t.p ? { p: n.p } : {}) }, src: "trajets" }));
    S.apply(ops, `Lieu d'après tes trajets : ${M.name(x.main.e)} (${fmtShort(x.main.d)})${n && n.l ? " · " + n.l : ""}`);
    toast(`Lieu mis${n && n.l ? " : " + n.l : ""}.`);
  }));
  $$("[data-far]").forEach((b) => b.addEventListener("click", async () => {
    const x = c.trjFar[+b.dataset.far]; if (!x) return; b.disabled = true; b.textContent = "…";
    const n = TRJ_NAMES.get(`${x.pt[1]},${x.pt[2]}`) || await nameAt(x.pt[1], x.pt[2]).catch(() => null);
    S.apply(x.ts.map((t) => ({ kind: "set-tick", cle: t.cle, id: t.id, patch: { lat: x.pt[1], lon: x.pt[2], ...(n && n.l ? { l: n.l } : {}), vg: null }, src: "trajets" })), `GPS d'après tes trajets : ${M.name(x.main.e)} (${fmtShort(x.main.d)}, ${x.pt[0]})${n && n.l ? " · " + n.l : ""}`);
    toast(`Position de ${x.pt[0]} reprise${n && n.l ? " : " + n.l : ""}.`);
  }));
  $$("[data-fix]").forEach((b) => b.addEventListener("click", () => {
    const [kind, i] = b.dataset.fix.split("|"), x = (kind === "trj" ? c.trajets : c.trjFar)[+i], box = $(`#fix-${kind}-${i}`); if (!x || !box) return;
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false; requestAnimationFrame(() => box.scrollIntoView({ block: "center", behavior: "smooth" })); if (box.dataset.on) return; box.dataset.on = "1";
    // what is already known: the proposed points, and for « GPS loin » the current GPS of the tick
    const others = kind === "trj" ? x.cands.map((p, k) => ({ lat: p.lat, lon: p.lon, nom: String(k + 1) }))
      : [{ lat: x.pt[1], lon: x.pt[2], nom: `téléphone ${x.pt[0]}` }, { lat: x.main.lat, lon: x.main.lon, nom: "GPS actuel" }];
    const start = kind === "trj" ? x.cands[0] : { lat: x.pt[1], lon: x.pt[2] };
    const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    box.innerHTML = `<div class="minimap tall"></div><p class="cap fix-trk">Chargement de ton trajet de ce jour-là…</p><p class="cap fix-pt">Touche la carte ou déplace l'épingle sur le bon endroit (${kind === "far" ? "les points orange : la position de ton téléphone et le GPS actuel" : "les points orange : les propositions, avec leur numéro"} ; ◎ : ta position).</p><p class="trj-fix-b"><button class="btn btn-primary" disabled>Valider ce point</button> <button class="btn" type="button">Fermer</button></p>`;
    const [ok, close] = $$("button", box), info = $(".fix-pt", box); let pt = null;
    close.addEventListener("click", () => { box.hidden = true; });
    const mp = mapPicker($(".minimap", box), { ...(start ? { lat: start.lat, lon: start.lon } : {}), others, labels: true }, async (lat, lon, how) => {
      if (lat == null) return; pt = { lat, lon, n: null }; ok.disabled = false;
      const when = /^trace /.test(how || "") ? ` (ton téléphone à ${how.slice(6)})` : "";
      info.textContent = `Point choisi : ${lat}, ${lon}${when}`;
      const n = await nameAt(lat, lon).catch(() => null); if (pt && pt.lat === lat && pt.lon === lon) { pt.n = n; if (n && n.l) info.textContent = `Point choisi : ${n.l}${when}`; }
    });
    // your track of that day (read only now: one file per month)
    const tinfo = $(".fix-trk", box);
    S.lazyJson(`data/traces/${x.main.d.slice(0, 7)}.json`).then((j) => {
      const pts = j && j.jours && j.jours[x.main.d];
      if (pts && pts.length) { mp.setTrack(pts); tinfo.textContent = `Ton trajet de ce jour-là en bleu (${pts.length} points, de ${hm(pts[0][0])} à ${hm(pts[pts.length - 1][0])}) : touche un point pour le prendre, l'heure s'affiche.`; }
      else tinfo.textContent = "Pas de trajet enregistré par ton téléphone ce jour-là.";
    }).catch(() => { tinfo.textContent = "Ton trajet de ce jour-là n'a pas pu être chargé (pas de réseau ?)."; });
    ok.addEventListener("click", async () => {
      if (!pt) return; ok.disabled = true; ok.textContent = "…";
      const n = pt.n || await nameAt(pt.lat, pt.lon).catch(() => null);
      const ts = kind === "trj" ? x.ts.filter((t) => t.lat == null) : x.ts;
      S.apply(ts.map((t) => ({ kind: "set-tick", cle: t.cle, id: t.id, src: "appli", patch: { lat: pt.lat, lon: pt.lon,
        ...(n && n.l && (kind === "far" || !t.l) ? { l: n.l } : {}), ...(n && n.p && !t.p ? { p: n.p } : {}), ...(kind === "far" ? { vg: null } : {}) } })),
        `Position corrigée : ${M.name(x.main.e)} (${fmtShort(x.main.d)})${n && n.l ? " · " + n.l : ""}`);
      toast(`Position mise${n && n.l ? " : " + n.l : ""}.`);
    });
  }));
  $$("[data-farkeep]").forEach((b) => b.addEventListener("click", () => {
    const x = c.trjFar[+b.dataset.farkeep]; if (!x) return;
    S.apply(x.ts.map((t) => ({ kind: "set-tick", cle: t.cle, id: t.id, patch: { vg: true } })), `GPS confirmé : ${M.name(x.main.e)} (${fmtShort(x.main.d)})`);
  }));
  $$("[data-addpays]").forEach((b) => b.addEventListener("click", () => {
    const x = c.paysMissing[+b.dataset.addpays], t = x.t, pl = M.liste.get(x.pays); if (!x || !pl) return;
    const tick = { id: `${pl.cle}-${Date.now().toString(36)}`, e: t.e }; ["d", "h", "sh", "l", "lat", "lon", "p", "t", "sd", "sl"].forEach((k) => { if (t[k] != null && t[k] !== "") tick[k] = t[k]; });
    if (pl.numerotee) tick.n = M.nextNum(pl.cle);
    S.apply({ kind: "add-tick", cle: pl.cle, tick }, `Ajout : ${M.name(t.e)} (${pl.nom}, ${t.d ? fmtShort(t.d) : "sans date"})`); toast(`${M.name(t.e)} ajoutée à ${pl.nom}.`);
  }));
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
    <section class="panel"><span class="lab">Thème</span><div class="seg wide3" id="thm"><button class="btn" type="button" data-t="auto">Auto</button><button class="btn" type="button" data-t="light">☀ Clair</button><button class="btn" type="button" data-t="dark">☾ Sombre</button></div></section>
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
// the copy of the base kept on this device is read (IndexedDB), then GitHub is asked what changed
S.boot.then(() => { seenV = S.version; try { M = buildModel(S.db); } catch (e) { console.error(e); } renderStatus(); route(); if (S.ready) S.sync(); });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
