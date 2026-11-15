// crateres.js
// Crateres detectados con YOLO (scripts/crateres.py -> data/zonas/<zona>/crateres.json).
//  - Capa en el mapa 2D (con filtro de confianza) y lectura del crater bajo el cursor.
//  - Crateres sobre la ruta: se resaltan y se listan en el panel de la mision.
//  - Herramienta "Seleccionar zona": arrastras un rectangulo, el mapa vuela hacia el y los
//    crateres de esa zona aparecen uno por uno, con un resumen de la zona.
//  - Funciones compartidas para la Mesa 3D (vista3d.js) y el casco (casco.js).
// Coordenadas de cada crater: x = m al este, s = m al sur desde el borde norte, d = diametro (m).
// Usa globales de app.js: info, mapa, ultimaMision, celdaAMapa, nombreParada, cuad.

const CRATER = {
  lista: [],          // todos los crateres del json
  confMin: 0.5,       // filtro de confianza (slider)
  capa: null,         // grupo con los circulos del mapa 2D
  render: null,       // render en canvas (miles de circulos sin trabarse)
  enRuta: [],         // [{ c, dist, tramo }] crateres que toca la ruta actual
  seleccion: null,    // capa del crater elegido (anillo animado)
  zona: null,         // estado de la herramienta de zona
};
const MARGEN_RUTA = 15;   // m: el camino "pasa por" el crater si entra a su borde + este margen
const D_MIN_LEJOS = 40;   // m: de lejos solo se dibujan los crateres grandes
window.CRATER = CRATER;

// ---------- Utilidades compartidas (tambien las usan vista3d.js y casco.js) ----------
const craterALatLng = (c) => [info.alto_m - c.s, c.x];
window.crateresVisibles = () => CRATER.lista.filter((c) => c.conf >= CRATER.confMin);

// Crateres cuyo borde esta a menos de 'radio' m del punto (x, s)
window.crateresCerca = (x, s, radio) => crateresVisibles()
  .filter((c) => Math.hypot(c.x - x, c.s - s) - c.d / 2 < radio);

// El crater que contiene el punto (el mas chico, si hay uno dentro de otro)
function craterEn(x, s) {
  let mejor = null;
  for (const c of crateresVisibles()) {
    if (Math.hypot(c.x - x, c.s - s) <= c.d / 2 && (!mejor || c.d < mejor.d)) mejor = c;
  }
  return mejor;
}
window.craterEn = craterEn;

// Distancia de un punto a un segmento (todo en metros)
function distSegmento(px, ps, ax, as, bx, bs) {
  const dx = bx - ax, ds = bs - as, l2 = dx * dx + ds * ds;
  const k = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (ps - as) * ds) / l2)) : 0;
  return Math.hypot(px - (ax + k * dx), ps - (as + k * ds));
}

