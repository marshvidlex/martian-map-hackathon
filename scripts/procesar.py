# procesar.py
# Recorta la zona de la caminata, calcula la pendiente y genera los archivos
# ligeros que usa la app web (PNG de cada capa + cuadricula JSON).
# Uso:
#   python scripts/procesar.py                 -> procesa Jezero (zona por defecto)
#   python scripts/procesar.py --zona gale     -> procesa la zona que bajo descargar_zona.py
# Cada zona queda en docs/data/zonas/<zona>/ y se agrega a docs/data/zonas.json

import argparse
import json
import math
import shutil
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import transform
from rasterio.windows import from_bounds
from matplotlib import colormaps
from PIL import Image

# ---------------- CONFIGURACION (lo que normalmente vas a mover) ----------------
# Valores de Jezero. Se usan cuando la zona no trae su propio zona.json
# (las zonas que baja descargar_zona.py si lo traen y mandan sobre esto).
ZONA_DEFAULT = "jezero"
NOMBRE_DEFAULT = "Crater Jezero"
CENTRO_LAT = 18.46     # centro de la zona de la caminata (grados norte)
CENTRO_LON = 77.42     # (grados este)
TAMANO_KM = 6          # lado del cuadrado que recortamos

# Nombres de los archivos dentro de la carpeta de la zona
#   datos_crudos/<zona>/   o, si esa carpeta no existe, datos_crudos/ (como estaba Jezero)
ARCH_DEM = "dem_ctx.tif"            # modelo de elevacion (CTX, 20 m/pixel)
ARCH_FOTO = "foto_ctx.tif"          # ortofoto (CTX, 6 m/pixel)
ARCH_HIRISE = "hirise_dtm.tif"      # DEM de detalle (HiRISE, 1 m/pixel). Si no existe, se salta
ARCH_ORTO_HIRISE = "hirise_orto.tif"  # foto HiRISE (opcional, para el casco)
CELDA_M = 20          # tamano de casilla de la cuadricula (m). Si el DEM es mas fino, se promedia a esto
PENDIENTE_MAX = 15     # grados; arriba de esto la celda queda bloqueada
RUGOSIDAD_MAX = 1.0    # metros; arriba de esto la celda queda bloqueada (ajustar con datos reales)
LADO_FOTO = 1500       # pixeles maximos de la foto (para que pese poco)
RADIO_MARTE = 3396190  # metros, el mismo que usa USGS en estos archivos
TESELA_M = 250         # mosaicos de HiRISE para el casco: lado de cada uno (m)
PASO_TESELA_M = 2      # resolucion de los mosaicos (m). Con 4 pesan 4 veces menos
FOTO_TESELA_PX = 512   # pixeles por lado de cada foto de mosaico (512 = ~50 cm por pixel)

# Capas extra: (archivo dentro de la carpeta de la zona, nombre, colormap, etiqueta)
# El nombre no lleva espacios ni acentos porque se vuelve nombre de archivo.
# Si el archivo no esta en esa zona, la capa se salta.
CAPAS_EXTRA = [
    # ("themis_dia.tif", "termica", "inferno", "Temperatura (THEMIS)"),
]
# ---------------------------------------------------------------------------------

# Estas se llenan en configurar() segun la zona
DEM = FOTO = HIRISE = ORTO_HIRISE = None
CARPETA = None
SALIDA = None


