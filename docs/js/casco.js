// casco.js
// Vista desde el casco del astronauta: primera persona a 1.70 m (ojos de alguien de 1.80 m),
// caminando la mision aprobada con la velocidad del modelo (Tobler + carga + rugosidad).
// Cerca del astronauta usa los mosaicos de HiRISE (altura a 2 m y foto a ~50 cm); lejos, CTX.
// HUD minimo: rumbo, oxigeno y el camino en el suelo. Lo demas se abre tocando los iconos.
// Usa globales de app.js / ruta.js: info, cuad, pois, celdaAMapa, lonlatAMapa, costoPaso.

import * as THREE from "three";

const OJOS = 1.7;        // m sobre el suelo
const BAJAR_CTX = 3;     // el terreno lejano va 3 m abajo para que HiRISE quede encima
const ZANCADA = 0.75;    // m por paso
const RADIO_TESELAS = 1; // cuantos mosaicos alrededor se cargan (1 = 3x3, unos 750 m con detalle)

let renderer, escena, camara;
let terrenoCTX, texFoto, zref = 0;
const cargadorFotos = new THREE.TextureLoader();
let indice = null;
const teselas = new Map();  // "i_j" -> { mesh, datos } o "cargando"
let ruta = null;            // puntos de la mision con distancia y tiempo acumulados
let sim = null;             // estado de la simulacion
let cabeza = { yaw: 0, pitch: -0.05 }; // a donde voltea el astronauta (relativo al camino)
let chevrones = [], balizas = null;
const reloj = new THREE.Timer();
const activos = new Set(["mapa"]); // paneles del HUD abiertos (el minimapa empieza abierto)

// ================= Terreno =================
// Coordenadas: x = metros al este desde el borde oeste; s = metros al sur desde el borde norte.
// En 3D: X = x - ancho/2, Z = s - alto/2, Y = altura - zref.
const a3D = (x, s, y) => new THREE.Vector3(x - info.ancho_m / 2, y, s - info.alto_m / 2);

function alturaCTX(x, s) {
  const { ancho, alto, celda_x, celda_y, elevacion } = cuad;
  const c = Math.min(Math.max(x / celda_x - 0.5, 0), ancho - 1.001);
  const f = Math.min(Math.max(s / celda_y - 0.5, 0), alto - 1.001);
  const c0 = Math.floor(c), f0 = Math.floor(f), tc = c - c0, tf = f - f0;
  const z = (ff, cc) => Math.max(elevacion[ff * ancho + cc], zref);
  const arriba = z(f0, c0) * (1 - tc) + z(f0, c0 + 1) * tc;
  const abajo = z(f0 + 1, c0) * (1 - tc) + z(f0 + 1, c0 + 1) * tc;
  return arriba * (1 - tf) + abajo * tf;
}

function alturaHiRISE(x, s) {
  if (!indice) return null;
  const T = indice.tesela_m;
  const i = Math.floor(x / T), j = Math.floor(s / T);
  const t = teselas.get(`${i}_${j}`);
  if (!t || t === "cargando") return null;
  const n = indice.muestras;
  const u = Math.min(Math.max((x - i * T - indice.origen_m) / indice.paso_m, 0), n - 1.001);
  const v = Math.min(Math.max((s - j * T - indice.origen_m) / indice.paso_m, 0), n - 1.001);
  const u0 = Math.floor(u), v0 = Math.floor(v), tu = u - u0, tv = v - v0;
  const d = (vv, uu) => t.datos[vv * n + uu];
  const dm = (d(v0, u0) * (1 - tu) + d(v0, u0 + 1) * tu) * (1 - tv) +
             (d(v0 + 1, u0) * (1 - tu) + d(v0 + 1, u0 + 1) * tu) * tv;
  return indice.z_base + dm / 10;
}

// Altura real (para mostrar en el HUD) y altura "de dibujo" (donde pisa la camara)
function alturaReal(x, s) {
  const h = alturaHiRISE(x, s);
  return h !== null ? h : alturaCTX(x, s);
}
function alturaSuelo(x, s) {
  const h = alturaHiRISE(x, s);
  return h !== null ? h - zref : alturaCTX(x, s) - zref - BAJAR_CTX;
}

