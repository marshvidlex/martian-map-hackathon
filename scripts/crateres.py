"""
crateres.py
Detecta los crateres de una zona con el modelo YOLO entrenado (best.pt) y guarda
docs/data/zonas/<zona>/crateres.json, que usan el mapa 2D, la Mesa 3D y el casco.

    python scripts/crateres.py --zona jezero
    python scripts/crateres.py --zona jezero --modelo ruta/a/best.pt --debug

El modelo (YOLOv8n, una clase "Crater", entrenado a 640 px) se probo tal cual sobre nuestras
imagenes y tenia dos problemas: no veia los crateres chicos (5-10 px) y marcaba cajas grandes
sobre terreno irregular o mesas brillantes. Para que sea mas preciso en NUESTRAS imagenes:

 1. Dos fuentes con resolucion distinta:
      - foto CTX de toda la zona (~6 m/px)       -> crateres grandes (~40 m a 1.5 km)
      - fotos HiRISE de 250 m (~0.5 m/px)          -> crateres chicos (~4 m a 120 m)
 2. Inferencia por rebanadas (estilo SAHI): la imagen se corta en ventanas con traslape y cada
    ventana se agranda a 640 px, el tamano con el que se entreno. Asi los crateres chicos
    quedan del tamano que el modelo conoce. Se corre a varias escalas.
 3. Contraste: CLAHE sobre la imagen en gris. Las fotos de Marte tienen poco contraste y el
    dataset de entrenamiento venia normalizado; se corre con y sin CLAHE y se juntan los votos.
 4. TTA (augment=True de ultralytics: volteo + escalas) en cada ventana.
 5. Filtros de forma: los crateres son redondos (relacion ancho/alto 0.6-1.6) y las cajas que
    tocan la orilla de una ventana estan cortadas (se descartan; la ventana vecina las ve completas).
 6. Fusion de cajas en metros (no en pixeles): las detecciones de todas las ventanas, escalas y
    fuentes que caen en el mismo crater se juntan en una sola, con centro y diametro promedio
    pesado por la confianza. Mas votos independientes = mas confianza.
 7. Textura: en campos de dunas el modelo confunde los valles con crateres. Se mide la coherencia
    del tensor de estructura alrededor (dunas > 0.55, terreno con crateres ~0.2-0.4) y se castiga.
 8. Validacion con el relieve: un crater es un hoyo. Con el DEM HiRISE (2 m) o el CTX (20 m) se
    mide la profundidad (borde - fondo). Si el centro esta MAS ALTO que el borde (mesa, roca,
    duna) se descarta; si es un hoyo claro se sube la confianza.
"""

import argparse
import json
import math
import time
from pathlib import Path

import cv2
import numpy as np

RAIZ = Path(__file__).resolve().parent.parent
TAM = 640            # tamano de entrada con el que se entreno el modelo
CONF_MIN_MODELO = 0.08   # umbral bajo en cada ventana: se filtra despues con votos y relieve
CONF_FINAL = 0.25        # confianza minima que se guarda en el json
IOU_NMS = 0.5


# ---------------------------------------------------------------- imagen
def preparar(img_gris, clahe):
    """Gris -> BGR de 3 canales (el modelo espera 3). Con CLAHE opcional."""
    if clahe:
        img_gris = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(img_gris)
    return cv2.cvtColor(img_gris, cv2.COLOR_GRAY2BGR)


def ventanas(alto, ancho, lado, traslape):
    """Posiciones (y0, x0) de ventanas cuadradas de 'lado' px con traslape, cubriendo todo."""
    paso = max(1, int(lado * (1 - traslape)))
    ys = list(range(0, max(1, alto - lado + 1), paso))
    xs = list(range(0, max(1, ancho - lado + 1), paso))
    if ys[-1] + lado < alto:
        ys.append(max(0, alto - lado))
    if xs[-1] + lado < ancho:
        xs.append(max(0, ancho - lado))
    return [(y, x) for y in ys for x in xs]


def dispositivo():
    import torch
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


DISPOSITIVO = None
LOTE = 16


