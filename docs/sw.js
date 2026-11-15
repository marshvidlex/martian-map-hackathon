// sw.js - service worker para que la app funcione sin internet.
// Estrategia "primero la red": si hay internet trae lo nuevo y lo guarda;
// si no hay, usa la copia guardada. Asi no te quedas con versiones viejas mientras programas.

const CACHE = "martian-map-v36"; // si cambias la lista de archivos, sube el numero
// Ojo: en index.html los css/js llevan ?v=NN; subelo junto con este numero para que el navegador no use copias viejas.

const ARCHIVOS = [
  "./",
  "index.html",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "css/estilos.css",
  "js/idioma.js",
  "js/ruta.js",
  "js/app.js",
  "js/crateres.js",
  "js/aterrizaje.js",
  "js/ciencia.js",
  "js/explorador.js",
  "js/habitat3d.js",
  "js/replay.js",
  "js/marte.js",
  "js/fases.js",
  "data/sitios.json",
  "js/vista3d.js",
  "js/casco.js",
  "lib/three/three.module.js",
  "lib/three/three.core.js",
  "lib/three/OrbitControls.js",
  "lib/leaflet/leaflet.js",
  "lib/leaflet/leaflet.css",
  "lib/leaflet/images/marker-icon.png",
  "lib/leaflet/images/marker-icon-2x.png",
  "lib/leaflet/images/marker-shadow.png",
];

// Mapa de Marte de la pantalla de inicio (niveles 0 a 3, ~170 mosaicos, ~3 MB): se guarda completo
// al instalar para que Marte se vea aunque se apague el servidor o no haya internet.
// El nivel 4 (mas detalle) se guarda solo conforme se va viendo.
const MOSAICOS_MARTE = [];
for (let z = 0; z <= 3; z++) {
  for (let y = 0; y < 2 ** z; y++) {
    for (let x = 0; x < 2 ** (z + 1); x++) MOSAICOS_MARTE.push(`data/marte/${z}/${y}/${x}.jpg`);
  }
}
const ZONAS = ["jezero", "gale"];
// Datos de las zonas que ya vienen en el repo (si alguno no existe, no pasa nada)
const DATOS_ZONA = ["data/zonas.json"].concat(
  ["info.json", "cuadricula.json", "foto.png", "elevacion.png", "pendiente.png", "rugosidad.png",
    "geologia.png", "crateres.json", "ciencia.json", "aterrizaje.json", "aterrizaje.png", "M20_traverse.json", "poi.json",
    "hirise/indice.json"].flatMap((a) => ZONAS.map((z) => `data/zonas/${z}/${a}`)));

// Al instalar: guardamos la app, el mapa de Marte y los datos de Jezero.
// Las fotos HiRISE de cerca se guardan la primera vez que se ven.
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all([
    c.addAll(ARCHIVOS),
    // uno por uno: si falta alguno no se cae toda la instalacion
    ...MOSAICOS_MARTE.concat(DATOS_ZONA).map((u) => c.add(u).catch(() => null)),
    // fotos de Perseverance de los lugares de ciencia (scripts/descargar_fotos_rover.py)
    ...ZONAS.map((z) => fetch(`data/zonas/${z}/poi.json`).then((r) => r.json()).then((pois) => Promise.all(pois.flatMap((p) =>
      (p.fotos || []).map((f) => c.add(`data/zonas/${z}/${f.archivo}`).catch(() => null))))).catch(() => null)),
    // nivel 4 (mas detalle) alrededor de cada sitio de aterrizaje: 3 x 3 mosaicos por sitio
    fetch("data/sitios.json").then((r) => r.json()).then((sitios) => Promise.all(sitios.flatMap((s) => {
      const cx = Math.floor(((s.lon + 180) / 360) * 32), cy = Math.floor(((90 - s.lat) / 180) * 16), lista = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < 32 && y >= 0 && y < 16) lista.push(c.add(`data/marte/4/${y}/${x}.jpg`).catch(() => null));
      }
      return lista;
    }))).catch(() => null),
  ])));
  self.skipWaiting();
});

// Al activar: borramos caches de versiones anteriores
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return resp;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
