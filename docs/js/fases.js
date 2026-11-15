// fases.js
// Flujo de mision en 5 fases, como lo hace NASA: MARS -> LAND -> PLAN -> REVIEW -> EXECUTE.
// No crea pantallas nuevas: ordena las que ya existen y en cada fase muestra solo lo que sirve.
//   MARS     mapa global (marte.js)
//   LAND     solo la capa de aterrizaje seguro (aterrizaje.js); tocar el mapa pone/mueve el habitat
//   PLAN     planeador normal con las capas agrupadas (Safety abierta, Science y Base cerradas)
//   REVIEW   mesa 3D (vista3d.js) + lista de revision (checklist)
//   EXECUTE  visor del casco (casco.js)
// Si este archivo falta, la pagina funciona como antes (las pestanas viejas siguen en el HTML).
// Usa globales de app.js: paradas, ultimaMision, borrarMision, decir, info, cuad, mapa, LIMITE_PENDIENTE.

const FASES = ["mars", "land", "plan", "review", "execute"];
window.faseActual = document.body.classList.contains("modo-marte") ? "mars" : "land";

const $f = (id) => document.getElementById(id);

// ---------------------------------------------------------------- condiciones para avanzar
function faltaPara(fase) {
  if (fase === "land" || fase === "mars") return null;
  if (!paradas.length) return t("f_falta_habitat");
  if (fase === "plan") return null;
  if (!ultimaMision) return t("f_falta_parada");
  if (fase === "execute" && !ultimaMision.go) return t("f_falta_go");
  return null;
}

// ---------------------------------------------------------------- barra de fases
function htmlBarra() {
  const k = FASES.indexOf(faseActual);
  return FASES.map((f, i) => {
    const bloqueo = i > k ? faltaPara(f) : null;
    const estado = i === k ? "actual" : i < k ? "hecha" : bloqueo ? "bloqueada" : "pendiente";
    return `${i ? '<span class="fase-linea' + (i <= k ? " hecha" : "") + '" aria-hidden="true"></span>' : ""}
      <button class="fase ${estado}" data-fase="${f}" ${i === k ? 'aria-current="step"' : ""}
        ${bloqueo ? `aria-disabled="true" title="${bloqueo}"` : ""}>
        <span class="fase-num">${i < k ? "✓" : i + 1}</span>
        <span class="fase-txt"><b>${t("f_" + f)}</b><small>${t("f_" + f + "_sub")}</small></span>
      </button>`;
  }).join("");
}

let ultimaBarra = "";
function pintarBarras() {
  const html = htmlBarra();
  if (html === ultimaBarra) return;
  ultimaBarra = html;
  document.querySelectorAll("nav.fases").forEach((n) => (n.innerHTML = html));
}

function ponerBarras() {
  // una barra en cada encabezado: principal, pantalla de Marte y mesa 3D
  for (const sel of ["#barra", "#inicio .inicio-barra", "#vista3d header"]) {
    const h = document.querySelector(sel);
    if (!h || h.querySelector("nav.fases")) continue;
    const nav = document.createElement("nav");
    nav.className = "fases";
    nav.setAttribute("aria-label", "Mission phases");
    const ancla = h.querySelector(".modos") || h.querySelector(".marca-app");
    if (ancla) ancla.after(nav); else h.appendChild(nav);
  }
  document.body.classList.add("con-fases");
  document.addEventListener("click", (e) => {
    const b = e.target.closest("nav.fases .fase");
    if (!b) return;
    if (b.getAttribute("aria-disabled") === "true") { avisar(b.title); return; }
    irA(b.dataset.fase);
  });
}

function avisar(texto) {
  if (document.body.classList.contains("modo3d")) { const e = $f("estado3d"); if (e) e.textContent = texto; return; }
  const caja = $f("instruccion");
  if (caja) { caja.innerHTML = texto; caja.classList.remove("oculto"); }
}

// ---------------------------------------------------------------- cambiar de fase
function cerrarVistas() {
  if (document.body.classList.contains("modo-explorador")) $f("btn-exp-cerrar")?.click();
  if (document.body.classList.contains("modo3d")) $f("btn-cerrar3d")?.click();
  if (document.body.classList.contains("modo-casco3d")) $f("hc-salir")?.click();
  if (document.body.classList.contains("modo-marte") && window.cerrarMarte) cerrarMarte();
}

function irA(fase) {
  if (!FASES.includes(fase) || faltaPara(fase)) return;
  if (fase === "mars") {
    cerrarVistas();
    window.faseActual = "mars";
    $f("btn-marte")?.click();
  } else if (fase === "land" || fase === "plan") {
    cerrarVistas();
    window.faseActual = fase;
    prepararMapa(fase);
  } else if (fase === "review") {
    if (document.body.classList.contains("modo-casco3d")) $f("hc-salir")?.click();
    window.faseActual = "review";
    if (!document.body.classList.contains("modo3d")) $f("btn-3d")?.click();
    pintarChecklist();
  } else if (fase === "execute") {
    if (document.body.classList.contains("modo3d")) $f("btn-cerrar3d")?.click();
    window.faseActual = "execute";
    $f("btn-aprobar")?.click();
  }
  aplicarClases();
  pintarBarras();
}
window.irAFase = irA;

