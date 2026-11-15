// vista3d.js
// Vista 3D del terreno con Three.js: el DEM se vuelve una malla, encima va la foto
// (o la capa que elijas), y se dibujan la mision, las paradas y los puntos de interes.
// Usa las variables y funciones globales de app.js: info, cuad, pois, paradas,
// ultimaMision, celdaAMapa, lonlatAMapa y mapaACelda.

import * as THREE from "three";
import { OrbitControls } from "../lib/three/OrbitControls.js";
import { crearHabitat, animarHabitat } from "./habitat3d.js";

let renderer, escena, camara, controles, terreno, grupoMision;
let zmin = 0;
let exageracion = 2.5;
let recorrido = null; // animacion de "recorrer ruta"
let grupoGeologia = null; // nombres de las unidades geologicas (solo con esa capa)
let vuelo = null;         // animacion de la camara cuando te acercas a un punto
let lugares = [];         // puntos a los que se puede ir: { nombre, pos }
let verCrateres = true;   // casilla "Craters" del panel 3D
let pulso = null;         // anillo animado del crater elegido
let habitat = null;       // modelo 3D del habitat (se agranda segun la distancia de la camara)
const DIST_CERCA = 1200;   // metros entre la camara y el punto al acercarse

// ---------- Conversiones: metros del mapa -> coordenadas 3D ----------
// En 3D: x = este, y = arriba, z = sur (el norte queda hacia -z)
function a3D(lat_m, lng_m, extra = 0) {
  const celda = mapaACelda({ lat: lat_m, lng: lng_m });
  const z = celda === null ? zmin : cuad.elevacion[celda];
  const y = (Math.max(z, zmin) - zmin) * exageracion + extra;
  return new THREE.Vector3(lng_m - info.ancho_m / 2, y, info.alto_m / 2 - lat_m);
}

function celdaA3D(i, extra = 0) {
  const [lat, lng] = celdaAMapa(i);
  return a3D(lat, lng, extra);
}

// ---------- Escena (se arma una sola vez) ----------
function crearEscena() {
  const contenedor = document.getElementById("lienzo3d");
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  contenedor.appendChild(renderer.domElement);

  escena = new THREE.Scene();
  escena.background = new THREE.Color("#1b1b1b");

  camara = new THREE.PerspectiveCamera(50, 1, 5, 60000);
  camara.position.set(0, 4500, 5500);

  controles = new OrbitControls(camara, renderer.domElement);
  controles.enableDamping = true;
  controles.maxPolarAngle = Math.PI * 0.49; // que no se meta debajo del suelo

  // Luz: una general suave y un "sol" bajo para que se note el relieve
  escena.add(new THREE.HemisphereLight("#fff2e0", "#3a2a20", 1.2));
  const sol = new THREE.DirectionalLight("#ffffff", 1.6);
  sol.position.set(-4000, 2500, 3000);
  escena.add(sol);

  // Malla del terreno: un vertice por celda de la cuadricula
  const { ancho, alto, celda_x, celda_y } = cuad;
  const geo = new THREE.PlaneGeometry((ancho - 1) * celda_x, (alto - 1) * celda_y, ancho - 1, alto - 1);
  geo.rotateX(-Math.PI / 2); // de "pared" a "piso"
  zmin = cuad.elevacion.reduce((m, z) => (z > -99999 && z < m ? z : m), Infinity);
  terreno = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: "#ffffff" }));
  escena.add(terreno);
  actualizarAlturas();

  grupoMision = new THREE.Group();
  escena.add(grupoMision);

  window.addEventListener("resize", ajustarTamano);
}

function actualizarAlturas() {
  const pos = terreno.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = cuad.elevacion[i];
    pos.setY(i, z > -99999 ? (z - zmin) * exageracion : 0);
  }
  pos.needsUpdate = true;
  terreno.geometry.computeVertexNormals();
}

// La textura es la foto, y si eliges otra capa se pinta encima de la foto
function cargarImagen(src) {
  return new Promise((ok, error) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = error;
    img.src = src;
  });
}

