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

// where a point is (France only), from the public French API, cached per point
const CACHE = new Map();
export async function whereIs(lat, lon) {
  const k = `${lat.toFixed(4)},${lon.toFixed(4)}`; if (CACHE.has(k)) return CACHE.get(k);
  try {
    const r = await fetch(`https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lon}&fields=nom,codeDepartement,codeRegion&format=json`, { cache: "force-cache" });
    const j = (await r.json())[0] || null;
    const out = j ? { commune: j.nom, dep: j.codeDepartement, reg: REGION_INSEE[j.codeRegion] || null } : null;
    CACHE.set(k, out); return out;
  } catch (_) { return null; }
}

// does a list (with its geography) contain a sighting in this commune / department?
export function listCovers(l, { dep, commune }) {
  if (l.communes && commune && l.communes.some((c) => norm(c) === norm(commune))) return true;
  if (l.deps && dep && l.deps.includes(dep)) return true;
  return false;
}
