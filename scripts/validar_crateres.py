"""
validar_crateres.py
Segundo paso despues de crateres.py (YOLO): revisa cada crater con la ELEVACION y lo corrige.

YOLO mira la foto y propone cajas. Esto lo comprueba con el relieve, como pedir "huellas digitales":
  - Un crater es un hoyo con el borde levantado y redondo. Se mide la altura del fondo y la del
    borde en 12 direcciones (DEM HiRISE, un punto cada 2 m).
  - Se buscan el centro y el radio que mejor encajan con ese borde (la caja de YOLO es solo la pista),
    asi el diametro, el centro y la profundidad quedan medidos de verdad.
Cada crater queda con un campo "relieve":
  - "confirmado": el relieve dice que si es un hoyo redondo. Se corrigen x, s, d y prof; sube la confianza.
  - "rechazado":  el relieve lo CONTRADICE: el centro es una loma o mesa, o el "borde" es una ladera
                  (cambia mas de lado a lado de lo que baja el hoyo). Tipico del delta. Se le baja la
                  confianza (queda oculto con el filtro de 50%).
  - "solo_foto":  no se puede comprobar: muy chico para el DEM de 2 m (< 30 m), o un crater viejo
                  relleno de arena en terreno plano (casi no tiene hondo). Se deja como YOLO lo dio.
Ojo: un crater viejo y relleno es real aunque casi no tenga hondo; por eso "no confirmado" NO
significa "falso". Solo se rechaza cuando el relieve dice lo contrario.

Uso (desde la carpeta del repo, despues de crateres.py):
    python scripts/validar_crateres.py --zona jezero
La primera vez guarda una copia del resultado original de YOLO en crateres_yolo.json y
siempre parte de esa copia (se puede correr las veces que quieras). Solo necesita numpy.
"""

import argparse
import json
import shutil
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parent.parent

D_MIN_VERIFICABLE = 30.0  # m: debajo de esto el DEM de 2 m no alcanza a "sentir" el hoyo
DIRECCIONES = 12
# criterios (se probaron sobre crateres reales de Jezero: Belva y los de 100-300 m del piso)
DIR_MINIMAS = 11          # en cuantas de las 12 direcciones el borde debe estar mas alto que el fondo
PROF_MIN_M = 1.5          # m de profundidad minima
PROF_DIAM_MIN = 0.03      # profundidad / diametro (medida con promedios)
MINIMO_REL = 0.3          # el punto mas bajo del borde debe subir al menos 30% de la profundidad
DISP_MAX = 0.4            # que tan disparejo puede ser el borde (desviacion / profundidad)
RELIEVE_CONTRA = 3.0      # m: desnivel del borde (o loma en el centro) que contradice a YOLO
HUNDIDO_MIN = 0.5         # si menos de la mitad de lo de alrededor esta mas alto que el fondo, no es un hoyo
D_MIN_HUNDIDO = 60.0      # m: desde este tamano se puede revisar eso con el DEM de 2 m


def cargar_dem(carpeta):
    """DEM HiRISE completo de la zona (fila 0 = norte), un punto cada 2 m; CTX donde no hay HiRISE."""
    c = json.loads((carpeta / "cuadricula.json").read_text())
    ctx = np.array(c["elevacion"], dtype="f8").reshape(c["alto"], c["ancho"])
    ind_arch = carpeta / "hirise" / "indice.json"
    if not ind_arch.exists():
        return ctx, (c["celda_x"] + c["celda_y"]) / 2, 0.0
    ind = json.loads(ind_arch.read_text())
    n, paso, o = ind["muestras"] - 1, ind["paso_m"], ind["origen_m"]
    filas, cols = ind["ny"] * n + 1, ind["nx"] * n + 1
    yy = np.clip(((np.arange(filas) * paso + o) / c["celda_y"]).astype(int), 0, c["alto"] - 1)
    xx = np.clip(((np.arange(cols) * paso + o) / c["celda_x"]).astype(int), 0, c["ancho"] - 1)
    z = ctx[yy][:, xx].copy()
    for clave in ind["existentes"]:
        i, j = map(int, clave.split("_"))
        t = np.fromfile(carpeta / "hirise" / f"t_{clave}.bin", dtype="<u2").reshape(n + 1, n + 1)
        z[j * n:j * n + n + 1, i * n:i * n + n + 1] = ind["z_base"] + t / 10.0
    return z, paso, o


