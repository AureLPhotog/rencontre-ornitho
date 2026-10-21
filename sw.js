// Keeps the app itself available offline. The data is cached by the app (localStorage), not here.
const V = "ro-shell-v32";
const SHELL = ["./", "index.html", "css/app.css?v=16", "js/app.js", "js/store.js", "js/model.js", "js/form.js", "js/map.js", "js/util.js", "js/export.js", "js/geo.js", "js/lists.js", "js/importer.js", "js/taxo.js",
  "icon.svg?v=2", "icon-192.png", "apple-touch-icon.png", "manifest.webmanifest", "vendor/leaflet/leaflet.css", "vendor/leaflet/leaflet.js", "vendor/leaflet/images/marker-icon.png", "vendor/leaflet/images/marker-icon-2x.png", "vendor/leaflet/images/marker-shadow.png", "vendor/leaflet/images/layers.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
// only this app's old caches: the site also hosts other apps (Oiseaux d'Ouessant), whose caches must stay
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("ro-shell-") && k !== V && k !== V + "-tiles").map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.hostname === "api.github.com") return; // the database always goes to GitHub
  const tile = /tile\.openstreetmap|geopf\.fr|arcgisonline/.test(u.hostname);
  // app files: network first (fresh after an update), cache when offline; map tiles: cache first
  e.respondWith((tile ? caches.match(e.request).then((r) => r || fetchAndKeep(e.request, true)) : fetchAndKeep(e.request).catch(() => caches.match(e.request))));
});
async function fetchAndKeep(req, isTile) {
  // app files are revalidated with GitHub Pages every time, so an update shows at the next opening
  const res = await fetch(req, isTile ? undefined : { cache: "no-cache" });
  if (res.ok || res.type === "opaque") { const c = await caches.open(isTile ? V + "-tiles" : V); c.put(req, res.clone()); }
  return res;
}