def configurar(zona):
    """Decide de donde se leen los datos y a donde se escriben, segun la zona."""
    global DEM, FOTO, HIRISE, ORTO_HIRISE, CARPETA, SALIDA
    global CENTRO_LAT, CENTRO_LON, TAMANO_KM
    CARPETA = Path("datos_crudos") / zona
    if not CARPETA.exists():
        if zona != ZONA_DEFAULT:
            raise SystemExit(f"No existe la carpeta {CARPETA}. Corre primero descargar_zona.py --zona {zona}")
        CARPETA = Path("datos_crudos")   # Jezero, como lo teniamos antes
    nombre = NOMBRE_DEFAULT if zona == ZONA_DEFAULT else zona
    ficha = CARPETA / "zona.json"
    if ficha.exists():
        datos = json.loads(ficha.read_text(encoding="utf-8"))
        CENTRO_LAT, CENTRO_LON = datos["lat"], datos["lon"]
        TAMANO_KM = datos.get("km", TAMANO_KM)
        nombre = datos.get("nombre", nombre)
    else:
        datos = {}
    # zona.json puede decir como se llaman los archivos, para no tener que renombrarlos.
    # Si un mosaico de 1 m se usa como "dem" y como "hirise" a la vez, se pone el mismo nombre en los dos.
    DEM = str(CARPETA / datos.get("dem", ARCH_DEM))
    FOTO = str(CARPETA / datos.get("foto", ARCH_FOTO))
    HIRISE = str(CARPETA / datos.get("hirise", ARCH_HIRISE))
    ORTO_HIRISE = str(CARPETA / datos.get("orto", ARCH_ORTO_HIRISE))
    SALIDA = Path("docs/data/zonas") / zona
    if not Path(DEM).exists():
        raise SystemExit(f"No encuentro {DEM}. Revisa el nombre de la zona o corre primero descargar_zona.py")
    if not Path(FOTO).exists():
        raise SystemExit(f"No encuentro {FOTO}")
    print(f"Zona: {nombre}  ({CENTRO_LAT:.4f} N, {CENTRO_LON:.4f} E, {TAMANO_KM} km)")
    print(f"Leyendo de {CARPETA}  ->  escribiendo en {SALIDA}")
    return nombre

MARTE_LONLAT = f"+proj=longlat +R={RADIO_MARTE} +no_defs"


def a_metros(ds, lon, lat):
    """Convierte lon/lat (grados) a las coordenadas en metros del archivo."""
    xs, ys = transform(MARTE_LONLAT, ds.crs, [lon], [lat])
    return xs[0], ys[0]


def a_lonlat(ds, x, y):
    """Lo contrario: de metros del archivo a lon/lat."""
    lons, lats = transform(ds.crs, MARTE_LONLAT, [x], [y])
    return lons[0], lats[0]


def recortar(ruta, limites, lado_max=None, forma=None, suave=False, promedio=False):
    """Lee solo el cuadro que nos interesa. Si lado_max, lo reduce a ese tamano.
    promedio=True junta varios pixeles en uno promediandolos (para bajar un DEM de 1 m a 20 m)."""
    with rasterio.open(ruta) as ds:
        ventana = from_bounds(*limites, transform=ds.transform)
        alto, ancho = round(ventana.height), round(ventana.width)
        if forma:
            alto, ancho = forma
        elif lado_max and max(alto, ancho) > lado_max:
            f = lado_max / max(alto, ancho)
            alto, ancho = round(alto * f), round(ancho * f)
        metodo = Resampling.average if promedio else (Resampling.bilinear if suave else Resampling.nearest)
        datos = ds.read(1, window=ventana, out_shape=(alto, ancho), resampling=metodo,
                        masked=True, boundless=True).astype("float32")
        # algunos archivos de USGS guardan enteros con escala y desplazamiento
        datos = datos * (ds.scales[0] or 1) + (ds.offsets[0] or 0)
        # nodata raros de USGS (-3.4e38, -32767...). En Marte nada esta abajo de -9 km
        datos = np.ma.masked_less(datos, -20000)
        return datos.filled(np.nan)


def guardar_png(rgba, nombre):
    Image.fromarray(rgba).save(SALIDA / nombre)
    print("  guardado", SALIDA / nombre, rgba.shape[1], "x", rgba.shape[0])


def colorear(valores, cmap):
    """Convierte una matriz de numeros en imagen RGBA usando un colormap."""
    vmin, vmax = np.nanpercentile(valores, [2, 98])
    norm = np.clip((valores - vmin) / (vmax - vmin + 1e-9), 0, 1)
    rgba = (colormaps[cmap](np.nan_to_num(norm)) * 255).astype("uint8")
    rgba[np.isnan(valores), 3] = 0
    return rgba, float(vmin), float(vmax)