async function ponerTextura(capa) {
  const foto = await cargarImagen(window.DATOS + "foto.png");
  const canvas = document.createElement("canvas");
  canvas.width = foto.width;
  canvas.height = foto.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(foto, 0, 0);
  if (capa === "geologia") {
    // estilo de las imagenes de NASA: el color de la unidad encima pero se sigue viendo el relieve
    const encima = await cargarImagen(`${window.DATOS}${capa}.png`);
    ctx.filter = "blur(3px)";                 // orillas suaves entre unidades
    ctx.globalCompositeOperation = "color";   // toma el color de la unidad y la luz de la foto
    ctx.drawImage(encima, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.3;                    // un poco mas de color para que se note
    ctx.drawImage(encima, 0, 0, canvas.width, canvas.height);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
  } else if (capa !== "foto") {
    // la pendiente sale de la imagen que pinta app.js con el limite actual
    const fuente = capa === "pendiente" && window.urlPendiente ? window.urlPendiente : `${window.DATOS}${capa}.png`;
    const encima = await cargarImagen(fuente);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.75;
    ctx.drawImage(encima, 0, 0, canvas.width, canvas.height);
  }
  const textura = new THREE.CanvasTexture(canvas);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = renderer.capabilities.getMaxAnisotropy();
  terreno.material.map = textura;
  terreno.material.needsUpdate = true;
  mostrarGeologia(capa === "geologia");
}

// Nombres de las unidades geologicas flotando sobre el terreno, del color de su unidad
function mostrarGeologia(visible) {
  if (grupoGeologia) { escena.remove(grupoGeologia); grupoGeologia = null; }
  if (!visible || !info.geologia) return;
  grupoGeologia = new THREE.Group();
  for (const u of info.geologia) {
    if (!u.letrero) continue;
    const [lat, lng] = lonlatAMapa(u.lon, u.lat);
    const s = letrero(u.nombre, "#ffffff", 200, true);
    s.position.copy(a3D(lat, lng, 220));
    grupoGeologia.add(s);
  }
  escena.add(grupoGeologia);
}

// Letrero que siempre mira a la camara (para H, 1, 2... y puntos de interes)
function letrero(texto, color, alto, sinFondo = false) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const fuente = sinFondo ? "italic 56px sans-serif" : "bold 56px sans-serif";
  ctx.font = fuente;
  canvas.width = Math.ceil(ctx.measureText(texto).width) + 40; // el ancho depende del texto
  canvas.height = 96;
  ctx.font = fuente; // al cambiar el tamano del canvas se borra la fuente
  if (sinFondo) {
    ctx.shadowColor = "rgba(0,0,0,0.9)"; // sombra para que se lea sobre cualquier color
    ctx.shadowBlur = 8;
  } else {
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(texto, canvas.width / 2, canvas.height / 2);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas), depthTest: false,
  }));
  sprite.scale.set(alto * canvas.width / canvas.height, alto, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// Ruta, paradas y puntos de interes (se rehace cada vez que abres la vista)
function dibujarMision() {
  grupoMision.clear();

  if (ultimaMision) {
    ultimaMision.tramos.forEach((t, k) => {
      const regreso = k === ultimaMision.tramos.length - 1;
      const puntos = t.camino.filter((_, j) => j % 2 === 0 || j === t.camino.length - 1)
        .map((c) => celdaA3D(c, 6));
      if (puntos.length < 2) return;
      const curva = new THREE.CatmullRomCurve3(puntos);
      const tubo = new THREE.Mesh(
        new THREE.TubeGeometry(curva, puntos.length * 3, 9, 6, false),
        new THREE.MeshBasicMaterial({ color: regreso ? "#b388ff" : "#00e5ff" })
      );
      grupoMision.add(tubo);
    });
  }

  // Recorrido real de Perseverance (linea blanca, como en las imagenes de NASA)
  const chkRover = document.getElementById("chk-rover");
  if ((window.recorridoRover || []).length && (!chkRover || chkRover.checked)) {
    const blanco = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    let masLarga = null;
    for (const l of window.recorridoRover) {
      const pts = l.filter((_, j) => j % 3 === 0 || j === l.length - 1).map(([lat, lng]) => a3D(lat, lng, 5));
      if (pts.length < 2) continue;
      const curva = new THREE.CatmullRomCurve3(pts);
      grupoMision.add(new THREE.Mesh(new THREE.TubeGeometry(curva, pts.length * 2, 5, 5, false), blanco));
      if (!masLarga || l.length > masLarga.length) masLarga = l;
    }
    if (masLarga) {
      const [lat, lng] = masLarga[Math.floor(masLarga.length / 2)];
      const s = letrero(t("rover_3d"), "#ffffff", 170, true);
      s.position.copy(a3D(lat, lng, 180));
      grupoMision.add(s);
    }
  }

  dibujarCrateres3D();

  // Habitat en 3D sobre la primera marca, con la esclusa mirando a la primera parada
  habitat = null;
  if (paradas.length) {
    habitat = crearHabitat();
    habitat.position.copy(celdaA3D(paradas[0], 0));
    if (paradas.length > 1) {
      const a = celdaA3D(paradas[0]), b = celdaA3D(paradas[1]);
      habitat.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); // +z local apunta a la parada
    }
    grupoMision.add(habitat);
  }

  lugares = [];
  paradas.forEach((c, k) => {
    const s = letrero(k === 0 ? "H" : String(k), k === 0 ? "#e8794a" : "#00e5ff", 160);
    s.position.copy(celdaA3D(c, 200));
    s.userData.lugar = lugares.length; // al tocar el letrero, la camara va a este punto
    lugares.push({ nombre: k === 0 ? t("habitat") : `${k} · ${nombreParada(k)}`, pos: celdaA3D(c, 0),
      tipo: k === 0 ? "habitat" : "parada", k, celda: c, titulo: nombreParada(k) });
    grupoMision.add(s);
  });

  for (const p of pois) {
    const [lat, lng] = lonlatAMapa(p.lon, p.lat);
    const s = letrero(p.nombre, "#ffd23f", 110);
    s.position.copy(a3D(lat, lng, 300));
    s.userData.lugar = lugares.length;
    lugares.push({ nombre: p.nombre, pos: a3D(lat, lng, 0), tipo: "poi", titulo: p.nombre,
      celda: mapaACelda({ lat, lng }), poi: p });
    grupoMision.add(s);
    const poste = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 260, 6),
      new THREE.MeshBasicMaterial({ color: "#ffd23f" })
    );
    poste.position.copy(a3D(lat, lng, 130));
    grupoMision.add(poste);
  }

  // crateres que toca la ruta: tambien se puede volar a ellos
  if (verCrateres && window.crateresDeMision) {
    crateresDeMision(ultimaMision).slice(0, 8).forEach((e, i) => {
      const [lat, lng] = [info.alto_m - e.c.s, e.c.x];
      lugares.push({ nombre: `${t("crat_titulo")} ${Math.round(e.c.d)} m · ${t("crat_tramo", { n: e.tramo })}`,
        pos: a3D(lat, lng, 0), tipo: "crater", titulo: `${t("crat_titulo")} ${Math.round(e.c.d)} m`,
        celda: mapaACelda({ lat, lng }), crater: e.c, tramo: e.tramo, k: i + 1 });
    });
  }
}

