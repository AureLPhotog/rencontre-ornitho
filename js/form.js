// Adding a sighting (with the lists it goes to) and editing one tick.
// a name you already gave within 300 m: a named tick (not a bare region name) or a saved place
function ownPlaceNear(pt) {
  let best = null, bd = 0.3;
  for (const x of [...M.ticks.filter((t) => t.l && t.lat != null && !["France", "Guyane", "Espagne"].includes(t.l)), ...(M.db.lieux || []).map((x) => ({ ...x, l: x.nom }))]) {
    if (x.lat == null) continue; const d = distKm(x, pt); if (d < bd) { bd = d; best = x.l; }
  }
  return best;
}
import { $, $$, esc, norm, cap, slug, uid, plural, todayIso, yearOf, isFrance, fmtShort, toast, store, srcName, QUALITES } from "./util.js";
import { S, M, go, UI, saveUI, phSlider, wirePhotos } from "./app.js";
import { photoBox } from "./photos.js";
import { suggest, PHOTO_FR } from "./model.js";
import { mapPicker, isOuessant } from "./map.js";
import { whereIs, listCovers, placeAt, distKm, outsideOf, lieuDit } from "./geo.js";

const countries = () => [...new Set(M.ticks.map((t) => t.p).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
const zoneLists = () => {
  // most precise first: a list contained in another one comes before it
  const z = M.listes.filter((l) => l.type === "zone" || l.type === "lieu");
  const depth = (cle) => M.chain(cle).length;
  return z.sort((a, b) => depth(b.cle) - depth(a.cle) || a.nom.localeCompare(b.nom, "fr"));
};

function placeFields(st) {
  return `<label>Lieu<input class="field" id="f-lieu" list="dl-lieux" autocomplete="off" placeholder="Nom du lieu" value="${esc(st.l || "")}"></label>
    <datalist id="dl-lieux">${M.db.lieux.slice(0, 300).map((p) => `<option value="${esc(p.nom)}">`).join("")}</datalist>
    <div class="combo mapq"><input class="field" id="f-mapq" type="search" autocomplete="off" placeholder="Chercher un lieu sur la carte (étang, lieu-dit, commune…)" aria-controls="f-mapsug"><ul id="f-mapsug" class="sug" role="listbox" hidden></ul></div>
    <div class="mapbox" id="f-map"></div>
    <div class="coords"><span id="f-coords">${st.lat != null ? `${st.lat}, ${st.lon}` : "Touche la carte pour placer le point, ou ◎ pour ta position."}</span>
      <button type="button" class="linkish" id="f-clear" ${st.lat == null ? "hidden" : ""}>effacer</button></div>`;
}
function wirePlace(st, onChange) {
  const show = () => { $("#f-coords").textContent = st.lat != null ? `${st.lat}, ${st.lon}` : "Pas de coordonnées."; $("#f-clear").hidden = st.lat == null; };
  const others = M.db.lieux.filter((p) => p.lat != null).slice(0, 150);
  const mp = mapPicker($("#f-map"), { lat: st.lat, lon: st.lon, others }, (lat, lon, how) => {
    if (how === "gps-refusé") { toast("Position refusée ou introuvable."); return; }
    st.lat = lat; st.lon = lon; show(); onChange && onChange("coords");
  });
  $("#f-lieu").addEventListener("change", (e) => {
    st.l = e.target.value.trim();
    const p = M.db.lieux.find((x) => x.nom === st.l);
    if (p && p.lat != null) { st.lat = p.lat; st.lon = p.lon; if (p.p) st.p = p.p; mp.set(p.lat, p.lon, 14); show(); onChange && onChange("lieu"); }
  });
  $("#f-lieu").addEventListener("input", (e) => { st.l = e.target.value; });
  $("#f-clear").addEventListener("click", () => { st.lat = st.lon = null; show(); });
  wireMapSearch(mp);
  return mp;
}

// search a place to move the map there; the point itself is then placed by a tap
// (your own places first, then IGN lieux-dits and communes in France, then OpenStreetMap elsewhere)
function wireMapSearch(mp) {
  const q = $("#f-mapq"), sug = $("#f-mapsug"); if (!q || !mp.map) return;
  let res = [], timer = null, seq = 0, ring = null;
  const own = (k) => {
    const seen = new Set(), out = [];
    for (const x of [...(M.db.lieux || []).map((p) => ({ nom: p.nom, lat: p.lat, lon: p.lon })), ...M.ticks.filter((t) => t.l && t.lat != null).map((t) => ({ nom: t.l, lat: t.lat, lon: t.lon }))]) {
      if (x.lat == null || seen.has(x.nom) || !norm(x.nom).includes(k)) continue; seen.add(x.nom); out.push({ ...x, src: "tes lieux", z: 16 }); if (out.length >= 5) break;
    }
    return out;
  };
  const getJ = async (u) => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch (_) { return null; } };
  const feat = (j, src, z) => ((j && j.features) || []).map((f) => { const p = f.properties || {}, c = (f.geometry || {}).coordinates || [];
    const nom = p.toponym || (Array.isArray(p.name) ? p.name[0] : p.name) || p.label; const where = [Array.isArray(p.city) ? p.city[0] : p.city, Array.isArray(p.depcode) ? p.depcode[0] : p.depcode || p.context].filter(Boolean).join(", ");
    const cat = Array.isArray(p.category) ? p.category.filter((x) => x !== "administratif").slice(-1)[0] : "";
    return nom && c.length ? { nom, detail: [cat, where].filter(Boolean).join(" · "), lat: c[1], lon: c[0], src, z } : null; }).filter(Boolean);
  const draw = () => {
    sug.hidden = !res.length;
    sug.innerHTML = res.map((r, i) => `<li role="option" data-i="${i}">${esc(r.nom)}<small>${esc([r.detail, r.src].filter(Boolean).join(" · "))}</small></li>`).join("");
  };
  const search = async (v) => {
    const k = norm(v), my = ++seq; if (k.length < 3) { res = []; draw(); return; }
    res = own(k); draw();
    const e = encodeURIComponent(v);
    const [poi, adr, osm] = await Promise.all([
      getJ(`https://data.geopf.fr/geocodage/search?q=${e}&index=poi&limit=6`),
      getJ(`https://data.geopf.fr/geocodage/search?q=${e}&index=address&limit=3`),
      getJ(`https://nominatim.openstreetmap.org/search?format=json&limit=3&accept-language=fr&q=${e}`),
    ]);
    if (my !== seq) return;
    const world = (Array.isArray(osm) ? osm : []).map((o) => ({ nom: o.name || o.display_name.split(",")[0], detail: o.display_name.split(",").slice(1, 3).join(",").trim(), lat: +o.lat, lon: +o.lon, src: "OpenStreetMap", z: 14 }));
    res = [...res, ...feat(poi, "IGN", 16), ...feat(adr, "adresse", 15), ...world].slice(0, 14);
    if (!res.length) { sug.hidden = false; sug.innerHTML = '<li class="cap">Rien trouvé (ou pas de réseau).</li>'; return; }
    draw();
  };
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => search(q.value.trim()), 350); });
  q.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); if (res[0]) pick(res[0]); } });
  q.addEventListener("blur", () => setTimeout(() => { sug.hidden = true; }, 200));
  q.addEventListener("focus", () => { if (res.length) sug.hidden = false; });
  const pick = (r) => {
    sug.hidden = true; q.value = r.nom;
    mp.map.setView([r.lat, r.lon], r.z || 15);
    if (ring) ring.remove();
    ring = window.L.circleMarker([r.lat, r.lon], { radius: 14, color: "#0A7895", weight: 2, fillOpacity: 0.08 }).addTo(mp.map);
    toast("Touche la carte à l'endroit précis pour placer le point.");
  };
  sug.addEventListener("pointerdown", (ev) => { const li = ev.target.closest("[data-i]"); if (li) { ev.preventDefault(); pick(res[+li.dataset.i]); } });
}

