// explorador.js
// Explorador de crateres: vista completa con
//  - mapa interactivo de detalle (foto CTX y, de cerca, HiRISE) con TODOS los crateres,
//    coloreados por diametro / confianza / profundidad; tocar uno lo selecciona.
//  - menu detallado: estadisticas, histograma de tamanos (se puede tocar para filtrar),
//    filtros (busqueda, confianza, diametro, fuente, solo en la ruta), orden y lista con miniaturas.
//  - ficha del crater: recorte HiRISE con el borde marcado, perfil de elevacion real (DEM HiRISE 2 m),
//    medidas, unidad geologica y acciones (ver en 3D, agregar como parada, ver en el planeador).
// Usa globales de app.js (info, cuad, DATOS, paradas, ultimaMision, celdaAMapa, mapaACelda, bloqueada,
// leerParametros, alTocarMapa) y de crateres.js (CRATER, crateresDeMision, seleccionarCrater, fmtCrater).

const EXP = {
  mapa: null, render: null, capa: null, sel: null, rutaCapa: null,
  filtrados: [], mostrados: 60, elegido: null,
  color: "diametro",            // diametro | confianza | profundidad | relieve
  // relieve: todos | confirmado | solo_foto | rechazado (scripts/validar_crateres.py)
  f: { texto: "", conf: 0.5, relieve: "todos", dmin: 0, dmax: 100, ctx: true, hirise: true, ruta: false, orden: "conf" },
  indHirise: null, geo: null, bins: {}, zMin: 0,
};

// Diametro en escala logaritmica: slider 0..100 -> 3 m .. 1500 m
const D_MIN = 3, D_MAX = 1500;
const sliderAD = (v) => D_MIN * Math.pow(D_MAX / D_MIN, v / 100);
const fmtM = (d) => (d >= 1000 ? `${(d / 1000).toFixed(2)} km` : d >= 10 ? `${Math.round(d)} m` : `${d.toFixed(1)} m`);

// Paleta secuencial (de chico/bajo a grande/alto), misma luminosidad creciente
const PALETA = ["#5B6CFF", "#2FA8E0", "#3DDC84", "#FFD23F", "#FF8A3D"];
const CLASES_D = [10, 30, 100, 300];       // m: limites de las clases de diametro
// Revision con el relieve (validar_crateres.py): confirmado / solo en la foto / rechazado
const COLOR_RELIEVE = { confirmado: "#4FD1E8", solo_foto: "#C9D1DF", rechazado: "#FF5A5F" };
const hayRelieve = () => CRATER.lista.some((c) => c.relieve);
function colorDe(c) {
  if (EXP.color === "relieve") return COLOR_RELIEVE[c.relieve] || "#C9D1DF";
  if (EXP.color === "confianza") return PALETA[Math.min(4, Math.floor((c.conf - 0.25) / 0.15))];
  if (EXP.color === "profundidad") {
    if (c.prof === null || c.prof === undefined || c.prof <= 0) return "#7B8496";
    const r = c.prof / c.d; // relacion profundidad / diametro
    return PALETA[r < 0.02 ? 0 : r < 0.05 ? 1 : r < 0.08 ? 2 : r < 0.12 ? 3 : 4];
  }
  let k = 0; while (k < CLASES_D.length && c.d >= CLASES_D[k]) k++;
  return PALETA[k];
}
function textosLeyenda() {
  if (EXP.color === "relieve") return [];
  if (EXP.color === "confianza") return ["25–40%", "40–55%", "55–70%", "70–85%", "85–99%"];
  if (EXP.color === "profundidad") return ["d/D < 0.02", "0.02–0.05", "0.05–0.08", "0.08–0.12", "> 0.12"];
  return ["< 10 m", "10–30 m", "30–100 m", "100–300 m", "> 300 m"];
}

// ---------------------------------------------------------------- abrir / cerrar
async function abrirExplorador(c) {
  if (!window.CRATER || !CRATER.lista.length) return;
  document.body.classList.add("modo-explorador");
  if (!EXP.mapa) await crearExplorador();
  EXP.mapa.invalidateSize();
  dibujarRuta();
  aplicarFiltros();
  if (c) elegir(c, true);
  else if (!EXP.elegido) EXP.mapa.fitBounds([[0, 0], [info.alto_m, info.ancho_m]]);
}
function cerrarExplorador() {
  document.body.classList.remove("modo-explorador");
  if (typeof mapa !== "undefined" && mapa) mapa.invalidateSize();
}
window.abrirExplorador = abrirExplorador;
window.cerrarExplorador = cerrarExplorador;

