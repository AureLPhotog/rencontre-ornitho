// Excel export (everything the app knows, one sheet per subject) and the exact JSON backup.
import { todayIso, isFrance, srcName, qualite, cmp, byFr } from "./util.js";

function download(name, blob) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
let xlsxLoading = null;
export function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return xlsxLoading || (xlsxLoading = new Promise((ok, ko) => {
    const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => ok(window.XLSX); s.onerror = () => { xlsxLoading = null; ko(new Error("Le module Excel n'a pas pu se charger (pas de réseau ?).")); }; document.head.appendChild(s);
  }));
}

// a real Excel date (sortable, filterable), shown 31/12/2026
const xdate = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const lab = (q) => (q ? (qualite(q) || { court: q }).court : "");
const PH_SRC = { appli: "ajoutée dans l'appli", serie: "choisie dans une série", liste: "dossier Liste", flickr: "Flickr", lien: "lien web" };

// one sheet: header row, widths, filter on the header, dates formatted
function sheet(X, head, rows, widths, links) {
  const ws = X.utils.aoa_to_sheet([head, ...rows], { cellDates: true });
  ws["!cols"] = head.map((h, i) => ({ wch: widths[i] || Math.max(8, Math.min(40, h.length + 2)) }));
  ws["!autofilter"] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: head.length - 1 } }) };
  for (const k of Object.keys(ws)) { const c = ws[k]; if (c && c.t === "d") c.z = "dd/mm/yyyy"; }
  // a column of links (map of the place): the cell shows its text and opens the address
  if (links) rows.forEach((r, i) => { const url = links(i); if (url) { const ref = X.utils.encode_cell({ r: i + 1, c: head.indexOf("Carte") }); ws[ref] = { t: "s", v: "voir", l: { Target: url } }; } });
  return ws;
}

