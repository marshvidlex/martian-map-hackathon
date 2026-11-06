// sw.js - service worker para que la app funcione sin internet.
// Estrategia "primero la red": si hay internet trae lo nuevo y lo guarda;
// si no hay, usa la copia guardada. Asi no te quedas con versiones viejas mientras programas.

const CACHE = "martian-map-v5"; // si cambias la lista de archivos, sube el numero

const ARCHIVOS = [
    "./",
    "index.html",
    "manifest.json",
    "icon-192.png",
    "icon-512.png",
    "css/estilos.css",
    "js/ruta.js",
    "js/app.js",
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
    "data/info.json",
    "data/cuadricula.json",
    "data/poi.json",
    "data/foto.png",
    "data/elevacion.png",
    "data/pendiente.png",
];

// Al instalar: guardamos todo. Lo opcional (rugosidad, capas extra, fotos y los mosaicos
// de HiRISE del casco) se guarda la primera vez que se pide.
self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)));
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
            .catch(() => caches.match(e.request))
    );
});