// Adding your own photos: one per tick (shown only in that tick's list) and one "best of" per species.
// A tick photo must really be the photo of that tick: its shooting date (EXIF, or Flickr's "date taken") must be the
// tick's day, and if it carries species keywords they must name that species. Otherwise it is refused.
import { $, esc, norm, fmtShort, toast, store } from "./util.js";
import { S, M } from "./app.js";

const FLICKR_KEY = "ro.flickr";
export const flickrKey = () => store(FLICKR_KEY) || "";
export const setFlickrKey = (k) => store(FLICKR_KEY, (k || "").trim());

// ---------- reading a JPEG: shooting date and keywords ----------
function exifDate(view, start, len) {
  // TIFF header inside the APP1 segment
  const t = start + 6, le = view.getUint16(t) === 0x4949;
  const u16 = (o) => view.getUint16(t + o, le), u32 = (o) => view.getUint32(t + o, le);
  const str = (o, n) => { let s = ""; for (let i = 0; i < n; i++) { const c = view.getUint8(t + o + i); if (!c) break; s += String.fromCharCode(c); } return s; };
  const readIfd = (off) => { const out = {}; const n = u16(off); for (let i = 0; i < n; i++) { const e = off + 2 + i * 12; out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), val: e + 8 }; } return out; };
  const ifd0 = readIfd(u32(4));
  const exifPtr = ifd0[0x8769] ? u32(ifd0[0x8769].val) : null;
  if (exifPtr == null) return null;
  const ex = readIfd(exifPtr);
  const tag = ex[0x9003] || ex[0x9004]; // DateTimeOriginal, else DateTimeDigitized (never the export date)
  if (!tag) return null;
  return str(tag.count > 4 ? u32(tag.val) : tag.val, tag.count);
}
export function readMeta(buf) {
  const v = new DataView(buf), out = { when: null, keywords: [] };
  if (v.getUint16(0) !== 0xffd8) return out;
  let i = 2;
  while (i + 4 < v.byteLength) {
    if (v.getUint8(i) !== 0xff) break;
    const m = v.getUint8(i + 1); if (m === 0xda || m === 0xd9) break;
    const len = v.getUint16(i + 2);
    if (m === 0xe1) {
      const head = String.fromCharCode(...new Uint8Array(buf, i + 4, Math.min(29, len - 2)));
      if (head.startsWith("Exif\0\0")) { try { out.when = out.when || exifDate(v, i + 4, len - 2); } catch (_) {} }
      else if (head.startsWith("http://ns.adobe.com/xap/1.0/")) {
        const xmp = new TextDecoder().decode(new Uint8Array(buf, i + 4, len - 2));
        const subj = xmp.match(/<dc:subject>([\s\S]*?)<\/dc:subject>/);
        if (subj) out.keywords = [...subj[1].matchAll(/<rdf:li[^>]*>([^<]*)<\/rdf:li>/g)].map((x) => x[1].trim()).filter(Boolean);
        const d = xmp.match(/(?:exif:DateTimeOriginal|photoshop:DateCreated)(?:="|>)(\d{4}-\d\d-\d\dT\d\d:\d\d)/);
        if (!out.when && d) out.when = d[1].replace(/-/g, ":").replace("T", " ");
      }
    }
    i += 2 + len;
  }
  // "2020:05:11 09:50:10" -> date + time
  const m = out.when && out.when.match(/^(\d{4})[:-](\d\d)[:-](\d\d)[ T](\d\d):(\d\d)/);
  return { d: m ? `${m[1]}-${m[2]}-${m[3]}` : null, h: m ? `${m[4]}:${m[5]}` : null, keywords: out.keywords };
}

// a copy small enough for the repository (and for a phone)
export async function shrink(file, max = 1600) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Image illisible."))), "image/jpeg", 0.85));
}

// ---------- Flickr ----------
const B58 = "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
function flickrId(url) {
  const s = String(url).trim();
  let m = s.match(/flickr\.com\/photos\/[^/]+\/(\d+)/); if (m) return m[1];
  m = s.match(/flic\.kr\/p\/([1-9a-km-zA-HJ-NP-Z]+)/);
  if (m) { let n = 0n; for (const ch of m[1]) n = n * 58n + BigInt(B58.indexOf(ch)); return n.toString(); }
  m = s.match(/^\d{6,}$/); return m ? s : null;
}
async function flickr(method, params) {
  const key = flickrKey(); if (!key) throw new Error("Il faut d'abord une clé Flickr (Réglages).");
  const q = new URLSearchParams({ method, api_key: key, format: "json", nojsoncallback: "1", ...params });
  let r; try { r = await fetch("https://api.flickr.com/services/rest/?" + q); } catch (_) { throw new Error("Flickr est injoignable (pas de réseau ?)."); }
  const j = await r.json();
  if (j.stat !== "ok") throw new Error(j.code === 100 ? "La clé Flickr est refusée (Réglages)." : j.code === 1 ? "Flickr ne montre pas cette photo : elle est sans doute privée (avec la clé, l'appli ne lit que les photos publiques) ou supprimée." : `Flickr : ${j.message}`);
  return j;
}
export async function flickrPhoto(url) {
  if (/flickr\.com\/gp\//.test(url)) throw new Error("C'est un lien de partage privé (« /gp/ ») : l'appli ne peut pas le lire. Rends la photo publique sur Flickr et colle le lien normal (flickr.com/photos/…/numéro), ou choisis la photo sur l'appareil.");
  const id = flickrId(url); if (!id) throw new Error("Ce n'est pas un lien de photo Flickr.");
  const [info, sizes] = await Promise.all([flickr("flickr.photos.getInfo", { photo_id: id }), flickr("flickr.photos.getSizes", { photo_id: id })]);
  const p = info.photo, all = sizes.sizes.size || [];
  const pick = ["Large 1600", "Large", "Large 2048", "Medium 800", "Original"].map((l) => all.find((s) => s.label === l)).find(Boolean) || all[all.length - 1];
  const taken = p.dates && +p.dates.takenunknown !== 1 ? p.dates.taken : null; // "2020-05-11 09:50:10", local time
  return { url: pick.source, page: (p.urls && p.urls.url && p.urls.url[0] && p.urls.url[0]._content) || `https://www.flickr.com/photos/${p.owner.nsid}/${id}/`,
    d: taken ? taken.slice(0, 10) : null, h: taken ? taken.slice(11, 16) : null, file: (p.title && p.title._content) || `Flickr ${id}`,
    keywords: [...((p.tags && p.tags.tag) || []).map((x) => x.raw), (p.title && p.title._content) || ""].filter(Boolean) };
}

// ---------- the checks ----------
// a keyword that is exactly the name of a species (or one of its other names)
function speciesOfKeyword(k) {
  const nk = norm(k).replace(/[^a-z0-9]+/g, " ").trim(); if (!nk) return null;
  for (const e of M.esp.values()) for (const n of [e.n, ...(e.al || [])]) if (norm(n).replace(/[^a-z0-9]+/g, " ").trim() === nk) return e.id;
  return null;
}
// null when the photo can be that one, else why it is refused
export function refuse(meta, { sid, tick }) {
  const named = [...new Set(meta.keywords.map(speciesOfKeyword).filter(Boolean))];
  if (named.length && !named.includes(sid)) return `La photo est étiquetée « ${named.map((x) => M.name(x)).join(", ")} », pas « ${M.name(sid)} ».`;
  if (!tick) return null; // the best photo of a species can be of any day
  if (!tick.d) return "La coche n'a pas de date : date-la d'abord, la photo sera vérifiée sur ce jour-là.";
  if (!meta.d) return "Impossible de lire la date de prise de vue de cette photo (exporte-la avec ses métadonnées, ou donne le lien de l'original). Photo refusée.";
  if (meta.d !== tick.d) return `Cette photo a été prise le ${fmtShort(meta.d)} ; la coche est du ${fmtShort(tick.d)}. Ce n'est pas la photo de la coche : refusée.`;
  return null;
}

// the observation (ticks of the same sighting) a best-of photo belongs to: same species, same day; when that day holds
// several sightings, the one nearest in time. Not when the observation already has its own photo.
function bestToTick(sid, ph) {
  if (!ph || !ph.d) return {};
  const day = M.ticks.filter((t) => t.e === sid && t.d === ph.d);
  if (!day.length) return {};
  const groups = []; day.forEach((t) => { const g = groups.find((x) => M.sameObs(x[0], t)); if (g) g.push(t); else groups.push([t]); });
  let g = groups[0];
  if (groups.length > 1) {
    const mins = (h) => { const m = /^(\d{1,2}):(\d{2})/.exec(h || ""); return m ? +m[1] * 60 + +m[2] : null; }, ph_ = mins(ph.h);
    const timed = groups.map((x) => ({ x, m: Math.min(...x.map((t) => mins(t.h)).filter((v) => v != null)) })).filter((y) => isFinite(y.m));
    if (ph_ == null || !timed.length) return { why: `Le ${fmtShort(ph.d)} a plusieurs observations de l'espèce : ajoute-la toi-même à la bonne coche.` };
    g = timed.sort((a, b) => Math.abs(a.m - ph_) - Math.abs(b.m - ph_))[0].x;
  }
  const same = (t) => t.ph && (t.ph.img || t.ph.url) === (ph.img || ph.url);
  if (g.every(same)) return {};
  if (g.some((t) => t.ph)) return { why: `La coche du ${fmtShort(ph.d)} a déjà sa propre photo : gardée.` };
  return { ticks: g };
}

// ---------- the widget ----------
// where: { kind: "tick", cle, tick } or { kind: "best", sid }
export function photoBox(el, where, phSlider) {
  const sid = where.kind === "tick" ? where.tick.e : where.sid;
  const cur = where.kind === "tick" ? where.tick.ph : (M.esp.get(sid) || {}).best;
  const obs = () => { if (where.kind !== "tick") return []; const t = where.tick; return [t, ...(t.d ? M.ticks.filter((x) => !(x.cle === where.cle && x.id === t.id) && M.sameObs({ ...t, cle: where.cle }, x)) : [])]; };
  const setObs = (ph, label) => S.apply(obs().map((x) => ({ kind: "set-tick", cle: x.cle || where.cle, id: x.id, patch: ph ? { ph, nph: null } : { ph } })), label);
  const title = where.kind === "tick" ? `Photo de la coche · ${esc(M.liste.get(where.cle).nom)}` : "Meilleure photo (best of)";
  const lists = where.kind === "tick" ? obs().map((x) => M.liste.get(x.cle || where.cle).nom) : [];
  const help = where.kind === "tick" ? `Une seule photo pour cette observation : elle s'affiche dans ${lists.length > 1 ? "ses listes (" + esc(lists.join(", ")) + ")" : "cette liste"}. Elle doit avoir été prise le jour de la coche${where.tick.d ? ` (${fmtShort(where.tick.d)})` : ""} : sa date de prise de vue est vérifiée.` : "Elle s'affiche en premier sur la page de l'espèce, jamais sur la carte. Choisis une de tes photos de l'espèce, ou ajoutes-en une nouvelle.";
  el.innerHTML = `<section class="panel phbox"><h3 class="minor">${title}</h3><p class="cap">${help}</p>
    <div class="phbox-cur">${cur ? phSlider([{ ...cur, label: where.kind === "tick" ? "Photo de la coche" : "Meilleure photo" }], M.name(sid)) : '<p class="cap">Pas encore de photo.</p>'}</div>
    <div class="row"><label class="btn">📷 Choisir sur l'appareil<input type="file" accept="image/jpeg,image/*" class="ph-file" hidden></label>${cur ? '<button type="button" class="btn ph-del">Retirer</button>' : ""}</div>
    <div class="row ph-fl"><input class="field" type="url" placeholder="ou lien Flickr (page de la photo, ou lien direct de l’image)"><button type="button" class="btn">Vérifier</button></div>
    ${where.kind === "best" ? (() => { const mine = M.allPhotos(sid).filter((p) => !cur || (p.img || p.url) !== (cur.img || cur.url)); return mine.length ? `<p class="cap">Parmi tes photos de l'espèce :</p><div class="ph-pick">${mine.map((p, i) => `<button type="button" class="ph-pk" data-i="${i}" title="${esc(p.label)}"><img class="ph" data-ph="${esc(p.img || p.url)}" data-alt="" alt=""><small>${esc(p.label)}${p.d ? " · " + esc(fmtShort(p.d)) : ""}</small></button>`).join("")}</div>` : ""; })() : ""}
    <div class="ph-new"></div><p class="msg"></p></section>`;
  const msg = $(".msg", el), box = $(".ph-new", el);
  const say = (t, cls = "") => { msg.className = "msg " + cls; msg.textContent = t; };
  const offer = (meta, previewUrl, save) => {
    const why = refuse(meta, { sid, tick: where.kind === "tick" ? where.tick : null });
    if (why) { box.innerHTML = ""; say(why, "bad"); return; }
    say(`Prise le ${meta.d ? fmtShort(meta.d) + (meta.h ? " à " + meta.h : "") : "?"}${meta.keywords.length ? " · mots-clés : " + meta.keywords.slice(0, 6).join(", ") : ""}`, "ok");
    box.innerHTML = `<img class="ph" src="${esc(previewUrl)}" alt=""><div class="row"><button type="button" class="btn btn-primary">${cur ? "Remplacer par cette photo" : "Ajouter cette photo"}</button></div>`;
    $("button", box).addEventListener("click", async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = "Envoi…";
      try { const ph = await save(); store_(ph); box.innerHTML = ""; say("Photo enregistrée.", "ok"); }
      catch (err) { b.disabled = false; b.textContent = "Réessayer"; say(err.message, "bad"); }
    });
  };
  const store_ = (ph, q) => {
    if (where.kind === "tick") { setObs(ph, `Photo de la coche : ${M.name(sid)} (${obs().map((x) => M.liste.get(x.cle || where.cle).nom).join(", ")})`); toast("Photo enregistrée."); again(); return; }
    // a best-of photo taken the day of a tick without photo becomes the photo of that observation too
    const to = bestToTick(sid, ph);
    const ops = [{ kind: "set-espece", id: sid, patch: q ? { best: ph, q } : { best: ph } }];
    if (to.ticks) to.ticks.forEach((x) => ops.push({ kind: "set-tick", cle: x.cle, id: x.id, patch: { ph, nph: null } }));
    S.apply(ops, `Meilleure photo : ${M.name(sid)}${q ? " (étiquette " + q + ")" : ""}${to.ticks ? ` · aussi photo de la coche du ${fmtShort(ph.d)} (${to.ticks.map((x) => M.liste.get(x.cle).nom).join(", ")})` : ""}`);
    toast(to.ticks ? `Photo enregistrée, et ajoutée à la coche du ${fmtShort(ph.d)} (${to.ticks.map((x) => M.liste.get(x.cle).nom).join(", ")}).` : to.why ? `Photo enregistrée. ${to.why}` : "Photo enregistrée.");
    again();
  };
  // draw the box again with what the base now holds
  const again = () => { const w = where.kind === "tick" ? { ...where, tick: (M.db.coches[where.cle] || []).find((x) => x.id === where.tick.id) || where.tick } : where; photoBox(el, w, phSlider); };
  $(".ph-file", el).addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; if (!f) return; say("Lecture de la photo…");
    try {
      const meta = readMeta(await f.arrayBuffer());
      const small = await shrink(f);
      offer(meta, URL.createObjectURL(small), async () => {
        const path = where.kind === "tick" ? `data/photos/listes/${where.cle}/${where.tick.id}.jpg` : `data/photos/best/${sid}-${Date.now().toString(36)}.jpg`;
        await S.putImage(path, small, `${where.kind === "tick" ? "Photo de la coche" : "Meilleure photo"} : ${M.name(sid)}`);
        return { img: path, d: meta.d, h: meta.h, file: f.name, src: "appli" };
      });
    } catch (err) { say("Photo illisible : " + err.message, "bad"); }
    ev.target.value = "";
  });
  const fl = $(".ph-fl input", el);
  $(".ph-fl button", el).addEventListener("click", async () => {
    if (!fl.value.trim()) return; say("Lecture sur Flickr…");
    const path = where.kind === "tick" ? `data/photos/listes/${where.cle}/${where.tick.id}.jpg` : `data/photos/best/${sid}-${Date.now().toString(36)}.jpg`;
    const label = where.kind === "tick" ? "Photo de la coche" : "Meilleure photo";
    try {
      const v = fl.value.trim();
      if (/^https?:\/\/\S+\.jpe?g(\?\S*)?$/i.test(v)) {
        // a direct link to the image file: its own metadata is the only way to check the date
        let r; try { r = await fetch(v); } catch (_) { throw new Error("Ce site ne laisse pas l'appli lire l'image. Donne le lien de la page Flickr."); }
        if (!r.ok) throw new Error("Image introuvable à ce lien.");
        const raw = await r.blob(), meta = readMeta(await raw.arrayBuffer());
        if (!meta.d && /staticflickr/.test(v) && where.kind === "tick") throw new Error("Flickr retire la date de prise de vue de ses copies réduites : donne plutôt le lien de la page de la photo (avec la clé Flickr), ou le lien de l'original.");
        offer(meta, v, async () => { const small = await shrink(raw); await S.putImage(path, small, `${label} : ${M.name(sid)}`); return { img: path, d: meta.d, h: meta.h, file: v.split("/").pop().split("?")[0], src: "lien" }; });
      } else {
        const p = await flickrPhoto(v);
        // the picture itself is copied into your repository: it stays even if it leaves Flickr
        offer(p, p.url, async () => {
          const r = await fetch(p.url); if (!r.ok) throw new Error("Impossible de télécharger l'image depuis Flickr.");
          await S.putImage(path, await shrink(await r.blob()), `${label} : ${M.name(sid)}`);
          return { img: path, page: p.page, d: p.d, h: p.h, file: p.file, src: "flickr" };
        });
      }
    } catch (err) { box.innerHTML = ""; say(err.message, "bad"); }
  });
  if (where.kind === "best") {
    const mine = M.allPhotos(sid).filter((p) => !cur || (p.img || p.url) !== (cur.img || cur.url));
    el.querySelectorAll(".ph-pk").forEach((b) => b.addEventListener("click", () => {
      const p = mine[+b.dataset.i]; if (!p) return;
      const { label, q, ...ph } = p; // the caption belongs to where it was shown, not to the photo
      store_(ph, q);
    }));
  }
  const del = $(".ph-del", el);
  if (del) del.addEventListener("click", () => {
    if (!del.dataset.armed) { del.dataset.armed = "1"; del.textContent = "Confirmer : retirer"; return; }
    if (where.kind === "tick") setObs(null, `Photo retirée : ${M.name(sid)} (${M.liste.get(where.cle).nom})`);
    else S.apply({ kind: "set-espece", id: sid, patch: { best: null } }, `Meilleure photo retirée : ${M.name(sid)}`);
    toast("Photo retirée."); again();
  });
}