export async function exportXlsx(M) {
  const X = await loadXlsx(), wb = X.utils.book_new();
  const L = (cle) => M.liste.get(cle) || { nom: cle };
  const photoLists = (l) => l.type === "photo" || l.type === "pays";

  // ---- the ticks, with their photo, its label, where the date and the place come from
  const ticks = M.ticks.slice().sort((a, b) => cmp(a.d || "9999", b.d || "9999") || cmp(a.cle, b.cle) || (a.n || 0) - (b.n || 0));
  const byDay = new Map(); ticks.forEach((t) => { if (t.d) { const k = t.e + "|" + t.d; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(t); } });
  const head = ["Espèce", "Nom latin", "Liste", "N°", "Date", "Heure", "Lieu", "Pays", "Latitude", "Longitude", "Carte", "Détail",
    "Photo", "Fichier de la photo", "Date de la photo", "Origine de la photo", "Étiquette de la photo", "Étiquette best of de l'espèce",
    "Date confirmée", "Source de la date", "Source du lieu", "Même observation dans", "ID espèce", "Clé liste", "ID coche"];
  const rows = ticks.map((t) => {
    const e = M.esp.get(t.e) || {}, ph = M.photosFor(t)[0] || null;
    const twins = t.d ? (byDay.get(t.e + "|" + t.d) || []).filter((x) => x !== t && M.sameObs(t, x)).map((x) => L(x.cle).nom) : [];
    const photo = ph ? "oui" : t.nph ? "pas de photo" : photoLists(L(t.cle)) ? "à trouver" : "";
    return [M.name(t.e), e.sc || "", L(t.cle).nom, M.rankOf(t) || "", xdate(t.d), t.h || "", t.l || "", isFrance(t.p) ? "France" : t.p, t.lat ?? "", t.lon ?? "", "", t.t || "",
      photo, ph ? ph.file || "" : "", ph ? xdate(ph.d) : "", ph ? (t.ph ? PH_SRC[t.ph.src] || t.ph.src || "" : "dossier Liste") + (ph.nv ? " (date non vérifiée)" : "") : "", lab(t.q), lab(M.bestQ(t.e)),
      t.vf && t.vf === t.d ? "oui" : "", t.d ? srcName(t.sd) : "", t.l || t.lat != null ? srcName(t.sl) : "", twins.join(", "), t.e, t.cle, t.id];
  });
  X.utils.book_append_sheet(wb, sheet(X, head, rows, [24, 24, 14, 6, 11, 7, 34, 10, 10, 10, 6, 18, 11, 26, 11, 20, 13, 13, 10, 22, 22, 26, 22, 12, 16],
    (i) => (ticks[i].lat != null ? `https://www.openstreetmap.org/?mlat=${ticks[i].lat}&mlon=${ticks[i].lon}#map=15/${ticks[i].lat}/${ticks[i].lon}` : null)), "Coches");

  // ---- the species: names, labels, rule, then one column per list
  const owned = M.db.especes.filter((e) => M.bySp.has(e.id)).sort((a, b) => byFr(a.n, b.n));
  const sp = owned.map((e) => {
    const lif = M.tick(e.id, "lifers"), pf = M.tick(e.id, "photo-france");
    return [e.n, e.sc || "", e.fa || "", e.lr || "", lab(M.spQ(e.id)), lab(e.q), lab(M.liferQ(e.id)), e.compte || "", (e.al || []).join(", "), xdate(lif && lif.d), xdate(pf && pf.d),
      ...M.listes.map((l) => { const t = M.tick(e.id, l.cle); return t ? (t.n ? `n°${t.n} ` : "") + (t.d ? t.d.split("-").reverse().join("/") : "✓") : ""; }), e.id];
  });
  X.utils.book_append_sheet(wb, sheet(X, ["Espèce", "Nom latin", "Famille", "Liste rouge mondiale", "Étiquette de l'espèce", "Étiquette best of", "Étiquette lifer", "Règle de coche", "Autres noms", "Lifer", "Photo France", ...M.listes.map((l) => l.nom), "ID"],
    sp, [24, 24, 18, 8, 13, 13, 13, 30, 30, 11, 11, ...M.listes.map(() => 16), 22]), "Espèces");

  // ---- the lists: how many species, with or without photo, without date
  const ls = M.listes.map((l) => {
    const sps = M.speciesOf(l.cle), withPh = sps.filter((t) => M.photosFor(t).length).length;
    return [l.nom, l.dans ? L(l.dans).nom : "", l.type, l.annee || "", l.numerotee ? "oui" : "", sps.length, (M.db.coches[l.cle] || []).length, withPh, photoLists(l) ? sps.filter((t) => !M.photosFor(t).length && !t.nph).length : "", sps.filter((t) => !t.d).length, l.note || "", l.cle];
  });
  X.utils.book_append_sheet(wb, sheet(X, ["Liste", "Dans", "Type", "Année", "Numérotée", "Espèces", "Coches", "Avec photo", "Photo à trouver", "Sans date", "Note", "Clé"], ls, [20, 16, 8, 6, 9, 8, 8, 10, 13, 9, 40, 14]), "Listes");

  // ---- year lists: France and with the trips abroad
  const today = todayIso().slice(5);
  const yl = M.years.slice().reverse().map((y) => { const fr = M.yearList(y, "fr"); return [y, fr.length, M.yearList(y, "monde").length, fr.filter((t) => t.d && t.d.slice(5) <= today).length]; });
  X.utils.book_append_sheet(wb, sheet(X, ["Année", "France", "France et étranger", `France au ${today.split("-").reverse().join("/")}`], yl, [8, 10, 18, 16]), "Year lists");

  // ---- every photo of every species (best of, lifer, first photos, photos of the ticks)
  const pr = [];
  owned.forEach((e) => M.allPhotos(e.id).forEach((p) => pr.push([e.n, p.label || "", xdate(p.d), p.h || "", p.file || "", lab(p.q), p.zone || "", p.nv ? "oui" : "", p.page || ""])));
  X.utils.book_append_sheet(wb, sheet(X, ["Espèce", "Rôle", "Date", "Heure", "Fichier d'origine", "Étiquette", "Zone", "Date non vérifiée", "Page Flickr"], pr, [24, 40, 11, 7, 30, 13, 10, 12, 30]), "Photos");

  // ---- the tasks still open
  const tasks = M.db.taches.filter((t) => !t.fait).map((t) => [t.cat || "", t.sid ? M.name(t.sid) : "", t.cle ? L(t.cle).nom : "", t.quoi || (t.kind === "choose-date" ? `date ${t.src || "cocheurs"} : ${(t.other || "").split("-").reverse().join("/")}` : ""), t.det || ""]);
  X.utils.book_append_sheet(wb, sheet(X, ["Catégorie", "Espèce", "Liste", "Quoi", "Détail"], tasks, [30, 24, 14, 40, 40]), "Tâches");

  const out = X.write(wb, { type: "array", bookType: "xlsx" });
  download(`rencontre-ornitho-${todayIso()}.xlsx`, new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}
export function exportJson(db) {
  download(`rencontre-ornitho-${todayIso()}.json`, new Blob([JSON.stringify({ format: "rencontre-ornitho/1", exporte: new Date().toISOString(), ...db }, null, 1)], { type: "application/json" }));
}