def calcular_rugosidad(limites, alto, ancho, celda_y):
    """Rugosidad de cada celda de 20 m usando el DEM HiRISE.
    En cada celda se ajusta un plano (eso ya es la pendiente) y se mide cuanto se
    salen los puntos de ese plano. Rocas grandes, escalones y bordes dan valores altos."""
    with rasterio.open(HIRISE) as ds:
        k = max(1, round(celda_y / ds.res[1]))  # pixeles HiRISE por lado de celda
    print(f"  leyendo HiRISE ({k} x {k} pixeles por celda)...")
    z = recortar(HIRISE, limites, forma=(alto * k, ancho * k))
    bloques = z.reshape(alto, k, ancho, k).transpose(0, 2, 1, 3)  # (alto, ancho, k, k)

    # coordenadas centradas dentro de la celda, para ajustar el plano z = a*u + b*v + c
    u = np.arange(k, dtype="float32") - (k - 1) / 2
    uu, vv = np.meshgrid(u, u)  # uu cambia por columna, vv por fila
    c = bloques.mean(axis=(2, 3), keepdims=True)
    a = (bloques * uu).sum(axis=(2, 3), keepdims=True) / (uu ** 2).sum()
    b = (bloques * vv).sum(axis=(2, 3), keepdims=True) / (vv ** 2).sum()
    residuo = bloques - (a * uu + b * vv + c)
    rug = np.sqrt((residuo ** 2).mean(axis=(2, 3)))  # NaN si la celda tiene huecos

    # En la orilla de lo que cubre HiRISE los valores salen falsos (medio pixel con dato,
    # medio sin dato). Quitamos una celda de orilla: si un vecino es NaN, esta tambien.
    orilla = np.isnan(rug)
    orilla[1:, :] |= np.isnan(rug[:-1, :])
    orilla[:-1, :] |= np.isnan(rug[1:, :])
    orilla[:, 1:] |= np.isnan(rug[:, :-1])
    orilla[:, :-1] |= np.isnan(rug[:, 1:])
    rug[orilla] = np.nan
    return rug


def exportar_teselas(limites, ancho_m, alto_m, escala_x):
    """Corta HiRISE en mosaicos chicos para la vista del casco.
    La app solo carga los que estan cerca del astronauta (como un videojuego de mundo abierto)."""
    carpeta = SALIDA / "hirise"
    carpeta.mkdir(exist_ok=True)
    for viejo in list(carpeta.glob("t_*.bin")) + list(carpeta.glob("f_*.jpg")):
        viejo.unlink()

    filas, cols = round(alto_m / PASO_TESELA_M), round(ancho_m / PASO_TESELA_M)
    print(f"  leyendo HiRISE a {PASO_TESELA_M} m ({cols} x {filas})...")
    zh = recortar(HIRISE, limites, forma=(filas, cols), suave=True)
    zc = recortar(DEM, limites, forma=(filas, cols), suave=True)  # para rellenar huecos
    zbase = float(np.nanmin(zc))

    n = TESELA_M // PASO_TESELA_M          # intervalos por mosaico (125 -> 126 muestras)
    nx, ny = int(np.ceil(cols / n)), int(np.ceil(filas / n))
    relleno = ((0, ny * n + 1 - filas), (0, nx * n + 1 - cols))
    zh = np.pad(zh, relleno, mode="edge")
    zc = np.pad(zc, relleno, mode="edge")

    existentes = []
    for j in range(ny):          # j: de norte a sur
        for i in range(nx):      # i: de oeste a este
            h = zh[j * n:j * n + n + 1, i * n:i * n + n + 1]
            if np.isnan(h).mean() > 0.5:
                continue         # casi sin HiRISE aqui: el casco usa CTX
            h = np.where(np.isnan(h), zc[j * n:j * n + n + 1, i * n:i * n + n + 1], h)
            h = np.where(np.isnan(h), zbase, h)
            # altura en decimetros sobre zbase, como enteros de 2 bytes (pesa poco)
            dm = np.clip(np.round((h - zbase) * 10), 0, 65535).astype("<u2")
            dm.tofile(carpeta / f"t_{i}_{j}.bin")
            existentes.append(f"{i}_{j}")

    fotos = []
    if Path(ORTO_HIRISE).exists():
        fotos = exportar_fotos_teselas(limites, escala_x, nx, ny, set(existentes))
    else:
        print("  no esta", ORTO_HIRISE, "-> el casco usara la foto CTX")

    indice = {"tesela_m": TESELA_M, "paso_m": PASO_TESELA_M, "muestras": n + 1,
              "origen_m": PASO_TESELA_M / 2, "z_base": round(zbase, 2),
              "nx": nx, "ny": ny, "existentes": existentes, "fotos": fotos}
    (carpeta / "indice.json").write_text(json.dumps(indice))
    peso = sum(f.stat().st_size for f in carpeta.glob("t_*.bin")) / 1e6
    print(f"  {len(existentes)} mosaicos de {nx * ny} ({peso:.1f} MB) en {carpeta}")


