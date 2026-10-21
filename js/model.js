// Everything the screens show is derived here from the raw database (lists, species, ticks).
import { norm, isFrance, yearOf, distanceInText, maxErrors } from "./util.js";
import { deptFromPlace, communeFromPlace, placeAt, distKm } from "./geo.js";

export const PHOTO_FR = "photo-france", LIFERS = "lifers", VU = "vu";
const byDate = (a, b) => ((a.d ? 0 : 1) - (b.d ? 0 : 1)) || (a.d || "").localeCompare(b.d || "") || ((a.n || 0) - (b.n || 0));

export function buildModel(db) {
  const M = { db };
  M.listes = db.listes.slice();
  M.liste = new Map(M.listes.map((l) => [l.cle, l]));
  M.children = new Map(); M.listes.forEach((l) => { if (l.dans) { if (!M.children.has(l.dans)) M.children.set(l.dans, []); M.children.get(l.dans).push(l.cle); } });
  M.esp = new Map(db.especes.map((e) => [e.id, e]));
  M.years = M.listes.filter((l) => l.type === "annee").map((l) => l.annee).sort((a, b) => a - b);

  // ticks, each knowing its list
  M.ticks = [];
  M.bySp = new Map(); // sid -> Map(cle -> [ticks])
  for (const l of M.listes) for (const t of db.coches[l.cle] || []) {
    const x = { ...t, cle: l.cle };
    M.ticks.push(x);
    if (!M.bySp.has(t.e)) M.bySp.set(t.e, new Map());
    const m = M.bySp.get(t.e); if (!m.has(l.cle)) m.set(l.cle, []); m.get(l.cle).push(x);
  }
  M.bySp.forEach((m) => m.forEach((a) => a.sort(byDate)));
  M.inList = (sid, cle) => !!(M.bySp.get(sid) && M.bySp.get(sid).has(cle));
  M.tick = (sid, cle) => (M.bySp.get(sid) && M.bySp.get(sid).get(cle) || [])[0] || null;
  M.name = (sid) => (M.esp.get(sid) || {}).n || sid;
  M.chain = (cle) => { const out = []; let c = cle; const seen = new Set(); while (c && !seen.has(c)) { seen.add(c); out.push(c); c = (M.liste.get(c) || {}).dans; } return out; };
  M.descendants = (cle) => { const out = []; const walk = (c) => (M.children.get(c) || []).forEach((k) => { out.push(k); walk(k); }); walk(cle); return out; };

  // species of a list, one entry per species (its first tick)
  M.speciesOf = (cle) => {
    const seen = new Map();
    for (const t of (db.coches[cle] || []).slice().sort(byDate)) if (!seen.has(t.e)) seen.set(t.e, { ...t, cle });
    return [...seen.values()];
  };
  M.count = (cle) => new Set((db.coches[cle] || []).map((t) => t.e)).size;
  M.nextNum = (cle) => Math.max(0, ...(db.coches[cle] || []).map((t) => t.n || 0)) + 1;

  // year list: first tick of each species in the year, in France only or anywhere
  M.yearList = (year, scope) => {
    const l = M.liste.get("yl" + year); if (!l) return [];
    const ticks = (db.coches[l.cle] || []).filter((t) => scope === "monde" || isFrance(t.p)).slice().sort(byDate);
    const seen = new Set(), out = [];
    for (const t of ticks) if (!seen.has(t.e)) { seen.add(t.e); out.push({ ...t, cle: l.cle }); }
    return out.map((t, i) => ({ ...t, rank: i + 1 }));
  };

  // seen or heard without a photo: still open until the species is photographed (in France for a French sighting)
  M.vuOpen = () => {
    const fr = [], ab = [];
    for (const t of M.speciesOf(VU)) {
      if (isFrance(t.p)) { if (!M.inList(t.e, PHOTO_FR)) fr.push(t); }
      else if (!M.inList(t.e, LIFERS)) ab.push(t);
    }
    return { fr, ab };
  };

  // a number for every tick: the one noted for numbered lists, otherwise its rank by date in the list
  // (a species counts once: its later ticks in the same list, e.g. abroad after France in a year list, get none)
  M.rank = new Map();
  for (const l of M.listes) {
    const ts = (db.coches[l.cle] || []).slice().sort(byDate), seen = new Set(); let i = 0;
    for (const t of ts) { const k = l.cle + "/" + t.id; if (l.numerotee) { if (t.n) M.rank.set(k, t.n); continue; } if (seen.has(t.e)) continue; seen.add(t.e); M.rank.set(k, ++i); }
  }
  M.rankOf = (t) => M.rank.get(t.cle + "/" + t.id) || "";
  const PALETTE = ["#24427F", "#0A7895", "#2F8F5B", "#6E8B1E", "#B7791F", "#8A5A9E", "#C2410C", "#B8326E", "#1D6FA5", "#7A5C2E", "#4B7F8C", "#9A3B3B"];
  M.color = (cle) => { const l = M.liste.get(cle) || {}; return l.couleur || (l.type === "annee" ? "#9A7400" : PALETTE[Math.max(0, M.listes.indexOf(l)) % PALETTE.length]); };

  // search index (names and other names)
  M.index = db.especes.map((e) => ({ e, keys: [norm(e.n), ...(e.al || []).map(norm), norm(e.sc), ...(e.scs || []).map(norm)].filter(Boolean) }));
  M.keysOf = new Map(M.index.map((x) => [x.e.id, x.keys]));
  M.search = (q, limit = 12) => {
    const k = norm(q); if (!k) return [];
    const words = k.split(" "), max = maxErrors(k);
    const scored = [];
    for (const { e, keys } of M.index) {
      let best = -1;
      for (const key of keys) {
        if (key === k) best = Math.max(best, 100);
        else if (key.startsWith(k)) best = Math.max(best, 80);
        else if (key.replace(/ /g, "").startsWith(k.replace(/ /g, ""))) best = Math.max(best, 75); // "rouge gorge" = "rougegorge"
        else if (words.every((w) => key.split(" ").some((p) => p.startsWith(w)))) best = Math.max(best, 60);
        else if (key.includes(k)) best = Math.max(best, 40);
        else if (max) { const d = distanceInText(k, key); if (d <= max) best = Math.max(best, 30 - 4 * d); } // typos
      }
      if (best >= 0) scored.push({ e, s: best + (M.bySp.has(e.id) ? 10 : 0) });
    }
    return scored.sort((a, b) => b.s - a.s || a.e.n.localeCompare(b.e.n, "fr")).slice(0, limit).map((x) => x.e);
  };
  // the same matching for a whole text (journal, list filters)
  // a species by any of its names: French name, other names, Latin names
  M.matchesSp = (k, sid) => !k || (M.keysOf.get(sid) || []).some((key) => M.matches(k, key));
  M.matches = (k, text) => { if (!k) return true; const t = norm(text); if (t.includes(k)) return true; const max = maxErrors(k); return max > 0 && distanceInText(k, t) <= max; };

  // Photo France ticks by calendar day, all years together
  M.calendar = () => {
    const days = new Map();
    for (const t of db.coches[PHOTO_FR] || []) if (t.d) { const k = t.d.slice(5); if (!days.has(k)) days.set(k, []); days.get(k).push({ ...t, cle: PHOTO_FR }); }
    return days;
  };

  // what is still missing or inconsistent
  M.checks = () => {
    const out = { nested: [], yearMissing: [], undated: [], noCoords: new Map() };
    for (const l of M.listes) if (l.dans) {
      for (const t of M.speciesOf(l.cle)) if (!M.inList(t.e, l.dans)) out.nested.push({ t, liste: l.cle, parent: l.dans });
    }
    for (const t of M.ticks) {
      if (!t.d && !["jardin", "bureau"].includes(t.cle)) out.undated.push(t);
      if (t.lat == null) out.noCoords.set(t.cle, (out.noCoords.get(t.cle) || 0) + 1);
      const y = yearOf(t.d), yl = y && M.liste.get("yl" + y);
      // a year list only counts what counts in photo: in France the species must have its Photo France, abroad its lifer;
      // a tick only seen or heard (Vu/entendu, or « vu » / « entendu » in a trip list) is not a reason
      const counts = t.cle !== VU && !/^(vu|entendu)/i.test(t.t || "") && (isFrance(t.p) ? M.inList(t.e, PHOTO_FR) : M.inList(t.e, LIFERS));
      if (yl && counts && t.cle !== yl.cle && !M.inList(t.e, yl.cle) && !out.yearMissing.some((x) => x.t.e === t.e && x.year === y)) out.yearMissing.push({ t, year: y });
    }
    // ticks placed outside their list's area, judged from the place name ("…, 69)") or the fixed spot
    out.outside = [];
    for (const l of M.listes) for (const t of (db.coches[l.cle] || [])) {
      let why = "";
      if (l.lieux && t.lat != null) { const f = placeAt(l, t.d); const d = f ? distKm(f, t) : 0; if (d > (l.rayon || 300) / 1000) why = `à ${d < 10 ? d.toFixed(1) : Math.round(d)} km de ${f.nom || l.nom}`; }
      else if (l.deps && t.l) { const dep = deptFromPlace(t.l); if (dep && !l.deps.includes(dep)) why = `lieu dans le ${dep}`; }
      else if (l.communes && t.l) { const c = communeFromPlace(t.l); if (c && !l.communes.some((x) => norm(x) === norm(c))) why = `lieu à ${c}`; }
      else if (l.type === "pays" && t.p && norm(t.p) !== norm(l.nom)) why = `pays : ${t.p}`;
      if (!isFrance(t.p) && (l.deps || l.communes || l.pays === "France")) why = `pays : ${t.p}`;
      if (why) out.outside.push({ t: { ...t, cle: l.cle }, why });
    }
    // same species, same day, different places: one observation should have one place
    const PREC = ["jardin", "bureau", "ouessant", "rhone", "aura", "guyane", PHOTO_FR, LIFERS, VU];
    const prec = (cle) => { const i = PREC.indexOf(cle); return i < 0 ? (M.liste.get(cle) && M.liste.get(cle).type === "annee" ? 60 : 20) : i; };
    const days = new Map(); M.ticks.forEach((t) => { if (t.d) { const k = t.e + "|" + t.d; if (!days.has(k)) days.set(k, []); days.get(k).push(t); } });
    out.placeMismatch = [];
    for (const ts of days.values()) {
      if (ts.length < 2) continue;
      const key = (t) => `${t.l || ""}|${t.lat != null ? t.lat.toFixed(5) : ""}|${t.lon != null ? t.lon.toFixed(5) : ""}`;
      if (new Set(ts.map(key)).size < 2) continue;
      const src = ts.slice().sort((a, b) => ((a.lat != null ? 0 : 2) + (a.l ? 0 : 1)) - ((b.lat != null ? 0 : 2) + (b.l ? 0 : 1)) || prec(a.cle) - prec(b.cle))[0];
      if (src.lat == null && !src.l) continue;
      out.placeMismatch.push({ src, others: ts.filter((t) => t !== src && key(t) !== key(src)) });
    }
    // a date that Faune-France / eBird do not have, while they have the species a few days apart: one row per
    // observation (species and day), all its lists together; « garder » marks the ticks (vf = the date checked)
    out.srcDate = [];
    const SRC = Object.entries(db.sources || {}), DAY = 864e5, groups = new Map();
    if (SRC.length) for (const t of M.ticks) {
      if (!t.d || t.cle === VU || /^(vu|entendu)/i.test(t.t || "") || t.vf === t.d) continue;
      let near = null, gap = 41, sameDay = null; // up to 40 days: a slip of one month (02/05 for 02/06) is common
      for (const [src, s] of SRC) for (const x of (s.especes || {})[t.e] || []) {
        const g = Math.abs(Date.parse(x[0]) - Date.parse(t.d)) / DAY, at = { src, d: x[0], l: x[1], lat: x[2], lon: x[3] };
        if (g === 0) { if (!sameDay || at.lat == null || t.lat == null || distKm(at, t) < distKm(sameDay, t)) sameDay = at; }
        else if (g < gap) { gap = g; near = at; }
      }
      // the same day in the source: fine, unless the app puts it more than 10 km from where the source says
      if (sameDay) { if (t.lat == null || sameDay.lat == null || distKm(sameDay, t) <= 20) continue; near = sameDay; gap = 0; }
      if (!near) continue;
      const k = t.e + "|" + t.d + "|" + (gap === 0 ? "lieu" : "date");
      if (!groups.has(k)) groups.set(k, { e: t.e, d: t.d, ticks: [], near, gap, lieu: gap === 0, km: gap === 0 ? Math.round(distKm(near, t)) : null }); groups.get(k).ticks.push(t);
    }
    out.srcDate = [...groups.values()].sort((a, b) => a.gap - b.gap || a.d.localeCompare(b.d));
    out.badNum = M.listes.filter((l) => l.numerotee).map((l) => ({ cle: l.cle, moves: M.renumber(l.cle) })).filter((x) => x.moves.length);
    return out;
  };
  // numbered list whose numbers do not follow the dates: dated ticks are put back in date order
  // in the numbers they already use; an undated tick keeps its number, since nothing says where it goes
  M.renumber = (cle) => {
    const dated = (db.coches[cle] || []).filter((t) => t.d && t.n);
    const slots = dated.map((t) => t.n).sort((a, b) => a - b);
    // within a day, the ticks that have a time (h, from the photo or Faune-France; never shown) go by time,
    // in the places of the timed ticks; the others keep their place
    const order = [], days = new Map();
    dated.slice().sort((a, b) => a.d.localeCompare(b.d) || a.n - b.n).forEach((t) => { if (!days.has(t.d)) days.set(t.d, []); days.get(t.d).push(t); });
    for (const g of days.values()) { const timed = g.filter((t) => t.h).sort((a, b) => a.h.localeCompare(b.h) || a.n - b.n); let i = 0; g.forEach((t) => order.push(t.h ? timed[i++] : t)); }
    return order.map((t, i) => ({ t: { ...t, cle }, to: slots[i] })).filter((x) => x.t.n !== x.to);
  };
  return M;
}