// ---------- Crateres (YOLO) sobre el terreno ----------
// Todos los anillos van en una sola geometria de segmentos (miles de crateres sin trabarse).
// Los que toca la ruta van en ambar y un poco mas altos; los demas en blanco tenue.
function dibujarCrateres3D() {
  if (!verCrateres || !window.crateresVisibles) return;
  const lista = crateresVisibles();
  if (!lista.length) return;
  const enRuta = new Set((window.crateresDeMision ? crateresDeMision(ultimaMision) : []).map((e) => e.c.id));
  const pos = [], col = [];
  const blanco = new THREE.Color("#f4ede4"), ambar = new THREE.Color("#ffb547");
  for (const c of lista) {
    const ruta = enRuta.has(c.id);
    if (c.d < 25 && !ruta) continue; // a escala de mesa no se ven
    const n = Math.min(64, Math.max(16, Math.round(c.d / 8)));
    const color = ruta ? ambar : blanco.clone().multiplyScalar(0.45 + 0.55 * c.conf);
    const alto = ruta ? 8 : 4;
    let prev = null;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const p = a3D(info.alto_m - (c.s + Math.sin(a) * c.d / 2), c.x + Math.cos(a) * c.d / 2, alto);
      if (prev) { pos.push(prev.x, prev.y, prev.z, p.x, p.y, p.z); col.push(color.r, color.g, color.b, color.r, color.g, color.b); }
      prev = p;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  grupoMision.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })));
}

