// replay.js
// Boton "Repetir mision de Perseverance": prepara la ruta real del rover (M20_traverse.json)
// y la recorre en la vista del casco (casco.js), igual que una mision aprobada.
// Usa las variables globales de app.js: info, leerParametros. app.js llama a iniciarReplay(geo).

const rover = {
  puntos: [],    // { x (m al este), s (m al sur desde el borde norte), sol, d (m acumulados) }
  solFinal: 0,   // ultimo sol del archivo (toda la mision)
  kmMision: 0,   // km de toda la mision (segun el archivo)
};

function iniciarReplay(geo) {
  // Aplanar el GeoJSON en una sola lista ordenada por sol, solo con lo que cae dentro de la zona
  const feats = (geo.features || []).filter((f) => f.geometry)
    .sort((a, b) => (a.properties.sol ?? 0) - (b.properties.sol ?? 0));
  let anterior = null, total = 0;
  for (const f of feats) {
    const sol = f.properties.sol ?? 0;
    rover.solFinal = Math.max(rover.solFinal, sol);
    rover.kmMision += (f.properties.length || 0) / 1000;
    const partes = f.geometry.type === "LineString" ? [f.geometry.coordinates]
      : f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [];
    for (const parte of partes) {
      for (const c of parte) {
        let [lon, lat] = c;
        if (lon > 180) lon -= 360;
        if (lat < info.sur || lat > info.norte || lon < info.oeste || lon > info.este) continue;
        const x = ((lon - info.oeste) / (info.este - info.oeste)) * info.ancho_m;
        const s = ((info.norte - lat) / (info.norte - info.sur)) * info.alto_m;
        if (anterior) {
          const paso = Math.hypot(x - anterior.x, s - anterior.s);
          if (paso < 1.5) continue; // puntos repetidos o casi iguales: no aportan nada
          total += paso;
        }
        anterior = { x, s, sol, d: total };
        rover.puntos.push(anterior);
      }
    }
  }
  if (rover.puntos.length < 2) return; // el rover no pasa por esta zona

  document.querySelector("#zona-mapa .abajo-izq").insertAdjacentHTML("afterbegin",
    `<button id="btn-replay" class="btn-sec btn-replay"><span aria-hidden="true">&#9654;</span> <span data-i18n="rp_boton">${t("rp_boton")}</span></button>`);
  document.getElementById("btn-replay").addEventListener("click", () => {
    if (window.abrirCascoRover) window.abrirCascoRover(rover, leerParametros());
  });
}