// ---------------------------------------------------------------- construccion
async function crearExplorador() {
  const lim = [[0, 0], [info.alto_m, info.ancho_m]];
  EXP.zMin = cuad.elevacion.reduce((m, z) => (z > -99999 && z < m ? z : m), Infinity);
  EXP.mapa = L.map("exp-mapa", { crs: L.CRS.Simple, minZoom: -5, maxZoom: 3, zoomSnap: 0.25, attributionControl: false });
  EXP.mapa.zoomControl.setPosition("topright");
  EXP.mapa.fitBounds(lim);
  EXP.mapa.createPane("exp-base").style.zIndex = 380;
  EXP.mapa.createPane("exp-hirise").style.zIndex = 390;
  EXP.mapa.createPane("exp-crateres").style.zIndex = 450;
  EXP.mapa.createPane("exp-sel").style.zIndex = 640;
  L.imageOverlay(DATOS + "foto.png", lim, { pane: "exp-base" }).addTo(EXP.mapa);
  EXP.render = L.canvas({ padding: 0.3, pane: "exp-crateres", tolerance: 3 });
  EXP.capa = L.layerGroup().addTo(EXP.mapa);
  EXP.rutaCapa = L.layerGroup().addTo(EXP.mapa);

  try {
    const r = await fetch(DATOS + "hirise/indice.json");
    if (r.ok) { EXP.indHirise = await r.json(); EXP.indHirise.conFoto = new Set(EXP.indHirise.fotos || []); EXP.indHirise.existe = new Set(EXP.indHirise.existentes || []); }
  } catch { EXP.indHirise = null; }
  fotosHirise();

  // lectura bajo el cursor
  EXP.mapa.on("mousemove", (e) => {
    const [lon, lat] = mapaALonlat(e.latlng);
    const celda = mapaACelda(e.latlng);
    const z = celda !== null ? cuad.elevacion[celda] : -99999;
    document.getElementById("exp-coord").textContent = `${lat.toFixed(4)}° N · ${lon.toFixed(4)}° E` +
      (z > -99999 ? `   ${Math.round(z).toLocaleString("en-US")} m` : "");
  });
  EXP.mapa.on("zoomend", dibujarMapa);

  conectarControles();
  prepararGeologia();
}

// Fotos HiRISE de cerca (mismas teselas que el planeador)
function fotosHirise() {
  const ind = EXP.indHirise;
  if (!ind || !ind.conFoto.size) return;
  const T = ind.tesela_m, o = ind.origen_m, puestas = new Map();
  const actualizar = () => {
    const vista = EXP.mapa.getBounds().pad(0.3), quedan = new Set();
    if (EXP.mapa.getZoom() >= -1.5) {
      const i0 = Math.max(0, Math.floor((vista.getWest() - o) / T)), i1 = Math.min(ind.nx - 1, Math.floor((vista.getEast() - o) / T));
      const j0 = Math.max(0, Math.floor((info.alto_m - vista.getNorth() - o) / T)), j1 = Math.min(ind.ny - 1, Math.floor((info.alto_m - vista.getSouth() - o) / T));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = `${i}_${j}`;
        if (!ind.conFoto.has(k)) continue;
        quedan.add(k);
        if (puestas.has(k)) continue;
        const norte = info.alto_m - (j * T + o), oeste = i * T + o;
        puestas.set(k, L.imageOverlay(`${DATOS}hirise/f_${k}.jpg`, [[norte - T, oeste], [norte, oeste + T]],
          { pane: "exp-hirise", interactive: false, className: "foto-hirise" }).addTo(EXP.mapa));
      }
    }
    for (const [k, capa] of puestas) if (!quedan.has(k)) { capa.remove(); puestas.delete(k); }
  };
  EXP.mapa.on("moveend zoomend", actualizar);
  actualizar();
}

// Ruta y habitat del planeador tambien en el explorador
function dibujarRuta() {
  if (!EXP.rutaCapa) return;
  EXP.rutaCapa.clearLayers();
  if (ultimaMision) {
    ultimaMision.tramos.forEach((tr, k) => {
      const regreso = k === ultimaMision.tramos.length - 1;
      L.polyline(tr.camino.map(celdaAMapa), { color: regreso ? "#9E8CFF" : "#4FD1E8", weight: 3, dashArray: regreso ? "6 8" : null, interactive: false })
        .addTo(EXP.rutaCapa);
    });
  }
  paradas.forEach((c, k) => L.marker(celdaAMapa(c), { interactive: false, icon: L.divIcon({
    className: k === 0 ? "marca habitat" : "marca", html: k === 0 ? "H" : String(k), iconSize: [26, 26] }) }).addTo(EXP.rutaCapa));
}