function aplicarClases() {
  FASES.forEach((f) => document.body.classList.toggle("fase-" + f, faseActual === f));
  pintarAccion();
}

// Capas y mensaje de cada fase del mapa
function prepararMapa(fase) {
  const marcar = (id, si) => {
    const c = $f(id);
    if (c && c.checked !== si) { c.checked = si; c.dispatchEvent(new Event("change")); }
  };
  if (fase === "land") {
    marcar("chk-aterrizaje", true);
    marcar("chk-crateres", false);
    if (!paradas.length) decir("f_msg_land");
  } else {
    marcar("chk-aterrizaje", false);
    marcar("chk-crateres", true);
    if (paradas.length === 1) decir("f_msg_plan");
  }
}

// ---------------------------------------------------------------- tarjeta de la fase (panel derecho)
function pintarAccion() {
  const caja = $f("fase-accion");
  if (!caja) return;
  const f = faseActual;
  if (f !== "land" && f !== "plan") { caja.innerHTML = ""; return; }
  let estado = "", boton = "", siguiente = f === "land" ? "plan" : "review";
  if (f === "land") {
    if (!paradas.length) estado = `<p class="fase-estado">${t("f_land_sin")}</p>`;
    else {
      const e = typeof ATZ !== "undefined" && ATZ.datos ? ATZ.datos.estado[paradas[0]] : 0;
      estado = `<p class="fase-estado ok">✓ ${t(e === 1 ? "f_land_prec" : "f_land_ok")}</p>`;
    }
  } else {
    estado = `<p class="fase-estado${ultimaMision ? " ok" : ""}">${ultimaMision ? "✓ " + t("f_plan_ok", { n: paradas.length - 1 }) : t("f_plan_sin")}</p>`;
    const rc = window.resumenCiencia && resumenCiencia();
    if (rc) estado += `<p class="fase-estado ciencia">★ ${t("ci_resumen", { l: rc.lugares, t: rc.total, o: rc.objetivos, to: rc.totalObjetivos })}</p>`;
  }
  const falta = faltaPara(siguiente);
  boton = `<button class="btn-principal" id="btn-fase-sig" ${falta ? "disabled" : ""}>${t("f_btn_" + siguiente)} →</button>`;
  caja.innerHTML = `<span class="etiqueta">${t("f_paso", { n: FASES.indexOf(f) + 1 })} · ${t("f_" + f)}</span>${estado}${boton}`;
  $f("btn-fase-sig").onclick = () => irA(siguiente);
}

// ---------------------------------------------------------------- checklist de la revision (fase REVIEW)
function pintarChecklist() {
  let caja = $f("checklist3d");
  if (!caja) {
    caja = document.createElement("section");
    caja.id = "checklist3d";
    $f("vista3d").appendChild(caja);
  }
  const m = ultimaMision;
  if (!m) { caja.innerHTML = ""; return; }
  const items = [];
  // 1) sitio de aterrizaje
  if (typeof ATZ !== "undefined" && ATZ.datos) {
    const e = ATZ.datos.estado[paradas[0]];
    items.push([e === 0 ? "ok" : e === 1 ? "prec" : "mal", t("f_ck_aterr"), t(e === 0 ? "f_land_ok" : "f_land_prec")]);
  }
  // 2) pendiente
  const lim = typeof LIMITE_PENDIENTE !== "undefined" ? LIMITE_PENDIENTE : 15;
  items.push([m.pendienteMax <= lim * 0.7 ? "ok" : m.pendienteMax <= lim ? "prec" : "mal",
    t("f_ck_pend", { n: lim }), t("f_ck_max", { n: m.pendienteMax.toFixed(1) })]);
  // 3) crateres sobre la ruta
  if (window.CRATER && CRATER.lista.length) {
    const en = CRATER.enRuta || [], dentro = en.filter((e) => e.dentro).length;
    items.push([!en.length ? "ok" : dentro ? "mal" : "prec", t("f_ck_crat"),
      !en.length ? t("f_ck_crat_no") : t("f_ck_crat_si", { n: en.length, d: dentro })]);
  }
  // ciencia: objetivos cubiertos por la ruta
  const rc = window.resumenCiencia && resumenCiencia();
  if (rc) items.push([rc.objetivos ? "ok" : "prec", t("ci_ck"),
    t("ci_resumen", { l: rc.lugares, t: rc.total, o: rc.objetivos, to: rc.totalObjetivos })]);
  // 4) oxigeno y 5) radiacion
  items.push([m.okOxigeno ? (m.oxigenoPct < 80 ? "ok" : "prec") : "mal", t("f_ck_o2"), `${m.oxigenoPct.toFixed(0)}%`]);
  items.push([m.okDosis ? "ok" : "mal", t("f_ck_dosis"), `${m.dosis.toFixed(2)} mSv`]);
  caja.innerHTML = `
    <h2>${t("f_ck_titulo")}</h2>
    <p class="ck-veredicto ${m.go ? "go" : "nogo"}">${m.go ? "GO" : "NO-GO"}</p>
    <ul>${items.map(([e, a, b]) => `<li class="${e}"><i></i><span><b>${a}</b><small>${b}</small></span></li>`).join("")}</ul>
    <button class="btn-principal" id="btn-ck-ejecutar" ${m.go ? "" : "disabled"}>${t("f_btn_execute")} →</button>`;
  $f("btn-ck-ejecutar").onclick = () => irA("execute");
}

