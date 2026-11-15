# geologia.py
# Agrega la capa de unidades geologicas a una zona ya procesada.
# Usa el mapa geologico de USGS de Jezero (Sun y Stack, 2020, SIM 3464), que viene
# como shapefile: Jezero_GeoUnits.shp (+ .shx, .dbf, .prj).
#
# No necesita los .tif: solo lee info.json de la zona para saber que cuadro cubrir.
#
# Uso:
#   python scripts/geologia.py --zona jezero --shp datos_crudos/jezero/geologia/Jezero_GeoUnits.shp
#
# Genera:
#   docs/data/zonas/<zona>/geologia.png    capa de colores (transparente fuera de las unidades)
#   info.json                               agrega la capa a capas_extra y la lista de unidades

import argparse
import json
from pathlib import Path

import numpy as np
import shapefile  # pyshp: lee shapefiles sin instalar GDAL aparte
from PIL import Image
from rasterio.crs import CRS
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from rasterio.warp import transform_geom

RADIO_MARTE = 3396190
MARTE_LONLAT = f"+proj=longlat +R={RADIO_MARTE} +no_defs"
# Proyeccion del mapa de USGS (por si falta el .prj): Transverse Mercator, meridiano 77.5
PROY_SIM3464 = f"+proj=tmerc +lon_0=77.5 +lat_0=0 +k=1 +x_0=0 +y_0=0 +R={RADIO_MARTE} +units=m +no_defs"
LADO_PX = 1500        # mismo tamano que la foto del mapa
MIN_PCT_LETRERO = 0.4  # unidades mas chicas que esto (% del cuadro) no llevan nombre en 3D

# Un color fijo por unidad (por su simbolo), para que siempre salgan igual
COLORES = {
    "NHjf1": "#f2b134",  # Jezero fan 1 unit (delta)
    "NHjf2": "#f7d774",  # Jezero fan 2 unit
    "Njf":   "#3fae5a",  # Jezero floor unit
    "Nle":   "#2ec4c4",  # Lower etched unit
    "Nue":   "#e0524f",  # Upper etched unit
    "Hnpf":  "#d98236",  # Nili Planum fan unit
    "Nnp1":  "#6f8fdc",  # Nili Planum 1 unit
    "Nnp2":  "#4a64b8",  # Nili Planum 2 unit
    "Nrb":   "#e47fb4",  # Rugged bright unit
    "Aeb":   "#b07cd8",  # Eolian bedform unit
    "su":    "#9ccc65",  # Smooth unit, undivided
    "ce":    "#a1887f",  # Crater ejecta unit
    "ci":    "#bdbdbd",  # Crater interior unit
    "cr":    "#8d8d8d",  # Crater rim unit
    "CR":    "#8d8d8d",
}
EXTRA = ["#ff8a65", "#4db6ac", "#ba68c8", "#fff176", "#90a4ae", "#f06292"]


def a_rgb(hexa):
    return tuple(int(hexa[i:i + 2], 16) for i in (1, 3, 5))


def main():
    ap = argparse.ArgumentParser(description="Capa de unidades geologicas (USGS SIM 3464)")
    ap.add_argument("--zona", default="jezero")
    ap.add_argument("--shp", required=True, help="ruta a Jezero_GeoUnits.shp")
    a = ap.parse_args()

    salida = Path("docs/data/zonas") / a.zona
    ruta_info = salida / "info.json"
    if not ruta_info.exists():
        raise SystemExit(f"No encuentro {ruta_info}. Primero hay que procesar la zona.")
    info = json.loads(ruta_info.read_text(encoding="utf-8"))

    shp = Path(a.shp)
    if not shp.exists():
        raise SystemExit(f"No encuentro {shp}")
    prj = shp.with_suffix(".prj")
    origen = CRS.from_wkt(prj.read_text()) if prj.exists() else CRS.from_string(PROY_SIM3464)

    # Cuadro de la zona en grados. En esta proyeccion (equirectangular) la imagen en grados
    # queda alineada con la foto y las otras capas.
    o, e, s, n = info["oeste"], info["este"], info["sur"], info["norte"]
    escala = LADO_PX / max(info["ancho_m"], info["alto_m"])
    ancho = max(1, round(info["ancho_m"] * escala))
    alto = max(1, round(info["alto_m"] * escala))
    tr = from_bounds(o, s, e, n, ancho, alto)

    print(f"Leyendo {shp.name} ...")
    lector = shapefile.Reader(str(shp))
    ids, unidades, formas = {}, [], []
    for sr in lector.iterShapeRecords():
        reg = sr.record.as_dict()
        nombre = str(reg.get("name") or "Sin nombre").strip()
        simbolo = str(reg.get("symbol") or reg.get("symbol_noS") or "").strip()
        clave = simbolo or nombre
        if clave not in ids:
            ids[clave] = len(ids) + 1
            color = COLORES.get(simbolo) or EXTRA[(len(ids) - 1) % len(EXTRA)]
            unidades.append({"id": ids[clave], "nombre": nombre, "simbolo": simbolo, "color": color})
        geo = sr.shape.__geo_interface__
        if not geo.get("coordinates"):
            continue
        formas.append((transform_geom(origen, MARTE_LONLAT, geo), ids[clave]))
    print(f"  {len(formas)} poligonos, {len(unidades)} unidades en todo el mapa")

    rejilla = rasterize(formas, out_shape=(alto, ancho), transform=tr, fill=0, dtype="uint8",
                        all_touched=False)
    total = rejilla.size
    print(f"  {100 * (rejilla > 0).mean():.1f} % del cuadro tiene unidad asignada")

    # Imagen de colores
    rgba = np.zeros((alto, ancho, 4), dtype="uint8")
    lista = []
    for u in unidades:
        mascara = rejilla == u["id"]
        cuenta = int(mascara.sum())
        if cuenta == 0:
            continue
        rgba[mascara] = (*a_rgb(u["color"]), 255)
        pct = 100 * cuenta / total
        # lugar para el nombre: el pixel de la unidad mas cercano a su centro
        ys, xs = np.nonzero(mascara)
        cy, cx = ys.mean(), xs.mean()
        k = int(np.argmin((ys - cy) ** 2 + (xs - cx) ** 2))
        lon, lat = tr * (xs[k] + 0.5, ys[k] + 0.5)
        lista.append({"nombre": u["nombre"], "simbolo": u["simbolo"], "color": u["color"],
                      "pct": round(pct, 1), "lon": round(lon, 5), "lat": round(lat, 5),
                      "letrero": pct >= MIN_PCT_LETRERO})
    lista.sort(key=lambda u: -u["pct"])
    Image.fromarray(rgba, "RGBA").save(salida / "geologia.png")
    print(f"  guardado {salida / 'geologia.png'} ({ancho} x {alto})")
    for u in lista:
        print(f"    {u['pct']:5.1f} %  {u['simbolo']:<6} {u['nombre']}")

    # info.json: capa extra + lista de unidades (para la leyenda y los letreros 3D)
    extras = [c for c in info.get("capas_extra", []) if c.get("nombre") != "geologia"]
    extras.append({"nombre": "geologia", "etiqueta": "Geologic units (USGS SIM 3464)"})
    info["capas_extra"] = extras
    info["geologia"] = lista
    ruta_info.write_text(json.dumps(info, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  actualizado {ruta_info}")


if __name__ == "__main__":
    main()