// ---------------------------------------------------------------- controles del menu
function conectarControles() {
  const $ = (id) => document.getElementById(id);
  const refiltrar = () => { EXP.mostrados = 60; aplicarFiltros(); };
  $("exp-buscar").addEventListener("input", (e) => { EXP.f.texto = e.target.value.trim(); refiltrar(); });
  $("exp-conf").addEventListener("input", (e) => { EXP.f.conf = parseFloat(e.target.value); refiltrar(); });
  $("exp-dmin").addEventListener("input", (e) => {
    EXP.f.dmin = Math.min(parseFloat(e.target.value), EXP.f.dmax - 2); e.target.value = EXP.f.dmin; refiltrar();
  });
  $("exp-dmax").addEventListener("input", (e) => {
    EXP.f.dmax = Math.max(parseFloat(e.target.value), EXP.f.dmin + 2); e.target.value = EXP.f.dmax; refiltrar();
  });
  $("exp-ctx").addEventListener("change", (e) => { EXP.f.ctx = e.target.checked; refiltrar(); });
  $("exp-hirise").addEventListener("change", (e) => { EXP.f.hirise = e.target.checked; refiltrar(); });
  $("exp-ruta").addEventListener("change", (e) => { EXP.f.ruta = e.target.checked; refiltrar(); });
  $("exp-relieve").addEventListener("change", (e) => { EXP.f.relieve = e.target.value; refiltrar(); });
  $("exp-orden").addEventListener("change", (e) => { EXP.f.orden = e.target.value; refiltrar(); });
  $("exp-limpiar").addEventListener("click", () => {
    Object.assign(EXP.f, { texto: "", conf: 0.5, relieve: "todos", dmin: 0, dmax: 100, ctx: true, hirise: true, ruta: false });
    $("exp-buscar").value = ""; $("exp-conf").value = 0.5; $("exp-relieve").value = "todos"; $("exp-dmin").value = 0; $("exp-dmax").value = 100;
    $("exp-ctx").checked = $("exp-hirise").checked = true; $("exp-ruta").checked = false;
    refiltrar();
  });
  document.querySelectorAll("#exp-colores button").forEach((b) => b.addEventListener("click", () => {
    EXP.color = b.dataset.color;
    document.querySelectorAll("#exp-colores button").forEach((x) => x.classList.toggle("activo", x === b));
    dibujarMapa(); dibujarLeyenda(); dibujarLista();
  }));
  $("exp-mas").addEventListener("click", () => { EXP.mostrados += 60; dibujarLista(); });
  $("exp-histo").addEventListener("click", clicHistograma);
  $("exp-ant").addEventListener("click", () => moverSeleccion(-1));
  $("exp-sig").addEventListener("click", () => moverSeleccion(1));
  $("exp-3d").addEventListener("click", () => {
    if (!EXP.elegido || !window.verCrater3D) return;
    const c = EXP.elegido; cerrarExplorador(); window.verCrater3D(c);
  });
  $("exp-planeador").addEventListener("click", () => {
    if (!EXP.elegido) return;
    const c = EXP.elegido; cerrarExplorador(); seleccionarCrater(c);
  });
  $("exp-parada").addEventListener("click", agregarComoParada);
  document.addEventListener("keydown", (e) => {
    if (!document.body.classList.contains("modo-explorador") || e.target.matches("input, select")) return;
    if (e.key === "Escape") cerrarExplorador();
    else if (e.key === "ArrowDown" || e.key === "j") { moverSeleccion(1); e.preventDefault(); }
    else if (e.key === "ArrowUp" || e.key === "k") { moverSeleccion(-1); e.preventDefault(); }
  });
}