function material(mapa = texFoto) {
  return new THREE.MeshLambertMaterial({ map: mapa });
}

function crearTerrenoCTX() {
  const { ancho, alto, celda_x, celda_y } = cuad;
  const geo = new THREE.PlaneGeometry((ancho - 1) * celda_x, (alto - 1) * celda_y, ancho - 1, alto - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = cuad.elevacion[i];
    pos.setY(i, (z > -99999 ? z - zref : 0) - BAJAR_CTX);
  }
  geo.computeVertexNormals();
  terrenoCTX = new THREE.Mesh(geo, material());
  escena.add(terrenoCTX);
}

// ---------- Mosaicos de HiRISE ----------
async function cargarTesela(i, j) {
  const clave = `${i}_${j}`;
  teselas.set(clave, "cargando");
  try {
    const resp = await fetch(`${window.DATOS}hirise/t_${clave}.bin`);
    const datos = new Uint16Array(await resp.arrayBuffer());
    const { tesela_m: T, paso_m: paso, muestras: n, origen_m: o } = indice;
    const geo = new THREE.PlaneGeometry(T, T, n - 1, n - 1);
    geo.rotateX(-Math.PI / 2);
    // Foto HiRISE del mosaico (si existe). Si no, se usa la foto CTX de toda la zona.
    let foto = null;
    if (indice.conFoto.has(clave)) {
      try {
        foto = await cargadorFotos.loadAsync(`${window.DATOS}hirise/f_${clave}.jpg`);
        foto.colorSpace = THREE.SRGBColorSpace;
        foto.anisotropy = renderer.capabilities.getMaxAnisotropy();
      } catch { foto = null; }
    }
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let k = 0; k < pos.count; k++) {
      const ix = k % n, iy = Math.floor(k / n);
      pos.setY(k, indice.z_base + datos[k] / 10 - zref);
      if (!foto) {
        // sin foto propia: coordenadas de la foto CTX segun la posicion en el mapa
        const x = i * T + o + ix * paso, s = j * T + o + iy * paso;
        uv.setXY(k, x / info.ancho_m, 1 - s / info.alto_m);
      } // con foto propia se dejan las coordenadas normales del plano (la foto cubre el mosaico)
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material(foto || texFoto));
    mesh.position.copy(a3D(i * T + o + T / 2, j * T + o + T / 2, 0));
    if (teselas.get(clave) !== "cargando") { // ya se descarto mientras cargaba
      geo.dispose(); if (foto) foto.dispose();
      return;
    }
    escena.add(mesh);
    teselas.set(clave, { mesh, datos });
  } catch (e) {
    teselas.delete(clave);
  }
}

function actualizarTeselas(x, s) {
  if (!indice) return;
  const T = indice.tesela_m;
  const ci = Math.floor(x / T), cj = Math.floor(s / T);
  for (let j = cj - RADIO_TESELAS; j <= cj + RADIO_TESELAS; j++) {
    for (let i = ci - RADIO_TESELAS; i <= ci + RADIO_TESELAS; i++) {
      const clave = `${i}_${j}`;
      if (!teselas.has(clave) && indice.existe.has(clave)) cargarTesela(i, j);
    }
  }
  // las que quedaron lejos se quitan para no gastar memoria
  for (const [clave, t] of teselas) {
    const [i, j] = clave.split("_").map(Number);
    if (Math.abs(i - ci) > RADIO_TESELAS + 1 || Math.abs(j - cj) > RADIO_TESELAS + 1) {
      if (t !== "cargando") {
        escena.remove(t.mesh);
        t.mesh.geometry.dispose();
        if (t.mesh.material.map !== texFoto) t.mesh.material.map.dispose(); // foto HiRISE propia
        t.mesh.material.dispose();
      }
      teselas.delete(clave);
    }
  }
}