// De lejos el habitat real (34 m) no se veria: se agranda con la distancia, de 1x a 14x
function escalarHabitat() {
  if (!habitat) return;
  const d = camara.position.distanceTo(habitat.position);
  const k = THREE.MathUtils.clamp(d / 300, 1, 14);
  habitat.scale.set(k, k, k);
  animarHabitat(habitat);
}

// Anillo que late sobre el crater elegido
function marcarCrater(c) {
  if (pulso) { escena.remove(pulso); pulso.geometry.dispose(); pulso = null; }
  if (!c) return;
  const geo = new THREE.RingGeometry(0.92, 1, 64);
  geo.rotateX(-Math.PI / 2);
  pulso = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: "#F26B3A", transparent: true, side: THREE.DoubleSide, depthTest: false }));
  pulso.renderOrder = 9;
  pulso.position.copy(a3D(info.alto_m - c.s, c.x, 25));
  pulso.userData.r = c.d / 2;
  escena.add(pulso);
}
function animarPulso() {
  if (!pulso) return;
  const k = (performance.now() % 1400) / 1400;
  const r = pulso.userData.r * (1 + 0.6 * k);
  pulso.scale.set(r, 1, r);
  pulso.material.opacity = 1 - k;
}

// Selector "Go to": vista completa + habitat, paradas y puntos de interes
function llenarSelectorLugares() {
  const caja = document.getElementById("lugares3d");
  const color = (l) => (l.tipo === "habitat" ? "#F26B3A" : l.tipo === "poi" ? "#FFD23F" : l.tipo === "crater" ? "#FFB547" : "#4FD1E8");
  caja.innerHTML = `<button data-i="-1"><span class="bolita"></span>${t("todo_sitio")}</button>` +
    lugares.map((l, i) => `<button data-i="${i}"><span class="bolita" style="background:${color(l)}"></span>${l.nombre}</button>`).join("");
  caja.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => irALugar(parseInt(b.dataset.i, 10))));
  document.getElementById("ficha3d").classList.add("oculto");
  marcarCrater(null);
}

// ---------- Acercarse a un punto ----------
// La camara vuela suave (1.2 s) hasta quedar a DIST_CERCA del punto, desde la misma direccion
function volarA(objetivo, distancia = DIST_CERCA) {
  const dir = camara.position.clone().sub(controles.target).normalize();
  if (dir.y < 0.35) { dir.y = 0.35; dir.normalize(); } // que no quede a ras del suelo
  iniciarVuelo(objetivo.clone().addScaledVector(dir, distancia), objetivo.clone());
}

function iniciarVuelo(posCamara, objetivo) {
  if (recorrido) detenerRecorrido();
  vuelo = { t0: performance.now(), dur: 1200,
    desdeCam: camara.position.clone(), haciaCam: posCamara,
    desdeObj: controles.target.clone(), haciaObj: objetivo };
}

function pasoVuelo() {
  const k = Math.min(1, (performance.now() - vuelo.t0) / vuelo.dur);
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // arranca y frena suave
  camara.position.lerpVectors(vuelo.desdeCam, vuelo.haciaCam, e);
  controles.target.lerpVectors(vuelo.desdeObj, vuelo.haciaObj, e);
  if (k >= 1) vuelo = null;
}

function irALugar(i) {
  document.querySelectorAll("#lugares3d button").forEach((b) => b.classList.toggle("activo", b.dataset.i === String(i)));
  mostrarFicha(i);
  if (i < 0) {
    const v = vistaCompleta();
    iniciarVuelo(v.camara, v.objetivo);
  } else if (lugares[i]) {
    const l = lugares[i];
    volarA(l.pos, l.crater ? Math.max(500, l.crater.d * 3.5) : DIST_CERCA);
  }
  marcarCrater(lugares[i] && lugares[i].crater);
}

