# descargar_zona.py
# Busca y baja los datos de cualquier zona de Marte que tenga DTM de CTX,
# directo del catalogo de USGS (Analysis Ready Data, STAC).
# Solo baja el pedazo que necesitamos, no el archivo completo.
#
# Uso:
#   python scripts/descargar_zona.py --zona gale --lat -4.72 --lon 137.37 --nombre "Crater Gale"
#   python scripts/descargar_zona.py --buscar --lat -4.72 --lon 137.37     (solo ver que hay cerca)
#
# Luego:
#   python scripts/procesar.py --zona gale

import argparse
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import Affine
from rasterio.warp import transform as transformar
from rasterio.windows import Window, from_bounds

STAC = "https://stac.astrogeology.usgs.gov/api"
COL_CTX = "mro_ctx_controlled_usgs_dtms"          # DTM de CTX a 20 m (con su ortofoto de 6 m)
COL_HIRISE = "mro_hirise_controlled_socet_dtms"   # DTM de HiRISE a 1-2 m (con ortofotos)
RADIO_MARTE = 3396190
LONLAT = f"+proj=longlat +R={RADIO_MARTE} +no_defs"

MARGEN = 1.15          # bajamos 15 % de mas alrededor para que no falte en las orillas
RES_ORTO_HIRISE = 0.5  # m por pixel de la foto HiRISE (el casco usa ~50 cm, no hace falta 25 cm)


# ---------------- busqueda en el catalogo ----------------
def caja_grados(lat, lon, km):
    """Cuadro en grados (oeste, sur, este, norte) que cubre km x km alrededor del centro."""
    grado_m = math.pi * RADIO_MARTE / 180            # metros que mide 1 grado de latitud
    dlat = km * 1000 / 2 / grado_m
    dlon = dlat / max(math.cos(math.radians(lat)), 0.05)
    return (lon - dlon, lat - dlat, lon + dlon, lat + dlat)


def buscar(coleccion, caja):
    """Pregunta al catalogo de USGS que productos tocan la caja. Regresa la lista de items."""
    params = urllib.parse.urlencode({
        "collections": coleccion,
        "bbox": ",".join(f"{v:.5f}" for v in caja),
        "limit": 50,
    })
    url = f"{STAC}/search?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "martian-map/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r).get("features", [])
    except Exception as e:
        print(f"  no pude consultar el catalogo ({e})")
        return []


def cobertura(item, caja):
    """Que fraccion de nuestra caja queda dentro del cuadro del producto (aprox., en grados)."""
    b = item.get("bbox")
    if not b:
        return 0
    o, s, e, n = caja
    ancho = max(0, min(e, b[2]) - max(o, b[0]))
    alto = max(0, min(n, b[3]) - max(s, b[1]))
    return (ancho * alto) / ((e - o) * (n - s))


def elegir_asset(item, prefiere, evita=()):
    """Busca el archivo correcto dentro del item (los nombres cambian un poco entre colecciones)."""
    assets = item.get("assets", {})
    for clave in prefiere:          # primero por nombre exacto
        if clave in assets:
            return clave, assets[clave]["href"]
    for clave, a in assets.items():  # luego por parecido
        texto = (clave + " " + a.get("title", "")).lower()
        if any(p in texto for p in prefiere) and not any(x in texto for x in evita):
            if a.get("href", "").lower().endswith((".tif", ".tiff")):
                return clave, a["href"]
    return None, None


