"""
ciencia_gale.py
Objetivos cientificos y lugares reales de Curiosity para la zona Gale (docs/data/zonas/gale/).

Igual que en Jezero, cada lugar va donde estaba el rover el sol (dia marciano) en que lo estudio.
Las posiciones salen de los puntos de recorrido de Curiosity que publica NASA/JPL (MMGIS):
    https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json
Si no hay internet, usa posiciones aproximadas (medidas desde Bradbury Landing) y lo avisa.
Solo se guardan los lugares que caen dentro del mapa de la zona (info.json).

Uso (desde la carpeta raiz martian-map):
    python scripts/ciencia_gale.py
    python scripts/descargar_fotos_rover.py --zona gale
"""
import json, math, os, sys
import requests

ZONA = os.path.join("docs", "data", "zonas", "gale")
URLS = [
    "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json",
    "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json",
]
BRADBURY = (-4.5895, 137.4417)  # lat, lon del aterrizaje (NASA/JPL)
VASAVADA = "https://doi.org/10.1002/2014JE004622"  # Vasavada et al. 2014, de Bradbury a Yellowknife Bay
YKB = "https://en.wikipedia.org/wiki/Yellowknife_Bay,_Mars"

OBJETIVOS = [
    {"id": "lago", "color": "#3DDC84",
     "en": {"titulo": "Was Gale a habitable lake?", "desc": "Drill the Yellowknife Bay mudstone, where Curiosity found the first proof that Mars once had water good for microbes."},
     "es": {"titulo": "¿Gale fue un lago habitable?", "desc": "Perforar la lodolita de Yellowknife Bay, donde Curiosity encontró la primera prueba de que Marte tuvo agua buena para microbios."},
     "fuente": VASAVADA},
    {"id": "rio", "color": "#4FD1E8",
     "en": {"titulo": "Follow the ancient streams", "desc": "Visit the rounded pebbles and cross-bedded sandstone left by rivers that flowed into the crater."},
     "es": {"titulo": "Seguir los ríos antiguos", "desc": "Visitar las piedras redondeadas y la arenisca en capas cruzadas que dejaron ríos que entraban al cráter."},
     "fuente": VASAVADA},
    {"id": "suelo", "color": "#FFB547",
     "en": {"titulo": "Test today's soil and dust", "desc": "Scoop the wind-blown sand and check the landing area: useful for the habitat, water extraction and dust in the suits."},
     "es": {"titulo": "Probar el suelo y el polvo de hoy", "desc": "Recoger arena que trajo el viento y revisar la zona de aterrizaje: sirve para el hábitat, sacar agua y el polvo en los trajes."},
     "fuente": YKB},
]