// Toque corto en un letrero = ir a ese punto. Doble clic en el terreno = acercarse ahi.
const rayo = new THREE.Raycaster();
let toque = null;
function puntoPantalla(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
}
function conectarClics() {
  const el = renderer.domElement;
  el.addEventListener("pointerdown", (ev) => { toque = { x: ev.clientX, y: ev.clientY, t: performance.now() }; });
  el.addEventListener("pointerup", (ev) => {
    if (!toque) return;
    const corto = Math.hypot(ev.clientX - toque.x, ev.clientY - toque.y) < 6 && performance.now() - toque.t < 400;
    toque = null;
    if (!corto) return; // fue arrastre para girar la camara
    rayo.setFromCamera(puntoPantalla(ev), camara);
    const letreros = grupoMision.children.filter((o) => o.isSprite && o.userData.lugar !== undefined);
    const tocado = rayo.intersectObjects(letreros)[0];
    if (tocado) {
      const i = tocado.object.userData.lugar;
      irALugar(i);
    }
  });
  el.addEventListener("dblclick", (ev) => {
    rayo.setFromCamera(puntoPantalla(ev), camara);
    const golpe = rayo.intersectObject(terreno)[0];
    if (golpe) volarA(golpe.point, DIST_CERCA * 0.7);
  });
}

// ---------- Ficha del lugar elegido ----------
let lugarActual = -1;
function mostrarFicha(i) {
  lugarActual = i;
  const ficha = document.getElementById("ficha3d");
  const l = lugares[i];
  if (!l) { ficha.classList.add("oculto"); return; }
  ficha.classList.remove("oculto");
  const poner = (id, v) => (document.getElementById(id).textContent = v);

  const num = document.getElementById("ficha-num");
  num.textContent = l.tipo === "habitat" ? "H" : l.tipo === "poi" ? "★" : l.tipo === "crater" ? "◯" : String(l.k);
  num.className = "insignia" + (l.tipo === "habitat" ? " habitat" : l.tipo === "poi" ? " poi" : l.tipo === "crater" ? " crater" : "");
  poner("ficha-nombre", l.titulo);

  // coordenadas, altura y pendiente desde la cuadricula
  let lon, lat;
  if (l.poi) { lon = l.poi.lon; lat = l.poi.lat; }
  else if (l.crater) { lon = l.crater.lon; lat = l.crater.lat; }
  else { const [la, ln] = celdaAMapa(l.celda); [lon, lat] = mapaALonlat({ lat: la, lng: ln }); }
  poner("ficha-coord", `${lat.toFixed(4)} N · ${lon.toFixed(4)} E`);
  const z = l.celda !== null && l.celda !== undefined ? cuad.elevacion[l.celda] : -99999;
  const p = l.celda !== null && l.celda !== undefined ? cuad.pendiente[l.celda] : -1;
  poner("ficha-elev", z > -99999 ? `${Math.round(z).toLocaleString("en-US")} m` : "--");
  poner("ficha-pend", p >= 0 ? `${(p / 10).toFixed(1)}°` : "--");

  // hora de llegada (solo paradas de la mision)
  let llegada = "--";
  if (l.tipo === "habitat") llegada = "T+0:00";
  else if (l.tipo === "parada" && ultimaMision && typeof horariosMision === "function") {
    const h = horariosMision(ultimaMision, leerParametros().trabajo)[l.k];
    if (h !== undefined) llegada = tMas(h);
  }
  poner("ficha-llegada", llegada);

  // unidad geologica en ese punto (si la zona tiene la capa)
  const unidad = unidadGeologica(lon, lat);
  const caja = document.getElementById("ficha-unidad");
  caja.innerHTML = unidad ? `<span style="background:${unidad.color}"></span>${unidad.nombre}${unidad.simbolo ? ` (${unidad.simbolo})` : ""}` : "";

  poner("ficha-texto", l.poi && l.poi.que_estudiar ? l.poi.que_estudiar
    : l.crater ? `${fmtCrater(l.crater)} · ${t("crat_tramo", { n: l.tramo })} · YOLO` : "");
}