class Relieve:
    """Promedios de cuadros del DEM en tiempo constante (imagen integral)."""

    def __init__(self, z, paso, origen):
        self.z, self.paso, self.o = z, paso, origen
        self.S = np.pad(z, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
        self.f, self.c = z.shape

    def caja(self, fila, col, h):
        f0, f1 = int(max(fila - h, 0)), int(min(fila + h + 1, self.f))
        c0, c1 = int(max(col - h, 0)), int(min(col + h + 1, self.c))
        if f1 <= f0 or c1 <= c0:
            return np.nan
        S = self.S
        return (S[f1, c1] - S[f0, c1] - S[f1, c0] + S[f0, c0]) / ((f1 - f0) * (c1 - c0))

    def medir(self, x, s, r_m):
        """Mide un posible crater con centro (x, s) en metros y radio r_m. Regresa dict o None."""
        fila, col = (s - self.o) / self.paso, (x - self.o) / self.paso
        r = r_m / self.paso
        if fila - 1.8 * r < 0 or col - 1.8 * r < 0 or fila + 1.8 * r >= self.f or col + 1.8 * r >= self.c:
            return None  # pegado a la orilla del DEM
        fondo = self.caja(fila, col, max(1, round(r * 0.35)))
        fondo_centro = self.caja(fila, col, max(1, round(r * 0.15)))
        hb = max(1, round(r * 0.15))
        borde = np.array([self.caja(fila + r * np.sin(a), col + r * np.cos(a), hb)
                          for a in np.linspace(0, 2 * np.pi, DIRECCIONES, endpoint=False)])
        afuera = np.mean([self.caja(fila + 1.7 * r * np.sin(a), col + 1.7 * r * np.cos(a), hb)
                          for a in np.linspace(0, 2 * np.pi, 8, endpoint=False)])
        prof = borde.mean() - fondo
        if not np.isfinite(prof):
            return None
        desnivel = float(borde.std())  # m: cuanto cambia la altura del borde de un lado a otro
        if prof <= 0:
            return {"ok": False, "prof": float(prof), "desnivel": desnivel, "puntaje": -1}
        m = {
            "desnivel": desnivel,
            "prof": float(prof),
            "prof_centro": float(borde.mean() - fondo_centro),
            "razon": float(prof / (2 * r_m)),
            "cuenta": int((borde > fondo).sum()),
            "minimo": float((borde - fondo).min() / prof),
            "disp": float(borde.std() / prof),
            "afuera": float((borde.mean() - afuera) / prof),
        }
        lim_afuera = -0.3 if r_m < 75 else -0.6
        m["ok"] = (m["cuenta"] >= DIR_MINIMAS and prof >= PROF_MIN_M and m["razon"] >= PROF_DIAM_MIN
                   and m["minimo"] >= MINIMO_REL and m["disp"] <= DISP_MAX and m["afuera"] >= lim_afuera)
        # puntaje para escoger el mejor centro/radio: hondo, parejo y cerrado
        m["puntaje"] = m["razon"] * max(m["minimo"], 0) * max(1 - m["disp"], 0)
        return m


def fraccion_hundido(rel, x, s, d):
    """Que fraccion del terreno de alrededor (a 1.6 radios, 16 direcciones) esta MAS ALTO que el fondo.
    Un crater (aunque este relleno y casi plano) es una depresion: casi todo lo de alrededor esta mas alto.
    La cima de una mesa o una loma da menos de la mitad."""
    r = d / 2 / rel.paso
    fila, col = (s - rel.o) / rel.paso, (x - rel.o) / rel.paso
    fondo = rel.caja(fila, col, max(1, round(r * 0.35)))
    alrededor = np.array([rel.caja(fila + 1.6 * r * np.sin(a), col + 1.6 * r * np.cos(a), max(1, round(r * 0.2)))
                          for a in np.linspace(0, 2 * np.pi, 16, endpoint=False)])
    alrededor = alrededor[np.isfinite(alrededor)]
    if not np.isfinite(fondo) or len(alrededor) < 8:
        return None
    return float((alrededor > fondo).mean())


def ajustar(rel, c):
    """Busca el centro y el radio que mejor encajan alrededor de la caja de YOLO."""
    r0 = c["d"] / 2
    mejor, mejor_m = None, None
    pasos_c = np.linspace(-0.3, 0.3, 7) * r0
    for fr in (0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.35):
        r = r0 * fr
        for dy in pasos_c:
            for dx in pasos_c:
                m = rel.medir(c["x"] + dx, c["s"] + dy, r)
                if m is None or m["puntaje"] <= 0:
                    continue
                # a igualdad, se prefieren los que pasan todos los criterios
                clave = (m["ok"], m["puntaje"])
                if mejor is None or clave > mejor:
                    mejor, mejor_m = clave, dict(m, x=c["x"] + dx, s=c["s"] + dy, r=r)
    return mejor_m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zona", default="jezero")
    args = ap.parse_args()
    carpeta = RAIZ / "docs" / "data" / "zonas" / args.zona
    salida = carpeta / "crateres.json"
    original = carpeta / "crateres_yolo.json"
    if not original.exists():
        shutil.copy(salida, original)
        print(f"Copia del resultado original de YOLO: {original.name}")
    datos = json.loads(original.read_text())
    info = json.loads((carpeta / "info.json").read_text())

    z, paso, o = cargar_dem(carpeta)
    rel = Relieve(z, paso, o)
    print(f"DEM: {z.shape[1]} x {z.shape[0]} puntos cada {paso} m")

    cuenta = {"confirmado": 0, "rechazado": 0, "solo_foto": 0}
    for c in datos["crateres"]:
        c["d_yolo"], c["conf_yolo"] = c["d"], c["conf"]
        c["prof_medible"] = False
        if c["d"] < D_MIN_VERIFICABLE:
            # el DEM de 2 m no alcanza: la profundidad que traiga no es confiable
            c["relieve"] = "solo_foto"
            c["prof"] = None
            cuenta["solo_foto"] += 1
            continue
        m = ajustar(rel, c)
        m0 = rel.medir(c["x"], c["s"], c["d"] / 2)  # tal cual lo dio YOLO
        if m is not None and m["ok"]:
            # 1) CONFIRMADO: hoyo redondo claro. Se corrigen centro, diametro y profundidad.
            c["relieve"] = "confirmado"
            c["x"], c["s"], c["d"] = round(m["x"], 1), round(m["s"], 1), round(2 * m["r"], 1)
            c["prof"] = round(m["prof_centro"], 1)
            c["prof_medible"] = True
            c["conf"] = round(min(0.99, 0.5 + 0.5 * c["conf"]), 2)
            c["lon"] = round(info["oeste"] + c["x"] / info["ancho_m"] * (info["este"] - info["oeste"]), 6)
            c["lat"] = round(info["norte"] - c["s"] / info["alto_m"] * (info["norte"] - info["sur"]), 6)
        elif m0 is not None and (m0["prof"] < -RELIEVE_CONTRA or
                                 (m0["desnivel"] > RELIEVE_CONTRA and m0["desnivel"] > 0.8 * abs(m0["prof"]))):
            # 2) RECHAZADO: el relieve lo contradice. O el centro esta claramente MAS ALTO que el borde
            #    (mesa, loma), o el "borde" es en realidad una ladera: de un lado a otro cambia mas
            #    de lo que el hoyo baja. Es lo tipico de los circulos falsos en el delta.
            c["relieve"] = "rechazado"
            c["conf"] = round(c["conf"] * 0.3, 2)
            c["prof"] = None
        elif c["d"] >= D_MIN_HUNDIDO and (fh := fraccion_hundido(rel, c["x"], c["s"], c["d"])) is not None \
                and fh < HUNDIDO_MIN:
            # 2b) RECHAZADO: el "fondo" no esta hundido respecto a lo de alrededor (cima de mesa o loma)
            c["relieve"] = "rechazado"
            c["conf"] = round(c["conf"] * 0.3, 2)
            c["prof"] = None
        else:
            # 3) Sin confirmar: el terreno es plano y el hoyo es muy poco hondo (crateres viejos
            #    rellenos de arena, muy comunes en el piso de Jezero). La foto manda; se deja como YOLO.
            c["relieve"] = "solo_foto"
            if m0 is not None and m0.get("prof_centro", 0) > 0.3:
                c["prof"] = round(m0["prof_centro"], 1)   # hondo medido con el DEM (poco, pero real)
                c["prof_medible"] = True
            else:
                c["prof"] = None
        cuenta[c["relieve"]] += 1

    datos["validacion"] = {
        "metodo": "DEM rim test (12 directions) + center/radius refit, HiRISE DEM 2 m",
        "d_min_verificable_m": D_MIN_VERIFICABLE, "cuenta": cuenta,
    }
    salida.write_text(json.dumps(datos, separators=(",", ":")))
    vis = [c for c in datos["crateres"] if c["conf"] >= 0.5]
    print(f"Listo: {cuenta}")
    print(f"Con el filtro de 50%: {len(vis)} crateres (antes {sum(c['conf_yolo'] >= 0.5 for c in datos['crateres'])})")


if __name__ == "__main__":
    main()