# id, objetivo, sol de la posicion, soles para fotos, (este_m, norte_m) aproximado desde Bradbury, textos
LUGARES = [
    ("bradbury", "suelo", 0, [1, 2, 3, 13], (0, 0), "Bradbury Landing · Goulburn",
     {"que": "Where Curiosity landed on 6 Aug 2012. The landing rockets blew away the soil at Goulburn and exposed the bedrock underneath: a free look below the dust.",
      "inst": "Context photos, hand lens", "muestra": "No"},
     {"que": "Donde aterrizó Curiosity el 6 de agosto de 2012. Los cohetes de aterrizaje barrieron el suelo en Goulburn y dejaron ver la roca de abajo: una mirada gratis debajo del polvo.",
      "inst": "Fotos de contexto, lupa", "muestra": "No"}, VASAVADA),
    ("link", "rio", 27, [27, 28, 26], (95, 15), "Link",
     {"que": "Conglomerate with rounded pebbles stuck together. Pebbles only get round by rolling in water: proof of an old stream, about ankle to hip deep.",
      "inst": "Close-up imaging, laser chemistry (like ChemCam)", "muestra": "No"},
     {"que": "Conglomerado con piedras redondeadas pegadas. Las piedras solo se redondean rodando en agua: prueba de un arroyo antiguo, de la profundidad del tobillo a la cadera.",
      "inst": "Fotos de cerca, química por láser (como ChemCam)", "muestra": "No"}, VASAVADA),
    ("hottah", "rio", 39, [39, 40, 41], (200, -15), "Hottah",
     {"que": "A tilted slab of ancient streambed gravel. Together with Link it was the first evidence of flowing water seen by Curiosity.",
      "inst": "Close-up imaging, X-ray chemistry (like APXS)", "muestra": "No"},
     {"que": "Una losa inclinada de grava de un antiguo cauce. Junto con Link fue la primera prueba de agua corriendo que vio Curiosity.",
      "inst": "Fotos de cerca, química por rayos X (como APXS)", "muestra": "No"}, VASAVADA),
    ("rocknest", "suelo", 60, [58, 61, 69, 74, 84], (400, 150), "Rocknest",
     {"que": "A drift of wind-blown sand where Curiosity used its scoop for the first time. First X-ray diffraction of Martian soil (17 Oct 2012). Heating the soil released water.",
      "inst": "Scoop, X-ray diffraction (like CheMin), oven analysis (like SAM)", "muestra": "Soil scoop"},
     {"que": "Un montón de arena traída por el viento donde Curiosity usó su pala por primera vez. Primera difracción de rayos X de suelo marciano (17 de octubre de 2012). Al calentar el suelo salió agua.",
      "inst": "Pala, difracción de rayos X (como CheMin), horno de análisis (como SAM)", "muestra": "Pala de suelo"}, YKB),
    ("shaler", "rio", 120, [120, 121, 316, 317], (445, 185), "Shaler",
     {"que": "Sandstone with cross-bedding: tilted layers that form when water flows over sand. Shows the direction the ancient river ran.",
      "inst": "Panoramic and close-up imaging", "muestra": "No"},
     {"que": "Arenisca con capas cruzadas: capas inclinadas que se forman cuando el agua corre sobre la arena. Muestra hacia dónde corría el río antiguo.",
      "inst": "Fotos panorámicas y de cerca", "muestra": "No"}, YKB),
    # John Klein y Cumberland estan a 3 m: van como un solo lugar (dos paradas tan juntas se encimarian)
    ("johnklein", "lago", 182, [182, 279, 180, 275, 170], (470, 150), "John Klein & Cumberland · Yellowknife Bay",
     {"que": "The first two rocks ever drilled on Mars, 3 m apart. Sheepbed mudstone from an old lake with clay minerals: NASA announced in March 2013 that conditions here were once suitable for microbial life. Cumberland also gave the first rock age measured on another planet (about 4 billion years).",
      "inst": "Drill, X-ray diffraction (like CheMin), oven analysis (like SAM)", "muestra": "Drilled powder"},
     {"que": "Las dos primeras rocas perforadas en Marte, a 3 m una de otra. Lodolita Sheepbed de un lago antiguo, con arcillas: NASA anunció en marzo de 2013 que aquí hubo condiciones aptas para vida microbiana. Cumberland además dio la primera edad de una roca medida en otro planeta (unos 4 mil millones de años).",
      "inst": "Taladro, difracción de rayos X (como CheMin), horno de análisis (como SAM)", "muestra": "Polvo de perforación"}, YKB),
    ("darwin", "rio", 395, [393, 395, 396, 400], (-1500, -1700), "Darwin waypoint",
     {"que": "First stop on the drive to Mount Sharp: pebbly sandstone from streams, studied to compare with Yellowknife Bay.",
      "inst": "Close-up imaging, X-ray chemistry (like APXS)", "muestra": "No"},
     {"que": "Primera parada del camino al Monte Sharp: arenisca con piedras de arroyo, estudiada para compararla con Yellowknife Bay.",
      "inst": "Fotos de cerca, química por rayos X (como APXS)", "muestra": "No"}, VASAVADA),
]


