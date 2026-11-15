// ciencia.js
// Objetivos cientificos de la caminata (data/zonas/<zona>/ciencia.json) y sus lugares (poi.json).
// El reto pide empezar por la ciencia: cada lugar dice que estudiar, por que, con que instrumento
// y si se toma muestra, con la fuente de NASA. La tripulacion elige objetivos y la ruta se arma
// pasando por sus lugares.
//  - Seccion "SCIENCE OBJECTIVES" arriba del panel de capas (fase PLAN).
//  - Marcadores de estrella en el mapa, con el color de su objetivo.
//  - Resumen de ciencia de la mision (lo usan fases.js y la lista de revision).
// Usa globales de app.js: mapa, info, pois, paradas, alTocarMapa, lonlatAMapa, celdaAMapa, decir.

const CIENCIA = { objetivos: [], marcas: null, elegidos: new Set() };

async function iniciarCiencia() {
  try {
    const r = await fetch(DATOS + "ciencia.json");
    if (r.ok) CIENCIA.objetivos = await r.json();
  } catch { CIENCIA.objetivos = []; }
  if (!pois.length) return; // zona sin lugares de ciencia: todo sigue igual
  traducirPois();
  pintarPois();
  guardarFotosSinInternet();
  if (CIENCIA.objetivos.length) {
    CIENCIA.elegidos.add(CIENCIA.objetivos[0].id); // de inicio, el objetivo principal
    pintarSeccion();
  }
}
window.iniciarCiencia = iniciarCiencia;
window.abrirFotoPoi = (p, k = 0) => (p && (p.fotos || []).length ? abrirFotoGrande(p, k) : null);

// Pide todas las fotos de Perseverance una vez: el service worker (sw.js) guarda cada archivo que pasa
// por el, asi las fotos se siguen viendo aunque se apague el servidor o no haya internet.
function guardarFotosSinInternet() {
  const lista = pois.flatMap((p) => (p.fotos || []).map((f) => DATOS + f.archivo));
  if (!lista.length || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready.then(() => setTimeout(async () => {
    for (const u of lista) { try { await fetch(u); } catch { /* sin red: ya estaban guardadas */ } }
  }, 2500));
}

// Los textos de cada lugar en el idioma actual (app.js, vista3d.js y casco.js leen que_estudiar)
function traducirPois() {
  for (const p of pois) {
    const txt = p[IDIOMA] || p.en;
    if (!txt) continue;
    p.que_estudiar = txt.que;
    p.instrumento = txt.inst;
    p.muestra = txt.muestra;
  }
  // primera foto del rover: la usan el casco (casco.js) y la vista 3D
  for (const p of pois) if ((p.fotos || []).length) p.foto = DATOS + p.fotos[0].archivo;
}

// Rover que estudio cada lugar (Jezero: Perseverance, Gale: Curiosity)
const roverDe = (p) => p.rover || "Perseverance";
const roverZona = () => (pois[0] && pois[0].rover) || "Perseverance";
const objetivoDe = (p) => CIENCIA.objetivos.find((o) => o.id === p.objetivo);
const colorPoi = (p) => (objetivoDe(p) || {}).color || "#FFD23F";

function htmlFicha(p) {
  const o = objetivoDe(p);
  return `<div class="poi-ficha">
    <b>${p.nombre}</b>
    ${o ? `<span class="poi-obj" style="color:${o.color}">${(o[IDIOMA] || o.en).titulo}</span>` : ""}
    <p>${p.que_estudiar}</p>
    <dl><dt>${t("ci_inst")}</dt><dd>${p.instrumento}</dd>
        <dt>${t("ci_muestra")}</dt><dd>${p.muestra}</dd>
        ${p.sol ? `<dt>${t("ci_rover")}</dt><dd>${t("ci_sol", { n: p.sol, r: roverDe(p) })}</dd>` : ""}</dl>
    ${htmlGaleria(p, 0)}
    ${p.fuente ? `<a href="${p.fuente}" target="_blank" rel="noopener">${t("ci_fuente")}</a>` : ""}
    <button class="btn-sec btn-ancho" data-poi-agregar="${p.id}">${t("ci_agregar")}</button>
  </div>`;
}

// Fotos que tomo Perseverance en ese lugar (scripts/descargar_fotos_rover.py)
function pieFoto(f) {
  return `${f.camara} · ${t("ci_sol_corto", { n: f.sol })} · ${f.credito}`;
}
function htmlGaleria(p, k) {
  const fotos = p.fotos || [];
  if (!fotos.length) return "";
  const f = fotos[k];
  return `<figure class="poi-galeria" data-poi="${p.id}" data-k="${k}">
    <div class="poi-galeria-marco">
      <img src="${DATOS + f.archivo}" alt="${p.nombre}" data-poi-grande="${p.id}" loading="lazy">
      ${fotos.length > 1 ? `<button class="poi-gal-ant" data-gal="-1" aria-label="prev">‹</button>
        <button class="poi-gal-sig" data-gal="1" aria-label="next">›</button>
        <span class="poi-gal-num">${k + 1}/${fotos.length}</span>` : ""}
    </div>
    <figcaption>${t("ci_visto", { r: roverDe(p) })} · ${pieFoto(f)}</figcaption>
  </figure>`;
}

// Visor grande de la foto
function abrirFotoGrande(p, k) {
  let v = document.getElementById("visor-foto");
  if (!v) {
    v = document.createElement("div");
    v.id = "visor-foto";
    document.body.appendChild(v);
    v.addEventListener("click", (e) => { if (e.target === v || e.target.closest("[data-cerrar]")) v.classList.remove("abierto"); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") v.classList.remove("abierto"); });
  }
  const f = p.fotos[k];
  v.innerHTML = `<figure>
    <img src="${DATOS + f.archivo}" alt="${p.nombre}">
    <figcaption><b>${p.nombre}</b> · ${pieFoto(f)}
      ${f.url ? ` · <a href="${f.url}" target="_blank" rel="noopener">${t("ci_original")}</a>` : ""}</figcaption>
    <button class="btn-sec" data-cerrar>${t("ci_cerrar")}</button>
  </figure>`;
  v.classList.add("abierto");
}

document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-gal]");
  if (g) {
    e.preventDefault(); e.stopPropagation();
    const fig = g.closest(".poi-galeria"), p = pois.find((x) => x.id === fig.dataset.poi);
    const n = p.fotos.length, k = (Number(fig.dataset.k) + Number(g.dataset.gal) + n) % n;
    fig.outerHTML = htmlGaleria(p, k);
    return;
  }
  const im = e.target.closest("[data-poi-grande]");
  if (im) {
    const p = pois.find((x) => x.id === im.dataset.poiGrande);
    abrirFotoGrande(p, Number(im.closest(".poi-galeria").dataset.k));
  }
});