function aplicarFiltros() {
  const f = EXP.f, dmin = f.dmin <= 0 ? 0 : sliderAD(f.dmin), dmax = f.dmax >= 100 ? Infinity : sliderAD(f.dmax);
  const enRuta = new Set(crateresDeMision(ultimaMision, CRATER.lista).map((e) => e.c.id));
  EXP.enRuta = enRuta;
  const habitat = paradas.length ? celdaAMapa(paradas[0]) : null;
  const q = f.texto.toLowerCase().replace(/^#/, "");
  EXP.filtrados = CRATER.lista.filter((c) => {
    if (q && !(String(c.id) === q || String(c.id).startsWith(q))) return false;
    // los rechazados por el relieve solo se ven si se piden (para mostrar que se quito y por que)
    if (f.relieve === "rechazado") { if (c.relieve !== "rechazado") return false; }
    else {
      if (c.relieve === "rechazado") return false;
      if (f.relieve !== "todos" && c.relieve !== f.relieve) return false;
      if (c.conf < f.conf) return false;
    }
    if (c.d < dmin || c.d > dmax) return false;
    const deCtx = c.fuente.includes("ctx"), deHi = c.fuente.includes("hirise");
    if (!((f.ctx && deCtx) || (f.hirise && deHi))) return false;
    if (f.ruta && !enRuta.has(c.id)) return false;
    return true;
  });
  const clave = {
    conf: (c) => -c.conf, diam: (c) => -c.d, diam_asc: (c) => c.d,
    prof: (c) => -(c.prof || -1), relacion: (c) => -((c.prof || 0) / c.d),
    habitat: (c) => (habitat ? Math.hypot(c.x - habitat[1], c.s - (info.alto_m - habitat[0])) : c.id),
    id: (c) => c.id,
  }[f.orden] || ((c) => -c.conf);
  EXP.filtrados.sort((a, b) => clave(a) - clave(b));

  // textos de los filtros
  document.getElementById("exp-conf-txt").textContent = `${Math.round(f.conf * 100)}%`;
  document.getElementById("exp-d-txt").textContent = `${f.dmin <= 0 ? fmtM(D_MIN) : fmtM(dmin)} – ${f.dmax >= 100 ? fmtM(D_MAX) + "+" : fmtM(dmax)}`;
  document.getElementById("exp-ruta").disabled = !ultimaMision;

  dibujarEstadisticas();
  dibujarHistograma();
  dibujarMapa();
  dibujarLeyenda();
  dibujarLista();
}

// ---------------------------------------------------------------- estadisticas + histograma
function dibujarEstadisticas() {
  const l = EXP.filtrados;
  // solo los que el DEM puede medir (en los chicos la profundidad no es confiable)
  const conProf = l.filter((c) => c.prof > 0 && c.prof_medible !== false);
  const mayor = l.reduce((m, c) => (!m || c.d > m.d ? c : m), null);
  const area = (info.ancho_m * info.alto_m) / 1e6;
  const poner = (id, v) => (document.getElementById(id).textContent = v);
  poner("exp-total", l.length.toLocaleString("en-US"));
  poner("exp-total-de", t("exp_de", { n: CRATER.lista.length.toLocaleString("en-US") }) +
    (hayRelieve() ? " · " + t("exp_confirmados", { n: l.filter((c) => c.relieve === "confirmado").length }) : ""));
  poner("exp-mayor", mayor ? fmtM(mayor.d) : "--");
  poner("exp-prof", conProf.length ? `${(conProf.reduce((s, c) => s + c.prof, 0) / conProf.length).toFixed(1)} m` : "--");
  poner("exp-dens", `${(l.length / area).toFixed(1)} /km²`);
  poner("exp-enruta", ultimaMision ? String(l.filter((c) => EXP.enRuta.has(c.id)).length) : "--");
}

// Distribucion tamano-frecuencia (bins logaritmicos). Gris = todos, color = los filtrados.
const N_BINS = 16;
const binDe = (d) => Math.min(N_BINS - 1, Math.max(0, Math.floor((Math.log(d / D_MIN) / Math.log(D_MAX / D_MIN)) * N_BINS)));
function dibujarHistograma() {
  const cv = document.getElementById("exp-histo");
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 280, H = cv.clientHeight || 110;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const todos = new Array(N_BINS).fill(0), fil = new Array(N_BINS).fill(0);
  CRATER.lista.forEach((c) => todos[binDe(c.d)]++);
  EXP.filtrados.forEach((c) => fil[binDe(c.d)]++);
  const max = Math.max(...todos, 1), base = H - 18, alto = base - 8;
  const bw = W / N_BINS;
  const css = getComputedStyle(document.documentElement);
  for (let i = 0; i < N_BINS; i++) {
    const x = i * bw + 1, w = bw - 2;
    const ha = Math.sqrt(todos[i] / max) * alto, hf = Math.sqrt(fil[i] / max) * alto; // raiz: se ven los bins chicos
    ctx.fillStyle = "#222B3B";
    ctx.beginPath(); ctx.roundRect(x, base - ha, w, ha, [3, 3, 0, 0]); ctx.fill();
    const dCentro = D_MIN * Math.pow(D_MAX / D_MIN, (i + 0.5) / N_BINS);
    let k = 0; while (k < CLASES_D.length && dCentro >= CLASES_D[k]) k++;
    ctx.fillStyle = PALETA[k];
    if (hf > 0) { ctx.beginPath(); ctx.roundRect(x, base - hf, w, Math.max(hf, 2), [3, 3, 0, 0]); ctx.fill(); }
  }
  ctx.fillStyle = css.getPropertyValue("--tenue") || "#9AA4B6";
  ctx.font = "10px 'IBM Plex Mono', monospace";
  ctx.textBaseline = "bottom";
  for (const d of [3, 10, 30, 100, 300, 1000]) {
    const x = (Math.log(d / D_MIN) / Math.log(D_MAX / D_MIN)) * W;
    ctx.textAlign = d === 3 ? "left" : d === 1000 ? "right" : "center";
    ctx.fillText(d >= 1000 ? "1 km" : `${d} m`, x, H);
  }
}
// tocar una barra = filtrar a ese rango de diametro (tocar de nuevo = quitar)
function clicHistograma(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const i = Math.floor(((e.clientX - r.left) / r.width) * N_BINS);
  const a = (i / N_BINS) * 100, b = ((i + 1) / N_BINS) * 100;
  const yaEs = Math.abs(EXP.f.dmin - a) < 0.01 && Math.abs(EXP.f.dmax - b) < 0.01;
  EXP.f.dmin = yaEs ? 0 : a; EXP.f.dmax = yaEs ? 100 : b;
  document.getElementById("exp-dmin").value = EXP.f.dmin;
  document.getElementById("exp-dmax").value = EXP.f.dmax;
  EXP.mostrados = 60;
  aplicarFiltros();
}

// ---------------------------------------------------------------- mapa
function dibujarMapa() {
  if (!EXP.capa) return;
  EXP.capa.clearLayers();
  const cerca = EXP.mapa.getZoom() >= -1.5;
  const lista = cerca ? EXP.filtrados : EXP.filtrados.filter((c) => c.d >= 25 || EXP.enRuta.has(c.id));
  for (const c of lista) {
    const ruta = EXP.enRuta.has(c.id);
    const col = colorDe(c);
    const circ = L.circle([info.alto_m - c.s, c.x], {
      radius: Math.max(c.d / 2, 1.5), renderer: EXP.render, color: ruta ? "#FFFFFF" : col, weight: ruta ? 3 : 1.6,
      dashArray: EXP.color === "relieve" && c.relieve === "solo_foto" && !ruta ? "4 4" : null,
      opacity: 0.95, fillColor: col, fillOpacity: c.d > 100 ? 0.05 : ruta ? 0.25 : 0.12,
    });
    circ.bindTooltip(`#${c.id} · ${fmtM(c.d)} · ${Math.round(c.conf * 100)}%`, { direction: "top", sticky: true, className: "exp-tip" });
    circ.on("click", () => elegir(c, false));
    circ.addTo(EXP.capa);
  }
}

function dibujarLeyenda() {
  const nombres = textosLeyenda();
  document.getElementById("exp-leyenda").innerHTML = nombres.map((n, i) =>
    `<div><span style="border-color:${PALETA[i]};background:${PALETA[i]}26"></span>${n}</div>`).join("") +
    (EXP.color === "profundidad" ? `<div><span style="border-color:#7B8496"></span>${t("exp_sin_prof")}</div>` : "") +
    (EXP.color === "relieve" ? ["confirmado", "solo_foto", "rechazado"].map((k) =>
      `<div><span style="border-color:${COLOR_RELIEVE[k]};${k === "solo_foto" ? "border-style:dashed;" : ""}background:${COLOR_RELIEVE[k]}26"></span>${t("exp_rel_" + k)}</div>`).join("") : "") +
    (ultimaMision ? `<div><span class="grueso"></span>${t("crat_ley_ruta")}</div>` : "");
}

// ---------------------------------------------------------------- lista
// Miniatura: recorte de la foto HiRISE (o CTX para los grandes) con background-position
function estiloMiniatura(c, lado) {
  const ind = EXP.indHirise;
  const caja = Math.max(c.d * 2.2, 24); // m que se ven en la miniatura
  if (ind && c.d <= 160) {
    const T = ind.tesela_m, o = ind.origen_m;
    const i = Math.floor((c.x - o) / T), j = Math.floor((c.s - o) / T);
    if (ind.conFoto.has(`${i}_${j}`)) {
      const esc = lado / caja;
      const px = (c.x - o - i * T) * esc, py = (c.s - o - j * T) * esc;
      return `background-image:url('${DATOS}hirise/f_${i}_${j}.jpg');background-size:${T * esc}px ${T * esc}px;background-position:${lado / 2 - px}px ${lado / 2 - py}px`;
    }
  }
  const esc = lado / caja;
  return `background-image:url('${DATOS}foto.png');background-size:${info.ancho_m * esc}px ${info.alto_m * esc}px;background-position:${lado / 2 - c.x * esc}px ${lado / 2 - c.s * esc}px`;
}

function dibujarLista() {
  const caja = document.getElementById("exp-lista");
  const l = EXP.filtrados.slice(0, EXP.mostrados);
  caja.innerHTML = l.length ? l.map((c) => `
    <li><button data-id="${c.id}" class="${EXP.elegido && EXP.elegido.id === c.id ? "activo" : ""}">
      <span class="exp-mini" style="${estiloMiniatura(c, 46)}"><i style="border-color:${colorDe(c)}"></i></span>
      <span class="exp-fila-txt">
        <b>#${c.id} · ${fmtM(c.d)}${EXP.enRuta.has(c.id) ? ` <em class="chip chico aviso">${t("exp_en_ruta")}</em>` : ""}</b>
        <small>${t("exp_fila", { p: c.prof > 0 ? c.prof.toFixed(1) + " m" : "--", c: Math.round(c.conf * 100), f: c.fuente.toUpperCase() })}</small>
      </span>
      <span class="exp-barra-conf" aria-hidden="true"><span style="width:${Math.round(c.conf * 100)}%"></span></span>
    </button></li>`).join("") : `<li class="vacio-lista">${t("exp_vacio")}</li>`;
  caja.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    const c = CRATER.lista.find((x) => x.id === Number(b.dataset.id));
    if (c) elegir(c, true);
  }));
  const resta = EXP.filtrados.length - l.length;
  const mas = document.getElementById("exp-mas");
  mas.classList.toggle("oculto", resta <= 0);
  mas.textContent = t("exp_mas", { n: Math.min(60, resta), total: resta });
}