# ---------------- bajar solo el pedazo ----------------
def bajar_pedazo(href, caja, destino, res_m=None, aplicar_escala=True):
    """Lee del servidor solo la ventana de la caja y la guarda como GeoTIFF local.
    Si res_m, lo baja a esa resolucion (usa las vistas reducidas del archivo, pesa menos)."""
    entorno = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="3",
                   GDAL_HTTP_RETRY_DELAY="2", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.tiff")
    with rasterio.Env(**entorno), rasterio.open(href) as ds:
        # las 4 esquinas de la caja en las coordenadas del archivo
        o, s, e, n = caja
        xs, ys = transformar(LONLAT, ds.crs, [o, e, o, e], [s, s, n, n])
        ventana = from_bounds(min(xs), min(ys), max(xs), max(ys), transform=ds.transform)
        ventana = ventana.round_offsets().round_lengths()
        ventana = ventana.intersection(Window(0, 0, ds.width, ds.height))
        alto, ancho = int(ventana.height), int(ventana.width)
        if res_m and res_m > ds.res[1]:
            f = ds.res[1] / res_m
            alto, ancho = max(1, round(alto * f)), max(1, round(ancho * f))
        print(f"    bajando {ancho} x {alto} pixeles...")
        datos = ds.read(1, window=ventana, out_shape=(alto, ancho), masked=True)
        tr = ds.window_transform(ventana) * Affine.scale(ventana.width / ancho, ventana.height / alto)

        if aplicar_escala:  # alturas: a metros de verdad, en float32, NaN = sin dato
            datos = datos.astype("float32") * (ds.scales[0] or 1) + (ds.offsets[0] or 0)
            datos = datos.filled(np.nan)
            perfil = dict(dtype="float32", nodata=np.nan)
        else:               # fotos: se quedan como vienen (pesan menos)
            perfil = dict(dtype=ds.dtypes[0], nodata=ds.nodata)
            datos = datos.filled(ds.nodata if ds.nodata is not None else 0)

        perfil.update(driver="GTiff", width=ancho, height=alto, count=1, crs=ds.crs,
                      transform=tr, compress="deflate", tiled=True)
        with rasterio.open(destino, "w", **perfil) as sal:
            sal.write(datos, 1)
    hay = np.isfinite(datos).mean() if aplicar_escala else 1
    print(f"    guardado {destino} ({Path(destino).stat().st_size / 1e6:.1f} MB)")
    return hay


def describir(items, caja):
    for it in sorted(items, key=lambda i: -cobertura(i, caja)):
        b = it.get("bbox", [0, 0, 0, 0])
        print(f"  {it['id']:<45} cubre {100 * cobertura(it, caja):5.1f} %  "
              f"(lat {b[1]:.2f} a {b[3]:.2f}, lon {b[0]:.2f} a {b[2]:.2f})")


