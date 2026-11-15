"""
evaluar_crateres.py
Mide que tan bien detectamos crateres, contra una "hoja de respuestas" marcada a mano.

1. Abre la pagina docs/etiquetar.html?zona=jezero (con el servidor local) y marca los crateres
   reales en las 15 fotos HiRISE que te muestra. Descarga el archivo y guardalo como
   docs/data/zonas/<zona>/verdad_crateres.json
2. python scripts/evaluar_crateres.py --zona jezero

Compara, SOLO dentro de las fotos marcadas:
  - YOLO original           (crateres_yolo.json, lo que da crateres.py)
  - YOLO + relieve          (crateres.json, despues de validar_crateres.py)
y para cada uno calcula:
  - precision: de lo que el detector marco, que % era de verdad un crater
  - recall:    de los crateres reales, que % encontro el detector
  - F1:        el promedio armonico de los dos (un solo numero para comparar)
  - error de diametro: cuanto se equivoca en el tamano de los que si acerto
Un crater detectado "acierta" si su centro esta a menos de medio diametro del real y el tamano
no difiere mas del doble. Solo cuentan crateres de D_MIN metros o mas (los muy chicos ni a mano son seguros).
Guarda el resultado en docs/data/zonas/<zona>/evaluacion_crateres.json
"""

import argparse
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
D_MIN = 5.0          # m
CONF_MIN = 0.5       # el mismo filtro que usa la pagina


def dentro(c, teselas, T):
    return any(t["x0"] <= c["x"] < t["x0"] + T and t["s0"] <= c["s"] < t["s0"] + T for t in teselas)


def emparejar(det, ver):
    """Empareja cada crater real con el detectado mas cercano que encaje (uno a uno)."""
    pares, usados = [], set()
    for v in sorted(ver, key=lambda c: -c["d"]):
        mejor, dmin = None, None
        for i, d in enumerate(det):
            if i in usados:
                continue
            dist = ((d["x"] - v["x"]) ** 2 + (d["s"] - v["s"]) ** 2) ** 0.5
            if dist <= 0.5 * max(d["d"], v["d"]) and max(d["d"], v["d"]) / min(d["d"], v["d"]) <= 2:
                if dmin is None or dist < dmin:
                    mejor, dmin = i, dist
        if mejor is not None:
            usados.add(mejor)
            pares.append((det[mejor], v))
    return pares


def evaluar(nombre, lista, verdad, teselas, T, filtro):
    det = [c for c in lista if filtro(c) and c["d"] >= D_MIN and dentro(c, teselas, T)]
    ver = [c for c in verdad if c["d"] >= D_MIN]
    pares = emparejar(det, ver)
    tp = len(pares)
    precision = tp / len(det) if det else 0.0
    recall = tp / len(ver) if ver else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    err = sum(abs(d["d"] - v["d"]) / v["d"] for d, v in pares) / tp if tp else 0.0
    r = {"detector": nombre, "detectados": len(det), "reales": len(ver), "aciertos": tp,
         "precision_pct": round(100 * precision, 1), "recall_pct": round(100 * recall, 1),
         "f1_pct": round(100 * f1, 1), "error_diametro_pct": round(100 * err, 1)}
    print(f"  {nombre:<22} precision {r['precision_pct']:5.1f}%  recall {r['recall_pct']:5.1f}%  "
          f"F1 {r['f1_pct']:5.1f}%  error de diametro {r['error_diametro_pct']:4.1f}%  "
          f"({tp} de {len(ver)} reales, {len(det)} detectados)")
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zona", default="jezero")
    a = ap.parse_args()
    carpeta = RAIZ / "docs" / "data" / "zonas" / a.zona
    v = json.loads((carpeta / "verdad_crateres.json").read_text(encoding="utf-8"))
    T, teselas, verdad = v["tesela_m"], v["teselas"], v["crateres"]
    print(f"Hoja de respuestas: {len(verdad)} crateres marcados en {len(teselas)} fotos de {T} m")

    resultados = []
    original = carpeta / "crateres_yolo.json"
    validado = carpeta / "crateres.json"
    if original.exists():
        lista = json.loads(original.read_text())["crateres"]
        resultados.append(evaluar("YOLO", lista, verdad, teselas, T, lambda c: c["conf"] >= CONF_MIN))
    if validado.exists():
        datos = json.loads(validado.read_text())
        lista = datos["crateres"] if isinstance(datos, dict) else datos
        resultados.append(evaluar("YOLO + relief check", lista, verdad, teselas, T,
                                  lambda c: c.get("relieve") != "rechazado" and c.get("conf", 1) >= CONF_MIN))
    (carpeta / "evaluacion_crateres.json").write_text(json.dumps(
        {"d_min_m": D_MIN, "conf_min": CONF_MIN, "teselas": len(teselas), "reales": len(verdad),
         "resultados": resultados}, indent=1), encoding="utf-8")
    print(f"Guardado en {carpeta / 'evaluacion_crateres.json'}")


if __name__ == "__main__":
    main()
