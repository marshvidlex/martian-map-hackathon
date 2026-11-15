// bitacora.js
// Bitacora de recorridos: guarda cada recorrido que se hace en el visor en primera persona (casco.js),
// tanto la caminata del astronauta ("eva") como la repeticion de Perseverance ("rover").
// Guarda tiempo, distancia y datos extra (subida, pendiente, geologia, avisos, oxigeno...).
//
// - Se guarda solo en el navegador (IndexedDB), asi funciona sin internet.
// - Lo que se quiera compartir se exporta a JSON (Bitacora.descargar()) y se agrega al repo con
//   scripts/bitacora.py -> docs/data/zonas/<zona>/bitacora.json. Al abrir la zona se cargan esos.
// - No tiene interfaz: solo el objeto global Bitacora y el evento "bitacora" en window.
//   La guia para quien haga la interfaz esta en BITACORA.md.
//
// Usa globales de app.js: info, cuad, mapaACelda, mapaALonlat. casco.js llama a Bitacora.grabar().

(function () {
  const NOMBRE_BD = "martian-map-bitacora";
  const VERSION_BD = 1;
  const CADA_METROS = 20;     // una muestra cada 20 m recorridos
  const CADA_MS = 1500;       // cada 1.5 s se escribe lo nuevo
  const FORMATO = "martian-map-bitacora";
  const EDITABLES = ["nombre", "notas", "etiquetas", "extra"]; // lo unico que anotar() deja cambiar

  // ================= Almacen (IndexedDB o memoria) =================
  // Tres almacenes: recorridos (resumen), muestras y eventos (clave [id del recorrido, n]).
  let bd = null;
  const memoria = { recorridos: new Map(), muestras: new Map(), eventos: new Map() };
  const rango = (id) => IDBKeyRange.bound([id, -Infinity], [id, Infinity]);

  const abierta = new Promise((ok) => {
    try {
      const pedido = indexedDB.open(NOMBRE_BD, VERSION_BD);
      pedido.onupgradeneeded = () => {
        const b = pedido.result;
        if (!b.objectStoreNames.contains("recorridos")) b.createObjectStore("recorridos", { keyPath: "id" });
        if (!b.objectStoreNames.contains("muestras")) b.createObjectStore("muestras", { keyPath: ["rec", "n"] });
        if (!b.objectStoreNames.contains("eventos")) b.createObjectStore("eventos", { keyPath: ["rec", "n"] });
      };
      pedido.onsuccess = () => { bd = pedido.result; ok(); };
      pedido.onerror = pedido.onblocked = () => { console.warn("Bitacora: sin IndexedDB, se guarda en memoria"); ok(); };
    } catch (e) {
      console.warn("Bitacora: sin IndexedDB, se guarda en memoria", e);
      ok();
    }
  });

  const terminada = (tx) => new Promise((ok, mal) => {
    tx.oncomplete = () => ok();
    tx.onerror = tx.onabort = () => mal(tx.error);
  });
  const resultado = (pedido) => new Promise((ok, mal) => {
    pedido.onsuccess = () => ok(pedido.result);
    pedido.onerror = () => mal(pedido.error);
  });

  // Guarda el recorrido y agrega filas nuevas (todo en una transaccion)
  async function guardar(rec, muestras = [], eventos = []) {
    await abierta;
    if (!bd) {
      memoria.recorridos.set(rec.id, copia(rec));
      if (!memoria.muestras.has(rec.id)) memoria.muestras.set(rec.id, []);
      if (!memoria.eventos.has(rec.id)) memoria.eventos.set(rec.id, []);
      memoria.muestras.get(rec.id).push(...muestras.map(copia));
      memoria.eventos.get(rec.id).push(...eventos.map(copia));
      return;
    }
    const tx = bd.transaction(["recorridos", "muestras", "eventos"], "readwrite");
    tx.objectStore("recorridos").put(rec);
    for (const m of muestras) tx.objectStore("muestras").put({ ...m, rec: rec.id });
    for (const e of eventos) tx.objectStore("eventos").put({ ...e, rec: rec.id });
    await terminada(tx);
  }

  async function todosLocales() {
    await abierta;
    if (!bd) return [...memoria.recorridos.values()].map(copia);
    return resultado(bd.transaction("recorridos").objectStore("recorridos").getAll());
  }

  // El recorrido y sus filas, leidos en la misma transaccion para que coincidan
  async function leerLocal(id, conFilas = true) {
    await abierta;
    if (!bd) {
      const r = memoria.recorridos.get(id);
      if (!r) return null;
      return conFilas ? { ...copia(r), muestras: copia(memoria.muestras.get(id) || []), eventos: copia(memoria.eventos.get(id) || []) } : copia(r);
    }
    const tx = bd.transaction(["recorridos", "muestras", "eventos"]);
    const [r, m, e] = await Promise.all([
      resultado(tx.objectStore("recorridos").get(id)),
      conFilas ? resultado(tx.objectStore("muestras").getAll(rango(id))) : [],
      conFilas ? resultado(tx.objectStore("eventos").getAll(rango(id))) : [],
    ]);
    if (!r) return null;
    if (!conFilas) return r;
    const limpiar = (f) => { const { rec, ...resto } = f; return resto; };
    return { ...r, muestras: m.map(limpiar), eventos: e.map(limpiar) };
  }

  async function borrarLocal(id) {
    await abierta;
    if (!bd) {
      const habia = memoria.recorridos.delete(id);
      memoria.muestras.delete(id); memoria.eventos.delete(id);
      return habia;
    }
    const habia = await leerLocal(id, false);
    const tx = bd.transaction(["recorridos", "muestras", "eventos"], "readwrite");
    tx.objectStore("recorridos").delete(id);
    tx.objectStore("muestras").delete(rango(id));
    tx.objectStore("eventos").delete(rango(id));
    await terminada(tx);
    return !!habia;
  }

  async function vaciarLocal() {
    await abierta;
    if (!bd) { memoria.recorridos.clear(); memoria.muestras.clear(); memoria.eventos.clear(); return; }
    const tx = bd.transaction(["recorridos", "muestras", "eventos"], "readwrite");
    ["recorridos", "muestras", "eventos"].forEach((n) => tx.objectStore(n).clear());
    await terminada(tx);
  }

  // ================= Utilidades =================
  const copia = (o) => JSON.parse(JSON.stringify(o));
  const redondear = (v, dec) => (v === null || v === undefined || !isFinite(v) ? null : Number(v.toFixed(dec)));
  const avisar = (accion, id) => window.dispatchEvent(new CustomEvent("bitacora", { detail: { accion, id } }));

  function zonaActual() {
    const m = /zonas\/([^/]+)\//.exec(window.DATOS || "");
    return m ? m[1] : "default";
  }

  function nuevoId(fecha) {
    const p = (n) => String(n).padStart(2, "0");
    const f = `${fecha.getUTCFullYear()}${p(fecha.getUTCMonth() + 1)}${p(fecha.getUTCDate())}`;
    const h = `${p(fecha.getUTCHours())}${p(fecha.getUTCMinutes())}${p(fecha.getUTCSeconds())}`;
    return `r-${f}-${h}-${Math.random().toString(36).slice(2, 6).padEnd(4, "0")}`;
  }

  // Punto del visor (x al este, s al sur, en m) con su lon/lat
  function punto(x, s) {
    const [lon, lat] = mapaALonlat({ lat: info.alto_m - s, lng: x });
    return { x: redondear(x, 1), s: redondear(s, 1), lon: redondear(lon, 6), lat: redondear(lat, 6) };
  }

  // Datos del terreno en un punto: elevacion, pendiente, rugosidad, unidad geologica
  function terreno(x, s) {
    const celda = mapaACelda({ lat: info.alto_m - s, lng: x });
    if (celda === null) return { elev: null, pend: null, rug: null, unidad: null };
    const z = cuad.elevacion[celda], p = cuad.pendiente[celda];
    const r = cuad.rugosidad ? cuad.rugosidad[celda] : -1;
    return {
      elev: z > -99999 ? z : null,
      pend: p >= 0 ? p / 10 : null,
      rug: r >= 0 ? r / 100 : null,
      unidad: unidadGeologica(x, s),
    };
  }

  // Mapa geologico (geologia.png + info.geologia): se lee una sola vez al abrir la zona
  let geo = null;
  async function prepararGeologia() {
    geo = null;
    if (!info || !info.geologia) return;
    try {
      const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = DATOS + "geologia.png"; });
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const colores = info.geologia.map((u) => [1, 3, 5].map((k) => parseInt(u.color.slice(k, k + 2), 16)));
      geo = { datos: ctx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height, colores };
    } catch { geo = null; }
  }
  function unidadGeologica(x, s) {
    if (!geo) return null;
    const px = Math.floor((x / info.ancho_m) * geo.w), py = Math.floor((s / info.alto_m) * geo.h);
    if (px < 0 || py < 0 || px >= geo.w || py >= geo.h) return null;
    const i = (py * geo.w + px) * 4, d = geo.datos;
    if (d[i + 3] < 10) return null;
    let mejor = -1, dist = Infinity;
    geo.colores.forEach(([r, g, b], k) => {
      const dd = (d[i] - r) ** 2 + (d[i + 1] - g) ** 2 + (d[i + 2] - b) ** 2;
      if (dd < dist) { dist = dd; mejor = k; }
    });
    const u = info.geologia[mejor];
    return u ? (u.simbolo || u.nombre) : null;
  }

  // ================= Grabadora =================
  // casco.js: grabadora = Bitacora.grabar(ruta, params, mision); luego grabadora.paso(sim, p) en cada
  // cuadro y grabadora.terminar("completado" | "abortado") al acabar o salir.
  let activa = null;

  function grabar(ruta, params, mision = null) {
    if (activa) activa.terminar("abortado");
    const ahora = new Date();
    const tipo = ruta.rover ? "rover" : "eva";
    const n = ruta.x.length;
    const rec = {
      id: nuevoId(ahora),
      zona: zonaActual(),
      tipo,
      estado: "en_curso",
      origen: "local",
      en_repo: false,
      inicio: ahora.toISOString(),
      fin: null,
      duracion_real_s: 0,
      tiempo_h: 0,
      distancia_m: 0,
      avance_pct: 0,
      tiempo_caminando_h: 0,
      tiempo_trabajo_h: 0,
      velocidad_media_kmh: null,
      plan: {
        distancia_m: redondear(ruta.largo, 1),
        tiempo_h: redondear(ruta.total, 4),
        paradas: tipo === "eva" ? ruta.destinos.length - 1 : 0,
        ...(mision ? {
          go: mision.go,
          oxigeno_pct: redondear(mision.oxigenoPct, 2),
          dosis_mSv: redondear(mision.dosis, 4),
          subida_m: redondear(mision.subida, 1),
          pendiente_max_deg: redondear(mision.pendienteMax, 1),
        } : {}),
      },
      elev_min_m: null, elev_max_m: null, subida_m: 0, bajada_m: 0, pendiente_max_deg: 0,
      geologia: {},
      avisos: { pendiente: 0, rugosidad: 0, crater: 0 },
      punto_inicio: punto(ruta.x[0], ruta.s[0]),
      punto_fin: null,
      paradas: tipo === "eva" ? ruta.destinos.slice(0, -1).map((p, k) => ({ n: k + 1, nombre: ruta.nombres[k + 1], ...punto(p.x, p.s) })) : [],
      paradas_visitadas: 0,
      crateres: [],
      params: copia(params || {}),
      nombre: "", notas: "", etiquetas: [], extra: {},
    };
    if (tipo === "eva") { rec.oxigeno_usado_pct = 0; rec.dosis_mSv = 0; }
    else { rec.sol_inicio = ruta.sol[0]; rec.sol_fin = ruta.sol[0]; }

    const tasa = params ? params.radiacion * (params.tormenta ? params.multTormenta : 1) : 0; // mSv por dia
    const g = {
      rec, ruta, params, tasa,
      kv: 0,               // siguiente punto de la ruta por revisar
      proxD: 0,            // distancia de la siguiente muestra
      nM: 0, nE: 0,
      pendM: [], pendE: [],
      t: 0, d: 0, ultimaMuestraD: -1, pausa: false, empezo: false, terminado: false,
      enAviso: { pendiente: false, rugosidad: false }, crater: null,
      escribiendo: null, ultimaEscritura: 0, t0: performance.now(),
    };

    const evento = (tipoE, t, d, datos = {}) => {
      g.pendE.push({ n: g.nE++, tipo: tipoE, t_h: redondear(t, 5), d_m: redondear(d, 1), hora: new Date().toISOString(), ...datos });
    };

    // Recorre los puntos de la ruta que ya pasaron: subida, pendiente, geologia y paradas
    function avanzarPuntos(hastaT) {
      while (g.kv < n && ruta.t[g.kv] <= hastaT + 1e-9) {
        const k = g.kv++;
        const ter = terreno(ruta.x[k], ruta.s[k]);
        if (ter.elev !== null) {
          rec.elev_min_m = rec.elev_min_m === null ? ter.elev : Math.min(rec.elev_min_m, ter.elev);
          rec.elev_max_m = rec.elev_max_m === null ? ter.elev : Math.max(rec.elev_max_m, ter.elev);
        }
        if (k > 0) {
          const dd = ruta.d[k] - ruta.d[k - 1];
          if (dd > 0) {
            const antes = terreno(ruta.x[k - 1], ruta.s[k - 1]).elev;
            if (antes !== null && ter.elev !== null) {
              if (ter.elev > antes) rec.subida_m += ter.elev - antes; else rec.bajada_m += antes - ter.elev;
            }
            if (ter.pend !== null) rec.pendiente_max_deg = Math.max(rec.pendiente_max_deg, ter.pend);
            const u = unidadGeologica((ruta.x[k] + ruta.x[k - 1]) / 2, (ruta.s[k] + ruta.s[k - 1]) / 2) || "sin_dato";
            rec.geologia[u] = (rec.geologia[u] || 0) + dd;
          }
        }
        // paradas: el punto k+1 repite al k con el tiempo de trabajo
        if (k + 1 < n && ruta.parada[k + 1] >= 0) {
          const q = ruta.parada[k + 1];
          rec.paradas_visitadas = Math.max(rec.paradas_visitadas, q);
          evento("llegada", ruta.t[k], ruta.d[k], { parada: q, nombre: ruta.nombres[q] || null });
        }
        if (ruta.parada[k] >= 0) {
          evento("salida_parada", ruta.t[k], ruta.d[k], { parada: ruta.parada[k], nombre: ruta.nombres[ruta.parada[k]] || null });
        }
      }
    }

    // Muestra en la distancia D (interpolada en la ruta, asi no depende de la velocidad del visor)
    function muestra(D) {
      let lo = 0, hi = n - 1;               // primer punto con d >= D
      while (lo < hi) { const m = (lo + hi) >> 1; if (ruta.d[m] >= D) hi = m; else lo = m + 1; }
      const i = lo;
      let x, s, t, vel = 0, k = i;
      if (i === 0 || ruta.d[i] <= ruta.d[i - 1]) { x = ruta.x[i]; s = ruta.s[i]; t = ruta.t[i]; }
      else {
        k = i - 1;
        const f = (D - ruta.d[k]) / (ruta.d[i] - ruta.d[k]);
        x = ruta.x[k] + (ruta.x[i] - ruta.x[k]) * f;
        s = ruta.s[k] + (ruta.s[i] - ruta.s[k]) * f;
        t = ruta.t[k] + (ruta.t[i] - ruta.t[k]) * f;
        vel = (ruta.d[i] - ruta.d[k]) / 1000 / ((ruta.t[i] - ruta.t[k]) || 1e-9);
      }
      const ter = terreno(x, s);
      const fila = {
        n: g.nM++, t_h: redondear(t, 5), d_m: redondear(D, 1), ...punto(x, s),
        elev_m: redondear(ter.elev, 1), pend_deg: redondear(ter.pend, 1), rug_m: redondear(ter.rug, 2),
        vel_kmh: redondear(vel, 3), unidad: ter.unidad,
      };
      if (tipo === "eva") {
        fila.o2_pct = redondear(params ? (t / params.oxigeno) * 100 : null, 2);
        fila.dosis_mSv = redondear((t / 24) * g.tasa, 5);
      } else fila.sol = ruta.sol[k];
      g.pendM.push(fila);
      g.ultimaMuestraD = D;

      // Avisos del terreno: se anotan cuando empiezan (no cada muestra)
      if (params) {
        const enPend = ter.pend !== null && ter.pend > params.pendienteMax * 0.7;
        const enRug = ter.rug !== null && ter.rug > params.rugosidadMax * 0.6;
        if (enPend && !g.enAviso.pendiente) { rec.avisos.pendiente++; evento("aviso", t, D, { aviso: "pendiente", valor: redondear(ter.pend, 1) }); }
        if (enRug && !g.enAviso.rugosidad) { rec.avisos.rugosidad++; evento("aviso", t, D, { aviso: "rugosidad", valor: redondear(ter.rug, 2) }); }
        g.enAviso = { pendiente: enPend, rugosidad: enRug };
      }
      const c = window.craterEn ? window.craterEn(x, s) : null;
      if (c && c !== g.crater && c.d >= 4) {
        rec.avisos.crater++;
        rec.crateres.push({ id: c.id ?? null, diametro_m: redondear(c.d, 1), ...punto(c.x, c.s), d_m: redondear(D, 1) });
        evento("aviso", t, D, { aviso: "crater", valor: redondear(c.d, 1), crater: c.id ?? null });
      }
      g.crater = c;
    }

    function avanzarMuestras(hastaD, incluirFinal) {
      while (g.proxD <= hastaD + 1e-6) { muestra(g.proxD); g.proxD += CADA_METROS; }
      if (incluirFinal && hastaD - g.ultimaMuestraD > 0.05) muestra(hastaD);
    }

    // Totales que dependen del tiempo actual
    function actualizarTotales() {
      const t = g.t;
      let trabajo = 0;
      for (let k = 1; k < n && ruta.t[k - 1] < t; k++) {
        if (ruta.d[k] === ruta.d[k - 1] && ruta.parada[k] >= 0) trabajo += Math.min(ruta.t[k], t) - ruta.t[k - 1];
      }
      rec.tiempo_h = redondear(t, 5);
      rec.distancia_m = redondear(g.d, 1);
      rec.avance_pct = redondear(ruta.largo ? (g.d / ruta.largo) * 100 : 0, 1);
      rec.tiempo_trabajo_h = redondear(trabajo, 5);
      rec.tiempo_caminando_h = redondear(t - trabajo, 5);
      rec.velocidad_media_kmh = t - trabajo > 0 ? redondear(g.d / 1000 / (t - trabajo), 3) : null;
      rec.duracion_real_s = redondear((performance.now() - g.t0) / 1000, 1);
      const p = muestraEn(g.d);
      rec.punto_fin = punto(p.x, p.s);
      if (tipo === "eva") {
        rec.oxigeno_usado_pct = redondear(params ? (t / params.oxigeno) * 100 : 0, 2);
        rec.dosis_mSv = redondear((t / 24) * g.tasa, 5);
      } else {
        rec.sol_fin = ruta.sol[Math.min(g.kv, n) - 1] ?? ruta.sol[0];
      }
      rec.subida_m = redondear(rec.subida_m, 1);
      rec.bajada_m = redondear(rec.bajada_m, 1);
      rec.elev_min_m = redondear(rec.elev_min_m, 1);
      rec.elev_max_m = redondear(rec.elev_max_m, 1);
      rec.pendiente_max_deg = redondear(rec.pendiente_max_deg, 1);
      for (const u of Object.keys(rec.geologia)) rec.geologia[u] = redondear(rec.geologia[u], 1);
    }
    function muestraEn(D) {
      let k = 0;
      while (k < n - 2 && ruta.d[k + 1] < D) k++;
      const span = ruta.d[k + 1] - ruta.d[k];
      const f = span > 0 ? Math.min(Math.max((D - ruta.d[k]) / span, 0), 1) : 0;
      return { x: ruta.x[k] + (ruta.x[k + 1] - ruta.x[k]) * f, s: ruta.s[k] + (ruta.s[k + 1] - ruta.s[k]) * f };
    }

    // Escribe lo pendiente; nunca hay dos escrituras en camino al mismo tiempo
    function escribir() {
      if (g.escribiendo) return g.escribiendo;
      g.ultimaEscritura = performance.now();
      const m = g.pendM.splice(0), e = g.pendE.splice(0);
      g.escribiendo = guardar(copia(rec), m, e)
        .catch((err) => console.warn("Bitacora: no se pudo guardar", err))
        .finally(() => {
          g.escribiendo = null;
          if (g.pendM.length || g.pendE.length || g.sucio) { g.sucio = false; escribir(); }
        });
      return g.escribiendo;
    }

    const grabadora = {
      id: rec.id,
      paso(sim, p) {
        if (g.terminado || !sim || !p) return;
        if (!g.empezo) { g.empezo = true; evento("salida", 0, 0); }
        if (sim.pausa !== g.pausa && !(sim.pausa && sim.t >= ruta.total)) {
          evento(sim.pausa ? "pausa" : "reanuda", sim.t, p.d);
        }
        g.pausa = sim.pausa;
        g.t = Math.max(g.t, sim.t);
        g.d = Math.max(g.d, p.d);
        avanzarPuntos(g.t);
        avanzarMuestras(g.d, false);
        if (performance.now() - g.ultimaEscritura > CADA_MS) {
          actualizarTotales();
          if (g.escribiendo) g.sucio = true; else escribir();
          avisar("avance", rec.id);
        }
      },
      terminar(estado = "completado") {
        if (g.terminado) return g.escribiendo || Promise.resolve();
        g.terminado = true;
        if (!g.empezo) { g.empezo = true; evento("salida", 0, 0); }
        if (estado === "completado") { g.t = ruta.total; g.d = ruta.largo; }
        avanzarPuntos(g.t);
        avanzarMuestras(g.d, true);
        actualizarTotales();
        evento("fin", g.t, g.d, { estado });
        rec.estado = estado;
        rec.fin = new Date().toISOString();
        if (activa === grabadora) activa = null;
        const listo = (async () => {
          if (g.escribiendo) await g.escribiendo;
          await escribir();
          while (g.escribiendo) await g.escribiendo;
        })();
        listo.then(() => avisar("fin", rec.id));
        return listo;
      },
      guardarYa() { if (!g.terminado) { actualizarTotales(); escribir(); } },
      get recorrido() { return copia(rec); },
    };
    activa = grabadora;
    escribir().then(() => avisar("inicio", rec.id));
    return grabadora;
  }

  // Al cerrar la pagina se escribe lo ultimo; el recorrido queda "en_curso" y al volver pasa a "interrumpido"
  window.addEventListener("pagehide", () => { if (activa) activa.guardarYa(); });

  // ================= Recorridos del repositorio =================
  let repo = new Map(); // id -> recorrido completo (con muestras y eventos), origen "repo"

  async function preparar() {
    await Promise.all([prepararGeologia(), abierta]);
    // Lo que quedo a medias en otra visita
    for (const r of await todosLocales()) {
      if (r.estado === "en_curso" && (!activa || activa.id !== r.id)) {
        r.estado = "interrumpido";
        r.fin = r.fin || null;
        await guardar(r);
      }
    }
    // Recorridos compartidos en git (docs/data/zonas/<zona>/bitacora.json)
    repo = new Map();
    try {
      const resp = await fetch(DATOS + "bitacora.json", { cache: "no-cache" });
      if (resp.ok) {
        const datos = await resp.json();
        for (const r of datos.recorridos || []) {
          if (!r || !r.id) continue;
          repo.set(r.id, { ...r, origen: "repo", en_repo: true, muestras: r.muestras || [], eventos: r.eventos || [] });
        }
      }
    } catch (e) { console.warn("Bitacora: no se pudo leer bitacora.json", e); }
    // Marcar los locales que ya estan en el repo
    for (const r of await todosLocales()) {
      const esta = repo.has(r.id);
      if (r.en_repo !== esta) { r.en_repo = esta; await guardar(r); }
    }
    avisar("repo", null);
  }

  // ================= API de consulta =================
  const sinFilas = (r) => { const { muestras, eventos, ...resto } = r; return resto; };

  async function todos() {
    const locales = await todosLocales();
    const ids = new Set(locales.map((r) => r.id));
    return locales.concat([...repo.values()].filter((r) => !ids.has(r.id)).map((r) => copia(sinFilas(r))));
  }

  async function listar(filtro = {}) {
    const f = filtro || {};
    let lista = (await todos()).filter((r) =>
      (!f.zona || r.zona === f.zona) &&
      (!f.tipo || r.tipo === f.tipo) &&
      (!f.estado || r.estado === f.estado) &&
      (!f.origen || r.origen === f.origen) &&
      (!f.desde || r.inicio >= new Date(f.desde).toISOString()) &&
      (!f.hasta || r.inicio <= new Date(f.hasta).toISOString()));
    const campo = f.orden || "inicio";
    const dir = f.ascendente ? 1 : -1;
    lista.sort((a, b) => (a[campo] > b[campo] ? 1 : a[campo] < b[campo] ? -1 : 0) * dir);
    if (f.limite) lista = lista.slice(0, f.limite);
    return lista;
  }

  async function obtener(id) {
    const local = await leerLocal(id);
    if (local) return local;
    return repo.has(id) ? copia(repo.get(id)) : null;
  }

  async function resumen(filtro = {}) {
    const lista = await listar({ ...filtro, limite: 0 });
    const r = { recorridos: lista.length, distancia_km: 0, horas: 0, por_tipo: {}, por_estado: {}, mas_largo: null, ultimo: null };
    for (const x of lista) {
      r.distancia_km += (x.distancia_m || 0) / 1000;
      r.horas += x.tiempo_h || 0;
      r.por_tipo[x.tipo] = (r.por_tipo[x.tipo] || 0) + 1;
      r.por_estado[x.estado] = (r.por_estado[x.estado] || 0) + 1;
      if (!r.mas_largo || x.distancia_m > r.mas_largo.distancia_m) r.mas_largo = { id: x.id, distancia_m: x.distancia_m };
      if (!r.ultimo || x.inicio > r.ultimo.inicio) r.ultimo = { id: x.id, inicio: x.inicio };
    }
    r.distancia_km = redondear(r.distancia_km, 3);
    r.horas = redondear(r.horas, 3);
    return r;
  }

  async function anotar(id, cambios = {}) {
    const r = await leerLocal(id, false);
    if (!r) throw new Error(repo.has(id) ? "Bitacora: los recorridos del repo no se pueden anotar; importalos primero" : "Bitacora: no existe " + id);
    for (const k of Object.keys(cambios)) {
      if (!EDITABLES.includes(k)) throw new Error(`Bitacora: no se puede cambiar "${k}" (solo ${EDITABLES.join(", ")})`);
    }
    if (cambios.nombre !== undefined) r.nombre = String(cambios.nombre);
    if (cambios.notas !== undefined) r.notas = String(cambios.notas);
    if (cambios.etiquetas !== undefined) r.etiquetas = Array.isArray(cambios.etiquetas) ? cambios.etiquetas.map(String) : [String(cambios.etiquetas)];
    if (cambios.extra !== undefined) r.extra = { ...(r.extra || {}), ...copia(cambios.extra) };
    await guardar(r);
    avisar("cambio", id);
    return r;
  }

  async function borrar(id) {
    if (activa && activa.id === id) throw new Error("Bitacora: ese recorrido se esta grabando");
    const habia = await borrarLocal(id);
    if (habia) avisar("borrado", id);
    return habia;
  }

  async function vaciar() {
    const ids = (await todosLocales()).map((r) => r.id).filter((id) => !activa || activa.id !== id);
    for (const id of ids) await borrarLocal(id);
    avisar("borrado", null);
    return ids.length;
  }

  // ================= Exportar / importar =================
  // exportar(): los grabados en este navegador. exportar([ids]) o exportar({filtro}) para escoger.
  async function exportar(ids) {
    let lista;
    if (Array.isArray(ids)) lista = ids;
    else lista = (await listar(ids || {})).filter((r) => ids ? true : r.origen !== "repo").map((r) => r.id);
    const recorridos = [];
    for (const id of lista) {
      const r = await obtener(id);
      if (r) recorridos.push(r);
    }
    return { formato: FORMATO, version: 1, exportado: new Date().toISOString(), recorridos };
  }

  const COLUMNAS = ["id", "zona", "tipo", "estado", "origen", "inicio", "fin", "duracion_real_s", "tiempo_h", "distancia_m",
    "avance_pct", "tiempo_caminando_h", "tiempo_trabajo_h", "velocidad_media_kmh", "elev_min_m", "elev_max_m", "subida_m",
    "bajada_m", "pendiente_max_deg", "oxigeno_usado_pct", "dosis_mSv", "sol_inicio", "sol_fin", "paradas_visitadas",
    "avisos_pendiente", "avisos_rugosidad", "avisos_crater", "nombre", "notas", "etiquetas"];
  function aCSV(recorridos) {
    const celda = (v) => {
      if (v === null || v === undefined) return "";
      const s = Array.isArray(v) ? v.join(";") : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const filas = recorridos.map((r) => COLUMNAS.map((c) =>
      celda(c.startsWith("avisos_") ? (r.avisos || {})[c.slice(7)] : r[c])).join(","));
    return [COLUMNAS.join(",")].concat(filas).join("\n");
  }

  async function descargar(formato = "json", filtro) {
    const datos = await exportar(filtro);
    const fecha = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
    const zona = (filtro && filtro.zona) || zonaActual();
    const csv = formato === "csv";
    const texto = csv ? aCSV(datos.recorridos) : JSON.stringify(datos, null, 1);
    const blob = new Blob([texto], { type: csv ? "text/csv" : "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bitacora-${zona}-${fecha}.${csv ? "csv" : "json"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return datos.recorridos.length;
  }

  // Acepta el objeto de exportar(), el texto JSON o un File de <input type="file">
  async function importar(datos) {
    if (datos && typeof datos.text === "function" && !(datos.recorridos)) datos = await datos.text();
    if (typeof datos === "string") datos = JSON.parse(datos);
    const lista = Array.isArray(datos) ? datos : datos && datos.recorridos;
    if (!Array.isArray(lista)) throw new Error("Bitacora: el archivo no tiene recorridos");
    const res = { importados: 0, repetidos: 0, invalidos: 0 };
    for (const r of lista) {
      if (!r || typeof r.id !== "string" || !r.zona || !r.tipo) { res.invalidos++; continue; }
      if (await leerLocal(r.id, false)) { res.repetidos++; continue; }
      const { muestras = [], eventos = [], ...resto } = r;
      resto.origen = "importado";
      resto.en_repo = repo.has(r.id);
      if (resto.estado === "en_curso") resto.estado = "interrumpido";
      await guardar(resto, muestras, eventos);
      res.importados++;
    }
    avisar("importado", null);
    return res;
  }

  // Punto de la bitacora (muestra, punto_inicio, parada...) a [lat, lng] del mapa de Leaflet
  const aMapa = (p) => [info.alto_m - p.s, p.x];

  window.Bitacora = {
    listar, obtener, resumen, anotar, borrar, vaciar, exportar, importar, descargar, aMapa,
    muestras: async (id) => ((await obtener(id)) || {}).muestras || [],
    eventos: async (id) => ((await obtener(id)) || {}).eventos || [],
    get activo() { return activa ? activa.recorrido : null; },
    get persistente() { return !!bd; },
    cadaMetros: CADA_METROS,
    preparar,
    grabar,
    listo: abierta,
  };
})();
