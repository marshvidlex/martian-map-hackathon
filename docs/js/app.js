// app.js
// Mapa por capas, clics para inicio/destino y panel de la caminata.
// Coordenadas del mapa: metros desde la esquina inferior izquierda del recorte.
//   lat de Leaflet = metros hacia el norte, lng de Leaflet = metros hacia el este.

let info, cuad, mapa, pois = [];
// Limite de pendiente para caminar (grados). Arriba de esto la casilla queda bloqueada.
// Se puede cambiar en "Mission parameters" sin volver a procesar los datos.
const LIMITE_PENDIENTE = 15;
// Carpeta de la zona que se esta viendo (data/zonas/<zona>/). La usan tambien vista3d.js y casco.js
window.DATOS = "data/";
let paradas = [];            // indices de celda; paradas[0] es el habitat
let marcadores = [];
let lineas = [];
let capaRegreso = null;
let ultimaMision = null;

async function cargarJSON(ruta) {
  const resp = await fetch(ruta);
  if (!resp.ok) throw new Error("Could not load " + ruta);
  return resp.json();
}

// Lee la lista de zonas y decide cual abrir: la de la direccion (?zona=gale) o la primera.
// Si no hay zonas.json (proyecto viejo), se usa docs/data como antes.
async function elegirZona() {
  const selector = document.getElementById("sel-zona");
  let zonas = [];
  try {
    const r = await fetch("data/zonas.json");
    if (r.ok) zonas = await r.json();
  } catch { zonas = []; }
  if (!zonas.length) {
    selector.closest(".zona").classList.add("oculto");
    return;
  }
  const pedida = new URLSearchParams(location.search).get("zona");
  const zona = zonas.find((z) => z.id === pedida) || zonas[0];
  window.DATOS = `data/zonas/${zona.id}/`;
  for (const z of zonas) {
    const lat = `${Math.abs(z.lat).toFixed(2)}° ${z.lat >= 0 ? "N" : "S"}`;
    selector.insertAdjacentHTML("beforeend",
      `<option value="${z.id}">${z.nombre} (${lat}, ${z.lon.toFixed(2)}° E)</option>`);
  }
  selector.value = zona.id;
  // cambiar de zona = recargar la pagina con la otra zona (asi el 3D y el casco empiezan limpios)
  selector.addEventListener("change", () => {
    location.search = "?zona=" + encodeURIComponent(selector.value);
  });
}

