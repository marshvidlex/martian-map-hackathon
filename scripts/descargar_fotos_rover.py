"""
descargar_fotos_rover.py
Baja fotos reales que tomo Perseverance desde el suelo en cada lugar de ciencia (poi.json)
y las guarda chicas (800 px) dentro de la app, para que se vean sin internet.

De donde salen: la API publica de imagenes crudas de Mars 2020 (la misma que usa
https://mars.nasa.gov/mars2020/multimedia/raw-images/). Para cada lugar se piden las fotos
de los soles (dias marcianos) en que el rover estuvo ahi y se escogen:
  - Mastcam-Z a color (ZL0 / ZR0): la "vista de astronauta"
  - WATSON (SI1): el acercamiento a la roca o al parche desgastado
  - Navcam a color: el panorama de navegacion
Solo fotos completas (no miniaturas ni recortes).

Uso (desde la carpeta raiz martian-map):
    pip install requests pillow
    python scripts/descargar_fotos_rover.py
    python scripts/descargar_fotos_rover.py --zona jezero --por-lugar 3
    python scripts/descargar_fotos_rover.py --solo wildcat,belva

Si alguna no te gusta: busca otra en el sitio de raw images, copia el enlace de la imagen y:
    python scripts/descargar_fotos_rover.py --url wildcat=https://mars.nasa.gov/mars2020-raw-images/....png
Ver y quitar:
    python scripts/descargar_fotos_rover.py --lista
    python scripts/descargar_fotos_rover.py --quitar wildcat=3
"""
import argparse, io, json, os, sys, time
import requests
from PIL import Image

API = "https://mars.nasa.gov/rss/api/"
CARPETA_DATOS = os.path.join("docs", "data", "zonas")

# Soles a revisar por lugar (el sol de la muestra y los de alrededor). Si un lugar no esta, se usa su "sol".
SOLES = {
    "butler":     [1, 2, 3, 4, 13, 14],
    "rochette":   [190, 191, 194, 196, 182, 186],
    "brac":       [262, 263, 264, 255, 258],
    "issole":     [286, 293, 295, 298, 300],
    "skinner":    [490, 492, 495, 485, 487],
    "wildcat":    [509, 511, 516, 503, 505],
    "amalik":     [575, 579, 580, 619, 621],
    "threeforks": [653, 654, 665, 675, 690],
    "belva":      [772, 773, 771, 770, 774],
}

# Que camara prefiero (mas puntos = mejor) y como se llama en la ficha
def calificar(img):
    iid = img.get("imageid", "")
    inst = (img.get("camera") or {}).get("instrument", "")
    if iid.startswith(("ZL0", "ZR0")):
        return 30, "Mastcam-Z", "NASA/JPL-Caltech/ASU"
    if inst == "SHERLOC_WATSON" or iid.startswith("SI1"):
        return 20, "WATSON", "NASA/JPL-Caltech/MSSS"
    if inst.startswith("NAVCAM") or iid.startswith(("NLF", "NRF")):
        return 15, "Navcam", "NASA/JPL-Caltech"
    if inst.startswith("FRONT_HAZCAM") or iid.startswith(("FLF", "FRF")):
        return 0, "Hazcam", "NASA/JPL-Caltech"  # ojo de pez con el rover en medio: no se usa
    return 0, inst, "NASA/JPL-Caltech"


def fotos_del_sol(sol, sesion, paginas=8):
    """Todas las fotos completas de un sol (la API regresa de 100 en 100).
    Prueba dos formas de filtrar por sol, porque la API ha cambiado con los anos."""
    formas = [
        {"condition_2": f"{sol}:sol:gte", "condition_3": f"{sol}:sol:lte", "extended": "sample_type::full,"},
        {"sol": sol},
    ]
    for filtro in formas:
        todas = []
        for pag in range(paginas):
            params = {"feed": "raw_images", "category": "mars2020", "feedtype": "json",
                      "num": 100, "page": pag, "order": "sol desc", **filtro}
            r = sesion.get(API, params=params, timeout=40)
            r.raise_for_status()
            crudas = r.json().get("images", [])
            todas += [i for i in crudas if int(i.get("sol", -1)) == sol
                      and str(i.get("sample_type", "Full")).lower().startswith("full")]
            if len(crudas) < 100:
                break
            time.sleep(0.3)
        if todas:
            return todas
    return []