def exportar_fotos_teselas(limites, escala_x, nx, ny, existentes):
    """Corta la ortofoto HiRISE (25 cm) en fotos JPG de cada mosaico para el casco.
    Se lee por franjas de 250 m de alto para no llenar la memoria."""
    carpeta = SALIDA / "hirise"
    o = PASO_TESELA_M / 2                 # mismo corrimiento que los mosaicos de altura
    px = FOTO_TESELA_PX
    print(f"  cortando ortofoto HiRISE ({TESELA_M / px * 100:.0f} cm por pixel)...")

    # contraste: lo calculamos una vez con una version chiquita de toda la zona
    muestra = recortar(ORTO_HIRISE, limites, lado_max=1500)
    p2, p98 = np.nanpercentile(muestra, [2, 98])
    fp2, fp98 = np.nanpercentile(recortar(FOTO, limites, lado_max=1500), [2, 98])

    hechas = []
    for j in range(ny):
        arriba = limites[3] - (j * TESELA_M + o)
        izq = limites[0] + o / escala_x
        franja_lim = (izq, arriba - TESELA_M, izq + nx * TESELA_M / escala_x, arriba)
        franja = recortar(ORTO_HIRISE, franja_lim, forma=(px, nx * px), suave=True)
        if np.isnan(franja).all():
            continue
        relleno = recortar(FOTO, franja_lim, forma=(px, nx * px), suave=True)  # donde no hay HiRISE
        gris = np.clip((franja - p2) / (p98 - p2), 0, 1)
        gris_ctx = np.clip((relleno - fp2) / (fp98 - fp2), 0, 1)
        gris = np.where(np.isnan(gris), gris_ctx, gris)
        gris = (np.nan_to_num(gris) * 255).astype("uint8")
        for i in range(nx):
            clave = f"{i}_{j}"
            if clave not in existentes:
                continue
            pedazo = franja[:, i * px:(i + 1) * px]
            if np.isnan(pedazo).mean() > 0.5:
                continue
            Image.fromarray(gris[:, i * px:(i + 1) * px]).save(carpeta / f"f_{clave}.jpg", quality=82)
            hechas.append(clave)
    peso = sum(f.stat().st_size for f in carpeta.glob("f_*.jpg")) / 1e6
    print(f"  {len(hechas)} fotos de mosaico ({peso:.1f} MB)")
    return hechas


