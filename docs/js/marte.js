// marte.js
// Pantalla de inicio: mapa completo de Marte con los sitios de aterrizaje.
// Si un sitio tiene sus datos procesados (esta en data/zonas.json) se puede entrar a planear la caminata;
// los demas solo muestran su informacion.
// La pantalla sale al abrir la pagina sin ?zona=... y con el boton "Mars" de la barra.

// Mosaico global a color de Viking (NASA Mars Trek, proyeccion equirectangular). Necesita internet.
const MOSAICO_MARTE =
  "https://trek.nasa.gov/tiles/Mars/EQ/Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg";

const marte = {
  mapa: null,
  sitios: [],
  listos: new Set(), // zonas con datos (de data/zonas.json)
  marcas: {},
  elegido: null,
  pulso: null,    // marca animada del sitio elegido
  cuadros: {},    // cuadro de 6 km de cada zona lista
};

async function abrirMarte() {
  document.body.classList.add("modo-marte");
  if (!marte.mapa) await crearMapaMarte();
  marte.mapa.invalidateSize();
  if (!marte.elegido || !marte.volo) marte.mapa.fitBounds([[-90, -180], [90, 180]]);
}

function cerrarMarte() {
  document.body.classList.remove("modo-marte");
  if (typeof mapa !== "undefined" && mapa) mapa.invalidateSize();
}

async function crearMapaMarte() {
  try {
    marte.sitios = await (await fetch("data/sitios.json")).json();
  } catch { marte.sitios = []; }
  try {
    const z = await (await fetch("data/zonas.json")).json();
    z.forEach((x) => marte.listos.add(x.id));
  } catch { /* sin zonas.json */ }

  // Leaflet con grados como coordenadas: en el zoom 0 son 2 mosaicos (oeste y este), igual que Mars Trek
  marte.mapa = L.map("mapa-marte", {
    crs: L.CRS.EPSG4326,
    minZoom: 0,
    maxZoom: 9,
    maxBounds: [[-90, -180], [90, 180]],
    maxBoundsViscosity: 1,
    attributionControl: false,
    zoomControl: false,
    zoomSnap: 0.25, // permite zoom intermedio para que Marte llene el espacio
  });
  L.control.zoom({ position: "topright" }).addTo(marte.mapa);
  marte.mapa.fitBounds([[-90, -180], [90, 180]]);

  // 1) Mapa guardado dentro de la pagina (scripts/descargar_marte.py), niveles 0 a 4: funciona sin internet.
  //    Al acercarse mas se sigue viendo, solo que estirado.
  const local = L.tileLayer("data/marte/{z}/{y}/{x}.jpg", {
    tileSize: 256, noWrap: true, maxNativeZoom: 4, bounds: [[-90, -180], [90, 180]],
  }).addTo(marte.mapa);
  // 2) Encima, el detalle de Mars Trek desde el nivel 5 (si hay internet). Si no hay, se queda el local.
  L.tileLayer(MOSAICO_MARTE, {
    tileSize: 256, noWrap: true, minZoom: 5, maxNativeZoom: 7, bounds: [[-90, -180], [90, 180]],
  }).addTo(marte.mapa);
  // si faltan los mosaicos locales (no se corrio el script) se avisa
  const aviso = document.getElementById("marte-sin-red");
  let fallas = 0;
  local.on("tileerror", () => { if (++fallas > 3) aviso.classList.remove("oculto"); });
  local.on("tileload", () => aviso.classList.add("oculto"));


  for (const s of marte.sitios) {
    const listo = s.zona && marte.listos.has(s.zona);
    const marca = L.circleMarker([s.lat, s.lon], {
      radius: listo ? 9 : 7, weight: 2,
      color: listo ? "#F26B3A" : "#4FD1E8", fillColor: listo ? "#F26B3A" : "#0B0F17", fillOpacity: listo ? 0.9 : 0.8,
    }).addTo(marte.mapa);
    marca.bindTooltip(`${s.mision} · ${s.nombre}`, { direction: "top", offset: [0, -8] });
    marca.on("click", () => elegirSitio(s.id, true));
    marte.marcas[s.id] = marca;
    // cuadro de 6 km de la zona que se puede planear
    if (listo) {
      const dlat = 3000 / (Math.PI * 3396190 / 180);
      const dlon = dlat / Math.cos((s.lat * Math.PI) / 180);
      marte.cuadros[s.id] = L.rectangle([[s.lat - dlat, s.lon - dlon], [s.lat + dlat, s.lon + dlon]],
        { color: "#F26B3A", weight: 2, fill: false, interactive: false, className: "cuadro-zona" }).addTo(marte.mapa);
    }
  }
  llenarListaSitios();
  // de inicio queda elegido el primer sitio que ya se puede planear (Jezero)
  const primero = marte.sitios.find((s) => s.zona && marte.listos.has(s.zona));
  if (primero) elegirSitio(primero.id, false);
}