function moverSeleccion(paso) {
  const l = EXP.filtrados;
  if (!l.length) return;
  let i = EXP.elegido ? l.findIndex((c) => c.id === EXP.elegido.id) : -1;
  i = (i + paso + l.length) % l.length;
  if (i >= EXP.mostrados) { EXP.mostrados = i + 20; dibujarLista(); }
  elegir(l[i], true);
}

// ---------------------------------------------------------------- seleccion + ficha
function elegir(c, volar) {
  EXP.elegido = c;
  if (EXP.sel) EXP.sel.remove();
  const centro = [info.alto_m - c.s, c.x];
  EXP.sel = L.layerGroup([
    L.circle(centro, { radius: c.d / 2, pane: "exp-sel", interactive: false, className: "crater-sel", color: "#F26B3A", weight: 3, fill: false }),
    L.circle(centro, { radius: c.d / 2, pane: "exp-sel", interactive: false, className: "crater-sel onda", color: "#F26B3A", weight: 2, fill: false }),
  ]).addTo(EXP.mapa);
  if (volar) {
    const r = Math.max(c.d * 1.8, 60);
    EXP.mapa.flyToBounds([[centro[0] - r, centro[1] - r], [centro[0] + r, centro[1] + r]], { duration: 1.0 });
  }
  document.querySelectorAll("#exp-lista button").forEach((b) => b.classList.toggle("activo", Number(b.dataset.id) === c.id));
  const activo = document.querySelector("#exp-lista button.activo");
  if (activo) activo.scrollIntoView({ block: "nearest", behavior: "smooth" });
  mostrarFicha(c);
}