async function iniciar() {
  await elegirZona();
  [info, cuad, pois] = await Promise.all([
    cargarJSON(DATOS + "info.json"),
    cargarJSON(DATOS + "cuadricula.json"),
    cargarJSON(DATOS + "poi.json").catch(() => []),
  ]);
  if (info.nombre) {
    document.getElementById("nombre-zona").textContent = info.nombre;
    document.title = "Martian Map - " + info.nombre;
  }

  const limites = [[0, 0], [info.alto_m, info.ancho_m]];
  mapa = L.map("mapa", {
    crs: L.CRS.Simple, // mapa plano, sin proyeccion de la Tierra
    minZoom: -5,
    maxZoom: 2,
    zoomSnap: 0.25,
    attributionControl: false,
  });
  mapa.fitBounds(limites);
  mapa.zoomControl.setPosition("topright"); // en el diseno nuevo el zoom va a la derecha

  // --- Capas fijas ---
  const capas = {
    foto: L.imageOverlay(DATOS + "foto.png", limites),
    elevacion: L.imageOverlay(DATOS + "elevacion.png", limites),
    // la capa de pendiente se pinta aqui con el limite actual, asi el rojo siempre coincide con lo bloqueado
    pendiente: L.imageOverlay(pintarPendiente(LIMITE_PENDIENTE), limites, { className: "pixelada" }),
  };
  if (info.tiene_rugosidad) {
    capas.rugosidad = L.imageOverlay(DATOS + "rugosidad.png", limites, { className: "pixelada" });
  } else {
    document.getElementById("bloque-rugosidad").classList.add("oculto");
  }

  // --- Capas extra (THEMIS, CRISM...): salen de info.json, no hay que tocar el HTML ---
  const contenedor = document.getElementById("capas-extra");
  for (const extra of info.capas_extra || []) {
    const rango = extra.min !== undefined ? `<span class="nota">${t("rango", { min: extra.min, max: extra.max })}</span>` : "";
    // las capas conocidas llevan su texto en los dos idiomas
    const etiqueta = extra.nombre === "geologia" ? `<span data-i18n="capa_geologia">${t("capa_geologia")}</span>` : extra.etiqueta;
    // la capa geologica lleva su leyenda de colores (sale de info.geologia, la hace geologia.py)
    const leyenda = extra.nombre === "geologia" && info.geologia
      ? `<div class="leyenda">${info.geologia.map((u) =>
          `<div><span style="background:${u.color}"></span>${u.nombre}${u.simbolo ? ` (${u.simbolo})` : ""} · ${u.pct}%</div>`).join("")}</div>`
      : "";
    contenedor.insertAdjacentHTML("beforeend", `
      <div class="capa">
        <label><input type="checkbox" id="chk-${extra.nombre}"> ${etiqueta} ${rango}</label>
        <input type="range" id="op-${extra.nombre}" min="0" max="1" step="0.1" value="0.6">
        ${leyenda}
      </div>`);
    capas[extra.nombre] = L.imageOverlay(`${DATOS}${extra.nombre}.png`, limites);
  }

  for (const nombre of Object.keys(capas)) {
    const chk = document.getElementById("chk-" + nombre);
    const op = document.getElementById("op-" + nombre);
    const capa = capas[nombre];
    capa.setOpacity(op.value);
    if (chk.checked) capa.addTo(mapa);
    chk.addEventListener("change", () => (chk.checked ? capa.addTo(mapa) : capa.remove()));
    op.addEventListener("input", () => capa.setOpacity(op.value));
  }

  // Valores por defecto del panel
  document.getElementById("p-pendiente").value = LIMITE_PENDIENTE;
  document.getElementById("p-pendiente").addEventListener("change", (e) => {
    capas.pendiente.setUrl(pintarPendiente(parseFloat(e.target.value) || LIMITE_PENDIENTE));
  });
  if (info.rugosidad_max) document.getElementById("p-rugosidad").value = info.rugosidad_max;

  // --- Puntos de interes (con foto opcional) ---
  for (const p of pois) {
    // si el punto no cae dentro de esta zona no se dibuja
    if (p.lat < info.sur || p.lat > info.norte || p.lon < info.oeste || p.lon > info.este) continue;
    const foto = p.foto ? `<br><img src="${p.foto}" width="200" alt="${p.nombre}">` : "";
    L.circleMarker(lonlatAMapa(p.lon, p.lat), { radius: 8, color: "#ffd23f", fillOpacity: 0.8 })
      .bindPopup(() => `<b>${p.nombre}</b><br>${p.que_estudiar}<br><i>${t("observado")}: ${p.instrumento}</i>${foto}`)
      .on("click", alTocarMapa) // tocar el punto tambien lo agrega a la mision
      .addTo(mapa);
  }

  // --- Recorrido real de Perseverance (opcional) ---
  // Si en la carpeta de la zona esta M20_traverse.json (el GeoJSON de NASA "Where is Perseverance?"),
  // se dibuja como linea blanca. La Mesa 3D tambien lo usa.
  await cargarRecorridoRover();

  // --- Eventos ---
  mapa.on("click", alTocarMapa);
  // lectura de coordenadas, altura y pendiente bajo el cursor
  mapa.on("mousemove", (e) => {
    const caja = document.getElementById("coordenadas");
    const celda = mapaACelda(e.latlng);
    if (celda === null) { caja.textContent = t("fuera_mapa"); return; }
    const [lon, lat] = mapaALonlat(e.latlng);
    const z = cuad.elevacion[celda], p = cuad.pendiente[celda];
    caja.textContent = `${lat.toFixed(4)}° N · ${lon.toFixed(4)}° E` +
      (z > -99999 ? `   ${Math.round(z).toLocaleString("en-US")} m` : "") +
      (p >= 0 ? `   ${t("pendiente_corta")} ${(p / 10).toFixed(1)}°` : "");
  });
  document.getElementById("btn-borrar").addEventListener("click", borrarMision);
  document.getElementById("btn-quitar").addEventListener("click", quitarUltima);
  // al esconder/mostrar el panel el mapa cambia de tamano: hay que avisarle a Leaflet
  document.getElementById("btn-casco").addEventListener("click", () => {
    document.body.classList.add("casco");
    mapa.invalidateSize();
  });
  document.getElementById("btn-salir-casco").addEventListener("click", () => {
    document.body.classList.remove("casco");
    mapa.invalidateSize();
  });
  document.getElementById("btn-aprobar").addEventListener("click", aprobarMision);
  document.getElementById("chk-regreso").addEventListener("change", dibujarZonaRegreso);
  document.getElementById("chk-tormenta").addEventListener("change", calcular);
  document.querySelectorAll("details input").forEach((inp) =>
    inp.addEventListener("change", () => { calcular(); dibujarZonaRegreso(); })
  );
}

