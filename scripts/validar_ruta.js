// validar_ruta.js
// Compara las rutas de nuestro planeador (el MISMO ruta.js de la pagina) con el recorrido REAL
// de Perseverance (M20_traverse.json, NASA/JPL) dentro de la zona.
// El recorrido del rover se corta en tramos; para cada tramo se le pide al planeador ir del mismo
// inicio al mismo final y se mide que tanto se parecen.
//
// Uso (desde la carpeta del repo, necesita Node.js):
//     node scripts/validar_ruta.js jezero
// Escribe docs/data/zonas/<zona>/validacion_ruta.json y muestra un resumen.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const zona = process.argv[2] || "jezero";
const TRAMO_M = Number(process.argv[3] || 800); // largo de cada tramo del rover (m)
const raiz = path.join(__dirname, "..", "docs");
const carpeta = path.join(raiz, "data", "zonas", zona);
const leer = (a) => JSON.parse(fs.readFileSync(path.join(carpeta, a), "utf8"));

// cargar ruta.js tal cual lo usa la pagina
const ctx = { Math, Float64Array, Int32Array, Uint8Array, Infinity };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(raiz, "js", "ruta.js"), "utf8"), ctx);

const info = leer("info.json");
const cuad = leer("cuadricula.json");
const params = { pendienteMax: 15, rugosidadMax: 1, velocidad: 3, carga: 20 }; // valores de la pagina

// lon/lat -> metros (x al este desde el borde oeste, s al sur desde el borde norte)
const aMetros = (lon, lat) => [
  ((lon - info.oeste) / (info.este - info.oeste)) * info.ancho_m,
  ((info.norte - lat) / (info.norte - info.sur)) * info.alto_m,
];
const celdaDe = (x, s) => {
  const c = Math.floor(x / cuad.celda_x), f = Math.floor(s / cuad.celda_y);
  return c < 0 || f < 0 || c >= cuad.ancho || f >= cuad.alto ? -1 : f * cuad.ancho + c;
};
const centro = (i) => [((i % cuad.ancho) + 0.5) * cuad.celda_x, (Math.floor(i / cuad.ancho) + 0.5) * cuad.celda_y];

// recorrido del rover en orden de sol, solo los pedazos dentro de la zona
const feats = leer("M20_traverse.json").features.slice().sort((a, b) => (a.properties.sol || 0) - (b.properties.sol || 0));
const corridas = []; let actual = [];
for (const f of feats) {
  const lineas = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const l of lineas) for (const p of l) {
    const [x, s] = aMetros(p[0], p[1]);
    if (celdaDe(x, s) >= 0) actual.push([x, s]);
    else if (actual.length) { corridas.push(actual); actual = []; }
  }
}
if (actual.length) corridas.push(actual);

// cortar en tramos de TRAMO_M metros de recorrido
const tramos = [];
for (const c of corridas) {
  let ini = 0, largo = 0;
  for (let k = 1; k < c.length; k++) {
    largo += Math.hypot(c[k][0] - c[k - 1][0], c[k][1] - c[k - 1][1]);
    if (largo >= TRAMO_M) { tramos.push({ pts: c.slice(ini, k + 1), largo }); ini = k; largo = 0; }
  }
}

// distancia de un punto a una polilinea
function distPoli(p, pts) {
  let m = Infinity;
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1], [bx, by] = pts[k], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
    m = Math.min(m, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
  }
  return m;
}

const resultados = [];
let celdasRover = 0, celdasRoverLibres = 0;
for (const tr of tramos) {
  // que tanto del camino real del rover consideramos caminable
  for (const p of tr.pts) { const i = celdaDe(p[0], p[1]); if (i >= 0) { celdasRover++; if (!ctx.bloqueada(cuad, i, params)) celdasRoverLibres++; } }
  const a = celdaDe(...tr.pts[0]), b = celdaDe(...tr.pts[tr.pts.length - 1]);
  const recta = Math.hypot(tr.pts[0][0] - tr.pts.at(-1)[0], tr.pts[0][1] - tr.pts.at(-1)[1]);
  if (a === b || recta < 200) continue;
  const camino = ctx.buscarRuta(cuad, a, b, params);
  if (!camino) { resultados.push({ ok: false, largo_rover: tr.largo }); continue; }
  const m = ctx.medirTramo(cuad, camino, params);
  const desv = camino.map((i) => distPoli(centro(i), tr.pts));
  resultados.push({
    ok: true,
    largo_rover_m: Math.round(tr.largo),
    largo_ruta_m: Math.round(m.distancia * 1000),
    recta_m: Math.round(recta),
    desviacion_media_m: Math.round(desv.reduce((x, y) => x + y, 0) / desv.length),
    dentro_50m_pct: Math.round((100 * desv.filter((d) => d <= 50).length) / desv.length),
    pendiente_max: m.pendienteMax,
  });
}

const ok = resultados.filter((r) => r.ok);
const prom = (k) => ok.reduce((s, r) => s + r[k], 0) / ok.length;
const resumen = {
  tramos: resultados.length,
  tramos_con_ruta: ok.length,
  largo_tramo_m: TRAMO_M,
  rover_caminable_pct: Math.round((100 * celdasRoverLibres) / Math.max(celdasRover, 1) * 10) / 10,
  ruta_vs_rover_largo_pct: Math.round((100 * ok.reduce((s, r) => s + r.largo_ruta_m, 0)) / ok.reduce((s, r) => s + r.largo_rover_m, 0)),
  desviacion_media_m: Math.round(prom("desviacion_media_m")),
  dentro_50m_pct: Math.round(prom("dentro_50m_pct")),
};
fs.writeFileSync(path.join(carpeta, "validacion_ruta.json"), JSON.stringify({ resumen, tramos: resultados }, null, 1));
console.log(JSON.stringify(resumen, null, 1));