def detectar_en_imagen(modelo, gris, escalas, nodata=None):
    """
    Corre el modelo sobre ventanas de varios tamanos. 'escalas' es una lista de
    (lado_px, [(y0, x0), ...]); cada ventana se reescala a 640 (el tamano de entrenamiento).
    Cada combinacion (CLAHE si/no, escala) es un "pase" independiente para contar votos.
    Regresa cajas en px de la imagen: [cx, cy, w, h, conf, pase] y el numero de pases.
    """
    H, W = gris.shape
    salida = []
    trabajos = []  # (entrada_640, y0, x0, lado, pase)
    pase = 0
    for clahe in (False, True):
        img = preparar(gris, clahe)
        for lado, posiciones in escalas:
            lado = min(lado, H, W)
            for (y0, x0) in posiciones:
                y0, x0 = min(y0, H - lado), min(x0, W - lado)
                if nodata is not None and nodata[y0:y0 + lado, x0:x0 + lado].mean() > 0.6:
                    continue
                recorte = img[y0:y0 + lado, x0:x0 + lado]
                entrada = cv2.resize(recorte, (TAM, TAM), interpolation=cv2.INTER_CUBIC if lado < TAM else cv2.INTER_AREA)
                trabajos.append((entrada, y0, x0, lado, pase))
            pase += 1

    for k in range(0, len(trabajos), LOTE):
        grupo = trabajos[k:k + LOTE]
        resultados = modelo.predict([g[0] for g in grupo], imgsz=TAM, conf=CONF_MIN_MODELO, iou=IOU_NMS,
                                    augment=True, verbose=False, max_det=300, device=DISPOSITIVO)
        for (_, y0, x0, lado, p), r in zip(grupo, resultados):
            if not len(r.boxes):
                continue
            esc = lado / TAM
            for (x1, y1, x2, y2), c in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.conf.cpu().numpy()):
                # caja cortada por la orilla de la ventana (si la orilla no es la de la imagen)
                m = 3
                if (x1 < m and x0 > 0) or (y1 < m and y0 > 0) or \
                   (x2 > TAM - m and x0 + lado < W) or (y2 > TAM - m and y0 + lado < H):
                    continue
                w, h = (x2 - x1) * esc, (y2 - y1) * esc
                if w < 4 or h < 4:          # menos de 4 px no se puede confirmar
                    continue
                if not 0.6 <= w / h <= 1.6:  # los crateres son redondos
                    continue
                if w > 0.8 * lado or h > 0.8 * lado:  # caja que llena la ventana: casi siempre es terreno
                    continue
                cx, cy = x0 + (x1 + x2) / 2 * esc, y0 + (y1 + y2) / 2 * esc
                salida.append([cx, cy, w, h, float(c), p])
    return salida, pase


