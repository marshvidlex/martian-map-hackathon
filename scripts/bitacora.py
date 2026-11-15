"""bitacora.py - pasa los recorridos exportados del navegador al repositorio.

La bitacora (docs/js/bitacora.js) guarda los recorridos del visor en el navegador.
Para compartirlos: en la consola del navegador Bitacora.descargar(), y luego

    python scripts/bitacora.py agregar ~/Downloads/bitacora-jezero-20261115-0830.json
    git add docs/data/zonas && git commit -m "Bitacora: nuevos recorridos" && git push

Cada recorrido va a docs/data/zonas/<zona>/bitacora.json segun su campo "zona".

Comandos:
    agregar ARCHIVO [--solo-completos] [--sin-muestras]   agrega (no duplica por id)
    ver [--zona Z]                                        lista lo que hay en el repo
    quitar ID [--zona Z]                                  quita un recorrido
    csv [--zona Z] [--salida tabla.csv]                   tabla resumen (un renglon por recorrido)

Solo usa la biblioteca estandar.
"""

import argparse
import csv
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ZONAS = RAIZ / "docs" / "data" / "zonas"
FORMATO = "martian-map-bitacora"
TIPOS = {"eva", "rover"}
ESTADOS = {"en_curso", "completado", "abortado", "interrumpido"}
SOLO_NAVEGADOR = ("origen", "en_repo")  # se calculan al cargar, no se guardan en el repo

COLUMNAS = ["id", "zona", "tipo", "estado", "inicio", "fin", "tiempo_h", "distancia_m", "avance_pct",
            "tiempo_caminando_h", "tiempo_trabajo_h", "velocidad_media_kmh", "elev_min_m", "elev_max_m",
            "subida_m", "bajada_m", "pendiente_max_deg", "oxigeno_usado_pct", "dosis_mSv", "sol_inicio",
            "sol_fin", "paradas_visitadas", "avisos_pendiente", "avisos_rugosidad", "avisos_crater",
            "nombre", "notas", "etiquetas"]


def error(msg):
    print("Error:", msg, file=sys.stderr)
    sys.exit(1)


def zonas_existentes():
    return sorted(p.name for p in ZONAS.iterdir() if p.is_dir()) if ZONAS.exists() else []


def archivo_zona(zona):
    return ZONAS / zona / "bitacora.json"


def leer_zona(zona):
    ruta = archivo_zona(zona)
    if not ruta.exists():
        return {"formato": FORMATO, "version": 1, "zona": zona, "recorridos": []}
    with open(ruta, encoding="utf-8") as f:
        datos = json.load(f)
    datos.setdefault("recorridos", [])
    return datos