// Lee el color de geologia.png en ese punto y lo compara con la leyenda
let imgGeologia = null;
async function prepararGeologia() {
  if (imgGeologia || !info.geologia) return;
  try {
    const img = await cargarImagen(window.DATOS + "geologia.png");
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    c.getContext("2d").drawImage(img, 0, 0);
    imgGeologia = c.getContext("2d");
    imgGeologia.ancho = img.width; imgGeologia.alto = img.height;
  } catch { imgGeologia = null; }
}
function unidadGeologica(lon, lat) {
  if (!imgGeologia || !info.geologia) return null;
  const x = Math.floor(((lon - info.oeste) / (info.este - info.oeste)) * imgGeologia.ancho);
  const y = Math.floor(((info.norte - lat) / (info.norte - info.sur)) * imgGeologia.alto);
  if (x < 0 || y < 0 || x >= imgGeologia.ancho || y >= imgGeologia.alto) return null;
  const [r, g, b, a] = imgGeologia.getImageData(x, y, 1, 1).data;
  if (a < 10) return null;
  let mejor = null, dist = Infinity;
  for (const u of info.geologia) {
    const ur = parseInt(u.color.slice(1, 3), 16), ug = parseInt(u.color.slice(3, 5), 16), ub = parseInt(u.color.slice(5, 7), 16);
    const d = (r - ur) ** 2 + (g - ug) ** 2 + (b - ub) ** 2;
    if (d < dist) { dist = d; mejor = u; }
  }
  return mejor;
}

// ---------- Recorrer la ruta como dron ----------
function puntosDeLaMision() {
  if (!ultimaMision) return [];
  const todos = [];
  for (const t of ultimaMision.tramos) for (const c of t.camino) todos.push(celdaA3D(c, 0));
  return todos;
}

function iniciarRecorrido() {
  const puntos = puntosDeLaMision();
  if (puntos.length < 2) {
    alert(t("a_sin_plan"));
    return;
  }
  recorrido = { curva: new THREE.CatmullRomCurve3(puntos), t: 0, duracion: 40 };
  controles.enabled = false;
  document.getElementById("btn-recorrer").textContent = t("detener");
}

function detenerRecorrido() {
  recorrido = null;
  controles.enabled = true;
  document.getElementById("btn-recorrer").textContent = t("recorrer");
}

function pasoRecorrido(dt) {
  recorrido.t += dt / recorrido.duracion;
  if (recorrido.t >= 1) { detenerRecorrido(); return; }
  const aqui = recorrido.curva.getPointAt(recorrido.t);
  const adelante = recorrido.curva.getPointAt(Math.min(1, recorrido.t + 0.02));
  const atras = recorrido.curva.getPointAt(Math.max(0, recorrido.t - 0.03));
  // camara detras y arriba del punto actual, mirando hacia adelante
  camara.position.set(atras.x, Math.max(atras.y, aqui.y) + 250, atras.z);
  camara.lookAt(adelante.x, adelante.y, adelante.z);
  controles.target.copy(adelante);
}

// Pone la camara a la distancia justa para que quepa todo el terreno (sirve en tablet vertical)
function vistaCompleta() {
  const mitadFov = THREE.MathUtils.degToRad(camara.fov / 2);
  const mitadFovH = Math.atan(Math.tan(mitadFov) * camara.aspect);
  const lado = Math.max(info.ancho_m, info.alto_m) / 2;
  const distancia = (lado / Math.tan(Math.min(mitadFov, mitadFovH))) * 1.15;
  return { camara: new THREE.Vector3(0, distancia * 0.6, distancia * 0.8), objetivo: new THREE.Vector3(0, 0, 0) };
}

function encuadrar() {
  const v = vistaCompleta();
  camara.position.copy(v.camara);
  controles.target.copy(v.objetivo);
  controles.update();
}

// ---------- Abrir / cerrar ----------
function ajustarTamano() {
  if (!renderer) return;
  const cont = document.getElementById("lienzo3d");
  renderer.setSize(cont.clientWidth, cont.clientHeight);
  camara.aspect = cont.clientWidth / cont.clientHeight;
  camara.updateProjectionMatrix();
}

const reloj = new THREE.Timer();

async function abrir3D() {
  document.body.classList.add("modo3d");
  if (!renderer) {
    crearEscena();
    conectarClics();
    llenarSelectorCapas();
    await ponerTextura("foto");
  }
  ajustarTamano();
  encuadrar();
  await prepararGeologia();
  dibujarMision();
  llenarSelectorLugares();
  document.getElementById("leyenda-rover").classList.toggle("oculto", !(window.recorridoRover || []).length);
  document.getElementById("leyenda-crateres").classList.toggle("oculto", !(window.CRATER && CRATER.lista.length));
  reloj.reset();
  renderer.setAnimationLoop(() => {
    reloj.update();
    if (recorrido) pasoRecorrido(reloj.getDelta());
    else {
      if (vuelo) pasoVuelo();
      controles.update();
    }
    animarPulso();
    escalarHabitat();
    renderer.render(escena, camara);
  });
}

