"""
descargar_marte.py
Descarga el mapa completo de Marte (mosaico a color de Viking, NASA Mars Trek)
y lo guarda dentro de la pagina, en docs/data/marte/{z}/{y}/{x}.jpg.
Asi la pantalla de inicio muestra Marte aunque no haya internet.

Uso (desde la carpeta del repo, con el venv activado o con cualquier Python 3):
    python scripts/descargar_marte.py           # niveles 0 a 4 (~680 mosaicos)
    python scripts/descargar_marte.py --max 5   # agrega el nivel 5 (~2,700 mosaicos, mucho mas pesado)

Solo usa la libreria estandar de Python. Si se corta, vuelve a correrlo: se salta lo que ya bajo.
"""

import argparse
import time
import urllib.request
from pathlib import Path

URL = ("https://trek.nasa.gov/tiles/Mars/EQ/Viking_MDIM21_ClrMosaic_global_232m/"
       "1.0.0/default/default028mm/{z}/{y}/{x}.jpg")
DESTINO = Path(__file__).resolve().parent.parent / "docs" / "data" / "marte"


def bajar(url, archivo, intentos=3):
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "martian-map (NASA Space Apps)"})
            with urllib.request.urlopen(req, timeout=30) as r:
                datos = r.read()
            archivo.parent.mkdir(parents=True, exist_ok=True)
            archivo.write_bytes(datos)
            return len(datos)
        except Exception as e:  # red inestable: se reintenta
            if i == intentos - 1:
                print(f"  fallo {url}: {e}")
            time.sleep(1 + i)
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=4, help="nivel de zoom maximo (0-7)")
    args = ap.parse_args()

    # En la proyeccion equirectangular de Mars Trek el nivel 0 son 2 x 1 mosaicos,
    # y cada nivel duplica columnas y filas.
    total = sum(2 ** (z + 1) * 2 ** z for z in range(args.max + 1))
    hechos, bytes_total, fallas = 0, 0, 0
    print(f"Descargando {total} mosaicos a {DESTINO}")
    for z in range(args.max + 1):
        columnas, filas = 2 ** (z + 1), 2 ** z
        for y in range(filas):
            for x in range(columnas):
                archivo = DESTINO / str(z) / str(y) / f"{x}.jpg"
                hechos += 1
                if archivo.exists() and archivo.stat().st_size > 0:
                    bytes_total += archivo.stat().st_size
                    continue
                n = bajar(URL.format(z=z, y=y, x=x), archivo)
                if n == 0:
                    fallas += 1
                bytes_total += n
        print(f"  nivel {z} listo ({hechos}/{total}, {bytes_total / 1e6:.1f} MB)")
    print("Terminado." if fallas == 0 else f"Terminado con {fallas} fallas: vuelve a correrlo.")


if __name__ == "__main__":
    main()
