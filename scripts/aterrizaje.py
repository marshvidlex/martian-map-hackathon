"""
aterrizaje.py
Analisis de zonas seguras para ATERRIZAR (donde se puede poner la nave / el habitat).

Usa los mismos criterios de ingenieria que uso NASA/JPL para escoger el sitio de Curiosity
(MSL Landing Site Selection, User's Guide to Engineering Constraints, seccion 1.5 y 1.6):
  - pendiente <= 15 grados en una distancia de ~5 m       (que la nave no se vuelque)
  - pendiente <= 15 grados en una distancia de 20 a 40 m  (que el radar no se confunda al bajar)
  - pendiente <= 5 grados en una distancia de 200 a 500 m (maniobra final; aqui cuenta como PRECAUCION)
  - sin rocas de mas de ~0.6 m bajo la nave              (aqui: el relieve local del DEM, ver abajo)
y ademas, con los datos que ya tenemos de la zona:
  - fuera de crateres (con margen de seguridad alrededor del borde)   -> crateres.json (YOLO + validacion)
  - fuera de dunas (arena suelta)                                   -> unidad geologica Aeb (geologia.png)
  - espacio libre: alrededor del punto no puede haber nada prohibido en RADIO_LIBRE_M metros

Resultado por punto: 0 = seguro (verde), 1 = precaucion (amarillo), 2 = prohibido (rojo) y el motivo.

Uso (desde la carpeta del repo):
    python scripts/aterrizaje.py --zona jezero
Salida en docs/data/zonas/<zona>/:
    aterrizaje.png   capa de colores para el mapa (un pixel cada 10 m)
    aterrizaje.json  estado y motivo por celda (misma malla que cuadricula.json),
                     porcentaje seguro y los 3 mejores lugares sugeridos
Solo necesita numpy y pillow.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validar_crateres import cargar_dem  # noqa: E402  (arma el DEM HiRISE de 2 m de la zona)

RAIZ = Path(__file__).resolve().parent.parent

# ---- Criterios (MSL Engineering Constraints; valores de demostracion para una nave tripulada) ----
PEND_5M_MAX = 15.0       # grados, distancia ~5 m: estabilidad al tocar el suelo
PEND_5M_PRECAUCION = 10.0
PEND_30M_MAX = 15.0      # grados, distancia 20-40 m
PEND_300M_MAX = 5.0      # grados, distancia 200-500 m (si se pasa: precaucion, no prohibido)
RELIEVE_MAX_M = 1.0      # m: subida/bajada local en ~6 m despues de quitar la inclinacion
                         # (el DEM de 2 m no ve rocas de 0.6 m; esto marca bordos, escalones y rocas grandes)
RELIEVE_PRECAUCION_M = 0.6
MARGEN_CRATER = 1.3      # se prohibe hasta 1.3 radios del centro del crater (borde + eyecta cercana)
CRATER_D_MIN = 8.0       # m: crateres mas chicos no cuentan
CRATER_D_PROHIBIDO = 20.0  # m: de 8 a 20 m son PRECAUCION (la nave cabe, pero el suelo no es parejo)
CRATER_D_GRANDE = 200.0  # m: en crateres grandes solo se prohibe el anillo del borde; el fondo plano
                         # lo deciden las pendientes (Jezero mismo es un crater y Perseverance aterrizo dentro)
RADIO_LIBRE_M = 50.0     # m: la nave necesita este radio libre alrededor (pie de la nave + error de aterrizaje)
RES_M = 10.0             # m por pixel del resultado
SEPARACION_SUGERIDOS_M = 700.0

# bits del motivo
M_PEND5, M_PEND30, M_PEND300, M_RELIEVE, M_CRATER, M_DUNA, M_ESPACIO, M_PEND5_PREC, M_REL_PREC, M_SIN_DATOS, M_CRATER_CHICO = (
    1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024)
PROHIBIDO = M_PEND5 | M_PEND30 | M_RELIEVE | M_CRATER | M_DUNA | M_ESPACIO | M_SIN_DATOS
PRECAUCION = M_PEND300 | M_PEND5_PREC | M_REL_PREC | M_CRATER_CHICO


def promedio_caja(z, r):
    r = max(int(r), 0)
    p = np.pad(z, r + 1, mode="edge")
    s = p.cumsum(0).cumsum(1)
    lado = 2 * r + 1
    tot = s[lado:, lado:] - s[:-lado, lado:] - s[lado:, :-lado] + s[:-lado, :-lado]
    return tot[:z.shape[0], :z.shape[1]] / (lado * lado)


def reducir(z, k):
    f, c = z.shape[0] // k * k, z.shape[1] // k * k
    return z[:f, :c].reshape(f // k, k, c // k, k)


def pendiente_grados(z, paso_m):
    gy, gx = np.gradient(z, paso_m)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def a_malla(a, forma, modo="max"):
    """Lleva una matriz a otra malla (forma) tomando el peor valor de cada bloque o el vecino mas cercano."""
    f, c = forma
    yy = (np.arange(f) * a.shape[0] / f).astype(int)
    xx = (np.arange(c) * a.shape[1] / c).astype(int)
    if modo == "cerca":
        return a[yy][:, xx]
    # peor valor de cada bloque
    ky, kx = max(1, a.shape[0] // f), max(1, a.shape[1] // c)
    salida = np.full(forma, -np.inf if modo == "max" else 0, dtype="f4")
    for dy in range(ky):
        for dx in range(kx):
            v = a[np.clip(yy + dy, 0, a.shape[0] - 1)][:, np.clip(xx + dx, 0, a.shape[1] - 1)]
            salida = np.maximum(salida, v)
    return salida


def dilatar(mask, radio_px):
    """Agranda las zonas marcadas un circulo de radio_px (para el espacio libre)."""
    out = mask.copy()
    r = int(np.ceil(radio_px))
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dy * dy + dx * dx > radio_px * radio_px or (dy == 0 and dx == 0):
                continue
            p = np.pad(mask, r)
            out |= p[r + dy:r + dy + mask.shape[0], r + dx:r + dx + mask.shape[1]]
    return out


def distancia_a(mask, paso_m, max_m=400.0):
    """Distancia aproximada (m) de cada pixel al pixel marcado mas cercano (hasta max_m)."""
    dist = np.full(mask.shape, max_m, dtype="f4")
    actual = mask.copy()
    dist[actual] = 0
    r = 1
    while r * paso_m < max_m:
        nueva = dilatar(mask, r)
        dist[nueva & ~actual] = r * paso_m
        actual = nueva
        r += 1 if r < 6 else 2
    return dist


def mascara_dunas(carpeta, info, forma):
    arch = carpeta / "geologia.png"
    unidades = info.get("geologia") or []
    duna = next((u for u in unidades if u.get("simbolo") == "Aeb"), None)
    if not arch.exists() or not duna:
        return np.zeros(forma, dtype=bool)
    img = np.asarray(Image.open(arch).convert("RGBA")).astype("f4")
    col = np.array([int(duna["color"][i:i + 2], 16) for i in (1, 3, 5)], dtype="f4")
    cerca = (np.abs(img[..., :3] - col).sum(-1) < 40) & (img[..., 3] > 0)
    return a_malla(cerca.astype("f4"), forma, "cerca") > 0.5


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zona", default="jezero")
    args = ap.parse_args()
    carpeta = RAIZ / "docs" / "data" / "zonas" / args.zona
    info = json.loads((carpeta / "info.json").read_text())
    cuad = json.loads((carpeta / "cuadricula.json").read_text())

    z, paso, o = cargar_dem(carpeta)
    print(f"DEM: {z.shape[1]} x {z.shape[0]} puntos cada {paso} m")
    ancho_m, alto_m = info["ancho_m"], info["alto_m"]
    forma = (int(round(alto_m / RES_M)), int(round(ancho_m / RES_M)))

    # 1) pendiente a ~5 m: DEM de 2 m suavizado 3x3 (6 m)
    z6 = promedio_caja(z, 1)
    p5 = pendiente_grados(z6, paso)
    # 2) pendiente a ~30 m: bloques de 30 m
    k30 = max(1, int(round(30 / paso)))
    z30 = reducir(z, k30).mean(axis=(1, 3))
    p30 = pendiente_grados(z30, paso * k30)
    # 3) pendiente a ~300 m: bloques de 100 m y diferencia a +-150 m
    k100 = max(1, int(round(100 / paso)))
    z100 = reducir(z, k100).mean(axis=(1, 3))
    z100s = promedio_caja(z100, 1)
    p300 = pendiente_grados(z100s, paso * k100)
    # 4) relieve local en ~6 m sin la inclinacion general (bordos, escalones, rocas grandes)
    resto = z - promedio_caja(z, 3)                       # se quita la inclinacion (~14 m)
    bloques = reducir(resto, 3)                           # bloques de 3x3 puntos = 6 x 6 m
    relieve = bloques.max(axis=(1, 3)) - bloques.min(axis=(1, 3))

    P5 = a_malla(p5, forma)
    P30 = a_malla(p30, forma, "cerca")
    P300 = a_malla(p300, forma, "cerca")
    REL = a_malla(relieve, forma)

    motivo = np.zeros(forma, dtype=np.int32)
    motivo[P5 > PEND_5M_MAX] |= M_PEND5
    motivo[(P5 > PEND_5M_PRECAUCION) & (P5 <= PEND_5M_MAX)] |= M_PEND5_PREC
    motivo[P30 > PEND_30M_MAX] |= M_PEND30
    motivo[P300 > PEND_300M_MAX] |= M_PEND300
    motivo[REL > RELIEVE_MAX_M] |= M_RELIEVE
    motivo[(REL > RELIEVE_PRECAUCION_M) & (REL <= RELIEVE_MAX_M)] |= M_REL_PREC

    # 5) crateres (los que no se rechazaron con el relieve)
    arch_c = carpeta / "crateres.json"
    n_crat = 0
    if arch_c.exists():
        datos = json.loads(arch_c.read_text())
        lista = datos["crateres"] if isinstance(datos, dict) else datos
        yy, xx = np.mgrid[0:forma[0], 0:forma[1]]
        cy, cx = (yy + 0.5) * RES_M, (xx + 0.5) * RES_M
        mc = np.zeros(forma, dtype=bool)
        mchico = np.zeros(forma, dtype=bool)
        for c in lista:
            if c.get("relieve") == "rechazado" or c.get("conf", 1) < 0.5 or c["d"] < CRATER_D_MIN:
                continue
            s = c["s"] if "s" in c else alto_m - c["y"]
            r = c["d"] / 2 * MARGEN_CRATER + RES_M / 2
            f0, f1 = int(max((s - r) / RES_M, 0)), int(min((s + r) / RES_M + 1, forma[0]))
            c0, c1 = int(max((c["x"] - r) / RES_M, 0)), int(min((c["x"] + r) / RES_M + 1, forma[1]))
            if f1 <= f0 or c1 <= c0:
                continue
            d2 = (cy[f0:f1, c0:c1] - s) ** 2 + (cx[f0:f1, c0:c1] - c["x"]) ** 2
            dentro = d2 <= r * r
            if c["d"] >= CRATER_D_GRANDE:
                dentro &= d2 >= (0.75 * c["d"] / 2) ** 2      # solo el anillo del borde
            if c["d"] < CRATER_D_PROHIBIDO:
                mchico[f0:f1, c0:c1] |= dentro
            else:
                mc[f0:f1, c0:c1] |= dentro
            n_crat += 1
        motivo[mchico] |= M_CRATER_CHICO
        motivo[mc] |= M_CRATER
    # 6) dunas
    motivo[mascara_dunas(carpeta, info, forma)] |= M_DUNA

    # 7) espacio libre: a menos de RADIO_LIBRE_M de algo prohibido tampoco se puede aterrizar.
    #    Fuera de la zona no sabemos que hay, asi que la orilla del mapa cuenta como peligro.
    prohibido = (motivo & PROHIBIDO) > 0
    orilla = np.zeros(forma, dtype=bool)
    n_or = int(np.ceil(RADIO_LIBRE_M / RES_M))
    orilla[:n_or], orilla[-n_or:], orilla[:, :n_or], orilla[:, -n_or:] = True, True, True, True
    motivo[orilla & ~prohibido] |= M_ESPACIO
    prohibido |= orilla
    cerca = dilatar(prohibido, RADIO_LIBRE_M / RES_M) & ~prohibido
    motivo[cerca] |= M_ESPACIO

    estado = np.where((motivo & PROHIBIDO) > 0, 2, np.where((motivo & PRECAUCION) > 0, 1, 0)).astype(np.uint8)
    pct = {k: round(float((estado == v).mean() * 100), 1) for k, v in (("seguro", 0), ("precaucion", 1), ("prohibido", 2))}
    print(f"Zona: {pct['seguro']}% seguro, {pct['precaucion']}% precaucion, {pct['prohibido']}% prohibido "
          f"({n_crat} crateres tomados en cuenta)")

    # 8) los mejores lugares: verdes, lo mas lejos posible de lo prohibido y lo mas planos
    lejos = distancia_a((estado == 2) | orilla, RES_M)
    puntaje = np.where(estado == 0, lejos * (1 - np.clip(P30 / PEND_30M_MAX, 0, 1) * 0.5), -1.0)
    sugeridos = []
    orden = np.argsort(puntaje, axis=None)[::-1]
    for idx in orden[:20000]:
        f, c = divmod(int(idx), forma[1])
        if puntaje[f, c] <= 0:
            break
        x, s = (c + 0.5) * RES_M, (f + 0.5) * RES_M
        if any(np.hypot(x - g["x"], s - g["s"]) < SEPARACION_SUGERIDOS_M for g in sugeridos):
            continue
        sugeridos.append({
            "x": round(x, 1), "s": round(s, 1), "y": round(alto_m - s, 1),
            "lon": round(info["oeste"] + x / ancho_m * (info["este"] - info["oeste"]), 6),
            "lat": round(info["norte"] - s / alto_m * (info["norte"] - info["sur"]), 6),
            "libre_m": round(float(lejos[f, c])), "pend5": round(float(P5[f, c]), 1),
            "pend30": round(float(P30[f, c]), 1), "pend300": round(float(P300[f, c]), 1),
            "relieve_m": round(float(REL[f, c]), 2),
        })
        if len(sugeridos) == 3:
            break

    # imagen de colores (10 m por pixel)
    colores = np.array([[61, 220, 132, 95], [255, 181, 71, 120], [255, 90, 95, 120]], dtype=np.uint8)
    Image.fromarray(colores[estado], "RGBA").save(carpeta / "aterrizaje.png", optimize=True)

    # estado y motivo en la malla del planeador (cuadricula.json): el PEOR valor de cada celda
    f_c, c_c = cuad["alto"], cuad["ancho"]
    yy = np.clip(((np.arange(f_c) + 0.5) * cuad["celda_y"] / RES_M).astype(int), 0, forma[0] - 1)
    xx = np.clip(((np.arange(c_c) + 0.5) * cuad["celda_x"] / RES_M).astype(int), 0, forma[1] - 1)
    est_c = estado[yy][:, xx]
    mot_c = motivo[yy][:, xx]
    salida = {
        "criterios": {
            "fuente": "MSL Landing Site Selection - User's Guide to Engineering Constraints (JPL), sec. 1.5-1.6",
            "pend_5m_max": PEND_5M_MAX, "pend_30m_max": PEND_30M_MAX, "pend_300m_max": PEND_300M_MAX,
            "relieve_max_m": RELIEVE_MAX_M, "radio_libre_m": RADIO_LIBRE_M, "margen_crater": MARGEN_CRATER,
        },
        "bits": {"pend5": M_PEND5, "pend30": M_PEND30, "pend300": M_PEND300, "relieve": M_RELIEVE,
                 "crater": M_CRATER, "duna": M_DUNA, "espacio": M_ESPACIO, "pend5_prec": M_PEND5_PREC,
                 "relieve_prec": M_REL_PREC, "sin_datos": M_SIN_DATOS, "crater_chico": M_CRATER_CHICO},
        "porcentaje": pct,
        "ancho": c_c, "alto": f_c,
        "estado": est_c.ravel().tolist(),
        "motivo": mot_c.ravel().tolist(),
        "sugeridos": sugeridos,
    }
    (carpeta / "aterrizaje.json").write_text(json.dumps(salida, separators=(",", ":")))
    print("Lugares sugeridos:")
    for i, g in enumerate(sugeridos, 1):
        print(f"  L{i}: ({g['lat']}, {g['lon']})  libre {g['libre_m']} m, pendiente {g['pend30']} grados")


if __name__ == "__main__":
    main()