# ---------------------------------------------------------------- relieve
class Relieve:
    """Altura en metros en cualquier punto (x = m al este, s = m al sur desde el borde norte)."""

    def __init__(self, carpeta, info, cuad):
        self.cuad = cuad
        self.ctx = np.array(cuad["elevacion"], dtype=np.float32).reshape(cuad["alto"], cuad["ancho"])
        self.ctx[self.ctx < -99999] = np.nan
        self.hi = None
        ind_ruta = carpeta / "hirise" / "indice.json"
        if ind_ruta.exists():
            ind = json.loads(ind_ruta.read_text())
            T, paso, n, o = ind["tesela_m"], ind["paso_m"], ind["muestras"], ind["origen_m"]
            por = int(round(T / paso))                 # muestras por tesela sin el traslape
            mosaico = np.full((ind["ny"] * por + 1, ind["nx"] * por + 1), np.nan, dtype=np.float32)
            for clave in ind["existentes"]:
                i, j = map(int, clave.split("_"))
                d = np.fromfile(carpeta / "hirise" / f"t_{clave}.bin", dtype=np.uint16).reshape(n, n)
                z = ind["z_base"] + d.astype(np.float32) / 10
                mosaico[j * por:j * por + n, i * por:i * por + n] = z   # la ultima muestra se traslapa con la vecina
            self.hi, self.hi_paso, self.hi_o = mosaico, paso, o

    def bloque(self, x, s, r_m, alcance):
        """Recorte del DEM alrededor del crater: (alturas, distancia/R, angulo, resolucion_m)."""
        if self.hi is not None and r_m >= 3:
            arr, res = self.hi, self.hi_paso
            u0, v0 = (x - self.hi_o) / res, (s - self.hi_o) / res
            ru = rv = r_m / res
        else:  # rejilla CTX: centros de celda en (col + 0.5) * celda
            arr, res = self.ctx, self.cuad["celda_x"]
            u0, v0 = x / self.cuad["celda_x"] - 0.5, s / self.cuad["celda_y"] - 0.5
            ru, rv = r_m / self.cuad["celda_x"], r_m / self.cuad["celda_y"]
        ua, ub = int(math.floor(u0 - ru * alcance)), int(math.ceil(u0 + ru * alcance))
        va, vb = int(math.floor(v0 - rv * alcance)), int(math.ceil(v0 + rv * alcance))
        ua, va = max(ua, 0), max(va, 0)
        ub, vb = min(ub, arr.shape[1] - 1), min(vb, arr.shape[0] - 1)
        if ub - ua < 3 or vb - va < 3:
            return None
        # crateres muy grandes: se submuestrea para no cargar millones de puntos
        paso = max(1, int((ub - ua) / 160))
        vv, uu = np.mgrid[va:vb + 1:paso, ua:ub + 1:paso]
        z = arr[va:vb + 1:paso, ua:ub + 1:paso]
        du, dv = (uu - u0) / max(ru, 1e-6), (vv - v0) / max(rv, 1e-6)
        return z, np.hypot(du, dv), np.arctan2(dv, du), res

    def medir(self, x, s, diametro):
        """
        Mide si hay un hoyo: (profundidad_m, consistencia 0-1, resolucion_m) o (None, None, None).
        1) Se ajusta un plano al terreno de afuera (1.3-1.9 R) y se resta: quita la pendiente regional,
           asi una ladera no parece crater.
        2) Fondo = promedio dentro de 0.4 R. Borde = maximo en cada uno de 8 sectores (0.7-1.25 R).
        3) Profundidad = mediana de los bordes - fondo. Consistencia = fraccion de sectores con borde
           mas alto que el fondo (un crater real es hoyo en todas direcciones; una ladera o canal no).
        """
        b = self.bloque(x, s, diametro / 2, 1.9)
        if b is None:
            return None, None, None
        z, r, ang, res = b
        ok = ~np.isnan(z)
        fuera = ok & (r > 1.3) & (r < 1.9)
        if fuera.sum() < 8:
            return None, None, None
        # plano z = a + b*u + c*v (u, v en unidades de radio)
        U, V = r * np.cos(ang), r * np.sin(ang)
        A = np.c_[np.ones(fuera.sum()), U[fuera], V[fuera]]
        coef, *_ = np.linalg.lstsq(A, z[fuera], rcond=None)
        zr = z - (coef[0] + coef[1] * U + coef[2] * V)
        dentro = ok & (r < 0.4)
        if dentro.sum() < 1:
            return None, None, None
        fondo = float(zr[dentro].mean())
        anillo = ok & (r > 0.7) & (r < 1.25)
        sector = ((ang + math.pi) / (2 * math.pi) * 8).astype(int) % 8
        bordes = [float(zr[anillo & (sector == k)].max()) for k in range(8) if (anillo & (sector == k)).any()]
        if len(bordes) < 5:
            return None, None, None
        ruido = max(0.3, 0.15 * res)
        prof = float(np.median(bordes) - fondo)
        consist = sum(bd > fondo + ruido for bd in bordes) / len(bordes)
        return prof, consist, res


