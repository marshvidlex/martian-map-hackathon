// idioma.js
// Todos los textos de la app en ingles (en) y espanol (es).
// En el HTML: data-i18n="clave" cambia el contenido del elemento.
// En el JS: t("clave", { variable: valor }) regresa el texto con {variable} reemplazado.
// El idioma elegido se guarda en el navegador para la siguiente vez.

const TEXTOS = {
  en: {
    // --- barra superior ---
    sub: "MARSWALK PLANNER", modo_plan: "Plan", modo_3d: "3D table", modo_visor: "Visor", sitio: "SITE",
    sin_mision_chip: "NO MISSION",
    // --- capas ---
    base: "BASE MAP", capa_foto: "CTX orbital photo", capa_elev: "Elevation",
    seguridad: "SAFETY LAYERS", capa_pend: "Slope", rojo_bloq: "red = blocked", capa_rug: "HiRISE roughness",
    capa_regreso: "Walk-back zone", capa_tormenta: "Solar storm scenario",
    ciencia: "SCIENCE LAYERS", capa_geologia: "Geologic units (USGS SIM 3464)", capa_rover: "Perseverance real traverse (NASA/JPL)",
    fuentes: "Data: USGS / NASA · CTX, HiRISE, SIM 3464, M20 traverse",
    rango: "({min} to {max})",
    // --- mapa ---
    sig_accion: "NEXT ACTION", btn_deshacer: "Undo last stop", btn_borrar: "Clear mission",
    mueve: "Move over the map", fuera_mapa: "Outside the map", pendiente_corta: "slope",
    observado: "Observed by",
    // --- panel ---
    estado_mision: "MISSION STATUS", sin_mision: "No mission yet",
    paso1: "Tap the map to place the <b>habitat</b>.", paso2: "Tap again to add <b>stops</b>.", paso3: "Review the result and <b>approve</b>.",
    distancia: "DISTANCE", tiempo_total: "TOTAL TIME", oxigeno: "OXYGEN", radiacion: "RADIATION",
    pend_max: "MAX SLOPE", subida: "TOTAL CLIMB", linea_tiempo: "TIMELINE", perfil: "ELEVATION PROFILE",
    aprobar: "APPROVE MISSION &amp; SUIT UP", ver3d: "Review in 3D table",
    params: "Mission parameters (demo values)",
    p_pend: "Max slope (degrees)", p_rug: "Max roughness (m)", p_vel: "Speed on flat ground (km/h)", p_carga: "Extra load (kg)",
    p_oxi: "Suit oxygen (hours)", p_trabajo: "Work time per stop (hours)", p_reserva: "Safety reserve (%)",
    p_rad: "Normal radiation (mSv per day)", p_tormenta: "Solar storm multiplier", p_dosis: "Dose limit per EVA (mSv)",
    nota_demo: "Demo values, not official NASA data.",
    // --- mensajes del mapa ---
    i_habitat: "Tap the map to place the <b>habitat</b>.",
    i_fuera: "That point is outside the map. Tap inside the terrain.",
    i_bloqueado: "That point is blocked ({motivo}). Pick another one.",
    sin_datos: "no data", grados: "{n} degrees",
    i_primera: "Now tap the <b>first stop</b>.",
    i_otra: "Tap again to add another stop, or remove the last one.",
    i_error: "{error} Remove the last stop or pick another point.",
    i_regreso: "Green = you can walk back from there in {t} or less.",
    i_sin_plan: "First plan a mission: place the <b>habitat</b> and at least one stop.",
    i_nogo: "Cannot approve: the mission is NO-GO. Check the reason in the result and adjust the stops.",
    error_ruta: "No safe route for leg {n}.",
    error_carga: "Error loading data. Open the page through a local server (python -m http.server).",
    // --- resultado ---
    habitat: "Habitat", parada_n: "Stop {n}",
    paradas_resumen: "{n} STOPS · ROUND TRIP", parada_resumen: "1 STOP · ROUND TRIP",
    m_oxigeno: "Not enough oxygen: the walk needs {necesita} and there are {hay} without using the reserve.",
    m_ninguna: "Not even the first stop is reachable. Pick a closer target.",
    m_una: "With this oxygen only stop 1 can be visited before returning.",
    m_varias: "With this oxygen, stops 1 to {n} can be visited before returning.",
    m_dosis: "The dose ({dosis} mSv) is over the {limite} mSv limit.",
    m_tormenta: " There is a solar storm: stay in the habitat.",
    m_margen: "Safe margin: {pct}% of the oxygen is used and the reserve is untouched.",
    l_inicio: "Habitat · EVA start", l_regreso: "Return to habitat", l_camina: "walk", l_trabajo: "work",
    // --- Mesa 3D ---
    capa_drape: "DRAPE LAYER", ir_a: "GO TO", relieve: "RELIEF", tip3d: "Tap a marker to fly to it. Double-click the ground to zoom in.",
    c_foto: "Photo", c_elev: "Elevation", c_pend: "Slope", c_rug: "Roughness", c_geo: "Geology",
    todo_sitio: "Whole site", f_latlon: "Lat / Lon", f_elev: "Elevation", f_llegada: "Arrival", f_pend: "Slope here",
    f_ant: "Previous", f_sig: "Next stop",
    leyenda: "LEGEND", ley_ida: "Outbound route", ley_reg: "Return route", ley_rover: "Perseverance real traverse",
    ley_geo: "Geology: USGS SIM 3464 (Sun &amp; Stack, 2020)",
    volver_plan: "&larr; Back to plan", recorrer: "Fly the route", detener: "Stop", aprobar_corto: "APPROVE &amp; SUIT UP",
    rover_3d: "Perseverance traverse",
    rp_boton: "Replay Perseverance mission", a_error_visor: "The visor could not open. Check the browser console.",
    rv_sol: "SOL", rv_recorrido_c: "DRIVEN", rv_fecha: "EARTH DATE", rv_falta: "TO GO", rv_recorrido: "Driven",
    rv_aterrizaje: "Octavia E. Butler landing", rv_destino: "Map edge · sol {sol}",
    rv_inicio: "Perseverance replay: real NASA/JPL traverse from Mastcam-Z height",
    rv_salir: "Exit replay", rv_fin: "Replay complete",
    rv_sale: "At sol {sol} Perseverance leaves this map toward the delta and crater rim. The full mission reaches sol {total} and {km} km.",
    a_sin_plan: "First plan a mission on the 2D map (habitat and at least one stop).",
    // --- casco ---
    o2_traje: "SUIT O₂", met: "MET", recorrido: "WALKED", dosis: "DOSE", regreso_en: "BACK IN",
    h_o2: "O₂", h_dist: "DIST", h_tiempo: "TIME", h_terreno: "TERRAIN", h_dosis: "DOSE", h_parada: "STOP", h_mapa: "MAP",
    pausa: "Pause", seguir: "Resume", frente: "Look ahead", giro: "Gyroscope", abortar: "Abort · back to the ship",
    fin: "Walk complete", volver_nave: "Back to the ship",
    quedan: "{t} left",
    c_oxigeno: "Oxygen", c_caminado: "Walked", c_falta: "To go", c_tiempo: "Time", c_regreso: "Back in",
    c_altitud: "Altitude", c_pendiente: "Slope", c_velocidad: "Speed", c_dosis: "Dose", c_limite: "limit",
    subiendo: "uphill", bajando: "downhill", plano: "flat", c_siguiente: "Next",
    a_reserva: "OXYGEN ON RESERVE: return to the habitat",
    a_trabajando: "Working at {lugar} · {t} left",
    a_pendiente: "Steep slope in {d} m ({g}°)", a_rugoso: "Rough terrain in {d} m",
    a_sin_giro: "This device has no gyroscope", a_giro: "Gyroscope on: move the tablet to look around",
    a_aprobada: "Mission approved. Leaving the habitat...",
    a_sin_hirise: "Mission approved (no HiRISE: CTX terrain)",
    a_sin_foto: "Mission approved (no HiRISE photo: CTX photo)",
    r_distancia: "Distance", r_tiempo: "Total time", r_oxigeno: "Oxygen used", r_dosis: "Dose", r_paradas: "Stops",
    cardinales: "N,NE,E,SE,S,SW,W,NW",
  },

  es: {
    sub: "PLANEADOR DE MARSWALK", modo_plan: "Planear", modo_3d: "Mesa 3D", modo_visor: "Visor", sitio: "SITIO",
    sin_mision_chip: "SIN MISIÓN",
    base: "MAPA BASE", capa_foto: "Foto orbital CTX", capa_elev: "Elevación",
    seguridad: "CAPAS DE SEGURIDAD", capa_pend: "Pendiente", rojo_bloq: "rojo = bloqueado", capa_rug: "Rugosidad HiRISE",
    capa_regreso: "Zona de regreso a pie", capa_tormenta: "Escenario de tormenta solar",
    ciencia: "CAPAS CIENTÍFICAS", capa_geologia: "Unidades geológicas (USGS SIM 3464)", capa_rover: "Recorrido real de Perseverance (NASA/JPL)",
    fuentes: "Datos: USGS / NASA · CTX, HiRISE, SIM 3464, recorrido M20",
    rango: "({min} a {max})",
    sig_accion: "SIGUIENTE PASO", btn_deshacer: "Quitar última parada", btn_borrar: "Borrar misión",
    mueve: "Pasa el cursor sobre el mapa", fuera_mapa: "Fuera del mapa", pendiente_corta: "pendiente",
    observado: "Observado por",
    estado_mision: "ESTADO DE LA MISIÓN", sin_mision: "Todavía no hay misión",
    paso1: "Toca el mapa para poner el <b>hábitat</b>.", paso2: "Toca otra vez para agregar <b>paradas</b>.", paso3: "Revisa el resultado y <b>aprueba</b>.",
    distancia: "DISTANCIA", tiempo_total: "TIEMPO TOTAL", oxigeno: "OXÍGENO", radiacion: "RADIACIÓN",
    pend_max: "PENDIENTE MÁX.", subida: "SUBIDA TOTAL", linea_tiempo: "LÍNEA DE TIEMPO", perfil: "PERFIL DE ELEVACIÓN",
    aprobar: "APROBAR MISIÓN Y EQUIPARSE", ver3d: "Revisar en la Mesa 3D",
    params: "Parámetros de la misión (valores de demo)",
    p_pend: "Pendiente máxima (grados)", p_rug: "Rugosidad máxima (m)", p_vel: "Velocidad en plano (km/h)", p_carga: "Carga extra (kg)",
    p_oxi: "Oxígeno del traje (horas)", p_trabajo: "Trabajo por parada (horas)", p_reserva: "Reserva de seguridad (%)",
    p_rad: "Radiación normal (mSv por día)", p_tormenta: "Multiplicador en tormenta", p_dosis: "Límite de dosis por salida (mSv)",
    nota_demo: "Valores de prueba, no son datos oficiales de la NASA.",
    i_habitat: "Toca el mapa para poner el <b>hábitat</b>.",
    i_fuera: "Ese punto está fuera del mapa. Toca dentro del terreno.",
    i_bloqueado: "Ese punto está bloqueado ({motivo}). Elige otro.",
    sin_datos: "sin datos", grados: "{n} grados",
    i_primera: "Ahora toca la <b>primera parada</b>.",
    i_otra: "Toca otra vez para agregar otra parada, o quita la última.",
    i_error: "{error} Quita la última parada o elige otro punto.",
    i_regreso: "Verde = desde ahí se regresa a pie en {t} o menos.",
    i_sin_plan: "Primero arma una misión: pon el <b>hábitat</b> y al menos una parada.",
    i_nogo: "No se puede aprobar: la misión es NO-GO. Revisa el motivo en el resultado y ajusta las paradas.",
    error_ruta: "No hay ruta segura en el tramo {n}.",
    error_carga: "Error cargando datos. Abre la página con el servidor local (python -m http.server).",
    habitat: "Hábitat", parada_n: "Parada {n}",
    paradas_resumen: "{n} PARADAS · IDA Y VUELTA", parada_resumen: "1 PARADA · IDA Y VUELTA",
    m_oxigeno: "No alcanza el oxígeno: la caminata necesita {necesita} y hay {hay} sin tocar la reserva.",
    m_ninguna: "Ni la primera parada alcanza. Elige un destino más cercano.",
    m_una: "Con este oxígeno solo se puede hacer la parada 1 y regresar.",
    m_varias: "Con este oxígeno se pueden hacer las paradas 1 a {n} y regresar.",
    m_dosis: "La dosis ({dosis} mSv) pasa el límite de {limite} mSv.",
    m_tormenta: " Hay tormenta solar: mejor quedarse en el hábitat.",
    m_margen: "Queda margen: se usa {pct}% del oxígeno y la reserva queda intacta.",
    l_inicio: "Hábitat · inicio de la salida", l_regreso: "Regreso al hábitat", l_camina: "caminando", l_trabajo: "de trabajo",
    capa_drape: "CAPA SOBRE EL TERRENO", ir_a: "IR A", relieve: "RELIEVE", tip3d: "Toca un marcador para ir ahí. Doble clic en el terreno para acercarte.",
    c_foto: "Foto", c_elev: "Elevación", c_pend: "Pendiente", c_rug: "Rugosidad", c_geo: "Geología",
    todo_sitio: "Toda la zona", f_latlon: "Lat / Lon", f_elev: "Elevación", f_llegada: "Llegada", f_pend: "Pendiente aquí",
    f_ant: "Anterior", f_sig: "Siguiente",
    leyenda: "LEYENDA", ley_ida: "Ruta de ida", ley_reg: "Ruta de regreso", ley_rover: "Recorrido real de Perseverance",
    ley_geo: "Geología: USGS SIM 3464 (Sun y Stack, 2020)",
    volver_plan: "&larr; Volver al plan", recorrer: "Recorrer la ruta", detener: "Detener", aprobar_corto: "APROBAR Y EQUIPARSE",
    rover_3d: "Recorrido de Perseverance",
    rp_boton: "Repetir misión de Perseverance", a_error_visor: "No se pudo abrir el visor. Revisa la consola del navegador.",
    rv_sol: "SOL", rv_recorrido_c: "RECORRIDO", rv_fecha: "FECHA EN LA TIERRA", rv_falta: "FALTA", rv_recorrido: "Recorrido",
    rv_aterrizaje: "Aterrizaje Octavia E. Butler", rv_destino: "Orilla del mapa · sol {sol}",
    rv_inicio: "Repetición de Perseverance: recorrido real de NASA/JPL desde la altura de Mastcam-Z",
    rv_salir: "Salir de la repetición", rv_fin: "Repetición terminada",
    rv_sale: "En el sol {sol} Perseverance sale de este mapa hacia el delta y el borde del cráter. La misión completa llega al sol {total} y {km} km.",
    a_sin_plan: "Primero arma una misión en el mapa 2D (hábitat y al menos una parada).",
    o2_traje: "O₂ DEL TRAJE", met: "MET", recorrido: "RECORRIDO", dosis: "DOSIS", regreso_en: "REGRESO EN",
    h_o2: "O₂", h_dist: "DIST", h_tiempo: "TIEMPO", h_terreno: "TERRENO", h_dosis: "DOSIS", h_parada: "PARADA", h_mapa: "MAPA",
    pausa: "Pausa", seguir: "Seguir", frente: "Mirar al frente", giro: "Giroscopio", abortar: "Abortar · volver a la nave",
    fin: "Caminata terminada", volver_nave: "Volver a la nave",
    quedan: "quedan {t}",
    c_oxigeno: "Oxígeno", c_caminado: "Recorrido", c_falta: "Falta", c_tiempo: "Tiempo", c_regreso: "Regreso en",
    c_altitud: "Altitud", c_pendiente: "Pendiente", c_velocidad: "Velocidad", c_dosis: "Dosis", c_limite: "límite",
    subiendo: "subida", bajando: "bajada", plano: "plano", c_siguiente: "Siguiente",
    a_reserva: "OXÍGENO EN RESERVA: regresa al hábitat",
    a_trabajando: "Trabajando en {lugar} · quedan {t}",
    a_pendiente: "Pendiente fuerte en {d} m ({g}°)", a_rugoso: "Terreno rugoso en {d} m",
    a_sin_giro: "Este equipo no tiene giroscopio", a_giro: "Giroscopio activo: mueve la tablet para voltear",
    a_aprobada: "Misión aprobada. Saliendo del hábitat...",
    a_sin_hirise: "Misión aprobada (sin HiRISE: terreno CTX)",
    a_sin_foto: "Misión aprobada (sin foto HiRISE: foto CTX)",
    r_distancia: "Distancia", r_tiempo: "Tiempo total", r_oxigeno: "Oxígeno usado", r_dosis: "Dosis", r_paradas: "Paradas",
    cardinales: "N,NE,E,SE,S,SO,O,NO",
  },
};