// Crateres que toca la mision: { c, dist (m del camino al centro), tramo (1..n), dentro (bool) }
function crateresDeMision(m, lista = crateresVisibles()) {
  if (!m) return [];
  const salida = new Map();
  m.tramos.forEach((tr, k) => {
    const pts = tr.camino.map((celda) => { const [lat, lng] = celdaAMapa(celda); return [lng, info.alto_m - lat]; });
    // caja del tramo para no revisar todos los crateres contra todos los segmentos
    let x0 = Infinity, x1 = -Infinity, s0 = Infinity, s1 = -Infinity;
    for (const [x, s] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); s0 = Math.min(s0, s); s1 = Math.max(s1, s); }
    for (const c of lista) {
      const r = c.d / 2 + MARGEN_RUTA;
      if (c.x < x0 - r || c.x > x1 + r || c.s < s0 - r || c.s > s1 + r) continue;
      let dmin = Infinity;
      for (let i = 1; i < pts.length; i++) {
        dmin = Math.min(dmin, distSegmento(c.x, c.s, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
      }
      if (pts.length === 1) dmin = Math.hypot(c.x - pts[0][0], c.s - pts[0][1]);
      if (dmin <= r && (!salida.has(c.id) || salida.get(c.id).dist > dmin)) {
        salida.set(c.id, { c, dist: dmin, tramo: k + 1, dentro: dmin < c.d / 2 });
      }
    }
  });
  return [...salida.values()].sort((a, b) => b.c.d - a.c.d);
}
window.crateresDeMision = crateresDeMision;

const fmtD = (d) => (d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`);
const fmtProf = (c) => (c.prof !== null && c.prof !== undefined && c.prof > 0 ? `${c.prof.toFixed(1)} m` : "--");
window.fmtCrater = (c) => t("crat_item", { d: fmtD(c.d), p: fmtProf(c), c: Math.round(c.conf * 100) });

// ---------- Carga ----------
async function iniciarCrateres() {
  let datos = null;
  try {
    const r = await fetch(DATOS + "crateres.json");
    if (r.ok) datos = await r.json();
  } catch { datos = null; }
  CRATER.lista = (datos && datos.crateres) || [];
  if (!CRATER.lista.length) return; // zona sin crateres procesados: todo funciona igual

  mapa.createPane("crateres").style.zIndex = 420;          // encima de las capas, debajo de la ruta
  mapa.createPane("crateres-sel").style.zIndex = 640;      // anillo animado encima de todo
  CRATER.render = L.canvas({ padding: 0.3, pane: "crateres" });
  CRATER.capa = L.layerGroup();

  // Seccion propia en el panel de capas (antes iba dentro de "Capas cientificas" y se encimaba
  // con la leyenda geologica). Va justo despues de esa seccion.
  const seccionCiencia = document.getElementById("capas-extra").closest("section");
  seccionCiencia.insertAdjacentHTML("afterend", `
    <section id="seccion-crateres">
      <h2 data-i18n="crat_seccion">${t("crat_seccion")}</h2>
      <div class="crat-control">
        <label class="crat-fila"><input type="checkbox" id="chk-crateres" checked>
          <span class="crat-nombre" data-i18n="capa_crateres">${t("capa_crateres")}</span>
          <span class="dato" id="crat-cuenta"></span></label>
        <div class="crat-rango">
          <span class="crat-rango-txt" data-i18n="crat_conf">${t("crat_conf")}</span>
          <span class="dato" id="txt-crat-conf">${Math.round(CRATER.confMin * 100)}%</span>
          <input type="range" id="rng-crat-conf" min="0.25" max="0.95" step="0.05" value="${CRATER.confMin}" aria-label="Crater confidence">
        </div>
        <ul class="crat-leyenda">
          <li><i class="crat-muestra"></i><span data-i18n="crat_ley">${t("crat_ley")}</span></li>
          ${CRATER.lista.some((c) => c.relieve) ? `
          <li><i class="crat-muestra confirmado"></i><span data-i18n="crat_ley_conf">${t("crat_ley_conf")}</span></li>
          <li><i class="crat-muestra foto"></i><span data-i18n="crat_ley_foto">${t("crat_ley_foto")}</span></li>` : ""}
          <li><i class="crat-muestra ruta"></i><span data-i18n="crat_ley_ruta">${t("crat_ley_ruta")}</span></li>
        </ul>
        <button id="btn-explorador" class="btn-sec btn-ancho" data-i18n="exp_abrir">${t("exp_abrir")}</button>
      </div>
    </section>`);
  const chk = document.getElementById("chk-crateres");
  chk.addEventListener("change", () => { chk.checked ? CRATER.capa.addTo(mapa) : CRATER.capa.remove(); });
  document.getElementById("rng-crat-conf").addEventListener("input", (e) => {
    CRATER.confMin = parseFloat(e.target.value);
    document.getElementById("txt-crat-conf").textContent = `${Math.round(CRATER.confMin * 100)}%`;
    dibujarCrateres();
    crateresRuta(ultimaMision);
    window.dispatchEvent(new Event("crateres")); // la Mesa 3D se vuelve a dibujar
  });

  CRATER.capa.addTo(mapa);
  mapa.on("zoomend", dibujarCrateres);
  dibujarCrateres();
  prepararZona();
  document.getElementById("btn-explorar-crateres").classList.remove("oculto");
}
window.iniciarCrateres = iniciarCrateres;

// Circulos en el mapa. No son interactivos: asi tocar dentro de un crater sigue poniendo paradas.
function dibujarCrateres() {
  if (!CRATER.capa) return;
  CRATER.capa.clearLayers();
  const cerca = mapa.getZoom() >= -1;
  const ids = new Set(CRATER.enRuta.map((e) => e.c.id));
  let n = 0;
  for (const c of crateresVisibles()) {
    n++;
    const enRuta = ids.has(c.id);
    if (!cerca && c.d < D_MIN_LEJOS && !enRuta) continue;
    L.circle(craterALatLng(c), {
      radius: c.d / 2, renderer: CRATER.render, pane: "crateres", interactive: false,
      // confirmado por el relieve (scripts/validar_crateres.py) = linea cian continua;
      // solo visto en la foto = linea punteada
      color: enRuta ? "#FFB547" : c.relieve === "confirmado" ? "#4FD1E8" : "#F4EDE4",
      weight: enRuta ? 2.5 : c.relieve === "confirmado" ? 2 : 1.2,
      dashArray: c.relieve === "solo_foto" && !enRuta ? "4 4" : null,
      opacity: enRuta ? 1 : 0.35 + 0.6 * c.conf,
      fill: enRuta, fillColor: "#FFB547", fillOpacity: 0.12,
    }).addTo(CRATER.capa);
  }
  document.getElementById("crat-cuenta").textContent = n.toLocaleString("en-US");
}

// Lectura bajo el cursor (app.js la agrega a la caja de coordenadas)
window.textoCraterEn = (latlng) => {
  const c = CRATER.lista.length ? craterEn(latlng.lng, info.alto_m - latlng.lat) : null;
  return c ? `   ${t("crat_hover", { d: fmtD(c.d) })}` : "";
};

// ---------- Crateres sobre la ruta (panel de la mision) ----------
function crateresRuta(m) {
  CRATER.enRuta = CRATER.lista.length ? crateresDeMision(m) : [];
  dibujarCrateres();
  const caja = document.getElementById("crateres-ruta");
  if (!caja) return;
  caja.classList.toggle("oculto", !CRATER.lista.length || !m);
  if (!m) return;
  const lista = CRATER.enRuta;
  const resumen = document.getElementById("crat-ruta-resumen");
  if (!lista.length) {
    resumen.textContent = t("crat_ruta_ninguno");
    document.getElementById("crat-ruta-lista").innerHTML = "";
    return;
  }
  const dentro = lista.filter((e) => e.dentro).length;
  resumen.textContent = t("crat_ruta_resumen", { n: lista.length, m: MARGEN_RUTA }) +
    (dentro ? " " + t("crat_ruta_dentro", { n: dentro }) : "");
  document.getElementById("crat-ruta-lista").innerHTML = lista.slice(0, 8).map((e, i) => `
    <li><button data-i="${i}">
      <span class="punto crater${e.dentro ? " dentro" : ""}">${i + 1}</span>
      <span class="paso">${t("crat_titulo")} ${fmtD(e.c.d)}<small>${fmtCrater(e.c)} · ${t("crat_tramo", { n: e.tramo })}</small></span>
      <span class="hora">${e.dentro ? t("crat_cruza") : `${Math.round(Math.max(0, e.dist - e.c.d / 2))} m`}</span>
    </button></li>`).join("");
  document.querySelectorAll("#crat-ruta-lista button").forEach((b) =>
    b.addEventListener("click", () => seleccionarCrater(lista[parseInt(b.dataset.i, 10)].c)));
}
window.crateresRuta = crateresRuta;

// ---------- Seleccionar un crater: vuelo + anillo que pulsa ----------
function seleccionarCrater(c, volar = true) {
  if (CRATER.seleccion) CRATER.seleccion.remove();
  const centro = craterALatLng(c);
  CRATER.seleccion = L.layerGroup([
    L.circle(centro, { radius: c.d / 2, pane: "crateres-sel", interactive: false, className: "crater-sel",
      color: "#F26B3A", weight: 3, fill: false }),
    L.circle(centro, { radius: c.d / 2, pane: "crateres-sel", interactive: false, className: "crater-sel onda",
      color: "#F26B3A", weight: 2, fill: false }),
  ]).addTo(mapa);
  if (volar) {
    const r = Math.max(c.d * 1.6, 160);
    mapa.flyToBounds([[centro[0] - r, centro[1] - r], [centro[0] + r, centro[1] + r]], { duration: 1.1 });
  }
  L.popup({ offset: [0, -4], autoPan: false })
    .setLatLng([centro[0] + c.d / 2, centro[1]])
    .setContent(`<b>${t("crat_titulo")} ${fmtD(c.d)}</b><br>${fmtCrater(c)}<br>` +
      `<span class="tenue">${c.lat.toFixed(4)}° N · ${c.lon.toFixed(4)}° E · ${t("crat_votos", { n: c.votos })} · ${c.fuente.toUpperCase()}</span>`)
    .openOn(mapa);
}
window.seleccionarCrater = seleccionarCrater;

// ---------- Herramienta "Seleccionar zona" ----------
// Arrastrar un rectangulo -> el rectangulo se "fija" con una animacion, el mapa vuela hacia el,
// los crateres de la zona aparecen escalonados y sale una tarjeta con el resumen.
function prepararZona() {
  document.getElementById("zona-mapa").insertAdjacentHTML("beforeend",
    `<button id="btn-zona" class="btn-sec flotante-zona" aria-pressed="false"><span aria-hidden="true">&#9633;</span> <span data-i18n="zona_btn">${t("zona_btn")}</span></button>`);
  document.getElementById("zona-mapa").insertAdjacentHTML("beforeend", `
    <section id="tarjeta-zona" class="flotante oculto" aria-live="polite">
      <div class="fila-etiqueta"><span class="etiqueta" data-i18n="zona_titulo">${t("zona_titulo")}</span>
        <button id="zona-cerrar" class="cerrar" aria-label="Close">&times;</button></div>
      <div id="zona-datos"></div>
      <ol id="zona-lista" class="lista-crateres"></ol>
    </section>`);
  const boton = document.getElementById("btn-zona");
  const cont = mapa.getContainer();
  CRATER.zona = { activa: false, inicio: null, rect: null, aparecidos: null };

  boton.addEventListener("click", () => (CRATER.zona.activa ? salirModoZona() : entrarModoZona()));
  document.getElementById("zona-cerrar").addEventListener("click", limpiarZona);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && CRATER.zona.activa) salirModoZona(); });

  function entrarModoZona() {
    CRATER.zona.activa = true;
    window.modoZona = true; // app.js no pone paradas mientras tanto
    boton.classList.add("activo"); boton.setAttribute("aria-pressed", "true");
    cont.classList.add("modo-zona");
    mapa.dragging.disable();
    decirZona();
  }
  function salirModoZona() {
    CRATER.zona.activa = false;
    boton.classList.remove("activo"); boton.setAttribute("aria-pressed", "false");
    cont.classList.remove("modo-zona");
    mapa.dragging.enable();
    if (typeof ultimoMensaje !== "undefined") texto(t(ultimoMensaje.clave, ultimoMensaje.v));
    // el clic que termina el arrastre llega despues: se deja pasar un momento antes de volver a poner paradas
    setTimeout(() => { window.modoZona = false; }, 50);
  }

  cont.addEventListener("pointerdown", (e) => {
    if (!CRATER.zona.activa || e.button > 0 || e.target.closest(".leaflet-control")) return;
    limpiarZona();
    CRATER.zona.inicio = mapa.mouseEventToLatLng(e);
    CRATER.zona.rect = L.rectangle([CRATER.zona.inicio, CRATER.zona.inicio], {
      pane: "crateres-sel", interactive: false, className: "zona-sel dibujando",
      color: "#4FD1E8", weight: 2, fillColor: "#4FD1E8", fillOpacity: 0.08,
    }).addTo(mapa);
    cont.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  cont.addEventListener("pointermove", (e) => {
    if (!CRATER.zona.activa || !CRATER.zona.inicio) return;
    CRATER.zona.rect.setBounds(L.latLngBounds(CRATER.zona.inicio, mapa.mouseEventToLatLng(e)));
  });
  cont.addEventListener("pointerup", (e) => {
    if (!CRATER.zona.activa || !CRATER.zona.inicio) return;
    const b = L.latLngBounds(CRATER.zona.inicio, mapa.mouseEventToLatLng(e));
    CRATER.zona.inicio = null;
    salirModoZona();
    // menos de 40 m de lado: fue un toque, no una seleccion
    if (b.getEast() - b.getWest() < 40 || b.getNorth() - b.getSouth() < 40) { limpiarZona(); return; }
    fijarZona(b);
  });
}

function decirZona() {
  if (typeof texto === "function") texto(t("zona_instr"));
}

function limpiarZona() {
  const z = CRATER.zona;
  if (!z) return;
  if (z.rect) { z.rect.remove(); z.rect = null; }
  if (z.aparecidos) { z.aparecidos.remove(); z.aparecidos = null; }
  if (z.esquinas) { z.esquinas.remove(); z.esquinas = null; }
  document.getElementById("tarjeta-zona").classList.add("oculto");
}

function fijarZona(b) {
  const z = CRATER.zona;
  // 1) el rectangulo deja de "dibujarse" y se fija con un destello
  const el = z.rect.getElement();
  if (el) { el.classList.remove("dibujando"); el.classList.add("fijada"); }
  // esquinas tipo mira, que se cierran hacia la zona
  const w = b.getEast() - b.getWest(), h = b.getNorth() - b.getSouth(), l = Math.min(w, h) * 0.18;
  const esq = (y, x, dy, dx) => L.polyline([[y + dy, x], [y, x], [y, x + dx]],
    { pane: "crateres-sel", interactive: false, className: "zona-esquina", color: "#4FD1E8", weight: 4 });
  z.esquinas = L.layerGroup([
    esq(b.getNorth(), b.getWest(), -l, l), esq(b.getNorth(), b.getEast(), -l, -l),
    esq(b.getSouth(), b.getWest(), l, l), esq(b.getSouth(), b.getEast(), l, -l),
  ]).addTo(mapa);

  // 2) el mapa vuela a la zona
  mapa.flyToBounds(b, { duration: 1.2, padding: [60, 60] });

  // 3) al llegar, los crateres de la zona aparecen uno por uno (del centro hacia afuera)
  const cx = (b.getEast() + b.getWest()) / 2, cy = (b.getNorth() + b.getSouth()) / 2;
  const dentro = crateresVisibles().filter((c) => b.contains(craterALatLng(c)))
    .sort((a, c) => Math.hypot(a.x - cx, info.alto_m - a.s - cy) - Math.hypot(c.x - cx, info.alto_m - c.s - cy));
  mapa.once("moveend", () => {
    if (CRATER.zona.rect === null) return; // se cerro mientras volaba
    z.aparecidos = L.layerGroup().addTo(mapa);
    const max = Math.min(dentro.length, 250);
    for (let i = 0; i < max; i++) {
      const c = dentro[i];
      const circ = L.circle(craterALatLng(c), { radius: c.d / 2, pane: "crateres-sel", interactive: false,
        className: "crater-aparece", color: "#FFD23F", weight: 2, fillColor: "#FFD23F", fillOpacity: 0.15 });
      circ.addTo(z.aparecidos);
      const p = circ.getElement();
      if (p) p.style.animationDelay = `${Math.min(i * 18, 1800)}ms`;
    }
    mostrarTarjetaZona(b, dentro);
  });
}

function mostrarTarjetaZona(b, dentro) {
  const w = (b.getEast() - b.getWest()) / 1000, h = (b.getNorth() - b.getSouth()) / 1000;
  const area = w * h;
  // pendiente media de la zona (cuadricula de 20 m)
  let suma = 0, n = 0;
  for (let i = 0; i < cuad.pendiente.length; i++) {
    const [lat, lng] = celdaAMapa(i);
    if (cuad.pendiente[i] >= 0 && b.contains([lat, lng])) { suma += cuad.pendiente[i] / 10; n++; }
  }
  const mayor = dentro.reduce((m, c) => (!m || c.d > m.d ? c : m), null);
  document.getElementById("zona-datos").innerHTML = `
    <div class="zona-cifras">
      <div><span class="etiqueta" data-i18n="zona_area">${t("zona_area")}</span><b class="mono">${w.toFixed(2)} × ${h.toFixed(2)} km</b></div>
      <div><span class="etiqueta" data-i18n="zona_crateres">${t("zona_crateres")}</span><b class="mono contador" data-fin="${dentro.length}">0</b></div>
      <div><span class="etiqueta" data-i18n="zona_densidad">${t("zona_densidad")}</span><b class="mono">${(dentro.length / Math.max(area, 1e-6)).toFixed(1)} /km²</b></div>
      <div><span class="etiqueta" data-i18n="zona_pend">${t("zona_pend")}</span><b class="mono">${n ? (suma / n).toFixed(1) + "°" : "--"}</b></div>
    </div>
    ${mayor ? `<p class="nota">${t("zona_mayor", { d: fmtD(mayor.d) })}</p>` : `<p class="nota">${t("zona_sin")}</p>`}`;
  const lista = [...dentro].sort((a, c) => c.d - a.d).slice(0, 6);
  document.getElementById("zona-lista").innerHTML = lista.map((c, i) =>
    `<li><button data-i="${i}"><b>${fmtD(c.d)}</b> <span class="tenue">${fmtCrater(c)}</span></button></li>`).join("");
  document.querySelectorAll("#zona-lista button").forEach((btn) =>
    btn.addEventListener("click", () => seleccionarCrater(lista[parseInt(btn.dataset.i, 10)])));
  const tarjeta = document.getElementById("tarjeta-zona");
  tarjeta.classList.remove("oculto");
  tarjeta.classList.remove("entra"); void tarjeta.offsetWidth; tarjeta.classList.add("entra");
  // contador animado del numero de crateres
  const cont = tarjeta.querySelector(".contador"), fin = dentro.length, t0 = performance.now();
  const paso = (ahora) => {
    const k = Math.min(1, (ahora - t0) / 900);
    cont.textContent = Math.round(fin * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

// Al cambiar de idioma: textos que arma este archivo
window.addEventListener("idioma", () => {
  if (!CRATER.lista.length) return;
  crateresRuta(ultimaMision);
  document.getElementById("tarjeta-zona").classList.add("oculto");
});
