// Managing lists: create a department, region, place or country list (optionally filled from existing ticks), edit one.
import { $, $$, esc, norm, slug, uid, plural, isFrance, toast } from "./util.js";
import { S, M, go } from "./app.js";
import { PHOTO_FR, LIFERS } from "./model.js";
import { DEPTS, DEPT, REGIONS, deptsOfRegion, deptFromPlace, communeFromPlace, listCovers, whereIs, placeAt, allCountries } from "./geo.js";
import { mapPicker } from "./map.js";
import { fmtShort } from "./util.js";

const TYPES = { dep: "Département", reg: "Région", lieu: "Lieu précis (réserve, étang…)", pays: "Pays", autre: "Autre" };

export function screenLists(view) {
  const ls = M.listes.filter((l) => l.type !== "annee");
  const geo = (l) => l.region ? REGIONS[l.region] : l.deps ? l.deps.map((d) => (DEPT.get(d) || { nom: d }).nom).join(", ") : l.communes ? l.communes.join(", ") : l.type === "pays" ? "pays" : "";
  view.innerHTML = `<div class="screen"><header class="phead"><a class="back" href="#/plus">← Plus</a><h1>Mes listes</h1></header>
    <ul class="plain">${ls.map((l) => `<li class="lrow"><span class="sw" style="background:${M.color(l.cle)}"></span><span class="grow"><b>${esc(l.nom)}</b> <small class="cap">${M.count(l.cle)} espèces${l.dans ? " · dans " + esc(M.liste.get(l.dans).nom) : ""}${geo(l) ? " · " + esc(geo(l)) : ""}${l.numerotee ? " · numérotée" : ""}</small></span><button class="btn" type="button" data-edit="${l.cle}">Modifier</button></li>`).join("")}</ul>
    <div id="edit"></div>
    <button class="btn btn-primary" type="button" id="new">Nouvelle liste</button></div>`;
  $$("[data-edit]").forEach((b) => b.addEventListener("click", () => editForm($("#edit"), M.liste.get(b.dataset.edit))));
  $("#new").addEventListener("click", () => editForm($("#edit"), null));
}

function parentOptions(sel, self) {
  const ok = M.listes.filter((l) => l.type !== "annee" && l.cle !== (self && self.cle) && !(self && M.chain(l.cle).includes(self.cle)));
  return `<option value="">— aucune —</option>${ok.map((l) => `<option value="${l.cle}" ${sel === l.cle ? "selected" : ""}>${esc(l.nom)}</option>`).join("")}`;
}