function llenarListaSitios() {
  const caja = document.getElementById("lista-sitios");
  // primero los que ya se pueden planear
  const orden = [...marte.sitios].sort((a, b) =>
    (b.zona && marte.listos.has(b.zona) ? 1 : 0) - (a.zona && marte.listos.has(a.zona) ? 1 : 0));
  caja.innerHTML = orden.map((s) => {
    const listo = s.zona && marte.listos.has(s.zona);
    return `<button data-sitio="${s.id}" class="${s.id === marte.elegido ? "activo" : ""}">
      <span class="bolita" style="background:${listo ? "#F26B3A" : "#4FD1E8"}"></span>
      <span class="sitio-texto"><b>${s.nombre}</b><small>${s.mision} · ${s.fecha.slice(0, 4)}</small></span>
      ${listo ? `<span class="chip go chico">${t("m_listo")}</span>` : ""}
    </button>`;
  }).join("");
  caja.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => elegirSitio(b.dataset.sitio, true)));
}

function elegirSitio(id, volar) {
  const s = marte.sitios.find((x) => x.id === id);
  if (!s) return;
  marte.elegido = id;
  document.querySelectorAll("#lista-sitios button").forEach((b) => b.classList.toggle("activo", b.dataset.sitio === id));
  for (const [k, m] of Object.entries(marte.marcas)) m.setStyle({ weight: k === id ? 4 : 2 });
  if (volar) marte.volo = true;
  if (volar) marte.mapa.flyTo([s.lat, s.lon], 6, { duration: 1.4 });
  // marca que late sobre el sitio elegido y el cuadro de la zona que se "dibuja"
  if (marte.pulso) marte.pulso.remove();
  marte.pulso = L.marker([s.lat, s.lon], { interactive: false, keyboard: false,
    icon: L.divIcon({ className: "pulso-sitio", html: "<span></span><span></span><span></span>", iconSize: [80, 80] }) }).addTo(marte.mapa);
  const cuadro = marte.cuadros[id] && marte.cuadros[id].getElement();
  if (cuadro) { cuadro.classList.remove("dibuja"); void cuadro.getBoundingClientRect(); cuadro.classList.add("dibuja"); }

  const listo = s.zona && marte.listos.has(s.zona);
  const lat = `${Math.abs(s.lat).toFixed(2)}° ${s.lat >= 0 ? "N" : "S"}`;
  const lonE = ((s.lon % 360) + 360) % 360;
  document.getElementById("ficha-sitio").classList.remove("oculto");
  document.getElementById("fs-nombre").textContent = s.nombre;
  document.getElementById("fs-mision").textContent = `${s.mision} · ${s.agencia} · ${s.fecha}`;
  document.getElementById("fs-coord").textContent = `${lat}, ${lonE.toFixed(2)}° E`;
  document.getElementById("fs-texto").textContent = s[IDIOMA] || s.en;
  const estado = document.getElementById("fs-estado");
  estado.className = "chip" + (listo ? " go" : "");
  estado.textContent = listo ? t("m_listo_largo") : t("m_sin_datos");
  const boton = document.getElementById("fs-entrar");
  boton.classList.toggle("oculto", !listo);
  boton.onclick = () => entrarSitio(s.zona);
  document.getElementById("fs-nota").classList.toggle("oculto", !!listo);
}