// which lists a new sighting should go to, and with which number
// photo: photographed?  zone: the most precise place list chosen (or null)  country: "" for France
export function suggest(M, sid, { photo, zone, country, date }) {
  const fr = isFrance(country), out = [], year = yearOf(date);
  const known = sid && M.bySp.has(sid);
  const has = (cle) => !!sid && M.inList(sid, cle);
  const add = (cle, why, checked = true) => { if (!M.liste.has(cle) && !cle.startsWith("yl")) return; if (out.some((x) => x.cle === cle)) return; out.push({ cle, why, checked, already: has(cle) }); };
  const hasPhotoFr = has(PHOTO_FR) || (photo && fr);
  if (photo) add(LIFERS, has(LIFERS) ? "déjà lifer" : "nouveau lifer", !has(LIFERS));
  if (photo && fr) add(PHOTO_FR, has(PHOTO_FR) ? "déjà en photo France" : "nouvelle coche photo France", !has(PHOTO_FR));
  if (fr && zone) {
    // the chosen place list and every list that contains it, up to Photo France
    for (const cle of M.chain(zone)) {
      if (cle === PHOTO_FR || cle === LIFERS) break;
      add(cle, has(cle) ? "déjà cochée" : hasPhotoFr ? "nouvelle" : "pas encore de photo France", !has(cle) && hasPhotoFr);
    }
  }
  if (!fr) {
    const cl = M.listes.find((l) => l.type === "pays" && country && l.nom.toLowerCase() === String(country).toLowerCase());
    if (cl) add(cl.cle, has(cl.cle) ? "déjà cochée" : "nouvelle", !has(cl.cle));
  }
  if (year) {
    const cle = "yl" + year, l = M.liste.get(cle);
    const inYearHere = !!sid && (M.bySp.get(sid) && (M.bySp.get(sid).get(cle) || []).some((t) => fr ? isFrance(t.p) : true));
    const okNoPhoto = fr ? has(PHOTO_FR) : has(LIFERS);
    out.push({ cle, why: inYearHere ? `déjà dans ${year}` : l ? `nouvelle pour ${year}` : `crée la year list ${year}`, checked: !inYearHere && (photo || okNoPhoto), already: inYearHere, year });
  }
  if (!photo) {
    const open = fr ? !has(PHOTO_FR) : !has(LIFERS);
    add(VU, open ? "pas encore photographiée" + (fr ? " en France" : "") : "déjà photographiée", open && !has(VU));
  }
  out.forEach((x) => { const l = M.liste.get(x.cle); if (l && l.numerotee) x.num = M.nextNum(x.cle); });
  return { list: out, known };
}
