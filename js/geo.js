// French departments and regions, to build department / region lists and to recognise where a sighting is.
import { norm } from "./util.js";

export const REGIONS = {
  ARA: "Auvergne-Rhône-Alpes", BFC: "Bourgogne-Franche-Comté", BRE: "Bretagne", CVL: "Centre-Val de Loire", COR: "Corse", GES: "Grand Est",
  HDF: "Hauts-de-France", IDF: "Île-de-France", NOR: "Normandie", NAQ: "Nouvelle-Aquitaine", OCC: "Occitanie", PDL: "Pays de la Loire", PAC: "Provence-Alpes-Côte d'Azur",
};
// INSEE region codes, as returned by geo.api.gouv.fr
export const REGION_INSEE = { "84": "ARA", "27": "BFC", "53": "BRE", "24": "CVL", "94": "COR", "44": "GES", "32": "HDF", "11": "IDF", "28": "NOR", "75": "NAQ", "76": "OCC", "52": "PDL", "93": "PAC" };
const D = `01 Ain ARA|02 Aisne HDF|03 Allier ARA|04 Alpes-de-Haute-Provence PAC|05 Hautes-Alpes PAC|06 Alpes-Maritimes PAC|07 Ardèche ARA|08 Ardennes GES|09 Ariège OCC|10 Aube GES|11 Aude OCC|12 Aveyron OCC|13 Bouches-du-Rhône PAC|14 Calvados NOR|15 Cantal ARA|16 Charente NAQ|17 Charente-Maritime NAQ|18 Cher CVL|19 Corrèze NAQ|2A Corse-du-Sud COR|2B Haute-Corse COR|21 Côte-d'Or BFC|22 Côtes-d'Armor BRE|23 Creuse NAQ|24 Dordogne NAQ|25 Doubs BFC|26 Drôme ARA|27 Eure NOR|28 Eure-et-Loir CVL|29 Finistère BRE|30 Gard OCC|31 Haute-Garonne OCC|32 Gers OCC|33 Gironde NAQ|34 Hérault OCC|35 Ille-et-Vilaine BRE|36 Indre CVL|37 Indre-et-Loire CVL|38 Isère ARA|39 Jura BFC|40 Landes NAQ|41 Loir-et-Cher CVL|42 Loire ARA|43 Haute-Loire ARA|44 Loire-Atlantique PDL|45 Loiret CVL|46 Lot OCC|47 Lot-et-Garonne NAQ|48 Lozère OCC|49 Maine-et-Loire PDL|50 Manche NOR|51 Marne GES|52 Haute-Marne GES|53 Mayenne PDL|54 Meurthe-et-Moselle GES|55 Meuse GES|56 Morbihan BRE|57 Moselle GES|58 Nièvre BFC|59 Nord HDF|60 Oise HDF|61 Orne NOR|62 Pas-de-Calais HDF|63 Puy-de-Dôme ARA|64 Pyrénées-Atlantiques NAQ|65 Hautes-Pyrénées OCC|66 Pyrénées-Orientales OCC|67 Bas-Rhin GES|68 Haut-Rhin GES|69 Rhône ARA|70 Haute-Saône BFC|71 Saône-et-Loire BFC|72 Sarthe PDL|73 Savoie ARA|74 Haute-Savoie ARA|75 Paris IDF|76 Seine-Maritime NOR|77 Seine-et-Marne IDF|78 Yvelines IDF|79 Deux-Sèvres NAQ|80 Somme HDF|81 Tarn OCC|82 Tarn-et-Garonne OCC|83 Var PAC|84 Vaucluse PAC|85 Vendée PDL|86 Vienne NAQ|87 Haute-Vienne NAQ|88 Vosges GES|89 Yonne BFC|90 Territoire de Belfort BFC|91 Essonne IDF|92 Hauts-de-Seine IDF|93 Seine-Saint-Denis IDF|94 Val-de-Marne IDF|95 Val-d'Oise IDF`;
export const DEPTS = D.split("|").map((s) => { const m = s.match(/^(\S+) (.+) (\w{3})$/); return { code: m[1], nom: m[2], reg: m[3] }; });
export const DEPT = new Map(DEPTS.map((d) => [d.code, d]));
const BY_NAME = new Map(DEPTS.map((d) => [norm(d.nom), d.code]));
export const deptByName = (name) => BY_NAME.get(norm(name)) || null;
export const deptsOfRegion = (reg) => DEPTS.filter((d) => d.reg === reg).map((d) => d.code);

// "Grand Parc (Meyzieu, 69)" -> "69": the department code the app's place names end with
export function deptFromPlace(l) {
  const m = String(l || "").match(/,\s*(\d{2}|2[AB])\)\s*$/); if (m && DEPT.has(m[1])) return m[1];
  const z = String(l || "").match(/\b(\d{2})\d{3}\b/); return z && DEPT.has(z[1]) ? z[1] : null;
}
export function communeFromPlace(l) { const m = String(l || "").match(/\(([^()]+),\s*(\d{2}|2[AB])\)\s*$/); return m ? m[1].trim() : null; }

