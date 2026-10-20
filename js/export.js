// Excel export (one line per tick) and the exact JSON backup.
import { todayIso, isFrance } from "./util.js";

function download(name, blob) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return xlsxLoading || (xlsxLoading = new Promise((ok, ko) => {
    const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => ok(window.XLSX); s.onerror = () => { xlsxLoading = null; ko(new Error("Le module Excel n'a pas pu se charger (pas de réseau ?).")); }; document.head.appendChild(s);
  }));
}
export async function exportXlsx(M) {
  const X = await loadXlsx(), wb = X.utils.book_new();
  const head = ["Espèce", "Liste", "Date", "N°", "Lieu", "Pays", "Latitude", "Longitude", "Détail", "ID espèce", "Clé liste", "ID coche"];
  const rows = M.ticks.slice().sort((a, b) => (a.d || "").localeCompare(b.d || "")).map((t) => [M.name(t.e), M.liste.get(t.cle).nom, t.d || "", t.n || "", t.l || "", isFrance(t.p) ? "France" : t.p, t.lat ?? "", t.lon ?? "", t.t || "", t.e, t.cle, t.id]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([head, ...rows]), "Coches");
  const owned = M.db.especes.filter((e) => M.bySp.has(e.id));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["Espèce", "Nom scientifique", "Famille", "Liste rouge mondiale", "Qualité photo", ...M.listes.map((l) => l.nom), "ID"],
    ...owned.map((e) => [e.n, e.sc || "", e.fa || "", e.lr || "", e.q || "", ...M.listes.map((l) => { const t = M.tick(e.id, l.cle); return t ? (t.n ? `n°${t.n} ` : "") + (t.d || "✓") : ""; }), e.id])]), "Espèces");
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["Liste", "Dans", "Type", "Année", "Espèces", "Clé"], ...M.listes.map((l) => [l.nom, l.dans ? M.liste.get(l.dans).nom : "", l.type, l.annee || "", M.count(l.cle), l.cle])]), "Listes");
  const out = X.write(wb, { type: "array", bookType: "xlsx" });
  download(`rencontre-ornitho-${todayIso()}.xlsx`, new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}
export function exportJson(db) {
  download(`rencontre-ornitho-${todayIso()}.json`, new Blob([JSON.stringify({ format: "rencontre-ornitho/1", exporte: new Date().toISOString(), ...db }, null, 1)], { type: "application/json" }));
}