# Cuantas fotos maximo de cada camara por lugar
MAX_CAMARA = {"Mastcam-Z": 2, "WATSON": 1, "Navcam": 1}


def elegir(candidatas, cuantas):
    """Las mejores sin repetir escena: max 2 Mastcam-Z, 1 WATSON, 1 Navcam.
    Las fotos izquierda/derecha de Mastcam-Z son casi iguales (mismo reloj de la nave): solo una."""
    orden = sorted(candidatas, key=lambda c: (-c["puntos"], -c["area"]))
    salida, usadas, por_cam = [], set(), {}
    for c in orden:
        if len(salida) >= cuantas:
            break
        if c["puntos"] <= 0 or c["escena"] in usadas:
            continue
        if por_cam.get(c["camara"], 0) >= MAX_CAMARA.get(c["camara"], 1):
            continue
        salida.append(c); usadas.add(c["escena"]); por_cam[c["camara"]] = por_cam.get(c["camara"], 0) + 1
    return salida


def guardar(url, destino, sesion):
    r = sesion.get(url, timeout=60)
    r.raise_for_status()
    im = Image.open(io.BytesIO(r.content)).convert("RGB")
    im.thumbnail((800, 800))
    im.save(destino, "JPEG", quality=82, optimize=True)
    return im.size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zona", default="jezero")
    ap.add_argument("--por-lugar", type=int, default=3)
    ap.add_argument("--solo", default="", help="ids separados por coma")
    ap.add_argument("--url", action="append", default=[], help="id=URL de una foto elegida a mano")
    ap.add_argument("--quitar", action="append", default=[], help="id=numero de la foto a quitar (1, 2, 3)")
    ap.add_argument("--principal", action="append", default=[], help="id=numero de la foto que va primero")
    ap.add_argument("--lista", action="store_true", help="solo muestra que fotos tiene cada lugar")
    a = ap.parse_args()

    car = os.path.join(CARPETA_DATOS, a.zona)
    ruta_poi = os.path.join(car, "poi.json")
    pois = json.load(open(ruta_poi, encoding="utf-8"))
    os.makedirs(os.path.join(car, "fotos"), exist_ok=True)
    sesion = requests.Session()
    sesion.headers["User-Agent"] = "martian-map (NASA Space Apps 2026)"

    # Ver que hay
    if a.lista:
        for p in pois:
            print(p["id"])
            for k, f in enumerate(p.get("fotos", []), 1):
                print(f"   {k}. {f['archivo']}  {f['camara']} sol {f['sol']}")
        return

    # Quitar fotos que no gustaron
    for par in a.quitar:
        pid, n = par.split("=", 1)
        p = next((x for x in pois if x["id"] == pid), None)
        fotos = (p or {}).get("fotos", [])
        if not p or not n.isdigit() or not 1 <= int(n) <= len(fotos):
            print(f"No hay foto {n} en {pid}. Usa --lista para ver los numeros."); continue
        f = fotos.pop(int(n) - 1)
        try: os.remove(os.path.join(car, f["archivo"]))
        except OSError: pass
        print(f"{pid}: quitada {f['archivo']}")
    # La foto principal (la que sale primero en el mapa, en el 3D y en el casco)
    for par in a.principal:
        pid, n = par.split("=", 1)
        p = next((x for x in pois if x["id"] == pid), None)
        fotos = (p or {}).get("fotos", [])
        if not p or not n.isdigit() or not 1 <= int(n) <= len(fotos):
            print(f"No hay foto {n} en {pid}. Usa --lista para ver los numeros."); continue
        fotos.insert(0, fotos.pop(int(n) - 1))
        print(f"{pid}: principal -> {fotos[0]['archivo']}")
    if (a.quitar or a.principal) and not a.url:
        json.dump(pois, open(ruta_poi, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        return

    # Fotos elegidas a mano: se ponen primero
    for par in a.url:
        pid, url = par.split("=", 1)
        if not url.startswith("http") or "..." in url:
            print(f"'{url}' no es un enlace de imagen. Copia el enlace real (clic derecho en la foto > Copiar dirección de imagen).")
            continue
        p = next((x for x in pois if x["id"] == pid), None)
        if not p:
            print("No existe el lugar", pid); continue
        n = len(p.get("fotos", [])) + 1
        arch = f"fotos/{pid}_m{n}.jpg"
        guardar(url, os.path.join(car, arch), sesion)
        p["fotos"] = [{"archivo": arch, "camara": "Perseverance", "sol": p.get("sol"),
                       "credito": "NASA/JPL-Caltech", "url": url}] + p.get("fotos", [])
        print(f"{pid}: agregada a mano -> {arch}")

    solo = set(filter(None, a.solo.split(",")))
    for p in pois:
        if a.url or a.quitar or a.principal or (solo and p["id"] not in solo):
            continue
        soles = SOLES.get(p["id"], [p.get("sol")])
        candidatas = []
        for sol in soles:
            try:
                for img in fotos_del_sol(sol, sesion):
                    puntos, camara, credito = calificar(img)
                    f = img.get("image_files") or {}
                    url = f.get("large") or f.get("medium") or f.get("full_res")
                    if not url:
                        continue
                    ext = img.get("extended") or {}
                    dims = str(ext.get("dimension", "(0,0,0,0)")).strip("()").split(",")
                    try: w, h = int(dims[2]), int(dims[3])
                    except Exception: w = h = 0
                    if w and h and (w / h > 2 or h / w > 2):
                        continue  # tiras delgadas de panorama: en la ficha no se entienden
                    area = w * h
                    partes = img.get("imageid", "").split("_")
                    escena = partes[2][:8] if len(partes) > 2 else img.get("imageid", "")
                    candidatas.append({"puntos": puntos, "camara": camara, "credito": credito, "url": url,
                                       "full": f.get("full_res", url), "sol": sol, "area": area,
                                       "id": img.get("imageid", ""), "escena": escena})
            except Exception as e:
                print(f"  {p['id']} sol {sol}: error {e}")
            if sum(1 for c in candidatas if c["puntos"] >= 20) >= a.por_lugar:
                break
        elegidas = elegir(candidatas, a.por_lugar)
        if not elegidas:
            print(f"{p['id']}: sin fotos (revise soles {soles})")
            continue
        # borra las fotos anteriores de este lugar (las elegidas a mano, _m1.jpg..., se quedan)
        for viejo in os.listdir(os.path.join(car, "fotos")):
            if viejo.startswith(p["id"] + "_") and not viejo.startswith(p["id"] + "_m"):
                os.remove(os.path.join(car, "fotos", viejo))
        a_mano = [f for f in p.get("fotos", []) if "_m" in f["archivo"]]
        p["fotos"] = []
        for k, c in enumerate(elegidas, 1):
            arch = f"fotos/{p['id']}_{k}.jpg"
            try:
                tam = guardar(c["url"], os.path.join(car, arch), sesion)
            except Exception as e:
                print(f"  no se pudo bajar {c['url']}: {e}"); continue
            p["fotos"].append({"archivo": arch, "camara": c["camara"], "sol": c["sol"],
                               "credito": c["credito"], "url": c["full"], "imagen": c["id"]})
            print(f"{p['id']}: {arch}  {c['camara']} sol {c['sol']}  {tam[0]}x{tam[1]}")
        p["fotos"] = a_mano + p["fotos"]
        time.sleep(0.5)

    json.dump(pois, open(ruta_poi, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    total = sum(len(p.get("fotos", [])) for p in pois)
    print(f"\nListo: {total} fotos en {os.path.join(car, 'fotos')} y poi.json actualizado.")


if __name__ == "__main__":
    sys.exit(main())