def main():
    parser = argparse.ArgumentParser(description="Procesa una zona de Marte para Martian Map")
    parser.add_argument("--zona", default=ZONA_DEFAULT,
                        help="nombre corto de la zona (carpeta en datos_crudos). Por defecto: jezero")
    zona = parser.parse_args().zona.lower()
    nombre = configurar(zona)
    SALIDA.mkdir(parents=True, exist_ok=True)
    mitad = TAMANO_KM * 1000 / 2

    with rasterio.open(DEM) as ds:
        cx, cy = a_metros(ds, CENTRO_LON, CENTRO_LAT)
        res_x, res_y = ds.res

        # En esta proyeccion un metro "del mapa" en x no es un metro real en el suelo.
        # Medimos cuanto se estira comparando 0.01 grados de longitud.
        x2, _ = a_metros(ds, CENTRO_LON + 0.01, CENTRO_LAT)
        metros_reales = RADIO_MARTE * math.cos(math.radians(CENTRO_LAT)) * math.radians(0.01)
        escala_x = metros_reales / (x2 - cx)

        # oeste, sur, este, norte (en x ensanchamos para que el cuadro sea parejo en el suelo)
        mitad_x = mitad / escala_x
        limites = (cx - mitad_x, cy - mitad, cx + mitad_x, cy + mitad)

        oeste, sur = a_lonlat(ds, limites[0], limites[1])
        este, norte = a_lonlat(ds, limites[2], limites[3])

    print("1) Recortando elevacion...")
    if res_y < CELDA_M * 0.75:
        # DEM mas fino que la casilla (por ejemplo un mosaico de 1 m): lo promediamos a CELDA_M
        alto = round(2 * mitad / CELDA_M)
        ancho = round(2 * mitad / CELDA_M)
        print(f"  el DEM es de {res_y:.1f} m; se promedia a casillas de {CELDA_M} m")
        z = recortar(DEM, limites, forma=(alto, ancho), promedio=True)
        dx = 2 * mitad / ancho   # metros reales entre columnas
        dy = 2 * mitad / alto    # metros reales entre filas
    else:
        z = recortar(DEM, limites)
        alto, ancho = z.shape
        dx = res_x * escala_x  # metros reales entre columnas
        dy = res_y             # metros reales entre filas
    print(f"  {ancho} x {alto} celdas, celda de {dx:.1f} m x {dy:.1f} m")

    print("2) Calculando pendiente...")
    dz_dy, dz_dx = np.gradient(z, dy, dx)
    pendiente = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))
    sin_dato = np.isnan(pendiente)
    bloqueadas = (pendiente > PENDIENTE_MAX) | sin_dato
    print(f"  pendiente maxima: {np.nanmax(pendiente):.1f} grados")
    print(f"  celdas bloqueadas: {100 * bloqueadas.mean():.1f} %")

    print("2b) Calculando rugosidad con HiRISE...")
    rug = None
    if Path(HIRISE).exists():
        rug = calcular_rugosidad(limites, alto, ancho, dy)
        p50, p90, p99 = np.nanpercentile(rug, [50, 90, 99])
        print(f"  rugosidad (m): mediana {p50:.2f}, p90 {p90:.2f}, p99 {p99:.2f}")
        print(f"  sin dato HiRISE: {100 * np.isnan(rug).mean():.1f} % de las celdas")
        print(f"  bloqueadas por rugosidad (> {RUGOSIDAD_MAX} m): {100 * (rug > RUGOSIDAD_MAX).mean():.1f} %")
        exportar_teselas(limites, ancho * dx, alto * dy, escala_x)
    else:
        print("  no esta", HIRISE, "-> se salta (la ruta solo usara pendiente)")
        # si antes se proceso esta zona con HiRISE, borramos lo viejo para que no se mezcle
        shutil.rmtree(SALIDA / "hirise", ignore_errors=True)
        (SALIDA / "rugosidad.png").unlink(missing_ok=True)

    print("3) Generando capas PNG...")
    # Elevacion con colores (transparente donde no hay dato)
    zmin, zmax = np.nanpercentile(z, [2, 98])
    norm = np.clip((z - zmin) / (zmax - zmin), 0, 1)
    rgba = (colormaps["terrain"](np.nan_to_num(norm)) * 255).astype("uint8")
    rgba[np.isnan(z), 3] = 0
    guardar_png(rgba, "elevacion.png")

    # Pendiente: de morado (plano) a amarillo (inclinado); rojo = bloqueado
    norm = np.clip(np.nan_to_num(pendiente) / PENDIENTE_MAX, 0, 1)
    rgba = (colormaps["viridis"](norm) * 255).astype("uint8")
    rgba[bloqueadas] = [220, 30, 30, 255]
    rgba[sin_dato, 3] = 0
    guardar_png(rgba, "pendiente.png")

    if rug is not None:
        # Rugosidad: transparente si es lisa, de amarillo a rojo si es aspera
        norm = np.clip(np.nan_to_num(rug) / RUGOSIDAD_MAX, 0, 1)
        rgba = (colormaps["YlOrRd"](norm) * 255).astype("uint8")
        rgba[..., 3] = (np.clip(norm * 1.5, 0, 1) * 255).astype("uint8")
        rgba[rug > RUGOSIDAD_MAX] = [120, 0, 0, 255]
        rgba[np.isnan(rug), 3] = 0
        guardar_png(rgba, "rugosidad.png")

    # Foto: estiramos el contraste para que se vea bien
    foto = recortar(FOTO, limites, lado_max=LADO_FOTO)
    p2, p98 = np.nanpercentile(foto, [2, 98])
    gris = (np.clip((foto - p2) / (p98 - p2), 0, 1) * 255)
    gris = np.nan_to_num(gris).astype("uint8")
    rgba = np.dstack([gris, gris, gris, np.where(np.isnan(foto), 0, 255).astype("uint8")])
    guardar_png(rgba, "foto.png")

    capas_extra = []
    for archivo, nombre_capa, cmap, etiqueta in CAPAS_EXTRA:
        ruta = CARPETA / archivo
        if not ruta.exists():
            print("  no esta", ruta, "-> se salta la capa", nombre_capa)
            continue
        valores = recortar(str(ruta), limites, lado_max=LADO_FOTO)
        rgba, vmin, vmax = colorear(valores, cmap)
        guardar_png(rgba, nombre_capa + ".png")
        capas_extra.append({"nombre": nombre_capa, "etiqueta": etiqueta,
                            "min": round(vmin, 2), "max": round(vmax, 2)})

    print("4) Guardando cuadricula para la ruta...")
    cuadricula = {
        "ancho": ancho,
        "alto": alto,
        "celda_x": round(dx, 3),
        "celda_y": round(dy, 3),
        # pendiente en decimas de grado (-1 = sin dato) para que el JSON pese menos
        "pendiente": np.where(sin_dato, -1, np.round(pendiente * 10)).astype(int).ravel().tolist(),
        "elevacion": np.where(np.isnan(z), -99999, np.round(z)).astype(int).ravel().tolist(),
    }
    if rug is not None:
        # rugosidad en centimetros (-1 = sin dato HiRISE)
        cuadricula["rugosidad"] = np.where(np.isnan(rug), -1, np.round(rug * 100)).astype(int).ravel().tolist()
    (SALIDA / "cuadricula.json").write_text(json.dumps(cuadricula, separators=(",", ":")))

    info = {
        "nombre": nombre,
        "ancho_m": round(ancho * dx, 1),
        "alto_m": round(alto * dy, 1),
        "oeste": oeste, "este": este, "sur": sur, "norte": norte,
        "pendiente_max": PENDIENTE_MAX,
        "rugosidad_max": RUGOSIDAD_MAX,
        "tiene_rugosidad": rug is not None,
        "capas_extra": capas_extra,
    }
    (SALIDA / "info.json").write_text(json.dumps(info, indent=2, ensure_ascii=False), encoding="utf-8")
    print("  listo:", SALIDA / "cuadricula.json", "y", SALIDA / "info.json")

    # Puntos de interes: si la zona no tiene, se crea la lista vacia para llenarla a mano.
    # Para Jezero se copia el poi.json que ya teniamos en docs/data.
    poi = SALIDA / "poi.json"
    if not poi.exists():
        viejo = Path("docs/data/poi.json")
        if zona == ZONA_DEFAULT and viejo.exists():
            shutil.copy(viejo, poi)
        else:
            poi.write_text("[]\n", encoding="utf-8")
        print("  creado", poi)

    # Lista de zonas para el selector de la pagina
    lista_ruta = Path("docs/data/zonas.json")
    lista = json.loads(lista_ruta.read_text(encoding="utf-8")) if lista_ruta.exists() else []
    lista = [z for z in lista if z["id"] != zona]
    lista.append({"id": zona, "nombre": nombre,
                  "lat": round(CENTRO_LAT, 4), "lon": round(CENTRO_LON, 4)})
    lista.sort(key=lambda z: z["nombre"])
    lista_ruta.write_text(json.dumps(lista, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  {lista_ruta} tiene {len(lista)} zona(s)")


if __name__ == "__main__":
    main()
