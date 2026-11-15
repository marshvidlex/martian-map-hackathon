"""
cortar_marte.py
Corta la imagen completa de Marte en mosaicos de 256 x 256 para la pantalla de inicio
y los guarda en docs/data/marte/{z}/{y}/{x}.jpg (el mismo acomodo que usa Leaflet).

Imagen que usa (dominio publico, NASA / JPL / USGS, Viking MDIM 2.1 a color, ~1 km/pixel):
    Mars_Viking_MDIM21_ClrMosaic_1km.jpg  (21,339 x 10,670 px, 35 MB)
    https://commons.wikimedia.org/wiki/File:Mars_Viking_MDIM21_ClrMosaic_1km.jpg
Se guarda en datos_crudos/ (esa carpeta no se sube a GitHub).

Uso (desde la carpeta del repo, con el venv activado):
    python scripts/cortar_marte.py
    python scripts/cortar_marte.py --imagen otra_ruta.jpg --max 5

La imagen debe ir de -180 a 180 grados de longitud (0 grados al centro) y de 90 N a 90 S.
Si tu imagen va de 0 a 360, agrega --de0a360 y el script la acomoda.
"""

import argparse
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "docs" / "data" / "marte"
IMAGEN = RAIZ / "datos_crudos" / "Mars_Viking_MDIM21_ClrMosaic_1km.jpg"

Image.MAX_IMAGE_PIXELS = None  # la imagen es enorme y PIL la bloquea por defecto


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--imagen", default=str(IMAGEN))
    ap.add_argument("--max", type=int, default=4, help="nivel de zoom maximo (4 = 8192 px de ancho)")
    ap.add_argument("--de0a360", action="store_true", help="la imagen empieza en 0 grados y no en -180")
    args = ap.parse_args()

    ruta = Path(args.imagen)
    if not ruta.exists():
        raise SystemExit(f"No encuentro la imagen: {ruta}\nDescargala y ponla en datos_crudos/ (ver arriba del script).")

    ancho_max = 256 * 2 ** (args.max + 1)
    img = Image.open(ruta)
    # el JPG se puede abrir ya reducido (mucho mas rapido y con menos memoria)
    img.draft("RGB", (ancho_max, ancho_max // 2))
    img = img.convert("RGB")
    print(f"Imagen: {img.width} x {img.height} px")
    if abs(img.width / img.height - 2) > 0.02:
        print("Ojo: la imagen no es 2:1, puede que no sea el mapa global completo.")

    if args.de0a360:  # se pasa la mitad derecha (180 a 360) al lado izquierdo
        mitad = img.width // 2
        nueva = Image.new("RGB", img.size)
        nueva.paste(img.crop((mitad, 0, img.width, img.height)), (0, 0))
        nueva.paste(img.crop((0, 0, mitad, img.height)), (img.width - mitad, 0))
        img = nueva

    total = 0
    for z in range(args.max + 1):
        columnas, filas = 2 ** (z + 1), 2 ** z
        nivel = img.resize((256 * columnas, 256 * filas), Image.LANCZOS)
        for y in range(filas):
            for x in range(columnas):
                archivo = DESTINO / str(z) / str(y) / f"{x}.jpg"
                archivo.parent.mkdir(parents=True, exist_ok=True)
                nivel.crop((x * 256, y * 256, x * 256 + 256, y * 256 + 256)).save(archivo, quality=82)
                total += 1
        print(f"  nivel {z}: {columnas} x {filas} mosaicos")

    peso = sum(f.stat().st_size for f in DESTINO.rglob("*.jpg")) / 1e6
    print(f"Listo: {total} mosaicos, {peso:.1f} MB en {DESTINO}")


if __name__ == "__main__":
    main()