// Estrellas en el mapa (reemplazan los circulos amarillos simples de app.js)
function pintarPois() {
  if (CIENCIA.marcas) CIENCIA.marcas.remove();
  CIENCIA.marcas = L.layerGroup();
  for (const p of pois) {
    if (p.lat < info.sur || p.lat > info.norte || p.lon < info.oeste || p.lon > info.este) continue;
    const mk = L.marker(lonlatAMapa(p.lon, p.lat), {
      icon: L.divIcon({ className: "poi-estrella", html: `<span style="background:${colorPoi(p)}">★</span>`, iconSize: [26, 26] }),
      title: p.nombre,
    });
    mk.bindTooltip(p.nombre, { direction: "top", offset: [0, -12] });
    mk.bindPopup(() => htmlFicha(p), { maxWidth: 320, autoPanPaddingTopLeft: L.point(20, 140), minWidth: (p.fotos || []).length ? 300 : 240 });
    CIENCIA.marcas.addLayer(mk);
  }
  CIENCIA.marcas.addTo(mapa);
}

// Agrega un lugar como parada (como si lo tocaran en el mapa)
function agregarPoi(id) {
  const p = pois.find((x) => x.id === id);
  if (!p) return;
  if (!paradas.length) { decir("ci_primero_habitat"); return; }
  if (estaEnRuta(p)) return;
  mapa.closePopup();
  alTocarMapa({ latlng: L.latLng(...lonlatAMapa(p.lon, p.lat)) });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-poi-agregar]");
  if (b) { e.preventDefault(); agregarPoi(b.dataset.poiAgregar); }
});

// Un lugar cuenta como visitado si una parada queda a menos de 150 m (igual que nombreParada)
function estaEnRuta(p) {
  const [py, px] = lonlatAMapa(p.lon, p.lat);
  return paradas.slice(1).some((c) => { const [y, x] = celdaAMapa(c); return Math.hypot(px - x, py - y) < 150; });
}

