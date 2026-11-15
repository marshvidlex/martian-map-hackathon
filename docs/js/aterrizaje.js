// aterrizaje.js
// Zonas seguras para ATERRIZAR (scripts/aterrizaje.py -> data/zonas/<zona>/aterrizaje.json y .png).
//  - Capa "Landing safety" en Capas de seguridad: verde = seguro, amarillo = precaucion, rojo = prohibido.
//  - El habitat (primer punto de la mision = donde aterriza la nave) ya no se puede poner en rojo:
//    se explica el motivo y se marca el punto seguro mas cercano para tocarlo.
//  - Boton "Suggest landing sites": los 3 mejores lugares de la zona.
// Usa globales de app.js: mapa, info, cuad, DATOS, paradas, alTocarMapa, borrarMision, decir, celdaAMapa.

const ATZ = { datos: null, capa: null, sugeridos: null, seguro: null };

async function iniciarAterrizaje() {
  try {
    const r = await fetch(DATOS + "aterrizaje.json");
    if (r.ok) ATZ.datos = await r.json();
  } catch { ATZ.datos = null; }
  if (!ATZ.datos || ATZ.datos.ancho !== cuad.ancho || ATZ.datos.alto !== cuad.alto) {
    ATZ.datos = null; // zona sin analisis (o de otra malla): todo funciona como antes
    return;
  }
  ATZ.capa = L.imageOverlay(DATOS + "aterrizaje.png", [[0, 0], [info.alto_m, info.ancho_m]],
    { className: "pixelada", opacity: 0.85 });

  // controles dentro de "Capas de seguridad", despues de "Solar storm scenario"
  const ancla = document.getElementById("chk-tormenta").closest("label");
  ancla.insertAdjacentHTML("afterend", `
    <div id="aterrizaje-control">
      <label class="opcion"><input type="checkbox" id="chk-aterrizaje">
        <span data-i18n="at_capa">${t("at_capa")}</span>
        <span class="dato" id="at-pct"></span></label>
      <ul class="at-leyenda">
        <li><i class="at-muestra seguro"></i><span data-i18n="at_ley_seguro">${t("at_ley_seguro")}</span></li>
        <li><i class="at-muestra precaucion"></i><span data-i18n="at_ley_prec">${t("at_ley_prec")}</span></li>
        <li><i class="at-muestra prohibido"></i><span data-i18n="at_ley_prohib">${t("at_ley_prohib")}</span></li>
      </ul>
      <button id="btn-sugerir-aterrizaje" class="btn-sec btn-ancho" data-i18n="at_sugerir">${t("at_sugerir")}</button>
    </div>`);
  pintarPorcentaje();
  const chk = document.getElementById("chk-aterrizaje");
  chk.addEventListener("change", () => mostrarCapaAterrizaje(chk.checked));
  document.getElementById("btn-sugerir-aterrizaje").addEventListener("click", sugerirAterrizaje);
  // mientras no hay habitat, la capa se ve: es lo primero que hay que decidir
  if (!paradas.length) mostrarCapaAterrizaje(true);
}
window.iniciarAterrizaje = iniciarAterrizaje;

function pintarPorcentaje() {
  const el = document.getElementById("at-pct");
  if (el && ATZ.datos) el.textContent = t("at_pct", { n: Math.round(ATZ.datos.porcentaje.seguro) });
}

function mostrarCapaAterrizaje(si) {
  if (!ATZ.capa) return;
  document.getElementById("chk-aterrizaje").checked = si;
  si ? ATZ.capa.addTo(mapa) : ATZ.capa.remove();
}

// Texto del motivo a partir de los bits
function motivosAterrizaje(bits) {
  const b = ATZ.datos.bits, salida = [];
  const pares = [["crater", "at_m_crater"], ["duna", "at_m_duna"], ["pend5", "at_m_pend5"],
    ["pend30", "at_m_pend30"], ["relieve", "at_m_relieve"], ["sin_datos", "at_m_sin_datos"],
    ["espacio", "at_m_espacio"], ["pend300", "at_m_pend300"], ["pend5_prec", "at_m_pend5_prec"],
    ["relieve_prec", "at_m_relieve_prec"], ["crater_chico", "at_m_crater_chico"]];
  for (const [k, clave] of pares) if (b[k] && (bits & b[k])) salida.push(t(clave));
  return salida.slice(0, 3).join(", ");
}

