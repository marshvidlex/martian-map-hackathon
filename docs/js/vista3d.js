// vista3d.js
// Vista 3D del terreno con Three.js: el DEM se vuelve una malla, encima va la foto
// (o la capa que elijas), y se dibujan la mision, las paradas y los puntos de interes.
// Usa las variables y funciones globales de app.js: info, cuad, pois, paradas,
// ultimaMision, celdaAMapa, lonlatAMapa y mapaACelda.

import * as THREE from "three";
import { OrbitControls } from "../lib/three/OrbitControls.js";

let renderer, escena, camara, controles, terreno, grupoMision;
let zmin = 0;
let exageracion = 2.5;
let recorrido = null; // animacion de "recorrer ruta"
let grupoGeologia = null; // nombres de las unidades geologicas (solo con esa capa)
let vuelo = null;         // animacion de la camara cuando te acercas a un punto
let lugares = [];         // puntos a los que se puede ir: { nombre, pos }
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
    const encima = await cargarImagen(`${window.DATOS}${capa}.png`);
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
      const s = letrero("Perseverance traverse", "#ffffff", 170, true);
      s.position.copy(a3D(lat, lng, 180));
      grupoMision.add(s);
    }
  }

  lugares = [];
  paradas.forEach((c, k) => {
    const s = letrero(k === 0 ? "H" : String(k), k === 0 ? "#e8794a" : "#00e5ff", 160);
    s.position.copy(celdaA3D(c, 200));
    s.userData.lugar = lugares.length; // al tocar el letrero, la camara va a este punto
    lugares.push({ nombre: k === 0 ? "Habitat" : `${k}. ${nombreParada(k)}`, pos: celdaA3D(c, 0) });
    grupoMision.add(s);
  });

  for (const p of pois) {
    const [lat, lng] = lonlatAMapa(p.lon, p.lat);
    const s = letrero(p.nombre, "#ffd23f", 110);
    s.position.copy(a3D(lat, lng, 300));
    s.userData.lugar = lugares.length;
    lugares.push({ nombre: p.nombre, pos: a3D(lat, lng, 0) });
    grupoMision.add(s);
    const poste = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 260, 6),
      new THREE.MeshBasicMaterial({ color: "#ffd23f" })
    );
    poste.position.copy(a3D(lat, lng, 130));
    grupoMision.add(poste);
  }
}

// Selector "Go to": vista completa + habitat, paradas y puntos de interes
function llenarSelectorLugares() {
  const sel = document.getElementById("sel-ir3d");
  sel.innerHTML = `<option value="-1">Whole site</option>` +
    lugares.map((l, i) => `<option value="${i}">${l.nombre}</option>`).join("");
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
  if (i < 0) {
    const v = vistaCompleta();
    iniciarVuelo(v.camara, v.objetivo);
  } else if (lugares[i]) {
    volarA(lugares[i].pos);
  }
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
      document.getElementById("sel-ir3d").value = String(i);
      irALugar(i);
    }
  });
  el.addEventListener("dblclick", (ev) => {
    rayo.setFromCamera(puntoPantalla(ev), camara);
    const golpe = rayo.intersectObject(terreno)[0];
    if (golpe) volarA(golpe.point, DIST_CERCA * 0.7);
  });
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
    alert("First plan a mission on the 2D map (habitat and at least one stop).");
    return;
  }
  recorrido = { curva: new THREE.CatmullRomCurve3(puntos), t: 0, duracion: 40 };
  controles.enabled = false;
  document.getElementById("btn-recorrer").textContent = "Stop";
}

function detenerRecorrido() {
  recorrido = null;
  controles.enabled = true;
  document.getElementById("btn-recorrer").textContent = "Fly the route";
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
  dibujarMision();
  llenarSelectorLugares();
  reloj.reset();
  renderer.setAnimationLoop(() => {
    reloj.update();
    if (recorrido) pasoRecorrido(reloj.getDelta());
    else {
      if (vuelo) pasoVuelo();
      controles.update();
    }
    renderer.render(escena, camara);
  });
}

function cerrar3D() {
  detenerRecorrido();
  renderer.setAnimationLoop(null); // deja de dibujar para no gastar bateria
  document.body.classList.remove("modo3d");
}

function llenarSelectorCapas() {
  const sel = document.getElementById("sel-capa3d");
  const opciones = [["foto", "Photo"], ["elevacion", "Elevation"], ["pendiente", "Slope"]];
  if (info.tiene_rugosidad) opciones.push(["rugosidad", "Roughness"]);
  for (const e of info.capas_extra || []) opciones.push([e.nombre, e.etiqueta]);
  sel.innerHTML = opciones.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
}

// ---------- Botones ----------
document.getElementById("btn-3d").addEventListener("click", abrir3D);
document.getElementById("btn-cerrar3d").addEventListener("click", cerrar3D);
document.getElementById("sel-capa3d").addEventListener("change", (e) => ponerTextura(e.target.value));
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
document.getElementById("sel-ir3d").addEventListener("change", (e) => irALugar(parseInt(e.target.value, 10)));