async function mostrarFicha(c) {
  const ficha = document.getElementById("exp-ficha");
  ficha.classList.remove("vacia");
  ficha.classList.remove("entra"); void ficha.offsetWidth; ficha.classList.add("entra");
  const poner = (id, v) => (document.getElementById(id).textContent = v);
  poner("exp-f-titulo", `${t("crat_titulo")} #${c.id}`);
  poner("exp-f-sub", `${c.lat.toFixed(5)}° N · ${c.lon.toFixed(5)}° E`);
  const celda = mapaACelda({ lat: info.alto_m - c.s, lng: c.x });
  const z = celda !== null ? cuad.elevacion[celda] : -99999, p = celda !== null ? cuad.pendiente[celda] : -1;
  const habitat = paradas.length ? celdaAMapa(paradas[0]) : null;
  const dHab = habitat ? Math.hypot(c.x - habitat[1], c.s - (info.alto_m - habitat[0])) : null;
  const relacion = c.prof > 0 ? c.prof / c.d : null;
  const estado = relacion === null ? t("exp_estado_nd") : relacion > 0.12 ? t("exp_estado_fresco") : relacion > 0.05 ? t("exp_estado_medio") : t("exp_estado_viejo");
  const datos = [
    [t("exp_diam"), fmtM(c.d)],
    [t("exp_prof_l"), c.prof > 0 ? `${c.prof.toFixed(1)} m` : "--"],
    [t("exp_relacion"), relacion !== null ? relacion.toFixed(3) : "--"],
    [t("exp_estado"), estado],
    [t("exp_conf_l"), `${Math.round(c.conf * 100)}%`],
    ...(c.relieve ? [[t("exp_relieve"), t("exp_rel_" + c.relieve)]] : []),
    ...(window.estadoAterrizajeEn ? [[t("exp_aterrizaje"), estadoAterrizajeEn(c.x, c.s)]] : []),
    [t("exp_votos"), String(c.votos)],
    [t("exp_fuente"), c.fuente.toUpperCase()],
    [t("exp_hoyo"), c.hoyo !== null && c.hoyo !== undefined ? `${Math.round(c.hoyo * 8)}/8` : "--"],
    [t("exp_textura"), c.textura !== null && c.textura !== undefined ? c.textura.toFixed(2) : "--"],
    [t("f_elev"), z > -99999 ? `${Math.round(z).toLocaleString("en-US")} m` : "--"],
    [t("f_pend"), p >= 0 ? `${(p / 10).toFixed(1)}°` : "--"],
    [t("exp_hab"), dHab !== null ? fmtM(dHab) : "--"],
  ];
  document.getElementById("exp-f-datos").innerHTML = datos.map(([k, v]) => `<span class="tenue">${k}</span><span>${v}</span>`).join("");
  const enRuta = EXP.enRuta.has(c.id);
  document.getElementById("exp-f-ruta").classList.toggle("oculto", !enRuta);
  const u = unidadGeologica(c.lon, c.lat);
  document.getElementById("exp-f-unidad").innerHTML = u ? `<span style="background:${u.color}"></span>${u.nombre}${u.simbolo ? ` (${u.simbolo})` : ""}` : "";
  document.getElementById("exp-parada").disabled = false;
  document.getElementById("exp-3d").disabled = !window.verCrater3D;
  await Promise.all([dibujarRecorte(c), dibujarPerfilCrater(c)]);
}