function editForm(el, l) {
  const isNew = !l;
  const st = l ? { ...l, kind: l.region ? "reg" : l.deps ? "dep" : l.type === "pays" ? "pays" : l.type === "lieu" || l.communes ? "lieu" : "autre" } : { kind: "dep", nom: "", dans: PHOTO_FR, numerotee: false };
  el.innerHTML = `<form class="panel" id="lf"><h3 class="minor" style="margin:0">${isNew ? "Nouvelle liste" : "Modifier « " + esc(l.nom) + " »"}</h3>
    ${isNew ? `<label>Type<select class="field" id="l-kind">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${st.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>` : ""}
    <label id="l-dep-w">Département<select class="field" id="l-dep">${DEPTS.map((d) => `<option value="${d.code}">${d.code} · ${esc(d.nom)}</option>`).join("")}</select></label>
    <label id="l-reg-w">Région<select class="field" id="l-reg">${Object.entries(REGIONS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></label>
    <label>Nom<input class="field" id="l-nom" value="${esc(st.nom || "")}" required list="dl-countries" autocomplete="off"></label>
    <datalist id="dl-countries">${[...new Set([...M.ticks.map((t) => t.p).filter(Boolean), ...allCountries()])].map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
    <label>Comprise dans<select class="field" id="l-dans">${parentOptions(st.dans, l)}</select></label>
    <div class="row2"><label>Couleur<input class="field" type="color" id="l-col" value="${esc(l ? M.color(l.cle) : "#3B7A57")}"></label>
      <label class="chk" style="align-self:end"><input type="checkbox" id="l-num" ${st.numerotee ? "checked" : ""}> Numéroter les coches</label></div>
    <div id="l-fixed-w"><span class="lab">Lieu <small>(repris tout seul à chaque coche ; ajoute un lieu à chaque déménagement)</small></span>
      <label>Rayon autour du lieu, en mètres <small>(une coche plus loin est signalée ; un import date les coches dans ce rayon)</small><input class="field" type="number" min="50" step="50" id="l-rayon" value="${esc(st.rayon || 300)}" style="max-width:140px"></label>
      <ul class="plain" id="l-fixed"></ul>
      <div id="l-addp"></div>
      <div class="row"><button class="btn" type="button" id="p-new">Ajouter un lieu</button></div>
      ${!isNew ? `<label class="chk"><input type="checkbox" id="l-apply" checked> Placer les coches de cette liste qui n'ont pas de coordonnées, et la même observation dans les autres listes</label>` : ""}</div>
    ${isNew ? `<label class="chk"><input type="checkbox" id="l-fill" checked> Remplir avec les coches que j'ai déjà dans ce secteur</label><p class="cap" id="l-prev"></p>` : ""}
    <div class="row"><button class="btn btn-primary" type="submit">${isNew ? "Créer la liste" : "Enregistrer"}</button><button class="btn" type="button" id="l-cancel">Annuler</button></div></form>`;
  const kindSel = $("#l-kind"), depSel = $("#l-dep"), regSel = $("#l-reg"), nomIn = $("#l-nom"), dansSel = $("#l-dans");
  if (l && l.deps && l.deps.length === 1) depSel.value = l.deps[0];
  if (l && l.region) regSel.value = l.region;
  let autoName = isNew;
  nomIn.addEventListener("input", () => { autoName = false; });
  const regionList = (reg) => M.listes.find((x) => x.region === reg);
  const sync = () => {
    const k = kindSel ? kindSel.value : st.kind;
    $("#l-dep-w").hidden = k !== "dep"; $("#l-reg-w").hidden = k !== "reg"; if (k === "pays") nomIn.setAttribute("list", "dl-countries"); else nomIn.removeAttribute("list");
    if (autoName) nomIn.value = k === "dep" ? DEPT.get(depSel.value).nom : k === "reg" ? REGIONS[regSel.value] : "";
    if (isNew) { // sensible container: the region list of the department, or Photo France
      if (k === "dep") { const r = regionList(DEPT.get(depSel.value).reg); dansSel.value = r ? r.cle : PHOTO_FR; }
      else if (k === "reg") dansSel.value = PHOTO_FR; else if (k === "pays") dansSel.value = "";
      preview();
    }
  };
  const geoOf = () => { const k = kindSel ? kindSel.value : st.kind; return k === "dep" ? { deps: [depSel.value] } : k === "reg" ? { deps: deptsOfRegion(regSel.value), region: regSel.value } : {}; };
  let found = null;
  function candidates() {
    const k = kindSel.value, g = geoOf(), nom = nomIn.value.trim();
    const best = new Map(); let noPhoto = 0;
    for (const t of M.ticks) {
      if (t.cle.startsWith("yl") && !t.d) continue;
      let inside = false;
      if (k === "pays") inside = !isFrance(t.p) && norm(t.p) === norm(nom);
      else if (g.deps && isFrance(t.p)) { const dep = deptFromPlace(t.l) || (M.liste.get(t.cle).deps && M.liste.get(t.cle).deps.length === 1 ? M.liste.get(t.cle).deps[0] : null) || (t.cle === "ouessant" ? "29" : null); inside = !!dep && g.deps.includes(dep); }
      if (!inside) continue;
      const cur = best.get(t.e); if (!cur || (t.d && (!cur.d || t.d < cur.d))) best.set(t.e, t);
    }
    const out = [];
    for (const [e, t] of best) { if (k !== "pays" && !M.inList(e, PHOTO_FR)) { noPhoto++; continue; } out.push(t); }
    return { ticks: out, noPhoto };
  }
  function preview() {
    const p = $("#l-prev"); if (!p) return;
    const k = kindSel.value; if (!["dep", "reg", "pays"].includes(k)) { p.textContent = "Ce type de liste se remplit à la main, coche par coche."; found = null; return; }
    found = candidates();
    p.textContent = `${found.ticks.length} ${plural(found.ticks.length, "espèce")} trouvée${found.ticks.length > 1 ? "s" : ""} dans tes coches, avec la date et le lieu de la première fois.${found.noPhoto ? ` ${found.noPhoto} autre${found.noPhoto > 1 ? "s" : ""} vue${found.noPhoto > 1 ? "s" : ""} là mais sans photo France, laissée${found.noPhoto > 1 ? "s" : ""} de côté.` : ""} Le département est lu dans le nom du lieu, par exemple « (Meyzieu, 69) ».`;
  }
  [kindSel, depSel, regSel].forEach((x) => x && x.addEventListener("change", () => { autoName = isNew; sync(); }));
  nomIn.addEventListener("change", () => isNew && preview());
  sync();
  // fixed places (one per period)
  st.lieux = (st.lieux || []).slice();
  const showFixed = () => { $("#l-fixed").innerHTML = st.lieux.slice().sort((a, b) => (a.depuis || "").localeCompare(b.depuis || "")).map((p) => `<li class="lrow"><span class="grow"><b>${esc(p.nom || "Sans nom")}</b><small class="cap">${p.depuis ? "depuis le " + fmtShort(p.depuis) : "depuis toujours"} · ${p.lat}, ${p.lon}</small></span><button class="linkish" type="button" data-rmp="${st.lieux.indexOf(p)}">retirer</button></li>`).join("") || '<li class="cap">Aucun lieu fixe.</li>';
    $$("[data-rmp]").forEach((b) => b.addEventListener("click", () => { st.lieux.splice(+b.dataset.rmp, 1); showFixed(); })); };
  const kindNow = () => (kindSel ? kindSel.value : st.kind);
  // only the garden and the office have a fixed spot
  const fixedOk = () => (isNew ? kindNow() === "lieu" : ["jardin", "bureau"].includes(l.cle) || l.type === "lieu");
  $("#l-fixed-w").hidden = !fixedOk(); if (kindSel) kindSel.addEventListener("change", () => { $("#l-fixed-w").hidden = !fixedOk(); });
  showFixed();
  // the form for a new spot is built only when asked for, so its map is created while visible
  let np = null, pmap = null;
  $("#p-new").addEventListener("click", () => {
    $("#l-addp").innerHTML = `<div class="panel"><div class="row2"><label>Depuis le <small>(vide = depuis toujours)</small><input class="field" type="date" id="p-depuis"></label><label>Nom du lieu<input class="field" id="p-nom" placeholder="Maison, Bureau IVECO…"></label></div>
      <div class="mapbox" id="p-map"></div><p class="cap" id="p-coords">Touche la carte, ou ◎ pour ta position.</p>
      <div class="row"><button class="btn btn-primary" type="button" id="p-ok">Ajouter ce lieu</button><button class="btn" type="button" id="p-x">Annuler</button></div></div>`;
    $("#p-new").style.display = "none"; np = { lat: null, lon: null };
    pmap = mapPicker($("#p-map"), {}, (lat, lon) => { if (lat == null) { toast("Position refusée ou introuvable."); return; } np.lat = lat; np.lon = lon; $("#p-coords").textContent = `${lat}, ${lon}`; });
    const close = () => { if (pmap) pmap.destroy(); pmap = null; $("#l-addp").innerHTML = ""; $("#p-new").style.display = ""; };
    $("#p-x").addEventListener("click", close);
    $("#p-ok").addEventListener("click", () => {
      if (np.lat == null) { toast("Place le point sur la carte."); return; }
      st.lieux.push({ depuis: $("#p-depuis").value || null, nom: $("#p-nom").value.trim() || nomIn.value.trim(), lat: np.lat, lon: np.lon });
      st.lieux.forEach((p) => { if (!p.depuis) delete p.depuis; });
      close(); showFixed();
    });
  });
  $("#l-cancel").addEventListener("click", () => { el.innerHTML = ""; });
  $("#lf").addEventListener("submit", (e) => {
    e.preventDefault();
    const nom = nomIn.value.trim(); if (!nom) return;
    const base = { nom, dans: dansSel.value || null, couleur: $("#l-col").value, numerotee: $("#l-num").checked || null };
    if (!isNew) {
      if (base.dans && M.chain(base.dans).includes(l.cle)) { toast("Une liste ne peut pas être dans une de ses sous-listes."); return; }
      const ops = [{ kind: "set-liste", cle: l.cle, patch: { ...base, lieux: st.lieux.length ? st.lieux : null, rayon: fixedOk() && +$("#l-rayon").value && +$("#l-rayon").value !== 300 ? +$("#l-rayon").value : null, ...(st.kind === "dep" ? { deps: [depSel.value] } : st.kind === "reg" ? { deps: deptsOfRegion(regSel.value), region: regSel.value } : {}) } }];
      if (st.lieux.length && $("#l-apply") && $("#l-apply").checked) {
        const L2 = { ...l, lieux: st.lieux };
        for (const t of M.ticks.filter((x) => x.cle === l.cle && x.lat == null)) {
          const f = placeAt(L2, t.d), patch = { l: f.nom || null, lat: f.lat, lon: f.lon, p: null, sl: "fixe" };
          ops.push({ kind: "set-tick", cle: t.cle, id: t.id, patch });
          if (t.d) M.ticks.filter((x) => x.e === t.e && x.d === t.d && x !== t).forEach((x) => ops.push({ kind: "set-tick", cle: x.cle, id: x.id, patch }));
        }
      }
      S.apply(ops, `Liste modifiée : ${nom}${ops.length > 1 ? ` (${ops.length - 1} coches placées)` : ""}`);
      toast("Liste modifiée."); el.innerHTML = ""; return;
    }
    const k = kindSel.value;
    let cle = slug(nom), i = 2; while (M.liste.has(cle) || /^yl\d{4}$/.test(cle)) cle = slug(nom) + "-" + i++;
    const liste = { cle, ...base, type: k === "pays" ? "pays" : k === "lieu" ? "lieu" : "zone", ...geoOf(), ...(st.lieux.length && fixedOk() ? { lieux: st.lieux } : {}) };
    Object.keys(liste).forEach((x) => liste[x] == null && delete liste[x]);
    const ops = [{ kind: "add-liste", liste }];
    if ($("#l-fill").checked && found && found.ticks.length) {
      found.ticks.slice().sort((a, b) => (a.d || "9").localeCompare(b.d || "9")).forEach((t, n) => {
        const tick = { id: `${cle}-${uid()}`, e: t.e }; ["d", "l", "p", "lat", "lon", "sd", "sl"].forEach((f) => { if (t[f] != null && t[f] !== "") tick[f] = t[f]; });
        if (liste.numerotee) tick.n = n + 1; ops.push({ kind: "add-tick", cle, tick });
      });
    }
    S.apply(ops, `Nouvelle liste : ${nom}${ops.length > 1 ? ` (${ops.length - 1} coches)` : ""}`);
    toast(`Liste « ${nom} » créée${ops.length > 1 ? ` avec ${ops.length - 1} espèces` : ""}.`);
    go(`#/liste/${cle}`);
  });
}