// ---------- add ----------
export function renderAdd(view, q) {
  const draft = store("ro.draft") || {};
  const st = { e: q.get("e") || draft.e || "", newName: "", photo: draft.photo !== false, d: q.get("d") || todayIso(), p: draft.p || "", zone: UI.zone !== undefined ? UI.zone : "rhone", l: "", lat: null, lon: null, t: "", picks: {} };
  const zones = zoneLists();
  view.innerHTML = `<div class="screen"><h2>Nouvelle observation</h2>
    <form id="add" class="form" autocomplete="off">
      <label>Espèce<div class="combo"><input class="field" id="f-sp" placeholder="Tape quelques lettres…" value="${esc(st.e ? M.name(st.e) : "")}" aria-autocomplete="list" aria-controls="f-sug"><ul id="f-sug" class="sug" role="listbox" hidden></ul></div></label>
      <p class="cap" id="f-known"></p>
      <div class="seg wide" role="group" aria-label="Photo"><button type="button" data-photo="1">Photographiée</button><button type="button" data-photo="0">Vue ou entendue</button></div>
      <div class="qrow" id="f-qrow"><span class="cap">Qualité photo de l'espèce</span><div class="qpick" role="group" aria-label="Qualité photo">${QUALITES.map((x) => `<button type="button" class="qtag" style="--c:${x.c}" data-fq="${esc(x.v)}">${x.court}</button>`).join("")}</div></div>
      <div class="row2"><label>Date<input class="field" type="date" id="f-date" value="${esc(st.d)}" max="${todayIso()}"></label>
        <label>Pays<input class="field" id="f-pays" list="dl-pays" placeholder="France" value="${esc(st.p)}"></label></div>
      <datalist id="dl-pays">${["France", ...countries()].map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
      <div id="f-zone-wrap"><span class="lab">Où, en France</span><div class="chips" id="f-zone">${zones.map((z) => `<button type="button" data-zone="${z.cle}">${esc(z.nom)}</button>`).join("")}<button type="button" data-zone="">Ailleurs en France</button></div></div>
      ${placeFields(st)}
      <label>Détail <small>(facultatif : vu, entendu, mâle, nombre…)</small><input class="field" id="f-det" value=""></label>
      <fieldset class="targets"><legend>À cocher dans</legend><div id="f-targets"></div></fieldset>
      <div class="row"><button class="btn btn-primary btn-lg" type="submit" id="f-save">Enregistrer</button><a class="btn" href="javascript:history.back()">Annuler</a></div>
    </form></div>`;

  const spIn = $("#f-sp"), sug = $("#f-sug");
  let options = [], active = -1;
  const setSpecies = (sid, newName = "") => { st.e = sid; st.newName = newName; spIn.value = sid ? M.name(sid) : newName; sug.hidden = true; store("ro.draft", { ...draft, e: sid }); refresh(); };
  const drawSug = () => {
    const v = spIn.value.trim(); options = M.search(v, 10);
    const exact = options.some((e) => norm(e.n) === norm(v));
    sug.innerHTML = options.map((e, i) => `<li role="option" data-i="${i}" class="${i === active ? "on" : ""}"><b>${esc(e.n)}</b>${M.bySp.has(e.id) ? "" : ' <span class="new">jamais cochée</span>'}<small>${esc(e.sc || "")}</small></li>`).join("")
      + (v.length > 2 && !exact ? `<li role="option" data-new="1" class="${active === options.length ? "on" : ""}">Nouvelle espèce : <b>${esc(cap(v))}</b></li>` : "");
    sug.hidden = !v;
  };
  spIn.addEventListener("input", () => { st.e = ""; active = -1; drawSug(); refresh(); });
  spIn.addEventListener("keydown", (e) => {
    const n = sug.querySelectorAll("li").length;
    if (e.key === "ArrowDown") { active = Math.min(n - 1, active + 1); drawSug(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); drawSug(); e.preventDefault(); }
    else if (e.key === "Enter" && !sug.hidden) { e.preventDefault(); const li = sug.querySelectorAll("li")[Math.max(0, active)]; if (li) li.dispatchEvent(new Event("mousedown", { bubbles: true })); }
  });
  sug.addEventListener("mousedown", (e) => { const li = e.target.closest("li"); if (!li) return; e.preventDefault(); if (li.dataset.new) setSpecies("", cap(spIn.value.trim())); else setSpecies(options[+li.dataset.i].id); });
  spIn.addEventListener("blur", () => setTimeout(() => { sug.hidden = true; }, 150));

  $$("[data-fq]").forEach((b) => b.addEventListener("click", () => { st.q = st.q === b.dataset.fq ? null : b.dataset.fq; refresh(); }));
  $$("[data-photo]").forEach((b) => b.addEventListener("click", () => { st.photo = b.dataset.photo === "1"; store("ro.draft", { ...draft, photo: st.photo }); refresh(); }));
  $$("[data-zone]").forEach((b) => b.addEventListener("click", () => {
    st.zone = b.dataset.zone; saveUI({ zone: st.zone });
    const fixed = placeAt(M.liste.get(st.zone), st.d); // jardin, bureau: their own spot on that date
    if (fixed) { st.l = fixed.nom || ""; st.lat = fixed.lat; st.lon = fixed.lon; st.p = ""; $("#f-lieu").value = st.l; $("#f-pays").value = ""; mp.set(st.lat, st.lon, 16); $("#f-coords").textContent = `${st.lat}, ${st.lon}`; $("#f-clear").hidden = false; }
    refresh();
  }));
  $("#f-date").addEventListener("change", (e) => { st.d = e.target.value; refresh(); });
  $("#f-pays").addEventListener("change", (e) => { st.p = isFrance(e.target.value) ? "" : cap(e.target.value); refresh(); });
  $("#f-det").addEventListener("input", (e) => { st.t = e.target.value; });
  const mp = wirePlace(st, async (why) => {
    if (st.lat == null) { st.where = null; refresh(); return; }
    const at = { lat: st.lat, lon: st.lon };
    // within 150 m of the garden or the office (as placed on that date): that list
    const near = zones.find((l) => { const f = placeAt(l, st.d); return f && distKm(f, st) < Math.min(0.15, (l.rayon || 300) / 2000); });
    // the place name follows the point as long as it was filled by the app (not typed)
    const free = () => !st.l || st.l === st.autoL, setL = (v) => { st.l = st.autoL = v; $("#f-lieu").value = v; };
    if (near) { st.zone = near.cle; saveUI({ zone: st.zone }); if (free()) setL(placeAt(near, st.d).nom || ""); }
    else if (isOuessant(st.lat, st.lon) && M.liste.has("ouessant")) st.zone = "ouessant";
    st.where = undefined; refresh();
    const w = await whereIs(st.lat, st.lon);
    if (st.lat !== at.lat || st.lon !== at.lon) return; // the point moved meanwhile
    st.where = w;
    if (w && w.fr) {
      if (!isFrance(st.p)) { st.p = ""; $("#f-pays").value = ""; }
      if (!near && w.dep) { const z = zones.find((l) => !l.lieux && listCovers(l, w)); st.zone = z ? z.cle : ""; saveUI({ zone: st.zone }); }
      // a place you already named within 300 m (a tick or a saved place), else the commune then the IGN lieu-dit
      const own = near ? null : ownPlaceNear(at);
      if (free() && own) setL(own);
      else if (free() && !near && w.commune) {
        const com = w.dep ? `${w.commune}, ${w.dep}` : w.commune; setL(`${w.commune}${w.dep ? ` (${w.dep})` : ""}`); const auto = st.l;
        lieuDit(at.lat, at.lon, w.commune).then((ld) => { if (ld && st.l === auto && st.lat === at.lat && st.lon === at.lon) setL(`${ld.name} (${com})`); });
      }
    } else if (w && w.pays) { st.p = w.pays; $("#f-pays").value = w.pays; const own = ownPlaceNear(at); if (free() && (own || w.commune)) setL(own || w.commune); }
    refresh();
  });
  // a sighting already ticked that day in another list: same place, so the lists stay linked
  let linkedKey = "";
  function prefillFromSameDay() {
    const k = st.e + "|" + st.d; if (!st.e || !st.d || k === linkedKey) return; linkedKey = k;
    const same = M.ticks.filter((t) => t.e === st.e && t.d === st.d && (t.lat != null || t.l));
    if (!same.length || st.l || st.lat != null) return;
    const src = same.find((t) => t.lat != null) || same[0];
    st.l = src.l || ""; st.lat = src.lat ?? null; st.lon = src.lon ?? null; st.p = src.p || "";
    $("#f-lieu").value = st.l; $("#f-pays").value = st.p; if (st.lat != null) mp.set(st.lat, st.lon, 14);
    $("#f-coords").textContent = st.lat != null ? `${st.lat}, ${st.lon}` : "Pas de coordonnées."; $("#f-clear").hidden = st.lat == null;
    toast("Lieu repris de la coche du même jour.");
  }

  function refresh() {
    $$("[data-photo]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.photo === "1") === st.photo)));
    // quality: the species' own, until another one is picked here
    const q = st.q !== undefined && st.q !== null ? st.q : st.q === null ? null : (M.esp.get(st.e) || {}).q;
    $("#f-qrow").hidden = !st.photo;
    $$("[data-fq]").forEach((b) => { const on = b.dataset.fq === q; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
    const fr = isFrance(st.p);
    $("#f-zone-wrap").hidden = !fr;
    $$("[data-zone]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.zone === st.zone)));
    const sid = st.e; prefillFromSameDay();
    // what we already know about the species
    const m = sid && M.bySp.get(sid);
    $("#f-known").innerHTML = sid ? (m ? "Déjà : " + M.listes.filter((l) => m.has(l.cle)).map((l) => { const t = m.get(l.cle)[0]; return `${esc(l.nom)}${t.n ? " n°" + t.n : ""}${t.d ? " (" + fmtShort(t.d) + ")" : ""}`; }).join(" · ") : "Jamais cochée : ce sera une première.") : st.newName ? `Nouvelle espèce « ${esc(st.newName)} » : elle sera ajoutée au référentiel.` : "";
    if (!sid && !st.newName) { $("#f-targets").innerHTML = '<p class="cap">Choisis d\'abord l\'espèce.</p>'; return; }
    const { list } = suggest(M, sid, { photo: st.photo, zone: fr ? st.zone : null, country: st.p, date: st.d });
    list.forEach((x) => { if (st.picks[x.cle] && st.picks[x.cle].touched) { x.checked = st.picks[x.cle].checked; if (st.picks[x.cle].num) x.num = st.picks[x.cle].num; } });
    // GPS check: a tick placed outside the list's area is unticked and flagged
    list.forEach((x) => { const l = M.liste.get(x.cle); const out = st.lat != null ? outsideOf(l, st.where, st, st.d) : ""; x.out = out; if (out && !(st.picks[x.cle] && st.picks[x.cle].touched)) x.checked = false; });
    st.targets = list;
    $("#f-targets").innerHTML = list.map((x) => {
      const l = M.liste.get(x.cle), nom = l ? l.nom : `YL ${x.year}`;
      return `<label class="target ${x.already ? "already" : ""}"><input type="checkbox" data-t="${x.cle}" ${x.checked ? "checked" : ""}><span><b>${esc(nom)}</b><small>${esc(x.why)}${x.out ? ` · <span class="miss">${esc(x.out)}</span>` : ""}</small></span>${x.num && !x.already ? `<span class="num">n° <input class="field" type="number" min="1" data-n="${x.cle}" value="${x.num}"></span>` : ""}</label>`;
    }).join("");
    $$("[data-t]").forEach((i) => i.addEventListener("change", () => { st.picks[i.dataset.t] = { ...(st.picks[i.dataset.t] || {}), touched: true, checked: i.checked }; const x = st.targets.find((y) => y.cle === i.dataset.t); if (x) x.checked = i.checked; }));
    $$("[data-n]").forEach((i) => i.addEventListener("change", () => { st.picks[i.dataset.n] = { ...(st.picks[i.dataset.n] || {}), touched: true, checked: true, num: +i.value }; const x = st.targets.find((y) => y.cle === i.dataset.n); if (x) x.num = +i.value; }));
  }
  refresh();

  $("#add").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!st.e && !st.newName) { toast("Choisis l'espèce."); spIn.focus(); return; }
    const chosen = (st.targets || []).filter((x) => x.checked);
    if (!chosen.length) { toast("Coche au moins une liste."); return; }
    const ops = []; let sid = st.e;
    if (!sid) { let id = slug(st.newName), k = 2; while (M.esp.has(id)) id = slug(st.newName) + "-" + k++; sid = id; ops.push({ kind: "add-espece", espece: { id, n: st.newName } }); }
    for (const x of chosen) {
      if (!M.liste.has(x.cle) && x.year) ops.push({ kind: "add-liste", liste: { cle: x.cle, nom: `YL ${x.year}`, dans: null, type: "annee", annee: x.year } });
      const tick = { id: `${x.cle}-${uid()}`, e: sid };
      if (st.d) tick.d = st.d; if (x.num) tick.n = x.num; if (st.l) tick.l = st.l.trim();
      if (!isFrance(st.p)) tick.p = st.p; if (st.lat != null) { tick.lat = st.lat; tick.lon = st.lon; } if (st.t) tick.t = st.t.trim();
      ops.push({ kind: "add-tick", cle: x.cle, tick });
    }
    if (st.e && st.d && (st.l || st.lat != null)) {
      const place = { l: st.l ? st.l.trim() : null, lat: st.lat, lon: st.lon, p: isFrance(st.p) ? null : st.p };
      M.ticks.filter((t) => t.e === st.e && t.d === st.d && M.sameObs(t, { e: st.e, d: st.d, cle: "", l: place.l, p: place.p || undefined }) && ((t.l || null) !== place.l || (t.lat ?? null) !== place.lat || (t.lon ?? null) !== place.lon))
        .forEach((t) => ops.push({ kind: "set-tick", cle: t.cle, id: t.id, patch: place }));
    }
    if (st.photo && st.q !== undefined && st.q !== ((M.esp.get(sid) || {}).q || null)) ops.push({ kind: "set-espece", id: sid, patch: { q: st.q } });
    if (st.l && st.lat != null) ops.push({ kind: "add-lieu", lieu: { nom: st.l.trim(), lat: st.lat, lon: st.lon, ...(isFrance(st.p) ? {} : { p: st.p }) } });
    const name = sid === st.e ? M.name(sid) : st.newName;
    const where = chosen.map((x) => (M.liste.get(x.cle) || { nom: `YL ${x.year}` }).nom).join(", ");
    S.apply(ops, `Ajout : ${name} (${where})`);
    store("ro.draft", { photo: st.photo, p: st.p });
    toast(`${name} : ${where}.`);
    go(`#/espece/${sid}`);
  });
}

// ---------- edit one tick ----------
export function renderEdit(view, cle, id) {
  const t0 = (M.db.coches[cle] || []).find((x) => x.id === id), l = M.liste.get(cle);
  if (!t0 || !l) { view.innerHTML = '<p class="empty">Cette coche n\'existe plus.</p>'; return; }
  const st = { ...t0 };
  // the same sighting ticked in other lists (same species, same day): they share date and place
  const twins = t0.d ? M.ticks.filter((x) => !(x.cle === cle && x.id === id) && M.sameObs({ ...t0, cle }, x)) : [];
  view.innerHTML = `<div class="screen"><header class="phead"><a class="back" href="javascript:history.back()">← Retour</a><h1>${esc(M.name(t0.e))}</h1><p class="cap">${esc(l.nom)}${t0.n ? " · n°" + t0.n : ""}</p>${t0.d || t0.l || t0.lat != null ? `<p class="cap">Source de la date : ${t0.d ? esc(srcName(t0.sd)) : "—"} · du lieu : ${t0.l || t0.lat != null ? esc(srcName(t0.sl)) : "—"}</p>` : ""}</header>
    <form id="ed" class="form">
      <div class="row2"><label>Date<input class="field" type="date" id="f-date" value="${esc(st.d || "")}"></label>${l.numerotee ? `<label>N°<input class="field" type="number" min="1" id="f-n" value="${esc(st.n || "")}"></label>` : `<label>Pays<input class="field" id="f-pays" list="dl-pays" placeholder="France" value="${esc(st.p || "")}"></label>`}</div>
      ${l.numerotee ? `<label>Pays<input class="field" id="f-pays" list="dl-pays" placeholder="France" value="${esc(st.p || "")}"></label>` : ""}
      <datalist id="dl-pays">${["France", ...countries()].map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
      ${placeFields(st)}
      <label>Détail<input class="field" id="f-det" value="${esc(st.t || "")}"></label>
      ${twins.length ? `<label class="chk"><input type="checkbox" id="f-twins" checked> Même observation dans ${twins.map((x) => esc(M.liste.get(x.cle).nom)).join(", ")} : la date et le lieu y changent aussi</label>` : ""}
      <div class="row"><button class="btn btn-primary btn-lg" type="submit">Enregistrer</button><a class="btn" href="javascript:history.back()">Annuler</a><button class="btn btn-danger" type="button" id="f-del">Supprimer</button></div>
    </form><div id="f-ph"></div></div>`;
  photoBox($("#f-ph"), { kind: "tick", cle, tick: t0 }, phSlider); wirePhotos($("#f-ph"));
  wirePlace(st);
  $("#f-date").addEventListener("change", (e) => { st.d = e.target.value; });
  $("#f-pays").addEventListener("change", (e) => { st.p = isFrance(e.target.value) ? "" : cap(e.target.value); });
  $("#f-det").addEventListener("input", (e) => { st.t = e.target.value; });
  const fn = $("#f-n"); if (fn) fn.addEventListener("change", (e) => { st.n = +e.target.value || null; });
  let confirmed = false;
  $("#ed").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!confirmed && st.lat != null && (st.lat !== t0.lat || st.lon !== t0.lon)) {
      const w = await whereIs(st.lat, st.lon), out = outsideOf(l, w, st, st.d);
      if (out) { confirmed = true; const b = $("#ed button[type=submit]"); b.textContent = "Enregistrer quand même"; toast(`Attention : ${out}, hors de ${l.nom}.`, "error"); return; }
    }
    const patch = {}; ["d", "n", "l", "p", "lat", "lon", "t"].forEach((k) => { const a = t0[k] ?? null, b = (typeof st[k] === "string" ? st[k].trim() : st[k]) ?? null; if ((a || null) !== (b || null) && !(a === 0 && b === 0)) patch[k] = b; });
    if (!Object.keys(patch).length) { history.back(); return; }
    const ops = [{ kind: "set-tick", cle, id, patch }];
    if ($("#f-twins") && $("#f-twins").checked) {
      const shared = {}; ["d", "l", "lat", "lon", "p"].forEach((k) => { if (k in patch) shared[k] = patch[k]; });
      if (Object.keys(shared).length) twins.filter((x) => !("d" in shared) || M.sameYearOk(x, shared.d)).forEach((x) => ops.push({ kind: "set-tick", cle: x.cle, id: x.id, patch: shared }));
    }
    // a date that matches ticks of other lists: take their place if this one has none, so they stay linked
    const nd = "d" in patch ? patch.d : t0.d;
    if (nd && !st.l && st.lat == null) {
      const src = M.ticks.find((x) => x.e === t0.e && x.d === nd && !(x.cle === cle && x.id === id) && (x.lat != null || x.l));
      if (src) ops[0].patch = { ...ops[0].patch, l: src.l || null, lat: src.lat ?? null, lon: src.lon ?? null, p: src.p || null, sl: src.sl || null };
    }
    if (st.l && st.lat != null && ("l" in patch || "lat" in patch)) ops.push({ kind: "add-lieu", lieu: { nom: st.l.trim(), lat: st.lat, lon: st.lon } });
    S.apply(ops, `Modification : ${M.name(t0.e)} (${l.nom})`);
    toast("Modifié."); history.back();
  });
  const del = $("#f-del");
  del.addEventListener("click", () => {
    if (del.dataset.armed) { S.apply({ kind: "del-tick", cle, id }, `Suppression : ${M.name(t0.e)} (${l.nom})`); toast("Coche supprimée."); history.back(); return; }
    del.dataset.armed = "1"; del.textContent = "Confirmer la suppression"; setTimeout(() => { delete del.dataset.armed; del.textContent = "Supprimer"; }, 4000);
  });
}