// where a point is: French commune and department (geo.api.gouv.fr), or the country elsewhere (OpenStreetMap Nominatim)
const OVERSEAS = { "971": "Guadeloupe", "972": "Martinique", "973": "Guyane", "974": "La Réunion", "976": "Mayotte" };
const CACHE = new Map();
export async function whereIs(lat, lon) {
  const k = `${lat.toFixed(4)},${lon.toFixed(4)}`; if (CACHE.has(k)) return CACHE.get(k);
  let out = null;
  try {
    const r = await fetch(`https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lon}&fields=nom,codeDepartement,codeRegion&format=json`);
    const j = (await r.json())[0];
    if (j) out = OVERSEAS[j.codeDepartement] ? { fr: false, pays: OVERSEAS[j.codeDepartement], commune: j.nom } : { fr: true, commune: j.nom, dep: j.codeDepartement, reg: REGION_INSEE[j.codeRegion] || null };
  } catch (_) { return null; } // no network: no check
  if (!out) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=5&accept-language=fr&lat=${lat}&lon=${lon}`);
      const j = await r.json();
      if (j && j.address && j.address.country) out = j.address.country_code === "fr" ? { fr: true, commune: null, dep: null, reg: null } : { fr: false, pays: j.address.country, cc: j.address.country_code };
      else out = { fr: false, pays: null, mer: true };
    } catch (_) { return null; }
  }
  CACHE.set(k, out); return out;
}
// does a list (with its geography) contain a sighting in this commune / department?
export function listCovers(l, { dep, commune }) {
  if (l.communes && commune && l.communes.some((c) => norm(c) === norm(commune))) return true;
  if (l.deps && dep && l.deps.includes(dep)) return true;
  return false;
}

// a list tied to one spot (jardin, bureau): its place on a given date; the spot can move, each move has a start date
export function placeAt(l, d) {
  const ps = (l && l.lieux || []).slice().sort((a, b) => (a.depuis || "").localeCompare(b.depuis || ""));
  if (!ps.length) return null;
  let cur = ps[0]; for (const p of ps) if (!p.depuis || (d && p.depuis <= d)) cur = p;
  return cur;
}
export function distKm(a, b) {
  const R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h));
}

// is a point outside a list's area? returns a short reason, or "" when it fits (or when nothing can be said)
export function outsideOf(l, w, pt, date) {
  if (!l) return "";
  const fixed = placeAt(l, date);
  if (fixed && pt && pt.lat != null) { const d = distKm(fixed, pt); return d > (l.rayon || 300) / 1000 ? `point à ${d < 10 ? d.toFixed(1) : Math.round(d)} km de ${fixed.nom || l.nom}` : ""; }
  if (!w) return "";
  if (l.pays === "France") return w.fr ? "" : w.pays ? `point en ${w.pays}` : "point hors de France";
  if (l.type === "pays") return w.fr ? "point en France" : w.pays && norm(w.pays) !== norm(l.nom) ? `point en ${w.pays}` : "";
  if (l.deps || l.communes) {
    if (!w.fr) return w.pays ? `point en ${w.pays}` : "point hors de France";
    if (!w.dep) return "";
    if (listCovers(l, w)) return "";
    const d = DEPT.get(w.dep); return `point à ${w.commune || "?"} (${d ? d.nom : w.dep})`;
  }
  return "";
}

// every country name, in French, for the country lists
export function allCountries() {
  let dn; try { dn = new Intl.DisplayNames(["fr"], { type: "region" }); } catch (_) { return []; }
  const out = new Set(), A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const a of A) for (const b of A) { try { const n = dn.of(a + b); if (n && n !== a + b && !/inconnue|^\d/i.test(n)) out.add(n); } catch (_) {} }
  out.delete("France"); return [...out].sort((x, y) => x.localeCompare(y, "fr"));
}

// ---------- lieux-dits (IGN BD TOPO, public WFS of the Géoplateforme) ----------
// named places around a point: lieux-dits (inhabited or not), ponds and lakes, marshes, bays, capes, valleys…
// A point inside a named pond gets the pond; otherwise the nearest name within 1.5 km.
const LD_LAYERS = ["lieu_dit_non_habite", "zone_d_habitation", "plan_d_eau", "detail_hydrographique", "detail_orographique"];
const LD_SKIP = new Set(["Ile", "Île", "Montagne", "Plaine", "Massif"]);
const ringsOf = (g) => g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map((p) => p[0]) : [];
const inRing = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(u) { // the service refuses bursts: retry a little later
  for (let k = 0; k < 3; k++) { try { const r = await fetch(u); if (r.ok) return await r.json(); } catch (_) {} await sleep(600 * (k + 1)); }
  return null;
}
// commune: its own name is skipped (the town itself), so that a finer name wins
export async function lieuDit(lat, lon, commune) {
  const d = 0.015, bbox = `${lat - d},${lon - d},${lat + d},${lon + d},urn:ogc:def:crs:EPSG::4326`;
  const all = []; let ok = 0;
  for (const layer of LD_LAYERS) {
    const j = await getJson(`https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:${layer}&outputFormat=application/json&COUNT=200&BBOX=${bbox}`);
    if (j) { ok++; (j.features || []).forEach((f) => all.push({ layer, f })); }
  }
  if (!ok) return null; // no network
  let best = null;
  for (const { layer, f } of all) {
    const name = f.properties && f.properties.toponyme, g = f.geometry; if (!name || !g || LD_SKIP.has(f.properties.nature) || (commune && norm(name) === norm(commune))) continue;
    let km;
    if (g.type === "Point") km = distKm({ lat, lon }, { lat: g.coordinates[1], lon: g.coordinates[0] });
    else { const rs = ringsOf(g); if (!rs.length) continue; km = rs.some((r) => inRing(r, lon, lat)) ? 0 : Math.min(...rs.flat().map(([x, y]) => distKm({ lat, lon }, { lat: y, lon: x }))); }
    const score = km - (layer === "plan_d_eau" && km === 0 ? 1 : 0); // inside a pond: the pond wins
    if (km <= 1.5 && (!best || score < best.score)) best = { name: name.charAt(0).toUpperCase() + name.slice(1), km, score, nature: f.properties.nature };
  }
  return best || false;
}