// La celda segura (verde) mas cercana, buscando en anillos alrededor
function seguroMasCercano(celda) {
  const W = cuad.ancho, H = cuad.alto, f0 = Math.floor(celda / W), c0 = celda % W;
  for (let r = 1; r < Math.max(W, H); r++) {
    let mejor = null, dmin = Infinity;
    for (let f = f0 - r; f <= f0 + r; f++) {
      for (let c = c0 - r; c <= c0 + r; c++) {
        if (Math.max(Math.abs(f - f0), Math.abs(c - c0)) !== r) continue;
        if (f < 0 || c < 0 || f >= H || c >= W) continue;
        if (ATZ.datos.estado[f * W + c] !== 0) continue;
        const d = Math.hypot((f - f0) * cuad.celda_y, (c - c0) * cuad.celda_x);
        if (d < dmin) { dmin = d; mejor = f * W + c; }
      }
    }
    if (mejor !== null) return { celda: mejor, dist: dmin };
  }
  return null;
}

function quitarSeguro() {
  if (ATZ.seguro) { ATZ.seguro.remove(); ATZ.seguro = null; }
}

// Se llama desde alTocarMapa ANTES de poner el habitat. Regresa false si no se puede aterrizar ahi.
window.revisarAterrizaje = (celda, forzar = false) => {
  if (!ATZ.datos || (paradas.length && !forzar)) return true;
  quitarSeguro();
  const estado = ATZ.datos.estado[celda], bits = ATZ.datos.motivo[celda];
  if (estado === 2) {
    mostrarCapaAterrizaje(true);
    const s = seguroMasCercano(celda);
    if (s) {
      ATZ.seguro = L.marker(celdaAMapa(s.celda), {
        icon: L.divIcon({ className: "marca sugerido pulso", html: "✓", iconSize: [26, 26] }),
      }).addTo(mapa).bindTooltip(t("at_aqui"), { permanent: true, direction: "top", offset: [0, -14] });
      ATZ.seguro.on("click", (ev) => { L.DomEvent.stop(ev); quitarSeguro(); alTocarMapa({ latlng: ev.latlng }); });
    }
    decir("at_no", { motivo: motivosAterrizaje(bits), dist: s ? Math.round(s.dist) : "--" });
    return false;
  }
  if (estado === 1) {
    // se permite, pero se avisa (despues de que app.js escriba su propio mensaje)
    setTimeout(() => decir("at_precaucion", { motivo: motivosAterrizaje(bits) }), 0);
  }
  return true;
};

// Al poner el habitat se quitan las marcas de sugerencia; al borrar la mision vuelven a servir
window.aterrizajeHabitatPuesto = () => {
  quitarSeguro();
  if (ATZ.sugeridos) { ATZ.sugeridos.remove(); ATZ.sugeridos = null; }
};

function sugerirAterrizaje() {
  if (!ATZ.datos) return;
  if (ATZ.sugeridos) ATZ.sugeridos.remove();
  quitarSeguro();
  mostrarCapaAterrizaje(true);
  const lista = ATZ.datos.sugeridos || [];
  ATZ.sugeridos = L.layerGroup(lista.map((g, i) => {
    const mk = L.marker([info.alto_m - g.s, g.x], {
      icon: L.divIcon({ className: "marca sugerido", html: `L${i + 1}`, iconSize: [30, 30] }),
    }).bindTooltip(t("at_sug_info", { n: i + 1, libre: g.libre_m, p: g.pend30, p5: g.pend5 }), { direction: "top" });
    mk.on("click", (ev) => {
      L.DomEvent.stop(ev);
      if (paradas.length) borrarMision(); // se empieza una mision nueva desde este sitio
      alTocarMapa({ latlng: L.latLng(info.alto_m - g.s, g.x) });
    });
    return mk;
  })).addTo(mapa);
  if (lista.length) {
    mapa.fitBounds(L.latLngBounds(lista.map((g) => [info.alto_m - g.s, g.x])).pad(0.4));
    decir("at_sug_msg", { n: lista.length });
  }
}

// Para el explorador de crateres: estado de aterrizaje en un punto (x al este, s al sur, en m)
window.estadoAterrizajeEn = (x, s) => {
  if (!ATZ.datos) return "--";
  const col = Math.floor(x / cuad.celda_x), fila = Math.floor(s / cuad.celda_y);
  if (col < 0 || fila < 0 || col >= cuad.ancho || fila >= cuad.alto) return "--";
  return [t("at_ley_seguro"), t("at_ley_prec"), t("at_ley_prohib")][ATZ.datos.estado[fila * cuad.ancho + col]];
};

window.addEventListener("idioma", () => {
  pintarPorcentaje();
  if (ATZ.sugeridos) ATZ.sugeridos.eachLayer((mk) => {
    const i = parseInt(mk.options.icon.options.html.slice(1), 10) - 1, g = ATZ.datos.sugeridos[i];
    mk.setTooltipContent(t("at_sug_info", { n: i + 1, libre: g.libre_m, p: g.pend30, p5: g.pend5 }));
  });
  if (ATZ.seguro) ATZ.seguro.setTooltipContent(t("at_aqui"));
});
