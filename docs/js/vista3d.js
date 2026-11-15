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
  if (capa !== "foto") {
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
    const s = letrero(u.nombre, u.color, 120);
    s.position.copy(a3D(lat, lng, 220));
    grupoGeologia.add(s);
  }
  escena.add(grupoGeologia);
}

// Letrero que siempre mira a la camara (para H, 1, 2... y puntos de interes)
function letrero(texto, color, alto) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = "bold 56px sans-serif";
  canvas.width = Math.ceil(ctx.measureText(texto).width) + 40; // el ancho depende del texto
  canvas.height = 96;
  ctx.font = "bold 56px sans-serif"; // al cambiar el tamano del canvas se borra la fuente
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
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

  paradas.forEach((c, k) => {
    const s = letrero(k === 0 ? "H" : String(k), k === 0 ? "#e8794a" : "#00e5ff", 160);
    s.position.copy(celdaA3D(c, 200));
    grupoMision.add(s);
  });

  for (const p of pois) {
    const [lat, lng] = lonlatAMapa(p.lon, p.lat);
    const s = letrero(p.nombre, "#ffd23f", 110);
    s.position.copy(a3D(lat, lng, 300));
    grupoMision.add(s);
    const poste = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 260, 6),
      new THREE.MeshBasicMaterial({ color: "#ffd23f" })
    );
    poste.position.copy(a3D(lat, lng, 130));
    grupoMision.add(poste);
  }
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
function encuadrar() {
  const mitadFov = THREE.MathUtils.degToRad(camara.fov / 2);
  const mitadFovH = Math.atan(Math.tan(mitadFov) * camara.aspect);
  const lado = Math.max(info.ancho_m, info.alto_m) / 2;
  const distancia = (lado / Math.tan(Math.min(mitadFov, mitadFovH))) * 1.15;
  camara.position.set(0, distancia * 0.6, distancia * 0.8);
  controles.target.set(0, 0, 0);
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
    llenarSelectorCapas();
    await ponerTextura("foto");
  }
  ajustarTamano();
  encuadrar();
  dibujarMision();
  reloj.reset();
  renderer.setAnimationLoop(() => {
    reloj.update();
    if (recorrido) pasoRecorrido(reloj.getDelta());
    else controles.update();
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