// ================= Ruta de la mision =================
// Junta todos los tramos en una sola lista de puntos con distancia (m) y tiempo (h) acumulados.
// En cada parada se repite el punto con el tiempo de trabajo, asi la simulacion "espera" ahi.
function armarRuta(mision, params, nombres, paradas) {
  const x = [], s = [], d = [], t = [], parada = [];
  let dist = 0, tiempo = 0;
  mision.tramos.forEach((tramo, k) => {
    tramo.camino.forEach((celda, j) => {
      if (k > 0 && j === 0) return; // el primer punto de cada tramo ya esta
      const [lat, lng] = celdaAMapa(celda);
      if (x.length) {
        const prev = tramo.camino[j - 1];
        const dx = lng - x[x.length - 1], ds = (info.alto_m - lat) - s[s.length - 1];
        dist += Math.hypot(dx, ds);
        tiempo += costoPaso(cuad, prev, celda, params);
      }
      x.push(lng); s.push(info.alto_m - lat); d.push(dist); t.push(tiempo); parada.push(-1);
    });
    if (k < mision.tramos.length - 1) {
      // trabajo en la parada k+1
      tiempo += params.trabajo;
      x.push(x[x.length - 1]); s.push(s[s.length - 1]); d.push(dist); t.push(tiempo); parada.push(k + 1);
    }
  });
  const destinos = paradas.slice(1).map((c) => {
    const [lat, lng] = celdaAMapa(c);
    return { x: lng, s: info.alto_m - lat };
  });
  destinos.push({ x: x[0], s: s[0] }); // al final se regresa al habitat
  return { x, s, d, t, parada, total: tiempo, largo: dist, nombres, destinos };
}

// Busqueda binaria: indice del ultimo punto con valor <= v
function buscar(arr, v) {
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (arr[m] <= v) lo = m; else hi = m - 1;
  }
  return lo;
}

function posicionPorTiempo(tt) {
  const k = Math.min(buscar(ruta.t, tt), ruta.t.length - 2);
  const span = ruta.t[k + 1] - ruta.t[k] || 1;
  const f = Math.min(Math.max((tt - ruta.t[k]) / span, 0), 1);
  const iguales = ruta.x[k] === ruta.x[k + 1] && ruta.s[k] === ruta.s[k + 1];
  return {
    x: ruta.x[k] + (ruta.x[k + 1] - ruta.x[k]) * f,
    s: ruta.s[k] + (ruta.s[k + 1] - ruta.s[k]) * f,
    d: ruta.d[k] + (ruta.d[k + 1] - ruta.d[k]) * f,
    k,
    trabajando: iguales ? ruta.parada[k + 1] : -1,
    velocidad: iguales ? 0 : (ruta.d[k + 1] - ruta.d[k]) / 1000 / span, // km/h
  };
}

function posicionPorDistancia(dd) {
  const dd2 = Math.min(Math.max(dd, 0), ruta.largo);
  const k = Math.min(buscar(ruta.d, dd2), ruta.d.length - 2);
  const span = ruta.d[k + 1] - ruta.d[k];
  const f = span > 0 ? (dd2 - ruta.d[k]) / span : 0;
  return { x: ruta.x[k] + (ruta.x[k + 1] - ruta.x[k]) * f, s: ruta.s[k] + (ruta.s[k + 1] - ruta.s[k]) * f };
}

// Rumbo en grados (0 = norte, 90 = este) para ir de a hacia b
const rumbo = (a, b) => (Math.atan2(b.x - a.x, -(b.s - a.s)) * 180 / Math.PI + 360) % 360;

// ================= Elementos en el suelo =================
function crearChevrones() {
  const forma = new THREE.Shape();
  forma.moveTo(0, 0.9); forma.lineTo(0.7, -0.3); forma.lineTo(0.35, -0.3);
  forma.lineTo(0, 0.2); forma.lineTo(-0.35, -0.3); forma.lineTo(-0.7, -0.3); forma.lineTo(0, 0.9);
  const geo = new THREE.ShapeGeometry(forma);
  geo.rotateX(-Math.PI / 2); // acostado en el suelo, apuntando a -Z (adelante)
  for (let i = 0; i < 25; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: "#00e5ff", transparent: true, opacity: 0.85, depthWrite: false,
      depthTest: false, // siempre encima del suelo, como proyectado en el visor
    }));
    m.renderOrder = 5;
    escena.add(m);
    chevrones.push(m);
  }
}