// Recorte de la foto con el borde del crater y barra de escala
const cargarImg = (src) => new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = src; });
async function dibujarRecorte(c) {
  const cv = document.getElementById("exp-f-foto");
  const dpr = window.devicePixelRatio || 1, L_ = cv.clientWidth || 300;
  cv.width = L_ * dpr; cv.height = L_ * dpr;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0B0F17"; ctx.fillRect(0, 0, L_, L_);
  const caja = Math.max(c.d * 2.2, 30), esc = L_ / caja; // px por metro
  const x0 = c.x - caja / 2, s0 = c.s - caja / 2;
  const ind = EXP.indHirise;
  let usado = "CTX";
  if (ind && c.d <= 400 && ind.conFoto.size) {
    const T = ind.tesela_m, o = ind.origen_m;
    const i0 = Math.floor((x0 - o) / T), i1 = Math.floor((x0 + caja - o) / T);
    const j0 = Math.floor((s0 - o) / T), j1 = Math.floor((s0 + caja - o) / T);
    const piezas = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (ind.conFoto.has(`${i}_${j}`)) piezas.push(cargarImg(`${DATOS}hirise/f_${i}_${j}.jpg`).then((img) => ({ img, i, j })).catch(() => null));
    }
    const imgs = (await Promise.all(piezas)).filter(Boolean);
    if (EXP.elegido !== c) return;
    if (imgs.length) {
      usado = "HiRISE";
      for (const { img, i, j } of imgs) ctx.drawImage(img, (i * T + o - x0) * esc, (j * T + o - s0) * esc, T * esc, T * esc);
    }
  }
  if (usado === "CTX") {
    const img = await cargarImg(DATOS + "foto.png");
    if (EXP.elegido !== c) return;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, (-x0) * esc, (-s0) * esc, info.ancho_m * esc, info.alto_m * esc);
  }
  // borde, centro y escala
  ctx.strokeStyle = "#F26B3A"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.arc(L_ / 2, L_ / 2, (c.d / 2) * esc, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L_ / 2 - 6, L_ / 2); ctx.lineTo(L_ / 2 + 6, L_ / 2); ctx.moveTo(L_ / 2, L_ / 2 - 6); ctx.lineTo(L_ / 2, L_ / 2 + 6); ctx.stroke();
  const barra = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((m) => m * esc > L_ * 0.18) || 1000;
  ctx.fillStyle = "rgba(11,15,23,0.75)"; ctx.fillRect(8, L_ - 30, barra * esc + 16, 22);
  ctx.fillStyle = "#fff"; ctx.fillRect(16, L_ - 14, barra * esc, 3);
  ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.textBaseline = "bottom";
  ctx.fillText(barra >= 1000 ? "1 km" : `${barra} m`, 16, L_ - 16);
  ctx.textAlign = "right"; ctx.fillText(usado, L_ - 8, L_ - 8); ctx.textAlign = "left";
  ctx.fillText("N ↑", 8, 18);
}