function cerrar3D() {
  detenerRecorrido();
  renderer.setAnimationLoop(null); // deja de dibujar para no gastar bateria
  document.body.classList.remove("modo3d");
}

function llenarSelectorCapas() {
  const caja = document.getElementById("capas3d");
  // cada boton lleva su clave de idioma para que cambie solo al cambiar de idioma
  const opciones = [["foto", "c_foto"], ["elevacion", "c_elev"], ["pendiente", "c_pend"]];
  if (info.tiene_rugosidad) opciones.push(["rugosidad", "c_rug"]);
  for (const e of info.capas_extra || []) opciones.push([e.nombre, e.nombre === "geologia" ? "c_geo" : null, e.etiqueta]);
  caja.innerHTML = opciones.map(([v, clave, texto]) =>
    clave ? `<button data-capa="${v}" data-i18n="${clave}">${t(clave)}</button>` : `<button data-capa="${v}">${texto}</button>`).join("");
  caja.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    caja.querySelectorAll("button").forEach((x) => x.classList.toggle("activo", x === b));
    ponerTextura(b.dataset.capa);
  }));
  caja.querySelector('[data-capa="foto"]').classList.add("activo");

  // casilla de crateres (solo si la zona tiene crateres.json)
  if (window.CRATER && CRATER.lista.length) {
    caja.insertAdjacentHTML("afterend", `<label class="opcion opcion3d"><input type="checkbox" id="chk-crateres3d" checked>
      <span data-i18n="crat_3d">${t("crat_3d")}</span></label>`);
    document.getElementById("chk-crateres3d").addEventListener("change", (e) => {
      verCrateres = e.target.checked;
      if (!verCrateres) marcarCrater(null);
      dibujarMision();
      llenarSelectorLugares();
    });
  }
}

// ---------- Botones ----------
document.getElementById("btn-3d").addEventListener("click", abrir3D);
document.getElementById("btn-cerrar3d").addEventListener("click", cerrar3D);
document.getElementById("rng-exagera").addEventListener("input", (e) => {
  exageracion = parseFloat(e.target.value);
  document.getElementById("txt-exagera").textContent = exageracion + "x";
  actualizarAlturas();
  dibujarMision();
  llenarSelectorLugares();
  if (grupoGeologia) mostrarGeologia(true);
});
// Desde la mesa de planeacion tambien se puede aprobar y salir al casco
document.getElementById("btn-aprobar3d").addEventListener("click", () => {
  cerrar3D();
  aprobarMision(); // esta en app.js; si es NO-GO no deja salir
});
document.getElementById("btn-recorrer").addEventListener("click", () =>
  recorrido ? detenerRecorrido() : iniciarRecorrido()
);
// Anterior / siguiente en la ficha
document.getElementById("ficha-ant").addEventListener("click", () => {
  if (lugares.length) irALugar((lugarActual - 1 + lugares.length) % lugares.length);
});
document.getElementById("ficha-sig").addEventListener("click", () => {
  if (lugares.length) irALugar((lugarActual + 1) % lugares.length);
});

// Desde el explorador de crateres: abrir la Mesa 3D y volar al crater
window.verCrater3D = async (c) => {
  await abrir3D();
  const pos = a3D(info.alto_m - c.s, c.x, 0);
  volarA(pos, Math.max(400, c.d * 3.5));
  marcarCrater(c);
};

// Cambio en el filtro de confianza de los crateres (crateres.js)
window.addEventListener("crateres", () => {
  if (!renderer) return;
  dibujarMision();
  llenarSelectorLugares();
});

// Al cambiar de idioma: letreros 3D, lista "Go to" y ficha
window.addEventListener("idioma", () => {
  if (!renderer) return;
  dibujarMision();
  const antes = lugarActual;
  llenarSelectorLugares();
  if (antes >= 0 && lugares[antes]) irALugarSinVolar(antes);
  if (!recorrido) document.getElementById("btn-recorrer").textContent = t("recorrer");
});
function irALugarSinVolar(i) {
  document.querySelectorAll("#lugares3d button").forEach((b) => b.classList.toggle("activo", b.dataset.i === String(i)));
  mostrarFicha(i);
}