function colorPendiente(x, s) {
  const celda = mapaACelda({ lat: info.alto_m - s, lng: x });
  const p = celda === null ? 0 : cuad.pendiente[celda] / 10;
  if (p > sim.params.pendienteMax * 0.8) return "#ff5252";
  if (p > 12) return "#f5c542";
  return "#00e5ff";
}

function actualizarChevrones(d) {
  chevrones.forEach((m, i) => {
    const dd = d + 3 + i * 4;
    if (dd > ruta.largo) { m.visible = false; return; }
    const p = posicionPorDistancia(dd), q = posicionPorDistancia(dd + 1);
    m.visible = true;
    m.position.copy(a3D(p.x, p.s, alturaSuelo(p.x, p.s) + 0.08));
    m.rotation.y = -rumbo(p, q) * Math.PI / 180;
    m.material.color.set(colorPendiente(p.x, p.s));
    m.material.opacity = 0.85 * (1 - i / 30); // se desvanecen a lo lejos
  });
}

function letrero(texto, color) {
  const c = document.createElement("canvas"), ctx = c.getContext("2d");
  ctx.font = "bold 48px sans-serif";
  c.width = ctx.measureText(texto).width + 32; c.height = 72;
  ctx.font = "bold 48px sans-serif";
  ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(texto, c.width / 2, c.height / 2);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, sizeAttenuation: false }));
  sp.scale.set(0.05 * c.width / c.height, 0.05, 1);
  sp.renderOrder = 10;
  return sp;
}

// Balizas de luz en el habitat y las paradas, para verlas de lejos
function crearBalizas() {
  balizas = new THREE.Group();
  const puntos = [{ ...ruta.destinos[ruta.destinos.length - 1], nombre: t("habitat"), color: "#e8794a" }];
  ruta.destinos.slice(0, -1).forEach((p, k) => puntos.push({ ...p, nombre: ruta.nombres[k + 1], color: "#00e5ff" }));
  for (const p of puntos) {
    const base = alturaCTX(p.x, p.s) - zref - BAJAR_CTX;
    const columna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 60, 8),
      new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.45, depthWrite: false })
    );
    columna.position.copy(a3D(p.x, p.s, base + 30));
    const et = letrero(p.nombre, p.color);
    et.position.copy(a3D(p.x, p.s, base + 64));
    balizas.add(columna, et);
  }
  escena.add(balizas);
}

// ================= Escena =================
function crearEscena() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // un poco menos para que la tablet vaya fluida
  document.getElementById("lienzo-casco").appendChild(renderer.domElement);

  escena = new THREE.Scene();
  const cielo = new THREE.Color("#c9a27e"); // cielo marciano color caramelo
  escena.background = cielo;
  escena.fog = new THREE.Fog(cielo, 250, 3200); // la neblina esconde la orilla del mapa

  camara = new THREE.PerspectiveCamera(70, 1, 0.1, 8000);
  camara.rotation.order = "YXZ"; // primero voltear a los lados, luego arriba/abajo

  escena.add(new THREE.HemisphereLight("#ffe9d0", "#4a3020", 1.1));
  const sol = new THREE.DirectionalLight("#fff4e6", 1.8);
  sol.position.set(-300, 400, 200);
  escena.add(sol);

  zref = cuad.elevacion.reduce((m, z) => (z > -99999 && z < m ? z : m), Infinity);
  texFoto = new THREE.TextureLoader().load(window.DATOS + "foto.png");
  texFoto.colorSpace = THREE.SRGBColorSpace;
  texFoto.anisotropy = renderer.capabilities.getMaxAnisotropy();
  crearTerrenoCTX();
  crearChevrones();
  configurarMirada();
  window.addEventListener("resize", ajustarTamano);
}

function ajustarTamano() {
  if (!renderer) return;
  const c = document.getElementById("lienzo-casco");
  renderer.setSize(c.clientWidth, c.clientHeight);
  camara.aspect = c.clientWidth / c.clientHeight;
  camara.updateProjectionMatrix();
}