let IDIOMA = (() => {
  try { return localStorage.getItem("mm-idioma") || "en"; } catch { return "en"; }
})();
if (!TEXTOS[IDIOMA]) IDIOMA = "en";

// Texto en el idioma actual, con {variables} reemplazadas
function t(clave, v = {}) {
  const s = TEXTOS[IDIOMA][clave] ?? TEXTOS.en[clave] ?? clave;
  return s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? v[k] : ""));
}

// Cambia todos los textos fijos del HTML (los que tienen data-i18n)
function aplicarIdioma() {
  document.documentElement.lang = IDIOMA;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.innerHTML = t(el.dataset.i18n); });
  document.querySelectorAll("[data-idioma]").forEach((b) => {
    const activo = b.dataset.idioma === IDIOMA;
    b.classList.toggle("activo", activo);
    b.setAttribute("aria-pressed", activo ? "true" : "false");
  });
}

// Cambia de idioma, lo guarda y avisa a app.js, vista3d.js y casco.js
function cambiarIdioma(nuevo) {
  if (!TEXTOS[nuevo] || nuevo === IDIOMA) return;
  IDIOMA = nuevo;
  try { localStorage.setItem("mm-idioma", nuevo); } catch { /* sin almacenamiento: solo dura esta vez */ }
  aplicarIdioma();
  window.dispatchEvent(new Event("idioma"));
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-idioma]").forEach((b) => b.addEventListener("click", () => cambiarIdioma(b.dataset.idioma)));
  aplicarIdioma();
});
