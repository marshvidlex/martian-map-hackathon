// ruta.js
// Algoritmo A* sobre la cuadricula de pendientes.
// El costo de cada paso es el TIEMPO (horas) que tarda el astronauta en recorrerlo.

// Cola de prioridad sencilla (min-heap): siempre saca el nodo con menor f
class ColaPrioridad {
  constructor() { this.datos = []; }
  get tamano() { return this.datos.length; }

  meter(nodo, prioridad) {
    this.datos.push({ nodo, prioridad });
    let i = this.datos.length - 1;
    while (i > 0) {
      const padre = Math.floor((i - 1) / 2);
      if (this.datos[padre].prioridad <= this.datos[i].prioridad) break;
      [this.datos[padre], this.datos[i]] = [this.datos[i], this.datos[padre]];
      i = padre;
    }
  }

  sacar() {
    const primero = this.datos[0];
    const ultimo = this.datos.pop();
    if (this.datos.length > 0) {
      this.datos[0] = ultimo;
      let i = 0;
      while (true) {
        const izq = 2 * i + 1, der = 2 * i + 2;
        let menor = i;
        if (izq < this.datos.length && this.datos[izq].prioridad < this.datos[menor].prioridad) menor = izq;
        if (der < this.datos.length && this.datos[der].prioridad < this.datos[menor].prioridad) menor = der;
        if (menor === i) break;
        [this.datos[menor], this.datos[i]] = [this.datos[i], this.datos[menor]];
        i = menor;
      }
    }
    return primero.nodo;
  }
}

// ---------- Modelo de caminata ----------

// Cuanto baja la velocidad por la carga (demo: cada 10 kg quita 5%, minimo 30%)
function factorCarga(params) {
  return Math.max(0.3, 1 - 0.005 * params.carga);
}

// Funcion de Tobler: la velocidad depende de la pendiente CON signo.
// s = desnivel / distancia (positivo = subida). La mas rapida es una bajada suave (-5%).
// La ajustamos para que en plano de exactamente params.velocidad.
function velocidad(s, params) {
  const v = params.velocidad * Math.exp(-3.5 * Math.abs(s + 0.05)) / Math.exp(-3.5 * 0.05);
  return Math.max(v * factorCarga(params), 0.1);
}

// Velocidad maxima posible (bajada suave). Sirve para que la heuristica de A* nunca sobreestime
function velocidadMaxima(params) {
  return params.velocidad * Math.exp(3.5 * 0.05) * factorCarga(params);
}

function bloqueada(cuad, i, params) {
  const p = cuad.pendiente[i];
  if (p < 0 || p / 10 > params.pendienteMax) return true;
  if (cuad.rugosidad && cuad.rugosidad[i] / 100 > params.rugosidadMax) return true;
  return false;
}

// Tiempo (horas) para caminar de la celda a a su vecina b
function costoPaso(cuad, a, b, params) {
  const { ancho, celda_x, celda_y, elevacion } = cuad;
  const dc = (b % ancho) - (a % ancho);
  const df = Math.floor(b / ancho) - Math.floor(a / ancho);
  const d = Math.hypot(dc * celda_x, df * celda_y); // metros
  const s = (elevacion[b] - elevacion[a]) / d;
  let t = d / 1000 / velocidad(s, params);
  if (cuad.rugosidad) {
    // terreno aspero = mas lento (sin dato HiRISE cuenta como liso)
    const r = (Math.max(cuad.rugosidad[a], 0) + Math.max(cuad.rugosidad[b], 0)) / 200;
    t *= 1 + r / params.rugosidadMax;
  }
  return t;
}

const VECINOS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

// Busqueda general.
//  - con destino: A* y se detiene al llegar
//  - sin destino (destino = -1): Dijkstra a todo el mapa hasta "limite" horas
//  - inverso = true: calcula el tiempo para ir DE cada celda HACIA el origen
function explorar(cuad, origen, params, { destino = -1, inverso = false, limite = Infinity } = {}) {
  const { ancho, alto, celda_x, celda_y } = cuad;
  const total = ancho * alto;
  const g = new Float64Array(total).fill(Infinity);
  const vieneDe = new Int32Array(total).fill(-1);
  const cerrada = new Uint8Array(total);

  const vmax = velocidadMaxima(params);
  const filaFin = Math.floor(destino / ancho), colFin = destino % ancho;
  const h = (i) => {
    if (destino < 0) return 0;
    const dx = ((i % ancho) - colFin) * celda_x;
    const dy = (Math.floor(i / ancho) - filaFin) * celda_y;
    return Math.hypot(dx, dy) / 1000 / vmax;
  };

  const abierta = new ColaPrioridad();
  g[origen] = 0;
  abierta.meter(origen, h(origen));

  while (abierta.tamano > 0) {
    const actual = abierta.sacar();
    if (cerrada[actual]) continue;
    if (actual === destino) break;
    cerrada[actual] = 1;

    const fila = Math.floor(actual / ancho), col = actual % ancho;
    for (const [df, dc] of VECINOS) {
      const f2 = fila + df, c2 = col + dc;
      if (f2 < 0 || f2 >= alto || c2 < 0 || c2 >= ancho) continue;
      const vecino = f2 * ancho + c2;
      if (cerrada[vecino] || bloqueada(cuad, vecino, params)) continue;

      const t = inverso ? costoPaso(cuad, vecino, actual, params) : costoPaso(cuad, actual, vecino, params);
      const nuevoG = g[actual] + t;
      if (nuevoG < g[vecino] && nuevoG <= limite) {
        g[vecino] = nuevoG;
        vieneDe[vecino] = actual;
        abierta.meter(vecino, nuevoG + h(vecino));
      }
    }
  }
  return { g, vieneDe };
}