// Arma la ruta: agrega los lugares de los objetivos elegidos, siempre yendo al mas cercano
function planearObjetivos() {
  if (!paradas.length) { decir("ci_primero_habitat"); return; }
  let pendientes = pois.filter((p) => CIENCIA.elegidos.has(p.objetivo) && !estaEnRuta(p)
    && p.lat >= info.sur && p.lat <= info.norte && p.lon >= info.oeste && p.lon <= info.este);
  let [y, x] = celdaAMapa(paradas[paradas.length - 1]);
  while (pendientes.length) {
    pendientes.sort((a, b) => {
      const [ay, ax] = lonlatAMapa(a.lon, a.lat), [by, bx] = lonlatAMapa(b.lon, b.lat);
      return Math.hypot(ax - x, ay - y) - Math.hypot(bx - x, by - y);
    });
    const p = pendientes.shift();
    alTocarMapa({ latlng: L.latLng(...lonlatAMapa(p.lon, p.lat)) });
    [y, x] = lonlatAMapa(p.lon, p.lat);
  }
}

// Resumen para el panel de la fase y la lista de revision
window.resumenCiencia = () => {
  if (!pois.length || !CIENCIA.objetivos.length) return null;
  const visitados = pois.filter(estaEnRuta);
  const cubiertos = CIENCIA.objetivos.filter((o) => visitados.some((p) => p.objetivo === o.id));
  const muestras = visitados.filter((p) => p.muestra && !/^no$/i.test(p.muestra)).length;
  return { lugares: visitados.length, total: pois.length, objetivos: cubiertos.length,
    totalObjetivos: CIENCIA.objetivos.length, muestras };
};

// Seccion del panel de capas: el titulo se crea una vez (fases.js lo vuelve plegable)
// y solo el cuerpo se vuelve a dibujar cuando cambia la mision
function pintarSeccion() {
  let s = document.getElementById("seccion-ciencia");
  if (!s) {
    s = document.createElement("section");
    s.id = "seccion-ciencia";
    s.innerHTML = `<h2 data-i18n="ci_titulo">${t("ci_titulo")}</h2><div id="ci-cuerpo"></div>`;
    const rail = document.getElementById("rail");
    const ater = document.getElementById("seccion-aterrizaje");
    if (ater) ater.after(s); else rail.prepend(s);
  }
  const cuerpo = document.getElementById("ci-cuerpo");
  cuerpo.innerHTML = `<p class="nota">${t("ci_intro", { r: roverZona() })}</p>
    ${CIENCIA.objetivos.map((o) => {
      const txt = o[IDIOMA] || o.en;
      const lugares = pois.filter((p) => p.objetivo === o.id);
      return `<div class="ci-objetivo" style="--c:${o.color}">
        <label><input type="checkbox" data-objetivo="${o.id}" ${CIENCIA.elegidos.has(o.id) ? "checked" : ""}>
          <span><b>${txt.titulo}</b><small>${txt.desc}</small></span></label>
        <ul>${lugares.map((p) => `<li><button data-poi-ver="${p.id}" class="${estaEnRuta(p) ? "en-ruta" : ""}">
          <i>★</i><span>${p.nombre}</span>${(p.fotos || []).length ? `<small class="ci-cam" title="${t("ci_visto", { r: roverDe(p) })}">📷</small>` : ""}${estaEnRuta(p) ? "<em>✓</em>" : ""}</button></li>`).join("")}</ul>
      </div>`;
    }).join("")}
    <button id="btn-ci-planear" class="btn-principal btn-ancho">${t("ci_planear")}</button>`;
  cuerpo.querySelectorAll("[data-objetivo]").forEach((c) => c.addEventListener("change", () => {
    c.checked ? CIENCIA.elegidos.add(c.dataset.objetivo) : CIENCIA.elegidos.delete(c.dataset.objetivo);
  }));
  cuerpo.querySelectorAll("[data-poi-ver]").forEach((b) => b.addEventListener("click", () => {
    const p = pois.find((x) => x.id === b.dataset.poiVer);
    mapa.flyTo(lonlatAMapa(p.lon, p.lat), Math.max(mapa.getZoom(), -1), { duration: 0.8 });
    CIENCIA.marcas.eachLayer((mk) => { if (mk.options.title === p.nombre) setTimeout(() => mk.openPopup(), 850); });
  }));
  document.getElementById("btn-ci-planear").onclick = planearObjetivos;
}

// Refresca las marcas de "en la ruta" cuando cambia la mision
let firmaCiencia = "";
setInterval(() => {
  if (!pois.length || !document.getElementById("seccion-ciencia")) return;
  const f = paradas.join(",") + IDIOMA;
  if (f !== firmaCiencia) { firmaCiencia = f; pintarSeccion(); }
}, 600);

window.addEventListener("idioma", () => {
  traducirPois();
  firmaCiencia = "";
  const h = document.querySelector("#seccion-ciencia h2");
  if (h) h.textContent = t("ci_titulo");
});
