// Small shared helpers: text, dates, DOM.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
export const slug = (s) => norm(s).replace(/ /g, "-").slice(0, 60) || "espece";
export const cap = (s) => { s = String(s ?? "").trim().replace(/\s+/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };
export const plural = (n, one, many) => (n > 1 ? many || one + "s" : one);
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const MOIS_C = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const yearOf = (iso) => (iso ? +iso.slice(0, 4) : null);
export function fmtDay(iso, withYear = true) {
  if (!iso) return "date inconnue";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d === 1 ? "1er" : d} ${MOIS[m - 1]}${withYear ? " " + y : ""}`;
}
export const fmtShort = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
export const isFrance = (p) => !p || norm(p) === "france";

// UTF-8 safe base64, for the GitHub API
export function b64encode(str) {
  const bytes = new TextEncoder().encode(str); let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64decode(b64) {
  const bin = atob(String(b64).replace(/\s+/g, "")); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// one record per line, so a commit shows exactly which ticks changed
export function stringifyRows(head, key, rows) {
  const h = JSON.stringify(head).slice(0, -1);
  return `${h}${Object.keys(head).length ? "," : ""}"${key}":[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]}\n`;
}

export function store(key, value) { try { if (value === undefined) return JSON.parse(localStorage.getItem(key) || "null"); localStorage.setItem(key, JSON.stringify(value)); } catch (_) { return null; } }
export function unstore(key) { try { localStorage.removeItem(key); } catch (_) {} }

export function toast(text, kind = "") {
  const t = document.createElement("div"); t.className = "toast " + kind; t.textContent = text; t.setAttribute("role", "status");
  document.body.appendChild(t); requestAnimationFrame(() => t.classList.add("in"));
  setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 300); }, kind === "error" ? 6000 : 3200);
}