class Textura:
    """
    Coherencia de la textura alrededor del crater (0 = sin direccion, 1 = todo en una direccion).
    Se calcula con el tensor de estructura en un anillo de 1.2 a 3 radios. Los campos de dunas y
    crestas (unidad Aeb de Jezero) dan > 0.55; el terreno con crateres reales da ~0.2-0.4.
    """

    def __init__(self, carpeta, foto_gris):
        self.carpeta, self.ctx, self.cache = carpeta, foto_gris, {}
        self.ind = None
        ruta = carpeta / "hirise" / "indice.json"
        if ruta.exists():
            self.ind = json.loads(ruta.read_text())
            self.fotos = set(self.ind.get("fotos", []))
            self.L = None

    def _tesela(self, i, j):
        clave = f"{i}_{j}"
        if clave not in self.cache:
            self.cache[clave] = cv2.imread(str(self.carpeta / "hirise" / f"f_{clave}.jpg"), cv2.IMREAD_GRAYSCALE) \
                if clave in self.fotos else None
            if self.cache[clave] is not None:
                self.L = self.cache[clave].shape[0]
        return self.cache[clave]

    def _recorte_hirise(self, x, s, radio_m):
        T, o = self.ind["tesela_m"], self.ind["origen_m"]
        i, j = int((x - o) // T), int((s - o) // T)
        if self._tesela(i, j) is None:
            return None, None
        L = self.L
        n = int(math.ceil(radio_m / T)) + 1  # teselas alrededor que hacen falta
        vacio = np.zeros((L, L), np.uint8)
        filas = [np.hstack([self._tesela(i + a, j + b) if self._tesela(i + a, j + b) is not None else vacio
                            for a in range(-n, n + 1)]) for b in range(-n, n + 1)]
        grande = np.vstack(filas)
        mpx = T / L
        px, py = (x - o - (i - n) * T) / mpx, (s - o - (j - n) * T) / mpx
        r = radio_m / mpx
        return grande[max(0, int(py - r)):int(py + r), max(0, int(px - r)):int(px + r)], mpx

    def coherencia(self, x, s, d):
        R = max(d / 2, 6.0)
        img, mpx = (None, None)
        if self.ind is not None and R * 3 <= 500:
            img, mpx = self._recorte_hirise(x, s, 3 * R)
        if img is None:
            H, W = self.ctx.shape
            mpx = 6.0
            px, py, r = x / mpx, s / mpx, 3 * R / mpx
            if r < 6:
                return None
            img = self.ctx[max(0, int(py - r)):int(py + r), max(0, int(px - r)):int(px + r)]
        if img is None or img.size < 64 or (img < 3).mean() > 0.3:
            return None
        rpx = R / mpx
        f = max(1, int(rpx / 8))          # unos 8 px por radio bastan
        img = cv2.resize(img, (max(8, img.shape[1] // f), max(8, img.shape[0] // f)), interpolation=cv2.INTER_AREA)
        rpx /= f
        c = cv2.GaussianBlur(img.astype(np.float32), (0, 0), 1)
        gx, gy = cv2.Sobel(c, cv2.CV_32F, 1, 0), cv2.Sobel(c, cv2.CV_32F, 0, 1)
        H, W = c.shape
        yy, xx = np.mgrid[:H, :W]
        rr = np.hypot(xx - W / 2, yy - H / 2) / rpx
        m = (rr > 1.2) & (rr < 3)
        if m.sum() < 20:
            return None
        a, b, e = (gx * gx)[m].sum(), (gy * gy)[m].sum(), (gx * gy)[m].sum()
        return float(np.sqrt((a - b) ** 2 + 4 * e * e) / (a + b + 1e-6))


# ---------------------------------------------------------------- fusion
def fusionar(dets, pases_totales):
    """
    dets: [x_m, s_m, d_m, conf, id_pase]. Junta las detecciones del mismo crater.
    Mismo crater = centros a menos de 0.5 del diametro mayor y diametros parecidos (razon < 1.8).
    """
    dets = sorted(dets, key=lambda d: -d[3])
    usados = np.zeros(len(dets), dtype=bool)
    arr = np.array([d[:4] for d in dets], dtype=np.float64) if dets else np.zeros((0, 4))
    grupos = []
    for i in range(len(dets)):
        if usados[i]:
            continue
        x, s, d, c = arr[i]
        dist = np.hypot(arr[:, 0] - x, arr[:, 1] - s)
        dmax = np.maximum(arr[:, 2], d)
        razon = np.maximum(arr[:, 2], d) / np.minimum(arr[:, 2], d)
        mios = (~usados) & (dist < 0.5 * dmax) & (razon < 1.8)
        idx = np.where(mios)[0]
        usados[idx] = True
        w = arr[idx, 3]
        pases = {dets[k][4] for k in idx}
        fuentes = {dets[k][5] for k in idx}
        grupos.append({
            "x": float(np.average(arr[idx, 0], weights=w)),
            "s": float(np.average(arr[idx, 1], weights=w)),
            "d": float(np.average(arr[idx, 2], weights=w)),
            "conf_max": float(w.max()),
            "conf_media": float(w.mean()),
            "votos": len(pases),
            "fuentes": sorted(fuentes),
        })
    return grupos


def puntuar(g, relieve, textura):
    """Confianza final = modelo (votos) x textura x relieve."""
    # votos: cada pase independiente que lo ve suma, con rendimiento decreciente
    base = 0.6 * g["conf_max"] + 0.4 * g["conf_media"]
    base = min(0.99, base * (1 + 0.12 * min(g["votos"] - 1, 4)))
    # textura: en campos de dunas / crestas el modelo confunde los valles con crateres
    coh = textura.coherencia(g["x"], g["s"], g["d"])
    g["textura"] = None if coh is None else round(coh, 2)
    if coh is not None:
        if coh >= 0.55:
            base *= 0.4
        elif coh >= 0.45:
            base *= 0.75
    prof, consist, res = relieve.medir(g["x"], g["s"], g["d"])
    g["prof"] = None if prof is None else round(prof, 1)
    g["hoyo"] = None if consist is None else round(consist, 2)
    if prof is None:
        g["conf"] = base * 0.9
        return g
    # el DEM no resuelve crateres chicos: no cuenta abajo de 6 celdas y cuenta completo desde 12
    peso = min(1.0, max(0.0, (g["d"] / res - 6) / 6))
    ruido = max(0.3, 0.15 * res)
    relacion = prof / g["d"]          # crateres frescos ~0.2, viejos/rellenos ~0.02-0.05
    g["peso_dem"] = peso
    if prof < -ruido or consist < 0.5:
        factor = 0.3                   # el centro no esta hundido: mesa, roca, duna o ladera
    elif prof < ruido or consist < 0.875:
        factor = 0.65                  # hoyo dudoso (no en 7 de 8 direcciones): relleno o falso positivo
    else:
        factor = 1 + min(relacion, 0.2) * 1.5   # hoyo claro en todas direcciones
        if coh is not None and coh >= 0.45 and relacion >= 0.08:
            factor *= 1.8   # hoyo profundo y claro: es crater aunque este entre dunas
    g["conf"] = min(0.99, base * (1 + (factor - 1) * peso))
    return g


# ---------------------------------------------------------------- principal
def main():
    ap = argparse.ArgumentParser(description="Detecta crateres con YOLO y guarda crateres.json")
    ap.add_argument("--zona", default="jezero")
    ap.add_argument("--modelo", default=None, help="ruta a best.pt (por defecto <zona>/crater_data/best.pt)")
    ap.add_argument("--sin-hirise", action="store_true", help="solo la foto CTX (rapido)")
    ap.add_argument("--cache", metavar="JSON", help="archivo para guardar las detecciones crudas del modelo")
    ap.add_argument("--reusar", action="store_true", help="con --cache: no corre el modelo, solo vuelve a filtrar")
    ap.add_argument("--debug", metavar="PNG", help="guarda una imagen de revision con los crateres dibujados")
    args = ap.parse_args()

    from ultralytics import YOLO  # import aqui para que --help funcione sin ultralytics
    global DISPOSITIVO
    DISPOSITIVO = dispositivo()
    print("Dispositivo:", DISPOSITIVO)

    carpeta = RAIZ / "docs" / "data" / "zonas" / args.zona
    ruta_modelo = Path(args.modelo) if args.modelo else carpeta / "crater_data" / "best.pt"
    modelo = YOLO(str(ruta_modelo))
    info = json.loads((carpeta / "info.json").read_text())
    cuad = json.loads((carpeta / "cuadricula.json").read_text())
    relieve = Relieve(carpeta, info, cuad)
    t0 = time.time()

    dets = []      # [x_m, s_m, d_m, conf, id_pase_global, fuente]
    pase_base = 0

    # --- 1) Foto CTX de toda la zona ---
    foto = cv2.imread(str(carpeta / "foto.png"), cv2.IMREAD_UNCHANGED)
    if foto.ndim == 3 and foto.shape[2] == 4:
        nodata = foto[:, :, 3] < 10
        gris = cv2.cvtColor(foto[:, :, :3], cv2.COLOR_BGR2GRAY)
    else:
        gris = foto if foto.ndim == 2 else cv2.cvtColor(foto, cv2.COLOR_BGR2GRAY)
        nodata = gris < 3
    H, W = gris.shape
    mx, my = info["ancho_m"] / W, info["alto_m"] / H
    archivo_crudos = Path(args.cache) if args.cache else None
    if archivo_crudos and archivo_crudos.exists() and args.reusar:
        guardado = json.loads(archivo_crudos.read_text())
        dets, pase_base = guardado["dets"], guardado["pases"]
        print(f"Detecciones crudas leidas de {archivo_crudos} ({len(dets)})")
    else:
        # ventanas: toda la zona (crateres grandes), 480 px (x1.3) y 240 px (x2.7: crateres chicos)
        lado_total = min(H, W)
        escalas = [(lado_total, ventanas(H, W, lado_total, 0.0)),
                   (480, ventanas(H, W, 480, 0.3)),
                   (240, ventanas(H, W, 240, 0.3))]
        cajas, n = detectar_en_imagen(modelo, gris, escalas, nodata=nodata)
        for cx, cy, w, h, c, p in cajas:
            if w * mx < 30:   # < 5 px en CTX: lo resuelve mejor HiRISE
                continue
            dets.append([cx * mx, cy * my, (w * mx + h * my) / 2, c, pase_base + p, "ctx"])
        pase_base += n
        print(f"CTX: {len(cajas)} cajas ({time.time() - t0:.0f} s)")

        # --- 2) Fotos HiRISE (teselas de 250 m) ---
        ind_ruta = carpeta / "hirise" / "indice.json"
        if not args.sin_hirise and ind_ruta.exists():
            ind = json.loads(ind_ruta.read_text())
            T, o = ind["tesela_m"], ind["origen_m"]
            fotos = set(ind.get("fotos", []))
            # Cada tesela (i, j) se analiza dentro de un bloque de 3x3 teselas (750 m) donde ella queda
            # al centro: asi los crateres que cruzan su orilla se ven completos. Solo se guardan los
            # crateres cuyo centro cae en la tesela central (los demas los guarda su propio bloque).
            cache = {}

            def leer(clave):
                if clave not in cache:
                    cache[clave] = cv2.imread(str(carpeta / "hirise" / f"f_{clave}.jpg"), cv2.IMREAD_GRAYSCALE) if clave in fotos else None
                return cache[clave]

            L = next(leer(k) for k in sorted(fotos)).shape[0]   # px por tesela (512)
            m_px = T / L
            vacio = np.zeros((L, L), np.uint8)
            # ventanas (en px del bloque de 3L) que cubren la tesela central y su orilla
            p2 = [int(L * .5)]                                    # 500 m (x0.64): crateres de 40-150 m
            p1 = [int(L * .5), int(L * 1.25)]                     # 250 m (x1.25): crateres de 8-60 m
            p05 = [int(L * .875), int(L * 1.25), int(L * 1.625)]  # 125 m (x2.5): crateres de 3-15 m
            escalas = [(2 * L, [(y, x) for y in p2 for x in p2]),
                       (L, [(y, x) for y in p1 for x in p1]),
                       (L // 2, [(y, x) for y in p05 for x in p05])]
            pase_hi = 0
            for j in range(ind["ny"]):
                for i in range(ind["nx"]):
                    if f"{i}_{j}" not in fotos:
                        continue
                    filas = []
                    for dj in (-1, 0, 1):
                        fila = [leer(f"{i + di}_{j + dj}") for di in (-1, 0, 1)]
                        filas.append(np.hstack([im if im is not None else vacio for im in fila]))
                    bloque = np.vstack(filas)
                    cajas, pase_hi = detectar_en_imagen(modelo, bloque, escalas, nodata=bloque < 3)
                    for cx, cy, w, h, c, p in cajas:
                        if not (L <= cx < 2 * L and L <= cy < 2 * L):
                            continue
                        d = (w + h) / 2 * m_px
                        if d > 150:   # los grandes los mide mejor la foto CTX completa
                            continue
                        dets.append([(i - 1) * T + o + cx * m_px, (j - 1) * T + o + cy * m_px, d, c, pase_base + p, "hirise"])
                # se libera la fila que ya no se va a usar
                for k in [k for k in cache if int(k.split("_")[1]) < j - 1]:
                    del cache[k]
                print(f"  HiRISE fila {j + 1}/{ind['ny']}  detecciones {len(dets)}  ({time.time() - t0:.0f} s)", flush=True)
            pase_base += pase_hi

    if archivo_crudos and not (archivo_crudos.exists() and args.reusar):
        archivo_crudos.write_text(json.dumps({"dets": dets, "pases": pase_base}))
        print("Detecciones crudas guardadas en", archivo_crudos)
    textura = Textura(carpeta, gris)

    # --- 3) Fusion, relieve y filtro final ---
    grupos = fusionar(dets, pase_base)
    finales = []
    for g in grupos:
        g = puntuar(g, relieve, textura)
        if g["conf"] < CONF_FINAL:
            continue
        # el DEM lo resuelve bien y dice que NO es un hoyo: se descarta aunque el modelo este seguro
        if g["hoyo"] is not None and g["hoyo"] < 0.5 and g.get("peso_dem", 0) > 0.8:
            continue
        # un solo voto sin hoyo medible no basta
        if g["votos"] == 1 and (g["hoyo"] is None or g["hoyo"] < 0.75) and g["conf"] < 0.45:
            continue
        lon = info["oeste"] + g["x"] / info["ancho_m"] * (info["este"] - info["oeste"])
        lat = info["norte"] - g["s"] / info["alto_m"] * (info["norte"] - info["sur"])
        finales.append({
            "x": round(g["x"], 1), "s": round(g["s"], 1), "d": round(g["d"], 1),
            "lon": round(lon, 6), "lat": round(lat, 6),
            "conf": round(g["conf"], 3), "prof": g["prof"], "hoyo": g["hoyo"], "textura": g["textura"], "votos": g["votos"],
            "fuente": "+".join(g["fuentes"]),
        })
    # quita crateres chicos dentro de uno mas grande que en realidad son el mismo (caja interna)
    finales.sort(key=lambda c: -c["d"])
    limpios = []
    for c in finales:
        dup = False
        for g in limpios:
            if g["d"] > c["d"] and math.hypot(g["x"] - c["x"], g["s"] - c["s"]) < 0.15 * g["d"] and c["d"] > 0.6 * g["d"]:
                dup = True
                break
        if not dup:
            limpios.append(c)
    limpios.sort(key=lambda c: -c["conf"])
    for k, c in enumerate(limpios):
        c["id"] = k

    salida = {
        "modelo": "YOLOv8n crater detector (" + ruta_modelo.name + ")",
        "metodo": "sliced multi-scale inference + CLAHE + TTA + metric box fusion + DEM depth check",
        "conf_min": CONF_FINAL,
        "crateres": limpios,
    }
    (carpeta / "crateres.json").write_text(json.dumps(salida, separators=(",", ":"), ensure_ascii=False))
    print(f"Listo: {len(limpios)} crateres en {carpeta / 'crateres.json'} ({time.time() - t0:.0f} s)")
    if limpios:
        ds = np.array([c["d"] for c in limpios])
        print(f"  diametro: min {ds.min():.1f} m, mediana {np.median(ds):.1f} m, max {ds.max():.0f} m")

    if args.debug:
        vis = cv2.cvtColor(gris, cv2.COLOR_GRAY2BGR)
        for c in limpios:
            r = max(2, int(c["d"] / 2 / mx))
            color = (0, 255, 0) if c["conf"] >= 0.5 else (0, 200, 255)
            cv2.circle(vis, (int(c["x"] / mx), int(c["s"] / my)), r, color, 1)
        destino = Path(args.debug)
        cv2.imwrite(str(destino), vis)
        print("Imagen de revision:", destino)


if __name__ == "__main__":
    main()