def main():
    ap = argparse.ArgumentParser(description="Baja DTM y fotos de una zona de Marte (USGS ARD)")
    ap.add_argument("--lat", type=float, required=True, help="latitud del centro (norte +, sur -)")
    ap.add_argument("--lon", type=float, required=True, help="longitud del centro en grados ESTE")
    ap.add_argument("--zona", help="nombre corto, sin espacios ni acentos (ej. gale)")
    ap.add_argument("--nombre", help='nombre bonito para la pagina (ej. "Crater Gale")')
    ap.add_argument("--km", type=float, default=6, help="lado del cuadro en km (por defecto 6)")
    ap.add_argument("--buscar", action="store_true", help="solo mostrar que hay, sin bajar nada")
    ap.add_argument("--sin-hirise", action="store_true", help="no bajar HiRISE aunque exista")
    a = ap.parse_args()

    lon = a.lon - 360 if a.lon > 180 else a.lon   # el catalogo usa -180 a 180
    if abs(a.lat) > 65:
        print("Ojo: arriba de 65 grados los archivos vienen en proyeccion polar y "
              "procesar.py no esta probado ahi.")
    caja = caja_grados(a.lat, lon, a.km)
    caja_grande = caja_grados(a.lat, lon, a.km * MARGEN)

    print(f"Buscando DTM de CTX alrededor de {a.lat} N, {lon} E ...")
    ctx = buscar(COL_CTX, caja)
    describir(ctx, caja)
    print(f"Buscando DTM de HiRISE ...")
    hirise = [] if a.sin_hirise else buscar(COL_HIRISE, caja)
    describir(hirise, caja)

    if a.buscar:
        return
    if not a.zona:
        raise SystemExit("Falta --zona (un nombre corto, ej. --zona gale)")
    if not ctx:
        raise SystemExit("No hay DTM de CTX en esa zona. Busca otra en el mapa de GeoSTAC "
                         "(donde se ven los rectangulos de CTX DTM).")

    zona = a.zona.lower().replace(" ", "_")
    carpeta = Path("datos_crudos") / zona
    carpeta.mkdir(parents=True, exist_ok=True)

    # --- CTX: el que mas cubre la zona ---
    mejor = max(ctx, key=lambda i: cobertura(i, caja))
    print(f"\nCTX elegido: {mejor['id']} ({100 * cobertura(mejor, caja):.0f} % de la zona)")
    _, url_dtm = elegir_asset(mejor, ["dtm"], evita=("hillshade", "err"))
    _, url_orto = elegir_asset(mejor, ["orthoimage", "ortho"], evita=("hillshade",))
    if not url_dtm or not url_orto:
        print("  archivos del item:", list(mejor.get("assets", {}).keys()))
        raise SystemExit("No encontre el DTM o la ortofoto dentro del item de CTX")
    print("  DTM:")
    hay = bajar_pedazo(url_dtm, caja_grande, carpeta / "dem_ctx.tif")
    print("  Ortofoto:")
    bajar_pedazo(url_orto, caja_grande, carpeta / "foto_ctx.tif", aplicar_escala=False)
    if hay < 0.6:
        print(f"  Ojo: solo {100 * hay:.0f} % del cuadro tiene datos de CTX. "
              "Mueve el centro hacia adentro del rectangulo del DTM.")

    # --- HiRISE (opcional): para la rugosidad y el casco ---
    for viejo in ("hirise_dtm.tif", "hirise_orto.tif"):
        (carpeta / viejo).unlink(missing_ok=True)
    if hirise:
        mejor_h = max(hirise, key=lambda i: cobertura(i, caja))
        print(f"\nHiRISE elegido: {mejor_h['id']} ({100 * cobertura(mejor_h, caja):.0f} % de la zona)")
        print("  archivos del item:", ", ".join(mejor_h.get("assets", {}).keys()))
        _, url_hd = elegir_asset(mejor_h, ["dtm"], evita=("hillshade", "fom", "thumb"))
        # la ortofoto en blanco y negro (canal rojo, resolucion completa)
        _, url_ho = elegir_asset(mejor_h, ["orthoimage", "ortho_red", "ortho"],
                                 evita=("color", "irb", "rgb", "dtm_res", "hillshade", "thumb"))
        if url_hd:
            try:
                print("  DTM HiRISE:")
                bajar_pedazo(url_hd, caja_grande, carpeta / "hirise_dtm.tif", res_m=1.0)
                if url_ho:
                    print("  Ortofoto HiRISE:")
                    bajar_pedazo(url_ho, caja_grande, carpeta / "hirise_orto.tif",
                                 res_m=RES_ORTO_HIRISE, aplicar_escala=False)
            except Exception as e:
                print(f"  no se pudo bajar HiRISE ({e}). Se sigue solo con CTX.")
                for viejo in ("hirise_dtm.tif", "hirise_orto.tif"):
                    (carpeta / viejo).unlink(missing_ok=True)
    else:
        print("\nNo hay HiRISE aqui: la ruta usara solo pendiente y el casco usara CTX.")

    ficha = {"nombre": a.nombre or a.zona, "lat": a.lat, "lon": lon, "km": a.km,
             "ctx": mejor["id"], "hirise": mejor_h["id"] if hirise else None}
    (carpeta / "zona.json").write_text(json.dumps(ficha, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nListo. Ahora corre:  python scripts/procesar.py --zona {zona}")


if __name__ == "__main__":
    main()