// ---------- Mirar: arrastrando (mouse o dedo) o moviendo la tablet ----------
let giro = null; // datos del giroscopio
function configurarMirada() {
  const el = renderer.domElement;
  let arrastre = null;
  el.addEventListener("pointerdown", (e) => { arrastre = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
  el.addEventListener("pointermove", (e) => {
    if (!arrastre || giro) return;
    cabeza.yaw += (e.clientX - arrastre.x) * 0.004;
    cabeza.pitch = Math.max(-1.4, Math.min(1.4, cabeza.pitch + (e.clientY - arrastre.y) * 0.004));
    arrastre = { x: e.clientX, y: e.clientY };
  });
  el.addEventListener("pointerup", () => (arrastre = null));
  el.addEventListener("dblclick", mirarAlFrente);
}

function mirarAlFrente() { cabeza.yaw = 0; cabeza.pitch = -0.05; }

async function alternarGiroscopio() {
  const btn = document.getElementById("hc-giro");
  if (giro) {
    window.removeEventListener("deviceorientation", giro.fn);
    giro = null; btn.classList.remove("activo"); mirarAlFrente();
    return;
  }
  if (typeof DeviceOrientationEvent === "undefined") { alerta(t("a_sin_giro"), "info", 3); return; }
  if (DeviceOrientationEvent.requestPermission) { // iPad / iPhone piden permiso
    try { if ((await DeviceOrientationEvent.requestPermission()) !== "granted") return; } catch { return; }
  }
  giro = { base: null };
  giro.fn = (e) => {
    if (e.alpha === null) return;
    if (!giro.base) giro.base = { a: e.alpha, b: e.beta };
    cabeza.yaw = THREE.MathUtils.degToRad(giro.base.a - e.alpha) * -1;
    cabeza.pitch = Math.max(-1.4, Math.min(1.4, THREE.MathUtils.degToRad(e.beta - giro.base.b)));
  };
  window.addEventListener("deviceorientation", giro.fn);
  btn.classList.add("activo");
  alerta(t("a_giro"), "info", 3);
}

// ================= HUD =================
const $ = (id) => document.getElementById(id);
const hm = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
const puntoCardinal = (g) => t("cardinales").split(",")[Math.round(g / 45) % 8];

// Mensajes temporales (con segundos) o que duran mientras pase algo (sin segundos)
let alertaHasta = 0;
function alerta(texto, tipo, segundos) {
  const el = $("hc-alerta");
  el.textContent = texto;
  el.className = "visible " + tipo;
  alertaHasta = segundos ? performance.now() + segundos * 1000 : 0;
}

function alternarPanel(nombre) {
  if (activos.has(nombre)) activos.delete(nombre); else activos.add(nombre);
  document.querySelectorAll("#hc-iconos button").forEach((b) => b.classList.toggle("activo", activos.has(b.dataset.panel)));
  $("hc-mini").classList.toggle("oculto", !activos.has("mapa"));
  actualizarHud(true);
}

function siguienteDestino(d) {
  // el destino al que va ahora: el primero cuya distancia en la ruta aun no se alcanza
  for (let k = 0; k < ruta.destinos.length; k++) {
    const i = ruta.parada.indexOf(k + 1);
    const dParada = i >= 0 ? ruta.d[i] : ruta.largo;
    if (d < dParada - 1) return { k, ...ruta.destinos[k], dRestante: dParada - d, nombre: k < ruta.destinos.length - 1 ? ruta.nombres[k + 1] : t("habitat") };
  }
  return { k: ruta.destinos.length - 1, ...ruta.destinos[ruta.destinos.length - 1], dRestante: 0, nombre: t("habitat") };
}

let ultimoHud = 0;
function actualizarHud(forzar) {
  const ahora = performance.now();
  if (!forzar && ahora - ultimoHud < 200) return; // 5 veces por segundo basta
  ultimoHud = ahora;

  const p = sim.pos, params = sim.params;
  const yawCamino = sim.rumboCamino;
  const verHacia = ((yawCamino - THREE.MathUtils.radToDeg(cabeza.yaw)) % 360 + 360) % 360;
  $("hc-rumbo").textContent = `${puntoCardinal(verHacia)} · ${Math.round(verHacia)}°`;

  const usado = sim.t / params.oxigeno;
  const reserva = params.reserva / 100;
  $("hc-o2-barra").style.width = `${Math.max(0, (1 - usado) * 100)}%`;
  $("hc-o2-barra").style.background = 1 - usado < reserva ? "#ff5252" : 1 - usado < reserva + 0.15 ? "#f5c542" : "#3ddc84";
  // anillo de oxigeno y telemetria (diseno nuevo)
  const quedaPct = Math.max(0, (1 - usado) * 100);
  const colorO2 = 1 - usado < reserva ? "#FF5A5F" : 1 - usado < reserva + 0.15 ? "#FFB547" : "#3DDC84";
  $("hc-o2-anillo").style.background = `conic-gradient(${colorO2} ${quedaPct}%, #222B3B 0)`;
  $("hc-o2-pct").textContent = `${quedaPct.toFixed(0)}%`;
  $("hc-o2-resto").textContent = t("quedan", { t: hm(Math.max(0, params.oxigeno - sim.t)) });
  const minMet = Math.round(sim.t * 60);
  $("hc-t-met").textContent = `T+${Math.floor(minMet / 60)}:${String(minMet % 60).padStart(2, "0")}`;
  $("hc-t-dist").textContent = `${(p.d / 1000).toFixed(2)} km`;
  $("hc-t-dosis").textContent = `${((sim.t / 24) * params.radiacion * (params.tormenta ? params.multTormenta : 1)).toFixed(3)} mSv`;
  $("hc-t-regreso").textContent = hm(Math.max(0, ruta.total - sim.t));

  const dest = siguienteDestino(p.d);
  const relativo = ((rumbo(p, dest) - verHacia) + 540) % 360 - 180;
  $("hc-flecha").style.transform = `rotate(${relativo}deg)`;
  $("hc-destino").textContent = `${dest.nombre} · ${dest.dRestante >= 1000 ? (dest.dRestante / 1000).toFixed(2) + " km" : Math.round(dest.dRestante) + " m"}`;

  // pendiente con signo (adelante 5 m)
  const q = posicionPorDistancia(p.d + 5);
  const zAqui = alturaReal(p.x, p.s), zAdelante = alturaReal(q.x, q.s);
  const pend = Math.atan2(zAdelante - zAqui, 5) * 180 / Math.PI;
  const dosis = (sim.t / 24) * params.radiacion * (params.tormenta ? params.multTormenta : 1);

  const textos = {
    oxigeno: `<b>${t("c_oxigeno")}</b> ${Math.max(0, (1 - usado) * 100).toFixed(0)}% · ${t("quedan", { t: hm(Math.max(0, params.oxigeno - sim.t)) })}`,
    distancia: `<b>${t("c_caminado")}</b> ${(p.d / 1000).toFixed(2)} km<br><b>${t("c_falta")}</b> ${((ruta.largo - p.d) / 1000).toFixed(2)} km`,
    tiempo: `<b>${t("c_tiempo")}</b> ${hm(sim.t)}<br><b>${t("c_regreso")}</b> ${hm(Math.max(0, ruta.total - sim.t))}`,
    terreno: `<b>${t("c_altitud")}</b> ${Math.round(zAqui)} m<br><b>${t("c_pendiente")}</b> ${pend >= 0 ? "+" : ""}${pend.toFixed(0)}° ${pend > 1 ? t("subiendo") : pend < -1 ? t("bajando") : t("plano")}<br><b>${t("c_velocidad")}</b> ${p.velocidad.toFixed(1)} km/h`,
    dosis: `<b>${t("c_dosis")}</b> ${dosis.toFixed(3)} mSv<br>${t("c_limite")} ${params.limiteDosis} mSv`,
    parada: textoParada(dest),
  };
  $("hc-paneles").innerHTML = [...activos].filter((n) => textos[n]).map((n) => `<div class="hc-panel">${textos[n]}</div>`).join("");
  if (activos.has("mapa")) dibujarMinimapa(p);

  // Alertas automaticas: salen aunque los paneles esten cerrados
  if (1 - usado < reserva) {
    alerta(t("a_reserva"), "peligro"); // lo mas importante va primero
  } else if (performance.now() < alertaHasta) {
    // hay un mensaje temporal (por ejemplo "Mision aprobada"): se deja ver
  } else if (p.trabajando > 0) {
    const i = ruta.parada.indexOf(p.trabajando);
    alerta(t("a_trabajando", { lugar: ruta.nombres[p.trabajando], t: hm(ruta.t[i] - sim.t) }), "info");
  } else {
    const aviso = revisarAdelante(p.d);
    if (aviso) alerta(aviso.texto, aviso.tipo);
    else if (performance.now() > alertaHasta) $("hc-alerta").className = "";
  }
}

function textoParada(dest) {
  const poi = pois.find((x) => x.nombre === dest.nombre);
  const foto = poi && poi.foto ? `<br><img src="${poi.foto}" alt="${poi.nombre}">` : "";
  const extra = poi ? `<br>${poi.que_estudiar}` : "";
  return `<b>${t("c_siguiente")}</b> ${dest.nombre}${extra}${foto}`;
}

// Revisa los proximos 60 m: subida fuerte o terreno rugoso
function revisarAdelante(d) {
  for (let dd = 5; dd <= 60; dd += 5) {
    const p = posicionPorDistancia(d + dd);
    const celda = mapaACelda({ lat: info.alto_m - p.s, lng: p.x });
    if (celda === null) continue;
    const pend = cuad.pendiente[celda] / 10;
    if (pend > sim.params.pendienteMax * 0.7) return { texto: t("a_pendiente", { d: dd, g: pend.toFixed(0) }), tipo: "aviso" };
    if (cuad.rugosidad && cuad.rugosidad[celda] / 100 > sim.params.rugosidadMax * 0.6) return { texto: t("a_rugoso", { d: dd }), tipo: "aviso" };
  }
  return null;
}

function dibujarMinimapa(p) {
  const c = $("hc-mini"), ctx = c.getContext("2d");
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(11,15,23,0.6)"; ctx.fillRect(0, 0, W, H);
  const esc = Math.min(W / info.ancho_m, H / info.alto_m);
  const X = (x) => x * esc + (W - info.ancho_m * esc) / 2, Y = (s) => s * esc + (H - info.alto_m * esc) / 2;
  ctx.strokeStyle = "#4FD1E8"; ctx.lineWidth = 2; ctx.beginPath();
  ruta.x.forEach((x, i) => (i ? ctx.lineTo(X(x), Y(ruta.s[i])) : ctx.moveTo(X(x), Y(ruta.s[i]))));
  ctx.stroke();
  ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(X(p.x), Y(p.s), 4, 0, 7); ctx.fill();
}

function mostrarResumen() {
  sim.pausa = true;
  const params = sim.params;
  const dosis = (ruta.total / 24) * params.radiacion * (params.tormenta ? params.multTormenta : 1);
  $("hc-resumen-datos").innerHTML = `
    <p>${t("r_distancia")}: <b>${(ruta.largo / 1000).toFixed(2)} km</b></p>
    <p>${t("r_tiempo")}: <b>${hm(ruta.total)}</b></p>
    <p>${t("r_oxigeno")}: <b>${(ruta.total / params.oxigeno * 100).toFixed(0)}%</b></p>
    <p>${t("r_dosis")}: <b>${dosis.toFixed(3)} mSv</b></p>
    <p>${t("r_paradas")}: <b>${ruta.nombres.slice(1).join(", ")}</b></p>`;
  $("hc-resumen").classList.remove("oculto");
}

// ================= Ciclo principal =================
function paso() {
  reloj.update();
  const dt = Math.min(reloj.getDelta(), 0.1); // segundos reales
  if (!sim.pausa) {
    sim.t += (dt * sim.multiplicador) / 3600; // horas de mision
    if (sim.t >= ruta.total) { sim.t = ruta.total; mostrarResumen(); }
  }
  const p = (sim.pos = posicionPorTiempo(sim.t));

  // hacia donde va el camino (mirando 6 m adelante, suaviza las esquinas de la cuadricula)
  const q = posicionPorDistancia(p.d + 6);
  if (Math.hypot(q.x - p.x, q.s - p.s) > 0.5) {
    const objetivo = rumbo(p, q);
    const dif = ((objetivo - sim.rumboCamino) + 540) % 360 - 180;
    sim.rumboCamino = (sim.rumboCamino + dif * Math.min(1, dt * 3) + 360) % 360;
  }

  // camara a la altura de los ojos, con un balanceo suave por cada paso (gravedad de Marte)
  const balanceo = p.velocidad > 0 ? Math.abs(Math.sin((p.d / ZANCADA) * Math.PI)) * 0.04 : 0;
  const yObjetivo = alturaSuelo(p.x, p.s) + OJOS + balanceo;
  sim.y = sim.y === null ? yObjetivo : sim.y + (yObjetivo - sim.y) * Math.min(1, dt * 8);
  camara.position.copy(a3D(p.x, p.s, sim.y));
  camara.rotation.y = -THREE.MathUtils.degToRad(sim.rumboCamino) + cabeza.yaw;
  camara.rotation.x = cabeza.pitch;

  if (performance.now() - sim.ultimaRevision > 500) {
    actualizarTeselas(p.x, p.s);
    sim.ultimaRevision = performance.now();
  }
  actualizarChevrones(p.d);
  actualizarHud();
  renderer.render(escena, camara);
}

// ================= Abrir / cerrar =================
async function abrirCasco(mision, params, nombres, paradas) {
  document.body.classList.add("modo-casco3d");
  if (!renderer) {
    crearEscena();
    try {
      const r = await fetch(window.DATOS + "hirise/indice.json");
      if (r.ok) {
        indice = await r.json();
        indice.existe = new Set(indice.existentes);
        indice.conFoto = new Set(indice.fotos || []);
      }
    } catch { indice = null; }
  }
  ajustarTamano();
  ruta = armarRuta(mision, params, nombres, paradas);
  if (balizas) escena.remove(balizas);
  crearBalizas();
  sim = { t: 0, pausa: false, multiplicador: 60, params, pos: null, y: null,
          rumboCamino: rumbo({ x: ruta.x[0], s: ruta.s[0] }, posicionPorDistancia(6)), ultimaRevision: 0 };
  mirarAlFrente();
  $("hc-resumen").classList.add("oculto");
  document.querySelectorAll("#hc-velocidad button").forEach((b) => b.classList.toggle("activo", b.dataset.x === "60"));
  $("hc-pausa").textContent = t("pausa");
  alerta(!indice ? t("a_sin_hirise")
    : indice.conFoto.size ? t("a_aprobada")
    : t("a_sin_foto"), "info", 4);
  reloj.reset();
  renderer.setAnimationLoop(paso);
}

function cerrarCasco() {
  if (giro) alternarGiroscopio();
  if (renderer) renderer.setAnimationLoop(null);
  document.body.classList.remove("modo-casco3d");
}

// ---------- Botones del casco ----------
window.abrirCasco = abrirCasco;
$("hc-salir").addEventListener("click", cerrarCasco);
$("hc-volver").addEventListener("click", cerrarCasco);
$("hc-frente").addEventListener("click", mirarAlFrente);
$("hc-giro").addEventListener("click", alternarGiroscopio);
$("hc-pausa").addEventListener("click", () => {
  if (!sim) return;
  sim.pausa = !sim.pausa;
  $("hc-pausa").textContent = sim.pausa ? t("seguir") : t("pausa");
});
document.querySelectorAll("#hc-velocidad button").forEach((b) => b.addEventListener("click", () => {
  if (!sim) return;
  sim.multiplicador = Number(b.dataset.x);
  document.querySelectorAll("#hc-velocidad button").forEach((o) => o.classList.toggle("activo", o === b));
}));
document.querySelectorAll("#hc-iconos button").forEach((b) => b.addEventListener("click", () => sim && alternarPanel(b.dataset.panel)));
