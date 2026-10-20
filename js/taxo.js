// Recognising a species from another source (Faune-France, eBird, cocheurs).
// The Latin name is the reference, because common names differ between sources (eBird is in English,
// Faune-France and cocheurs use their own French names). Latin names change too: genera are split or merged
// (Sylvia -> Curruca, Parus -> Cyanistes…) and endings follow the genus (communis / commune), so the matching
// accepts the other Latin names recorded for a species (scs), then a same species name in a related genus.
import { norm } from "./util.js";

// genera that were split from or merged with one another in recent checklists
const GROUPS = [
  "sylvia curruca", "parus cyanistes periparus poecile lophophanes melaniparus", "carduelis spinus chloris linaria acanthis serinus crithagra",
  "larus chroicocephalus ichthyaetus hydrocoloeus leucophaeus rissa", "porzana zapornia mustelirallus laterallus", "anas spatula mareca sibirionetta",
  "sterna sternula thalasseus gelochelidon hydroprogne onychoprion", "egretta ardea casmerodius bubulcus mesophoyx", "philomachus calidris limicola tryngites aphriza",
  "miliaria emberiza", "hirundo cecropis ptyonoprogne petrochelidon", "oceanodroma hydrobates", "puffinus ardenna calonectris",
  "phalacrocorax gulosus microcarbo leucocarbo", "charadrius anarhynchus thinornis ochthodromus", "tetrao lyrurus", "bonasa tetrastes",
  "carpodacus erythrina", "corvus coloeus", "picoides dendrocopos dryobates leiopicus dendrocoptes veniliornis", "seicercus phylloscopus rhadina",
  "hippolais iduna acrocephalus", "locustella helopsaltes", "calandrella alaudala", "accipiter astur tachyspiza", "aquila hieraaetus clanga",
  "buteogallus rupornis geranoaetus leucopternis pseudastur", "otus megascops", "bubo nyctea", "tringa xenus actitis", "anthropoides grus",
  "parula setophaga dendroica oporornis geothlypis", "thraupis tangara stilpnia ixothraupis", "oryzoborus sporophila", "aratinga eupsittula psittacara",
  "amazilia saucerottia chrysuronia chionomesa hylocharis", "columba patagioenas", "nycticorax nyctanassa", "ixobrychus botaurus",
];
const GROUP = new Map(); GROUPS.forEach((g) => g.split(" ").forEach((x) => GROUP.set(x, g)));
const related = (a, b) => a === b || (GROUP.has(a) && GROUP.get(a) === GROUP.get(b));
// Latin species names agree with their genus: communis / commune / communa, so compare the stem
const stem = (ep) => ep.replace(/(us|um|a|is|e|os|on)$/, "");

export function makeMatcher(especes) {
  const bySc = new Map(), byName = new Map(), byEpithet = new Map();
  const add = (map, k, id) => { if (k && !map.has(k)) map.set(k, id); };
  // the main Latin name first; other Latin names (scs) only as written, so a subspecies kept apart
  // (Numenius phaeopus hudsonicus) does not take over its species (Numenius phaeopus)
  for (const e of especes) if (e.sc) { const w = norm(e.sc).split(" "); add(bySc, w.join(" "), e.id); add(bySc, w.slice(0, 2).join(" "), e.id); }
  for (const e of especes) for (const sc of e.scs || []) add(bySc, norm(sc), e.id);
  for (const e of especes) {
    for (const sc of [e.sc, ...(e.scs || [])].filter(Boolean)) { const w = norm(sc).split(" "); if (w[1]) { const k = stem(w[1]); if (!byEpithet.has(k)) byEpithet.set(k, []); byEpithet.get(k).push({ genus: w[0], id: e.id }); } }
    add(byName, norm(e.n), e.id); (e.al || []).forEach((a) => add(byName, norm(a), e.id));
  }
  return (name, sci) => {
    const raw = String(sci || "");
    if (/\bspp?\.?(\s|$)|\s[x×]\s|\//i.test(raw)) return null; // "Larus sp.", hybrids, "A / B": no single species
    const w = norm(raw).replace(/\b(ssp|subsp|var)\b/g, " ").split(" ").filter(Boolean);
    if (w.length >= 2) {
      // 1. the Latin name, with its subspecies when there is one, then without
      // (a subspecies may be a species of its own here: Phylloscopus collybita tristis = Phylloscopus tristis)
      const hit = (w.length > 2 && (bySc.get(w.slice(0, 3).join(" ")) || bySc.get(`${w[0]} ${w[2]}`))) || bySc.get(w.slice(0, 2).join(" "));
      if (hit) return { id: hit, how: "latin" };
      // 2. same species name in a related genus (Sylvia communis = Curruca communis)
      const c = (byEpithet.get(stem(w[1])) || []).filter((x) => related(x.genus, w[0]));
      const ids = [...new Set(c.map((x) => x.id))];
      if (ids.length === 1) return { id: ids[0], how: "genre" };
    }
    // 3. the common name, or one of the other names saved for the species
    const n = norm(String(name || "").replace(/\(.*?\)/g, ""));
    const byN = byName.get(n) || byName.get(norm(name));
    if (byN) return { id: byN, how: "nom" };
    return null;
  };
}
