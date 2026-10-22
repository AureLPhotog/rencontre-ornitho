// Leaflet map: tap to place the point, GPS button, three backgrounds.
const L = () => window.L;
const LAYERS = {
  plan: () => L().tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }),
  ign: () => L().tileLayer("https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}", { maxZoom: 19, attribution: "© IGN" }),
  monde: () => L().tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, attribution: "© Esri" }),
};
const LYON = [45.76, 4.84];

export function mapPicker(el, { lat, lon, others = [] } = {}, onPick) {
  if (!L()) { el.innerHTML = '<p class="cap">La carte n\'a pas pu se charger (pas de réseau ?). Tu peux taper les coordonnées.</p>'; return { set() {}, destroy() {} }; }
  const has = lat != null && lon != null;
  const map = L().map(el, { zoomControl: true, attributionControl: true }).setView(has ? [lat, lon] : LYON, has ? 14 : 9);
  let base = LAYERS.plan().addTo(map);
  const bases = { "Plan": base, "Photo aérienne (France)": LAYERS.ign(), "Satellite (monde)": LAYERS.monde() };
  L().control.layers(bases, null, { position: "topright" }).addTo(map);
  others.forEach((o) => L().circleMarker([o.lat, o.lon], { radius: 4, color: "#5D7068", weight: 1, fillOpacity: 0.5 }).addTo(map).bindTooltip(o.nom || ""));
  const pin = L().marker(has ? [lat, lon] : LYON, { draggable: true, opacity: has ? 1 : 0 }).addTo(map);
  const pick = (ll, how) => { pin.setLatLng(ll).setOpacity(1); onPick && onPick(+ll.lat.toFixed(6), +ll.lng.toFixed(6), how); };
  map.on("click", (e) => pick(e.latlng, "carte"));
  pin.on("dragend", () => pick(pin.getLatLng(), "carte"));
  // GPS
  const Gps = L().Control.extend({ options: { position: "topleft" }, onAdd() {
    const b = L().DomUtil.create("button", "map-gps"); b.type = "button"; b.title = "Ma position"; b.setAttribute("aria-label", "Ma position"); b.textContent = "◎";
    L().DomEvent.on(b, "click", (ev) => { L().DomEvent.stop(ev); locate(); }); return b; } });
  map.addControl(new Gps());
  function locate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => { const ll = L().latLng(p.coords.latitude, p.coords.longitude); map.setView(ll, 15); pick(ll, "gps"); },
      () => { onPick && onPick(null, null, "gps-refusé"); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }
  setTimeout(() => map.invalidateSize(), 60);
  return {
    set(la, lo, zoom) { if (la == null || lo == null) return; pin.setLatLng([la, lo]).setOpacity(1); map.setView([la, lo], zoom || Math.max(map.getZoom(), 13)); },
    locate, map, destroy() { map.remove(); },
  };
}

export function mapView(el, points) {
  if (!L() || !points.length) return null;
  const map = L().map(el, { zoomControl: true, scrollWheelZoom: false });
  LAYERS.plan().addTo(map);
  // the bigger, more important points last, so they stay on top
  const sorted = points.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
  const g = L().featureGroup(sorted.map((p) => L().circleMarker([p.lat, p.lon], { radius: p.r || 6, color: p.stroke || p.color || "#0A7895", fillColor: p.color || "#0A7895", weight: p.stroke ? 4 : 2, fillOpacity: p.z ? 0.9 : 0.55 }).bindPopup(p.html))).addTo(map);
  map.fitBounds(g.getBounds().pad(0.3), { maxZoom: 13 });
  setTimeout(() => map.invalidateSize(), 60);
  return map;
}

// every tick of a list on one big map: a popup is built only when its point is opened
export function listMap(el, points, onOpen) {
  if (!L()) { el.innerHTML = '<p class="cap">La carte n\'a pas pu se charger (pas de réseau ?).</p>'; return null; }
  const map = L().map(el, { zoomControl: true });
  const base = LAYERS.plan().addTo(map);
  L().control.layers({ "Plan": base, "Photo aérienne (France)": LAYERS.ign(), "Satellite (monde)": LAYERS.monde() }, null, { position: "topright" }).addTo(map);
  const ms = points.map((p) => L().circleMarker([p.lat, p.lon], { radius: p.r || 7, color: p.stroke || "#fff", fillColor: p.color || "#0A7895", weight: 2, fillOpacity: 0.9 })
    // the popup content is built once and kept (Leaflet calls this again when the popup is resized)
    .bindPopup(() => { if (!p._el) { p._el = document.createElement("div"); p._el.innerHTML = p.html(); } return p._el; }, { maxWidth: 300, minWidth: 240, autoPanPadding: [20, 60] }));
  const g = L().featureGroup(ms).addTo(map);
  if (points.length) map.fitBounds(g.getBounds().pad(0.1), { maxZoom: 13 }); else map.setView(LYON, 6);
  map.on("popupopen", (e) => onOpen && onOpen(e.popup.getElement(), e.popup));
  setTimeout(() => map.invalidateSize(), 60);
  return map;
}

// the French territory a point falls in, roughly: used only to pre-select Ouessant
export const isOuessant = (lat, lon) => lat > 48.40 && lat < 48.50 && lon > -5.17 && lon < -5.00;