// ---------------------------------------------------------------- panel de capas por grupos (fase PLAN)
function prepararRail() {
  const rail = $f("rail");
  if (!rail) return;
  // la seccion de aterrizaje va arriba de todo y solo se ve en LAND
  const ctrl = $f("aterrizaje-control");
  if (ctrl && !$f("seccion-aterrizaje")) {
    const s = document.createElement("section");
    s.id = "seccion-aterrizaje";
    s.innerHTML = `<h2>${t("f_land_capas")}</h2>`;
    s.appendChild(ctrl);
    rail.prepend(s);
  }
  // Base map y Science empiezan cerradas; se abren tocando el titulo
  const secciones = [...rail.querySelectorAll(":scope > section")];
  secciones.forEach((s, i) => {
    const h = s.querySelector("h2");
    if (!h || h.dataset.plegable) return;
    h.dataset.plegable = "1";
    h.setAttribute("role", "button");
    h.tabIndex = 0;
    const alternar = () => s.classList.toggle("plegada");
    h.addEventListener("click", alternar);
    h.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternar(); } });
    if (/^(base|ciencia)$/.test(h.dataset.i18n || "")) s.classList.add("plegada"); // capas: mapa base y cientificas
  });
}

// ---------------------------------------------------------------- sincronizar con lo que pase en la pagina
function sincronizar() {
  const b = document.body.classList;
  let f = faseActual;
  if (b.contains("modo-marte")) f = "mars";
  else if (b.contains("modo-casco3d")) f = "execute";
  else if (b.contains("modo3d")) f = "review";
  else if (["mars", "review", "execute"].includes(f)) {
    f = paradas.length ? "plan" : "land";
    window.faseActual = f;
    prepararMapa(f);
  }
  if (f === "plan" && !paradas.length) { f = "land"; window.faseActual = f; prepararMapa(f); }
  if (f !== faseActual) window.faseActual = f;
  aplicarClases();
  pintarBarras();
  if (f === "review") pintarChecklistSiCambio();
}
let firmaCk = "";
function pintarChecklistSiCambio() {
  const firma = ultimaMision ? `${paradas.length}|${ultimaMision.distancia}|${ultimaMision.go}|${(window.CRATER && CRATER.enRuta || []).length}|${IDIOMA}` : "";
  if (firma !== firmaCk) { firmaCk = firma; pintarChecklist(); }
}

// Al aterrizar el habitat en LAND: el mensaje invita a continuar (o a moverlo)
const habitatPuestoOriginal = window.aterrizajeHabitatPuesto;
window.aterrizajeHabitatPuesto = () => {
  if (habitatPuestoOriginal) habitatPuestoOriginal();
  if (faseActual === "land") setTimeout(() => decir("f_msg_land_ok"), 0);
};

// ---------------------------------------------------------------- arranque
function iniciarFases() {
  // el panel derecho del planeador lleva arriba la tarjeta de la fase
  const panel = $f("panel");
  if (panel && !$f("fase-accion")) {
    const c = document.createElement("section");
    c.id = "fase-accion";
    panel.prepend(c);
  }
  ponerBarras();
  prepararRail();
  if (faseActual === "land") prepararMapa("land");
  aplicarClases();
  pintarBarras();
  setInterval(sincronizar, 400);
}

window.addEventListener("idioma", () => {
  ultimaBarra = "";
  pintarBarras();
  pintarAccion();
  firmaCk = "";
  const s = document.querySelector("#seccion-aterrizaje h2");
  if (s) s.textContent = t("f_land_capas");
});

// Espera a que app.js termine de cargar la zona (cuadricula, crateres y aterrizaje listos)
(function esperar(n = 0) {
  const listo = typeof cuad !== "undefined" && cuad && document.querySelector("#rail");
  if (listo && ($f("aterrizaje-control") || n > 40)) return iniciarFases();
  setTimeout(() => esperar(n + 1), 200);
})();