// Lista de celdas desde inicio hasta fin, o null si no hay camino
function buscarRuta(cuad, inicio, fin, params) {
  if (bloqueada(cuad, inicio, params) || bloqueada(cuad, fin, params)) return null;
  if (inicio === fin) return [inicio];
  const { vieneDe } = explorar(cuad, inicio, params, { destino: fin });
  if (vieneDe[fin] === -1) return null;
  const camino = [fin];
  while (camino[camino.length - 1] !== inicio) camino.push(vieneDe[camino[camino.length - 1]]);
  return camino.reverse();
}

// Distancia, tiempo, pendiente maxima, subida y perfil de un tramo
function medirTramo(cuad, camino, params) {
  const { ancho, celda_x, celda_y, pendiente, elevacion } = cuad;
  let distancia = 0, tiempo = 0, pendienteMax = 0, subida = 0;
  const perfil = [{ d: 0, z: elevacion[camino[0]] }];

  for (let k = 1; k < camino.length; k++) {
    const a = camino[k - 1], b = camino[k];
    const dc = (b % ancho) - (a % ancho);
    const df = Math.floor(b / ancho) - Math.floor(a / ancho);
    distancia += Math.hypot(dc * celda_x, df * celda_y) / 1000;
    tiempo += costoPaso(cuad, a, b, params);
    pendienteMax = Math.max(pendienteMax, pendiente[b] / 10);
    if (elevacion[b] > elevacion[a]) subida += elevacion[b] - elevacion[a];
    perfil.push({ d: distancia, z: elevacion[b] });
  }
  return { camino, distancia, tiempo, pendienteMax, subida, perfil };
}

// Mision completa: paradas[0] es el habitat; al final se regresa al habitat
function planearMision(cuad, paradas, params) {
  const puntos = [...paradas, paradas[0]];
  const tramos = [];
  for (let k = 0; k < puntos.length - 1; k++) {
    const camino = buscarRuta(cuad, puntos[k], puntos[k + 1], params);
    if (!camino) return { error: typeof t === "function" ? t("error_ruta", { n: k + 1 }) : `No safe route for leg ${k + 1}.` };
    tramos.push(medirTramo(cuad, camino, params));
  }

  const numParadas = paradas.length - 1;
  const caminando = tramos.reduce((s, t) => s + t.tiempo, 0);
  const total = caminando + numParadas * params.trabajo;
  const disponible = params.oxigeno * (1 - params.reserva / 100);
  const tasa = params.radiacion * (params.tormenta ? params.multTormenta : 1); // mSv por dia
  const dosis = (total / 24) * tasa;

  const okOxigeno = total <= disponible;
  const okDosis = dosis <= params.limiteDosis;

  // Si no alcanza el oxigeno: cuantas paradas si se pueden hacer y regresar
  let alcanzables = numParadas;
  if (!okOxigeno) {
    alcanzables = 0;
    let acumulado = 0;
    for (let k = 1; k <= numParadas; k++) {
      acumulado += tramos[k - 1].tiempo + params.trabajo;
      const regreso = buscarRuta(cuad, paradas[k], paradas[0], params);
      if (!regreso) break;
      if (acumulado + medirTramo(cuad, regreso, params).tiempo <= disponible) alcanzables = k;
      else break;
    }
  }

  return {
    tramos,
    total,
    caminando,
    disponible,
    distancia: tramos.reduce((s, t) => s + t.distancia, 0),
    pendienteMax: Math.max(...tramos.map((t) => t.pendienteMax)),
    subida: tramos.reduce((s, t) => s + t.subida, 0),
    oxigenoPct: (total / params.oxigeno) * 100,
    dosis,
    okOxigeno,
    okDosis,
    go: okOxigeno && okDosis,
    alcanzables,
  };
}

// Celdas desde donde se puede regresar CAMINANDO al habitat en "horas" o menos
// (para cuando hay rover: si se descompone ahi, la tripulacion aun puede volver)
function zonaRegresoAPie(cuad, habitat, params, horas) {
  const { g } = explorar(cuad, habitat, params, { inverso: true, limite: horas });
  const zona = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) if (g[i] <= horas) zona[i] = 1;
  return zona;
}