// ---------- Capa de pendiente ----------
// Colores: de morado (plano) a amarillo (cerca del limite); rojo = pasa el limite o sin datos
function pintarPendiente(limite) {
  const canvas = document.createElement("canvas");
  canvas.width = cuad.ancho;
  canvas.height = cuad.alto;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(cuad.ancho, cuad.alto);
  const tonos = [[59, 42, 107], [42, 157, 143], [244, 211, 94]];
  for (let i = 0; i < cuad.pendiente.length; i++) {
    const p = cuad.pendiente[i];
    if (p < 0 || p / 10 > limite) { img.data.set([230, 40, 40, 235], i * 4); continue; }
    const f = Math.min(1, p / 10 / limite);
    const k = f < 0.5 ? 0 : 1, u = f < 0.5 ? f * 2 : (f - 0.5) * 2;
    const a = tonos[k], b = tonos[k + 1];
    img.data.set([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  window.urlPendiente = canvas.toDataURL(); // la Mesa 3D usa esta misma imagen
  return window.urlPendiente;
}

// ---------- Recorrido real de Perseverance ----------
window.recorridoRover = []; // lineas en metros del mapa: [[lat_m, lng_m], ...]

async function cargarRecorridoRover() {
  let geo = null;
  try {
    const r = await fetch(DATOS + "M20_traverse.json");
    if (r.ok) geo = await r.json();
  } catch { geo = null; }
  if (!geo) return; // no hay archivo: la app funciona igual
  window.recorridoRover = recortarRecorrido(geo);
  if (!window.recorridoRover.length) return;

  const capa = L.layerGroup(window.recorridoRover.map((l) =>
    L.polyline(l, { color: "#ffffff", weight: 2, opacity: 0.9, interactive: false })));
  document.getElementById("capas-extra").insertAdjacentHTML("beforeend", `
    <div class="capa"><label><input type="checkbox" id="chk-rover" checked>
      <span data-i18n="capa_rover">${t("capa_rover")}</span></label></div>`);
  const chk = document.getElementById("chk-rover");
  capa.addTo(mapa);
  chk.addEventListener("change", () => (chk.checked ? capa.addTo(mapa) : capa.remove()));
}

// Se queda solo con los pedazos del recorrido que caen dentro de la zona
function recortarRecorrido(geo) {
  const salida = [];
  for (const f of geo.features || []) {
    const g = f.geometry;
    if (!g) continue;
    const partes = g.type === "LineString" ? [g.coordinates]
      : g.type === "MultiLineString" ? g.coordinates : [];
    for (const parte of partes) {
      let actual = [];
      for (const c of parte) {
        let [lon, lat] = c;
        if (lon > 180) lon -= 360;
        const dentro = lat >= info.sur && lat <= info.norte && lon >= info.oeste && lon <= info.este;
        if (dentro) actual.push(lonlatAMapa(lon, lat));
        else if (actual.length) { if (actual.length > 1) salida.push(actual); actual = []; }
      }
      if (actual.length > 1) salida.push(actual);
    }
  }
  return salida;
}

// ---------- Conversiones ----------
function mapaACelda(latlng) {
  const col = Math.floor(latlng.lng / cuad.celda_x);
  const fila = Math.floor((info.alto_m - latlng.lat) / cuad.celda_y);
  if (col < 0 || col >= cuad.ancho || fila < 0 || fila >= cuad.alto) return null;
  return fila * cuad.ancho + col;
}

function celdaAMapa(i) {
  const fila = Math.floor(i / cuad.ancho), col = i % cuad.ancho;
  return [info.alto_m - (fila + 0.5) * cuad.celda_y, (col + 0.5) * cuad.celda_x];
}

function mapaALonlat(latlng) {
  const lon = info.oeste + (latlng.lng / info.ancho_m) * (info.este - info.oeste);
  const lat = info.sur + (latlng.lat / info.alto_m) * (info.norte - info.sur);
  return [lon, lat];
}

function lonlatAMapa(lon, lat) {
  const x = ((lon - info.oeste) / (info.este - info.oeste)) * info.ancho_m;
  const y = ((lat - info.sur) / (info.norte - info.sur)) * info.alto_m;
  return [y, x];
}

// Si la parada cae a menos de 150 m de un punto de interes, usamos su nombre
function nombreParada(k) {
  if (k === 0) return t("habitat");
  const [y, x] = celdaAMapa(paradas[k]);
  for (const p of pois) {
    const [py, px] = lonlatAMapa(p.lon, p.lat);
    if (Math.hypot(px - x, py - y) < 150) return p.nombre;
  }
  return t("parada_n", { n: k });
}

// ---------- Interaccion ----------
function alTocarMapa(e) {
  const celda = mapaACelda(e.latlng);
  if (celda === null) {
    decir("i_fuera");
    return;
  }

  const params = leerParametros();
  if (bloqueada(cuad, celda, params)) {
    const p = cuad.pendiente[celda];
    decir("i_bloqueado", { motivo: p < 0 ? t("sin_datos") : t("grados", { n: (p / 10).toFixed(0) }) });
    return;
  }

  paradas.push(celda);
  const k = paradas.length - 1;
  const icono = L.divIcon({
    className: k === 0 ? "marca habitat" : "marca",
    html: k === 0 ? "H" : String(k),
    iconSize: [26, 26],
  });
  marcadores.push(L.marker(celdaAMapa(celda), { icon: icono }).addTo(mapa).bindTooltip(nombreParada(k)));

  if (k === 0) {
    decir("i_primera");
    dibujarZonaRegreso();
  } else {
    decir("i_otra");
    calcular();
  }
}

function leerParametros() {
  const num = (id) => parseFloat(document.getElementById(id).value);
  return {
    pendienteMax: num("p-pendiente"),
    rugosidadMax: num("p-rugosidad"),
    velocidad: num("p-velocidad"),
    carga: num("p-carga"),
    oxigeno: num("p-oxigeno"),
    trabajo: num("p-trabajo"),
    reserva: num("p-reserva"),
    radiacion: num("p-radiacion"),
    multTormenta: num("p-mult-tormenta"),
    limiteDosis: num("p-limite-dosis"),
    tormenta: document.getElementById("chk-tormenta").checked,
  };
}

function calcular() {
  lineas.forEach((l) => l.remove());
  lineas = [];
  if (paradas.length < 2) {
    ocultarResultado();
    ultimaMision = null;
    actualizarHud();
    return;
  }

  const params = leerParametros();
  const t0 = performance.now();
  const m = planearMision(cuad, paradas, params);
  console.log(`Mision calculada en ${(performance.now() - t0).toFixed(0)} ms`);

  if (m.error) {
    decir("i_error", { error: m.error });
    ocultarResultado();
    ultimaMision = null;
    actualizarHud();
    return;
  }

  // ida en azul, regreso al habitat en morado punteado
  m.tramos.forEach((t, k) => {
    const regreso = k === m.tramos.length - 1;
    lineas.push(L.polyline(t.camino.map(celdaAMapa), {
      color: regreso ? "#9E8CFF" : "#4FD1E8",
      weight: 4,
      dashArray: regreso ? "6 8" : null,
    }).addTo(mapa));
  });

  ultimaMision = m;
  mostrarPanel(m, params);
  dibujarPerfil(m);
  actualizarHud();
}

const horas = (h) => {
  const min = Math.round(h * 60);
  return `${Math.floor(min / 60)} h ${min % 60} min`;
};

function mostrarPanel(m, params) {
  const poner = (id, valor) => (document.getElementById(id).textContent = valor);
  document.getElementById("resultado").classList.remove("oculto");
  document.getElementById("sin-mision").classList.add("oculto");

  const v = document.getElementById("veredicto");
  v.textContent = m.go ? "GO" : "NO-GO";
  document.getElementById("tarjeta-veredicto").className = m.go ? "tarjeta-go" : "tarjeta-nogo";
  const numParadas = m.tramos.length - 1;
  poner("resumen-paradas", numParadas === 1 ? t("parada_resumen") : t("paradas_resumen", { n: numParadas }));
  ponerChips(m.go ? "go" : "nogo", `${m.go ? "GO" : "NO-GO"} · ${horas(m.total)} · O₂ ${m.oxigenoPct.toFixed(0)}%`);

  const motivos = [];
  if (!m.okOxigeno) {
    motivos.push(t("m_oxigeno", { necesita: horas(m.total), hay: horas(m.disponible) }));
    if (m.alcanzables === 0) motivos.push(t("m_ninguna"));
    else if (m.alcanzables === 1) motivos.push(t("m_una"));
    else motivos.push(t("m_varias", { n: m.alcanzables }));
  }
  if (!m.okDosis) {
    motivos.push(t("m_dosis", { dosis: m.dosis.toFixed(2), limite: params.limiteDosis }) +
      (params.tormenta ? t("m_tormenta") : ""));
  }
  if (m.go) motivos.push(t("m_margen", { pct: m.oxigenoPct.toFixed(0) }));
  poner("motivo", motivos.join(" "));

  poner("r-distancia", `${m.distancia.toFixed(2)} km`);
  poner("r-total", horas(m.total));
  poner("r-pendiente", `${m.pendienteMax.toFixed(1)}°`);
  poner("r-subida", `${Math.round(m.subida)} m`);
  poner("r-oxigeno", `${m.oxigenoPct.toFixed(0)}%`);
  poner("r-radiacion", `${m.dosis.toFixed(2)} mSv`);
  // barras: oxigeno usado del traje y dosis contra el limite
  const oxi = document.getElementById("b-oxigeno");
  oxi.style.width = `${Math.min(100, m.oxigenoPct)}%`;
  oxi.style.background = m.okOxigeno ? "#4FD1E8" : "#FF5A5F";
  const dos = document.getElementById("b-dosis");
  dos.style.width = `${Math.min(100, (m.dosis / params.limiteDosis) * 100)}%`;
  dos.style.background = m.okDosis ? "#FFB547" : "#FF5A5F";

  // linea de tiempo: habitat, cada parada con su hora de llegada, y el regreso
  const llegadas = horariosMision(m, params.trabajo);
  const lista = document.getElementById("tramos");
  let html = `<li><span class="punto habitat">H</span><span class="paso">${t("l_inicio")}</span><span class="hora">T+0:00</span></li>`;
  m.tramos.forEach((tr, k) => {
    const regreso = k === m.tramos.length - 1;
    const detalle = `${tr.distancia.toFixed(2)} km · ${horas(tr.tiempo)} ${t("l_camina")}` + (regreso ? "" : ` · ${horas(params.trabajo)} ${t("l_trabajo")}`);
    html += regreso
      ? `<li><span class="punto regreso">&#8617;</span><span class="paso">${t("l_regreso")}<small>${detalle}</small></span><span class="hora">${tMas(m.total)}</span></li>`
      : `<li><span class="punto">${k + 1}</span><span class="paso">${nombreParada(k + 1)}<small>${detalle}</small></span><span class="hora">${tMas(llegadas[k + 1])}</span></li>`;
  });
  lista.innerHTML = html;
}

// Hora de llegada (en horas desde la salida) a cada punto: [0] = habitat, [k] = parada k
function horariosMision(m, trabajo) {
  const llegadas = [0];
  let t = 0;
  m.tramos.slice(0, -1).forEach((tramo, k) => {
    t += tramo.tiempo;
    llegadas.push(t);
    t += trabajo;
  });
  return llegadas;
}
const tMas = (h) => { const min = Math.round(h * 60); return `T+${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`; };

// Chip de estado en la barra de arriba y en la Mesa 3D
function ponerChips(clase, textoChip) {
  for (const id of ["chip-estado", "estado3d"]) {
    const c = document.getElementById(id);
    if (!c) continue;
    c.className = "chip" + (clase ? " " + clase : "");
    c.textContent = textoChip;
  }
}

function ocultarResultado() {
  document.getElementById("resultado").classList.add("oculto");
  document.getElementById("sin-mision").classList.remove("oculto");
  ponerChips("", t("sin_mision_chip"));
}

// Grafica de altura contra distancia de toda la mision, con lineas en cada parada
function dibujarPerfil(m) {
  const canvas = document.getElementById("perfil");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, margen = 24;
  ctx.clearRect(0, 0, W, H);

  // juntamos los tramos en una sola lista de puntos
  const puntos = [], cortes = [];
  let base = 0;
  for (const t of m.tramos) {
    for (const p of t.perfil) puntos.push({ d: base + p.d, z: p.z });
    base += t.distancia;
    cortes.push(base);
  }
  const zs = puntos.map((p) => p.z);
  const zmin = Math.min(...zs), zmax = Math.max(...zs) + 1;
  const X = (d) => margen + (d / base) * (W - margen - 6);
  const Y = (z) => H - 16 - ((z - zmin) / (zmax - zmin)) * (H - 26);

  // relleno suave debajo de la linea
  ctx.fillStyle = "rgba(79, 209, 232, 0.14)";
  ctx.beginPath();
  ctx.moveTo(X(0), H - 16);
  puntos.forEach((p) => ctx.lineTo(X(p.d), Y(p.z)));
  ctx.lineTo(X(base), H - 16);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#2B3548";
  ctx.setLineDash([3, 4]);
  cortes.slice(0, -1).forEach((d) => { ctx.beginPath(); ctx.moveTo(X(d), 4); ctx.lineTo(X(d), H - 16); ctx.stroke(); });
  ctx.setLineDash([]);

  ctx.strokeStyle = "#4FD1E8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  puntos.forEach((p, i) => (i ? ctx.lineTo(X(p.d), Y(p.z)) : ctx.moveTo(X(p.d), Y(p.z))));
  ctx.stroke();

  ctx.fillStyle = "#9AA4B6";
  ctx.font = "10px 'IBM Plex Mono', monospace";
  ctx.fillText(`${Math.round(zmax)} m`, 2, 12);
  ctx.fillText(`${Math.round(zmin)} m`, 2, H - 18);
  ctx.fillText("0 km", margen, H - 4);
  ctx.fillText(`${base.toFixed(1)} km`, W - 40, H - 4);
}

// Zona verde: desde ahi se puede volver caminando con la mitad del oxigeno disponible
function dibujarZonaRegreso() {
  if (capaRegreso) { capaRegreso.remove(); capaRegreso = null; }
  if (!document.getElementById("chk-regreso").checked || paradas.length === 0) return;

  const params = leerParametros();
  const horasRegreso = (params.oxigeno * (1 - params.reserva / 100)) / 2;
  const zona = zonaRegresoAPie(cuad, paradas[0], params, horasRegreso);

  // pintamos la zona en un canvas del tamano de la cuadricula y lo ponemos como imagen
  const canvas = document.createElement("canvas");
  canvas.width = cuad.ancho;
  canvas.height = cuad.alto;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(cuad.ancho, cuad.alto);
  for (let i = 0; i < zona.length; i++) {
    if (zona[i]) img.data.set([60, 220, 130, 90], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  capaRegreso = L.imageOverlay(canvas.toDataURL(), [[0, 0], [info.alto_m, info.ancho_m]], { className: "pixelada" })
    .addTo(mapa);
  decir("i_regreso", { t: horas(horasRegreso) });
}

function actualizarHud() {
  const v = document.getElementById("hud-veredicto");
  const sig = document.getElementById("hud-siguiente");
  const datos = document.getElementById("hud-datos");
  if (!ultimaMision) {
    v.textContent = "--"; v.className = ""; sig.textContent = "No mission"; datos.textContent = "";
    return;
  }
  const m = ultimaMision, t = m.tramos[0];
  v.textContent = m.go ? "GO" : "NO-GO";
  v.className = m.go ? "go" : "nogo";
  sig.textContent = `Next: ${nombreParada(1)}`;
  datos.textContent =
    `${t.distancia.toFixed(2)} km  |  ${horas(t.tiempo)}\n` +
    `Mission: ${horas(m.total)}  |  O2 ${m.oxigenoPct.toFixed(0)}%\n` +
    `Dose ${m.dosis.toFixed(2)} mSv`;
}


// Solo se puede salir si la mision es GO: es la regla de seguridad antes de dejar la nave
function aprobarMision() {
  if (!ultimaMision) {
    decir("i_sin_plan");
    return;
  }
  if (!ultimaMision.go) {
    decir("i_nogo");
    document.getElementById("motivo").scrollIntoView({ behavior: "smooth" });
    return;
  }
  const nombres = paradas.map((_, k) => nombreParada(k));
  window.abrirCasco(ultimaMision, leerParametros(), nombres, paradas);
}

function quitarUltima() {
  if (paradas.length === 0) return;
  paradas.pop();
  marcadores.pop().remove();
  if (paradas.length === 0) borrarMision();
  else calcular();
}

function borrarMision() {
  marcadores.forEach((m) => m.remove());
  lineas.forEach((l) => l.remove());
  if (capaRegreso) capaRegreso.remove();
  marcadores = []; lineas = []; paradas = []; capaRegreso = null; ultimaMision = null;
  ocultarResultado();
  actualizarHud();
  decir("i_habitat");
}


// Mensaje de "siguiente paso" que se puede volver a traducir si cambia el idioma
let ultimoMensaje = { clave: "i_habitat", v: {} };
function decir(clave, v = {}) {
  ultimoMensaje = { clave, v };
  texto(t(clave, v));
}

// Al cambiar de idioma: se vuelven a escribir los textos que arma este archivo
window.addEventListener("idioma", () => {
  texto(t(ultimoMensaje.clave, ultimoMensaje.v));
  if (ultimaMision) { mostrarPanel(ultimaMision, leerParametros()); actualizarHud(); }
  else ponerChips("", t("sin_mision_chip"));
  marcadores.forEach((mk, k) => mk.setTooltipContent && mk.getTooltip() && mk.setTooltipContent(nombreParada(k)));
});

function texto(html) {
  document.getElementById("instruccion").innerHTML = html;
}

// Funcionar sin internet: registramos el service worker (solo jala en https o localhost)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Sin modo offline:", err));
}

iniciar().catch((err) => {
  console.error(err);
  alert(t("error_carga"));
});

// Botones con data-click="id": hacen lo mismo que el boton con ese id
document.querySelectorAll("[data-click]").forEach((b) =>
  b.addEventListener("click", () => document.getElementById(b.dataset.click).click()));