// Entrar a planear: si es la zona que ya esta abierta solo se cierra la pantalla; si no, se recarga con esa zona
// Animacion de entrada: la camara desciende hasta el cuadro de la zona, la pantalla se funde con
// "Descendiendo a ..." y el planeador aparece acercandose desde lejos.
let descendiendo = false;
function entrarSitio(zona) {
  if (descendiendo) return;
  const actual = new URLSearchParams(location.search).get("zona");
  const abierta = (window.DATOS || "").includes(`/zonas/${zona}/`);
  const s = marte.sitios.find((x) => x.zona === zona);
  const seguir = () => {
    if (abierta) {
      if (!actual) history.replaceState(null, "", "?zona=" + encodeURIComponent(zona));
      cerrarMarte();
      acercarPlaneador();
      setTimeout(() => { velo.classList.remove("visible"); descendiendo = false; }, 150);
      return;
    }
    try { sessionStorage.setItem("mm-descenso", "1"); } catch { /* sin almacenamiento */ }
    location.search = "?zona=" + encodeURIComponent(zona);
  };
  const velo = document.getElementById("velo-descenso");
  const sinAnimacion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!s || !marte.mapa || sinAnimacion) { seguir(); return; }
  descendiendo = true;
  document.getElementById("velo-texto").textContent = t("m_descenso", { sitio: s.nombre });
  const cuadro = marte.cuadros[s.id];
  if (cuadro) marte.mapa.flyToBounds(cuadro.getBounds(), { duration: 1.6, padding: [40, 40] });
  else marte.mapa.flyTo([s.lat, s.lon], 9, { duration: 1.6 });
  setTimeout(() => velo.classList.add("visible"), 1100);   // fundido a la mitad del descenso
  setTimeout(seguir, 1900);
}

// El mapa del planeador entra acercandose a la zona completa
function acercarPlaneador() {
  if (typeof mapa === "undefined" || !mapa || typeof info === "undefined" || !info) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const limites = [[0, 0], [info.alto_m, info.ancho_m]];
  mapa.invalidateSize();
  mapa.fitBounds(limites, { animate: false });
  const destino = mapa.getZoom();
  mapa.setView(mapa.getCenter(), destino - 2.5, { animate: false });
  mapa.flyTo(mapa.getCenter(), destino, { duration: 1.3 });
}

document.getElementById("btn-marte").addEventListener("click", abrirMarte);
document.getElementById("btn-marte-cerrar").addEventListener("click", cerrarMarte);
window.addEventListener("idioma", () => {
  if (!marte.mapa) return;
  llenarListaSitios();
  if (marte.elegido) elegirSitio(marte.elegido, false);
});

// Si se llego por una recarga desde el descenso, el planeador tambien entra acercandose
// (se espera a que app.js termine de cargar la zona)
let vieneDeDescenso = false;
try { vieneDeDescenso = !!sessionStorage.getItem("mm-descenso"); sessionStorage.removeItem("mm-descenso"); } catch { /* sin almacenamiento */ }
if (vieneDeDescenso) {
  let intentos = 0;
  const esperar = () => {
    if (typeof mapa !== "undefined" && mapa && typeof info !== "undefined" && info) acercarPlaneador();
    else if (intentos++ < 40) setTimeout(esperar, 100);
  };
  esperar();
}

// Al abrir la pagina sin una zona elegida, se empieza en el mapa de Marte
if (!new URLSearchParams(location.search).get("zona")) abrirMarte();