// Perfil oeste-este por el centro: DEM HiRISE (2 m) si hay, si no la cuadricula CTX (20 m)
async function binHirise(clave) {
  if (!(clave in EXP.bins)) {
    EXP.bins[clave] = fetch(`${DATOS}hirise/t_${clave}.bin`).then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? new Uint16Array(b) : null)).catch(() => null);
  }
  return EXP.bins[clave];
}
async function alturaEn(x, s) {
  const ind = EXP.indHirise;
  if (ind) {
    const T = ind.tesela_m, o = ind.origen_m, n = ind.muestras;
    const i = Math.floor((x - o) / T), j = Math.floor((s - o) / T), k = `${i}_${j}`;
    if (ind.existe.has(k)) {
      const d = await binHirise(k);
      if (d) {
        const u = Math.min(n - 1, Math.max(0, Math.round((x - o - i * T) / ind.paso_m)));
        const v = Math.min(n - 1, Math.max(0, Math.round((s - o - j * T) / ind.paso_m)));
        return { z: ind.z_base + d[v * n + u] / 10, fuente: "HiRISE DTM" };
      }
    }
  }
  const celda = mapaACelda({ lat: info.alto_m - s, lng: x });
  return { z: celda !== null ? cuad.elevacion[celda] : NaN, fuente: "CTX DTM" };
}
async function dibujarPerfilCrater(c) {
  const largo = c.d * 2.2, n = 80, pts = [];
  for (let k = 0; k <= n; k++) {
    const dx = -largo / 2 + (k / n) * largo;
    pts.push(alturaEn(c.x + dx, c.s).then((r) => ({ dx, ...r })));
  }
  const datos = (await Promise.all(pts)).filter((p) => isFinite(p.z) && p.z > -99999);
  if (EXP.elegido !== c) return;
  const cv = document.getElementById("exp-f-perfil");
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 300, H = cv.clientHeight || 110;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (datos.length < 2) return;
  const zs = datos.map((p) => p.z);
  let zmin = Math.min(...zs), zmax = Math.max(...zs);
  // misma escala horizontal y vertical seria casi plano: se exagera, y se dice cuanto
  const rango = Math.max(zmax - zmin, 1);
  zmin -= rango * 0.15; zmax += rango * 0.1;
  const X = (dx) => 6 + ((dx + largo / 2) / largo) * (W - 12);
  const Y = (z) => H - 18 - ((z - zmin) / (zmax - zmin)) * (H - 30);
  const exag = ((H - 30) / (zmax - zmin)) / ((W - 12) / largo); // px por m vertical / px por m horizontal
  // borde del crater
  ctx.fillStyle = "rgba(242,107,58,0.10)";
  ctx.fillRect(X(-c.d / 2), 4, X(c.d / 2) - X(-c.d / 2), H - 22);
  ctx.strokeStyle = "rgba(242,107,58,0.6)"; ctx.setLineDash([3, 3]);
  for (const v of [-c.d / 2, c.d / 2]) { ctx.beginPath(); ctx.moveTo(X(v), 4); ctx.lineTo(X(v), H - 18); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(79,209,232,0.15)";
  ctx.beginPath(); ctx.moveTo(X(datos[0].dx), H - 18);
  datos.forEach((p) => ctx.lineTo(X(p.dx), Y(p.z)));
  ctx.lineTo(X(datos[datos.length - 1].dx), H - 18); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#4FD1E8"; ctx.lineWidth = 2;
  ctx.beginPath(); datos.forEach((p, i) => (i ? ctx.lineTo(X(p.dx), Y(p.z)) : ctx.moveTo(X(p.dx), Y(p.z)))); ctx.stroke();
  ctx.fillStyle = "#9AA4B6"; ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.textBaseline = "bottom";
  ctx.fillText(`${(zmax - rango * 0.1).toFixed(1)} m`, 6, 14);
  ctx.fillText("W", 6, H - 2);
  ctx.textAlign = "right"; ctx.fillText("E", W - 6, H - 2);
  ctx.textAlign = "center"; ctx.fillText(`${datos[0].fuente} · ×${exag.toFixed(0)} ${t("exp_vert")}`, W / 2, H - 2);
  ctx.textAlign = "left";
}

// ---------------------------------------------------------------- unidad geologica
async function prepararGeologia() {
  if (!info.geologia) return;
  try {
    const img = await cargarImg(DATOS + "geologia.png");
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    EXP.geo = { ctx, w: img.width, h: img.height };
  } catch { EXP.geo = null; }
}
function unidadGeologica(lon, lat) {
  if (!EXP.geo) return null;
  const x = Math.floor(((lon - info.oeste) / (info.este - info.oeste)) * EXP.geo.w);
  const y = Math.floor(((info.norte - lat) / (info.norte - info.sur)) * EXP.geo.h);
  if (x < 0 || y < 0 || x >= EXP.geo.w || y >= EXP.geo.h) return null;
  const [r, g, b, a] = EXP.geo.ctx.getImageData(x, y, 1, 1).data;
  if (a < 10) return null;
  let mejor = null, dist = Infinity;
  for (const u of info.geologia) {
    const d = (r - parseInt(u.color.slice(1, 3), 16)) ** 2 + (g - parseInt(u.color.slice(3, 5), 16)) ** 2 + (b - parseInt(u.color.slice(5, 7), 16)) ** 2;
    if (d < dist) { dist = d; mejor = u; }
  }
  return mejor;
}

// ---------------------------------------------------------------- agregar como parada
// La parada va en la celda caminable mas cercana al borde del crater (dentro suele estar empinado)
function agregarComoParada() {
  const c = EXP.elegido;
  if (!c) return;
  const params = leerParametros();
  let mejor = null, dMejor = Infinity;
  const rBusca = c.d / 2 + 80;
  const c0 = Math.floor((c.x - rBusca) / cuad.celda_x), c1 = Math.ceil((c.x + rBusca) / cuad.celda_x);
  const f0 = Math.floor((c.s - rBusca) / cuad.celda_y), f1 = Math.ceil((c.s + rBusca) / cuad.celda_y);
  for (let f = Math.max(0, f0); f <= Math.min(cuad.alto - 1, f1); f++) {
    for (let col = Math.max(0, c0); col <= Math.min(cuad.ancho - 1, c1); col++) {
      const i = f * cuad.ancho + col;
      if (bloqueada(cuad, i, params)) continue;
      const x = (col + 0.5) * cuad.celda_x, s = (f + 0.5) * cuad.celda_y;
      const d = Math.abs(Math.hypot(x - c.x, s - c.s) - c.d / 2); // distancia al borde
      if (d < dMejor) { dMejor = d; mejor = i; }
    }
  }
  if (mejor === null) { avisoFicha(t("exp_sin_lugar")); return; }
  cerrarExplorador();
  alTocarMapa({ latlng: L.latLng(celdaAMapa(mejor)) });
  seleccionarCrater(c, true);
}
function avisoFicha(txt) {
  const el = document.getElementById("exp-f-aviso");
  el.textContent = txt;
  el.classList.remove("oculto");
  setTimeout(() => el.classList.add("oculto"), 3500);
}

// ---------------------------------------------------------------- botones de entrada
document.getElementById("btn-explorar-crateres").addEventListener("click", () => abrirExplorador());
document.getElementById("btn-exp-cerrar").addEventListener("click", cerrarExplorador);
document.getElementById("btn-exp-3d").addEventListener("click", () => {
  const c = EXP.elegido;
  cerrarExplorador();
  if (c && window.verCrater3D) window.verCrater3D(c); else document.getElementById("btn-3d").click();
});
document.addEventListener("click", (e) => {
  if (e.target.closest("#btn-explorador")) abrirExplorador();
});
window.addEventListener("idioma", () => {
  if (!EXP.mapa) return;
  aplicarFiltros();
  if (EXP.elegido) mostrarFicha(EXP.elegido);
});
window.addEventListener("resize", () => {
  if (document.body.classList.contains("modo-explorador") && EXP.mapa) { dibujarHistograma(); EXP.mapa.invalidateSize(); }
});