def escribir_zona(zona, datos):
    datos["recorridos"].sort(key=lambda r: r.get("inicio") or "")
    with open(archivo_zona(zona), "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=1)
        f.write("\n")


def validar(r):
    """Devuelve None si el recorrido sirve, o el motivo por el que no."""
    if not isinstance(r, dict):
        return "no es un objeto"
    for campo in ("id", "zona", "tipo", "estado", "inicio"):
        if not r.get(campo):
            return f"falta '{campo}'"
    if r["tipo"] not in TIPOS:
        return f"tipo desconocido '{r['tipo']}'"
    if r["estado"] not in ESTADOS:
        return f"estado desconocido '{r['estado']}'"
    if r["zona"] not in zonas_existentes():
        return f"la zona '{r['zona']}' no existe en docs/data/zonas"
    return None


def cmd_agregar(args):
    try:
        with open(args.archivo, encoding="utf-8") as f:
            datos = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        error(f"no se pudo leer {args.archivo}: {e}")
    lista = datos if isinstance(datos, list) else datos.get("recorridos") if isinstance(datos, dict) else None
    if not isinstance(lista, list):
        error("el archivo no tiene una lista 'recorridos' (se exporta con Bitacora.descargar())")

    por_zona, saltados = {}, 0
    for r in lista:
        motivo = validar(r)
        if motivo:
            print(f"  se salta {r.get('id', '?') if isinstance(r, dict) else '?'}: {motivo}")
            saltados += 1
            continue
        if args.solo_completos and r["estado"] != "completado":
            saltados += 1
            continue
        r = {k: v for k, v in r.items() if k not in SOLO_NAVEGADOR}
        if r["estado"] == "en_curso":
            r["estado"] = "interrumpido"
        if args.sin_muestras:
            r["muestras"] = []
        por_zona.setdefault(r["zona"], []).append(r)

    nuevos = repetidos = 0
    for zona, recorridos in por_zona.items():
        datos_zona = leer_zona(zona)
        ids = {r["id"] for r in datos_zona["recorridos"]}
        agregados = 0
        for r in recorridos:
            if r["id"] in ids:
                repetidos += 1
                continue
            datos_zona["recorridos"].append(r)
            ids.add(r["id"])
            agregados += 1
        if agregados:
            escribir_zona(zona, datos_zona)
        nuevos += agregados
        print(f"{zona}: {agregados} nuevos -> {archivo_zona(zona).relative_to(RAIZ)}")
    print(f"Listo: {nuevos} agregados, {repetidos} ya estaban, {saltados} saltados.")


def zonas_pedidas(zona):
    if zona:
        if zona not in zonas_existentes():
            error(f"la zona '{zona}' no existe")
        return [zona]
    return zonas_existentes()


def cmd_ver(args):
    total = 0
    for zona in zonas_pedidas(args.zona):
        recorridos = leer_zona(zona)["recorridos"]
        if not recorridos:
            continue
        print(f"\n{zona} ({len(recorridos)})")
        for r in recorridos:
            km = (r.get("distancia_m") or 0) / 1000
            h = r.get("tiempo_h") or 0
            nombre = f"  {r['nombre']}" if r.get("nombre") else ""
            print(f"  {r['id']}  {r['tipo']:5} {r['estado']:12} {km:6.2f} km {h:6.2f} h  "
                  f"{(r.get('inicio') or '')[:16]}{nombre}")
        total += len(recorridos)
    if not total:
        print("No hay recorridos en el repositorio.")


def cmd_quitar(args):
    for zona in zonas_pedidas(args.zona):
        datos = leer_zona(zona)
        antes = len(datos["recorridos"])
        datos["recorridos"] = [r for r in datos["recorridos"] if r.get("id") != args.id]
        if len(datos["recorridos"]) < antes:
            escribir_zona(zona, datos)
            print(f"Quitado {args.id} de {zona}.")
            return
    error(f"no se encontro {args.id}")


def cmd_csv(args):
    filas = []
    for zona in zonas_pedidas(args.zona):
        for r in leer_zona(zona)["recorridos"]:
            avisos = r.get("avisos") or {}
            fila = {}
            for c in COLUMNAS:
                v = avisos.get(c[7:]) if c.startswith("avisos_") else r.get(c)
                fila[c] = ";".join(map(str, v)) if isinstance(v, list) else v
            filas.append(fila)
    salida = open(args.salida, "w", newline="", encoding="utf-8") if args.salida else sys.stdout
    escritor = csv.DictWriter(salida, fieldnames=COLUMNAS)
    escritor.writeheader()
    escritor.writerows(filas)
    if args.salida:
        salida.close()
        print(f"{len(filas)} recorridos -> {args.salida}")


def main():
    p = argparse.ArgumentParser(description="Bitacora de recorridos de Martian Map")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("agregar", help="agrega un JSON exportado del navegador")
    a.add_argument("archivo")
    a.add_argument("--solo-completos", action="store_true", help="solo recorridos completados")
    a.add_argument("--sin-muestras", action="store_true", help="no guarda las muestras (archivo mas chico)")
    v = sub.add_parser("ver", help="lista los recorridos del repo")
    v.add_argument("--zona")
    q = sub.add_parser("quitar", help="quita un recorrido por id")
    q.add_argument("id")
    q.add_argument("--zona")
    c = sub.add_parser("csv", help="tabla resumen en CSV")
    c.add_argument("--zona")
    c.add_argument("--salida")
    args = p.parse_args()
    {"agregar": cmd_agregar, "ver": cmd_ver, "quitar": cmd_quitar, "csv": cmd_csv}[args.cmd](args)


if __name__ == "__main__":
    main()
