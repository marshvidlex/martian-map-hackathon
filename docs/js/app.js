// app.js
// Mapa por capas, clics para inicio/destino y panel de la caminata.
// Coordenadas del mapa: metros desde la esquina inferior izquierda del recorte.
//   lat de Leaflet = metros hacia el norte, lng de Leaflet = metros hacia el este.

let info, cuad, mapa, pois = [];
let paradas = [];            // indices de celda; paradas[0] es el habitat
let marcadores = [];
let lineas = [];
let capaRegreso = null;
let ultimaMision = null;

async function cargarJSON(ruta) {
    const resp = await fetch(ruta);
    if (!resp.ok) throw new Error("No se pudo cargar " + ruta);
    return resp.json();
}

async function iniciar() {
    [info, cuad, pois] = await Promise.all([
        cargarJSON("data/info.json"),
        cargarJSON("data/cuadricula.json"),
        cargarJSON("data/poi.json"),
    ]);

    const limites = [[0, 0], [info.alto_m, info.ancho_m]];
    mapa = L.map("mapa", {
        crs: L.CRS.Simple, // mapa plano, sin proyeccion de la Tierra
        minZoom: -5,
        maxZoom: 2,
        zoomSnap: 0.25,
        attributionControl: false,
    });
    mapa.fitBounds(limites);

    // --- Capas fijas ---
    const capas = {
        foto: L.imageOverlay("data/foto.png", limites),
        elevacion: L.imageOverlay("data/elevacion.png", limites),
        pendiente: L.imageOverlay("data/pendiente.png", limites, { className: "pixelada" }),
    };
    if (info.tiene_rugosidad) {
        capas.rugosidad = L.imageOverlay("data/rugosidad.png", limites, { className: "pixelada" });
    } else {
        document.getElementById("bloque-rugosidad").classList.add("oculto");
    }

    // --- Capas extra (THEMIS, CRISM...): salen de info.json, no hay que tocar el HTML ---
    const contenedor = document.getElementById("capas-extra");
    for (const extra of info.capas_extra || []) {
        contenedor.insertAdjacentHTML("beforeend", `
      <div class="capa">
        <label><input type="checkbox" id="chk-${extra.nombre}"> ${extra.etiqueta}
          <span class="nota">(${extra.min} a ${extra.max})</span></label>
        <input type="range" id="op-${extra.nombre}" min="0" max="1" step="0.1" value="0.6">
      </div>`);
        capas[extra.nombre] = L.imageOverlay(`data/${extra.nombre}.png`, limites);
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

    // Los valores por defecto del panel salen de lo que se uso al procesar
    document.getElementById("p-pendiente").value = info.pendiente_max;
    if (info.rugosidad_max) document.getElementById("p-rugosidad").value = info.rugosidad_max;

    // --- Puntos de interes (con foto opcional) ---
    for (const p of pois) {
        const foto = p.foto ? `<br><img src="${p.foto}" width="200" alt="${p.nombre}">` : "";
        L.circleMarker(lonlatAMapa(p.lon, p.lat), { radius: 8, color: "#ffd23f", fillOpacity: 0.8 })
            .bindPopup(`<b>${p.nombre}</b><br>${p.que_estudiar}<br><i>Detectado por: ${p.instrumento}</i>${foto}`)
            .on("click", alTocarMapa) // tocar el punto tambien lo agrega a la mision
            .addTo(mapa);
    }

    // --- Eventos ---
    mapa.on("click", alTocarMapa);
    mapa.on("mousemove", (e) => {
        const [lon, lat] = mapaALonlat(e.latlng);
        document.getElementById("coordenadas").textContent =
            `Cursor: ${lat.toFixed(4)} N, ${lon.toFixed(4)} E`;
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
    if (k === 0) return "Habitat";
    const [y, x] = celdaAMapa(paradas[k]);
    for (const p of pois) {
        const [py, px] = lonlatAMapa(p.lon, p.lat);
        if (Math.hypot(px - x, py - y) < 150) return p.nombre;
    }
    return `Parada ${k}`;
}

// ---------- Interaccion ----------
function alTocarMapa(e) {
    const celda = mapaACelda(e.latlng);
    if (celda === null) {
        texto("Ese punto esta fuera de la zona del mapa. Toca dentro del terreno.");
        return;
    }

    const params = leerParametros();
    if (bloqueada(cuad, celda, params)) {
        const p = cuad.pendiente[celda];
        texto(`Ese punto esta bloqueado (${p < 0 ? "sin datos" : (p / 10).toFixed(0) + " grados"}). Toca otro.`);
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
        texto("Ahora toca la <b>primera parada</b>.");
        dibujarZonaRegreso();
    } else {
        texto("Toca otra parada para agregarla, o quita la ultima.");
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
        document.getElementById("resultado").classList.add("oculto");
        ultimaMision = null;
        actualizarHud();
        return;
    }

    const params = leerParametros();
    const t0 = performance.now();
    const m = planearMision(cuad, paradas, params);
    console.log(`Mision calculada en ${(performance.now() - t0).toFixed(0)} ms`);

    if (m.error) {
        texto(m.error + " Quita la ultima parada o elige otro punto.");
        document.getElementById("resultado").classList.add("oculto");
        ultimaMision = null;
        actualizarHud();
        return;
    }

    // ida en azul, regreso al habitat en morado punteado
    m.tramos.forEach((t, k) => {
        const regreso = k === m.tramos.length - 1;
        lineas.push(L.polyline(t.camino.map(celdaAMapa), {
            color: regreso ? "#b388ff" : "#00e5ff",
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

    const v = document.getElementById("veredicto");
    v.textContent = m.go ? "GO" : "NO-GO";
    v.className = m.go ? "go" : "nogo";

    const motivos = [];
    if (!m.okOxigeno) {
        motivos.push(`No alcanza el oxigeno: se necesitan ${horas(m.total)} y hay ${horas(m.disponible)} sin tocar la reserva.`);
        if (m.alcanzables === 0) motivos.push("Ni la primera parada alcanza. Elige un destino mas cercano.");
        else if (m.alcanzables === 1) motivos.push("Con este oxigeno solo se puede hacer la parada 1 y regresar.");
        else motivos.push(`Con este oxigeno se pueden hacer las paradas 1 a ${m.alcanzables} y regresar.`);
    }
    if (!m.okDosis) {
        motivos.push(`La dosis (${m.dosis.toFixed(2)} mSv) pasa el limite de ${params.limiteDosis} mSv.` +
            (params.tormenta ? " Hay tormenta solar: mejor quedarse en el habitat." : ""));
    }
    if (m.go) motivos.push(`Queda margen: se usa ${m.oxigenoPct.toFixed(0)}% del oxigeno y la reserva queda intacta.`);
    poner("motivo", motivos.join(" "));

    poner("r-distancia", `${m.distancia.toFixed(2)} km`);
    poner("r-total", horas(m.total));
    poner("r-pendiente", `${m.pendienteMax.toFixed(1)} grados`);
    poner("r-subida", `${Math.round(m.subida)} m`);
    poner("r-oxigeno", `${m.oxigenoPct.toFixed(0)} % del traje`);
    poner("r-radiacion", `${m.dosis.toFixed(3)} mSv`);

    const lista = document.getElementById("tramos");
    lista.innerHTML = "";
    m.tramos.forEach((t, k) => {
        const desde = nombreParada(k);
        const hasta = k === m.tramos.length - 1 ? "Habitat" : nombreParada(k + 1);
        lista.insertAdjacentHTML("beforeend",
            `<li>${desde} &rarr; ${hasta}: ${t.distancia.toFixed(2)} km, ${horas(t.tiempo)}</li>`);
    });
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

    ctx.strokeStyle = "#555";
    ctx.setLineDash([3, 3]);
    cortes.slice(0, -1).forEach((d) => { ctx.beginPath(); ctx.moveTo(X(d), 4); ctx.lineTo(X(d), H - 16); ctx.stroke(); });
    ctx.setLineDash([]);

    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    puntos.forEach((p, i) => (i ? ctx.lineTo(X(p.d), Y(p.z)) : ctx.moveTo(X(p.d), Y(p.z))));
    ctx.stroke();

    ctx.fillStyle = "#aaa";
    ctx.font = "10px sans-serif";
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
    texto(`Verde = desde ahi se regresa a pie en ${horas(horasRegreso)} o menos.`);
}

function actualizarHud() {
    const v = document.getElementById("hud-veredicto");
    const sig = document.getElementById("hud-siguiente");
    const datos = document.getElementById("hud-datos");
    if (!ultimaMision) {
        v.textContent = "--"; v.className = ""; sig.textContent = "Sin mision"; datos.textContent = "";
        return;
    }
    const m = ultimaMision, t = m.tramos[0];
    v.textContent = m.go ? "GO" : "NO-GO";
    v.className = m.go ? "go" : "nogo";
    sig.textContent = `Siguiente: ${nombreParada(1)}`;
    datos.textContent =
        `${t.distancia.toFixed(2)} km  |  ${horas(t.tiempo)}\n` +
        `Mision: ${horas(m.total)}  |  O2 ${m.oxigenoPct.toFixed(0)}%\n` +
        `Dosis ${m.dosis.toFixed(2)} mSv`;
}


// Solo se puede salir si la mision es GO: es la regla de seguridad antes de dejar la nave
function aprobarMision() {
    if (!ultimaMision) return;
    if (!ultimaMision.go) {
        texto("No se puede aprobar: la mision es NO-GO. Revisa el motivo en el resultado y ajusta las paradas.");
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
    document.getElementById("resultado").classList.add("oculto");
    actualizarHud();
    texto("Toca el mapa para poner el <b>habitat</b>.");
}


function texto(html) {
    document.getElementById("instruccion").innerHTML = html;
}

// Funcionar sin internet: registramos el service worker (solo jala en https o localhost)
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Sin modo offline:", err));
}

iniciar().catch((err) => {
    console.error(err);
    alert("Error cargando datos. Abre la pagina con el servidor local (python -m http.server).");
});