def posiciones_nasa():
    """{sol: (lat, lon)} con la ultima posicion de cada sol."""
    for url in URLS:
        try:
            r = requests.get(url, timeout=60, headers={"User-Agent": "martian-map (NASA Space Apps 2026)"})
            r.raise_for_status()
            datos = r.json()
        except Exception as e:
            print(f"  no se pudo leer {url}: {e}")
            continue
        por_sol = {}
        for f in datos.get("features", []):
            pr, g = f.get("properties", {}), f.get("geometry") or {}
            sol = pr.get("sol", pr.get("SOL"))
            if sol is None:
                continue
            if g.get("type") == "Point":
                lon, lat = g["coordinates"][:2]
            elif g.get("type") == "LineString" and g["coordinates"]:
                lon, lat = g["coordinates"][-1][:2]
            elif g.get("type") == "MultiLineString" and g["coordinates"]:
                lon, lat = g["coordinates"][-1][-1][:2]
            else:
                continue
            por_sol[int(sol)] = (lat, lon)
        if por_sol:
            json.dump(datos, open(os.path.join(ZONA, "MSL_traverse.json"), "w"))
            print(f"Recorrido de Curiosity: {len(por_sol)} soles ({url})")
            return por_sol
    return {}


def en_sol(por_sol, sol):
    antes = [s for s in por_sol if s <= sol]
    return por_sol[max(antes)] if antes else por_sol[min(por_sol)]


def main():
    info = json.load(open(os.path.join(ZONA, "info.json"), encoding="utf-8"))
    por_sol = posiciones_nasa()
    if not por_sol:
        print("AVISO: sin datos de NASA, se usan posiciones aproximadas. Vuelve a correrlo con internet.")
    m_lat = 1 / 59274.0  # grados por metro en Marte
    m_lon = m_lat / math.cos(math.radians(BRADBURY[0]))

    viejos = {}
    try:  # conservar fotos ya descargadas
        viejos = {p["id"]: p for p in json.load(open(os.path.join(ZONA, "poi.json"), encoding="utf-8"))}
    except Exception:
        pass

    salida = []
    for pid, obj, sol, soles, (este, norte), nombre, en, es, fuente in LUGARES:
        if por_sol:
            lat, lon = en_sol(por_sol, sol)
            ubic = f"Curiosity position on sol {sol} (NASA/JPL MSL waypoints)"
        else:
            lat, lon = BRADBURY[0] + norte * m_lat, BRADBURY[1] + este * m_lon
            ubic = "approximate (offset from Bradbury Landing)"
        if lon > 180:
            lon -= 360
        dentro = info["sur"] <= lat <= info["norte"] and info["oeste"] <= lon <= info["este"]
        print(f"{pid:11s} sol {sol:4d}  {lat:.5f}, {lon:.5f}  {'ok' if dentro else 'FUERA del mapa, no se usa'}")
        if not dentro:
            continue
        p = {"id": pid, "nombre": nombre, "lat": round(lat, 6), "lon": round(lon, 6), "objetivo": obj,
             "tipo": "landing" if pid == "bradbury" else "ciencia", "sol": sol, "rover": "Curiosity",
             "mision": "msl", "soles_fotos": soles,
             "que_estudiar": en["que"], "instrumento": en["inst"], "muestra": en["muestra"],
             "en": en, "es": es, "fuente": fuente, "ubicacion": ubic}
        if pid in viejos and viejos[pid].get("fotos"):
            p["fotos"] = viejos[pid]["fotos"]
        salida.append(p)

    json.dump(salida, open(os.path.join(ZONA, "poi.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    usados = {p["objetivo"] for p in salida}
    json.dump([o for o in OBJETIVOS if o["id"] in usados], open(os.path.join(ZONA, "ciencia.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"\nListo: {len(salida)} lugares y {len(usados)} objetivos en {ZONA}")
    print("Siguiente: python scripts/descargar_fotos_rover.py --zona gale")


if __name__ == "__main__":
    sys.exit(main())
