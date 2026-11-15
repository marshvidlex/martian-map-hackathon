# Bitácora de recorridos

Cada recorrido que se hace en el visor en primera persona (`docs/js/casco.js`) se guarda solo: la caminata del astronauta (`eva`) y la repetición de Perseverance (`rover`). Se guarda el tiempo, la distancia y datos extra.

**No tiene interfaz.** Esta guía es para quien la haga: todo se usa con el objeto global `Bitacora` y el evento `bitacora`.

## Cómo funciona

```
Visor (casco.js) ──> Bitacora.grabar() ──> IndexedDB del navegador   (se guarda solo, funciona sin internet)
                                                   │ Bitacora.descargar()
                                                   ▼
                                    bitacora-<zona>-<fecha>.json
                                                   │ python scripts/bitacora.py agregar <archivo>
                                                   ▼
                              docs/data/zonas/<zona>/bitacora.json   (en git: lo ve todo el equipo)
```

- Al empezar un recorrido se crea el registro. Cada 20 m se toma una muestra y cada 1.5 s se escribe lo nuevo, así que si se cierra la página casi no se pierde nada.
- Al abrir una zona, `Bitacora.preparar()` (la llama `app.js`) marca como `interrumpido` lo que quedó a medias en otra visita y carga los recorridos del repo con `origen: "repo"`.
- Si el navegador no tiene IndexedDB, la bitácora vive en memoria (`Bitacora.persistente === false`) y el visor funciona igual.

| Archivo | Qué es |
|---|---|
| `docs/js/bitacora.js` | La base de datos, la grabadora y la API `Bitacora` |
| `scripts/bitacora.py` | Pasa los JSON exportados al repo: `agregar`, `ver`, `quitar`, `csv` |
| `docs/data/zonas/<zona>/bitacora.json` | Recorridos compartidos de cada zona (empiezan vacíos) |

Cambios a archivos existentes: `casco.js` llama a la grabadora (5 líneas), `app.js` llama a `Bitacora.preparar()` (1 línea), `index.html` carga `bitacora.js` (versión `?v=32`) y `sw.js` lo guarda para usar sin internet (`martian-map-v32`).

## API

Todo es asíncrono (`await`) salvo `aMapa`, `activo`, `persistente` y `cadaMetros`.

| Función | Qué hace |
|---|---|
| `Bitacora.listar(filtro)` | Lista de recorridos (sin muestras ni eventos), del más nuevo al más viejo |
| `Bitacora.obtener(id)` | Recorrido completo con `muestras` y `eventos`, o `null` |
| `Bitacora.muestras(id)`, `Bitacora.eventos(id)` | Solo las filas |
| `Bitacora.resumen(filtro)` | `{ recorridos, distancia_km, horas, por_tipo, por_estado, mas_largo, ultimo }` |
| `Bitacora.anotar(id, cambios)` | Cambia `nombre`, `notas`, `etiquetas` (lista) y `extra` (objeto, se mezcla). Cualquier otro campo da error. Solo recorridos locales o importados |
| `Bitacora.borrar(id)` | Borra un recorrido local. Regresa `true` si existía. Los del repo no se borran desde aquí |
| `Bitacora.vaciar()` | Borra todos los locales (menos el que se está grabando). Regresa cuántos |
| `Bitacora.descargar(formato, filtro)` | Baja `bitacora-<zona>-<fecha>.json` (o `.csv` con `"csv"`). Sin filtro: todo lo grabado en este navegador |
| `Bitacora.exportar(ids o filtro)` | Lo mismo que `descargar` pero regresa el objeto |
| `Bitacora.importar(datos)` | Acepta el objeto de `exportar`, el texto JSON o un `File`. Regresa `{ importados, repetidos, invalidos }` |
| `Bitacora.aMapa(punto)` | Cualquier punto de la bitácora (muestra, `punto_inicio`, parada…) a `[lat, lng]` de Leaflet |
| `Bitacora.activo` | Copia del recorrido que se está grabando, o `null` |
| `Bitacora.persistente` | `true` si se guarda en IndexedDB |
| `Bitacora.cadaMetros` | Metros entre muestras (20) |
| `Bitacora.preparar()`, `Bitacora.grabar()` | Internas: las usan `app.js` y `casco.js` |

**Filtro** (todo opcional): `{ zona, tipo, estado, origen, desde, hasta, orden, ascendente, limite }`. `desde` y `hasta` comparan con `inicio`; `orden` es el nombre de un campo (por defecto `inicio`).

**Evento** `bitacora` en `window`, con `detail.accion` y `detail.id`:

| `accion` | Cuándo |
|---|---|
| `inicio` | Empieza un recorrido |
| `avance` | Se guardó avance del recorrido en curso (cada 1.5 s; útil para un contador en vivo) |
| `fin` | Terminó (completado o abortado) |
| `cambio` | `anotar()` |
| `borrado` | `borrar()` o `vaciar()` (`id` es `null`) |
| `importado` | `importar()` |
| `repo` | Se cargaron los recorridos de `bitacora.json` al abrir la zona |

### Ejemplo

```js
// lista de la zona y el recorrido mas nuevo dibujado en el mapa
const lista = await Bitacora.listar({ zona: "jezero" });
const r = await Bitacora.obtener(lista[0].id);
L.polyline(r.muestras.map(Bitacora.aMapa), { color: "#FFB547" }).addTo(mapa);

// refrescar la lista cuando cambie algo (sin redibujar 1 vez por segundo)
window.addEventListener("bitacora", (e) => { if (e.detail.accion !== "avance") pintarLista(); });

// botones
btnExportar.onclick = () => Bitacora.descargar();
inputArchivo.onchange = (e) => Bitacora.importar(e.target.files[0]);
await Bitacora.anotar(r.id, { nombre: "Delta oeste", etiquetas: ["demo"] });
```

## Qué guarda cada recorrido

Los nombres llevan la unidad: `_m`, `_h`, `_s`, `_pct`, `_deg`, `_kmh`, `_mSv`. Fechas en ISO, hora UTC. `x` = metros al este desde el borde oeste de la zona, `s` = metros al sur desde el borde norte (las coordenadas del visor).

### Identidad

| Campo | Qué es |
|---|---|
| `id` | `r-AAAAMMDD-HHMMSS-xxxx` |
| `zona` | `jezero`, `gale`… |
| `tipo` | `eva` (astronauta) o `rover` (Perseverance) |
| `estado` | `en_curso`, `completado`, `abortado` (se salió del visor antes) o `interrumpido` (se cerró la página) |
| `origen` | `local` (grabado aquí), `repo` (de `bitacora.json`) o `importado` |
| `en_repo` | `true` si ya está en el `bitacora.json` de la zona |

### Tiempo y distancia

| Campo | Qué es |
|---|---|
| `inicio`, `fin` | Fecha y hora real (`fin` es `null` si se interrumpió) |
| `duracion_real_s` | Segundos reales que estuvo abierto el visor |
| `tiempo_h` | **Tiempo de misión** recorrido (horas) |
| `distancia_m` | **Distancia** recorrida |
| `avance_pct` | Distancia recorrida / distancia del plan |
| `tiempo_caminando_h`, `tiempo_trabajo_h` | El tiempo de misión separado en caminar y trabajar en paradas |
| `velocidad_media_kmh` | Distancia / tiempo caminando |

### Datos extra

| Campo | Qué es |
|---|---|
| `plan` | Lo planeado: `distancia_m`, `tiempo_h`, `paradas`, y en `eva` también `go`, `oxigeno_pct`, `dosis_mSv`, `subida_m`, `pendiente_max_deg` |
| `elev_min_m`, `elev_max_m`, `subida_m`, `bajada_m` | Altura del terreno recorrido |
| `pendiente_max_deg` | Pendiente más fuerte que se pisó |
| `geologia` | Metros recorridos por unidad geológica (`{ "Njf": 1513.4, "NHjf2": 205.1 }`; solo en zonas con mapa geológico) |
| `avisos` | Cuántas veces se entró a terreno de cuidado: `{ pendiente, rugosidad, crater }`. Pendiente > 70 % del límite, rugosidad > 60 % del límite, borde de cráter ≥ 4 m |
| `crateres` | Cráteres que se cruzaron: `{ id, diametro_m, x, s, lon, lat, d_m }` |
| `oxigeno_usado_pct`, `dosis_mSv` | Solo `eva` |
| `sol_inicio`, `sol_fin` | Solo `rover` |
| `punto_inicio`, `punto_fin` | `{ x, s, lon, lat }` |
| `paradas` | `{ n, nombre, x, s, lon, lat }` (solo `eva`) |
| `paradas_visitadas` | Cuántas se alcanzaron |
| `params` | Parámetros de la misión con los que se hizo |

### Para la interfaz

`nombre`, `notas`, `etiquetas`, `extra`. Empiezan vacíos y son lo único que `anotar()` deja cambiar.

### Muestras (una cada 20 m, más la del final)

`n`, `t_h`, `d_m`, `x`, `s`, `lon`, `lat`, `elev_m`, `pend_deg`, `rug_m`, `vel_kmh`, `unidad` (geológica), y además `o2_pct` y `dosis_mSv` (`eva`) o `sol` (`rover`).

### Eventos

Cada uno lleva `n`, `tipo`, `t_h`, `d_m` y `hora` (hora real).

| `tipo` | Datos extra |
|---|---|
| `salida` | |
| `llegada` | `parada`, `nombre` |
| `salida_parada` | `parada`, `nombre` |
| `aviso` | `aviso` (`pendiente`, `rugosidad`, `crater`), `valor`, y `crater` (id) si aplica |
| `pausa`, `reanuda` | |
| `fin` | `estado` |

## Compartir en git

```bash
# 1. En la consola del navegador (no en la terminal): Bitacora.descargar()
# 2. En la terminal, en la carpeta del repo:
python scripts/bitacora.py agregar ~/Downloads/bitacora-jezero-<fecha>.json
git add docs/data/zonas && git commit -m "Bitacora: nuevos recorridos" && git push
```

Otras opciones: `python scripts/bitacora.py ver`, `quitar <id>`, `csv --salida tabla.csv`; y en `agregar`, `--solo-completos` y `--sin-muestras` (archivo más chico).

## Límites

- Cada navegador tiene su propia bitácora: `localhost` y la página publicada son bases distintas. Para compartir hay que exportar y subir a git.
- Safari puede borrar los datos de un sitio que lleva días sin abrirse.
- En el visor la posición sale del plan, así que un recorrido completo mide lo mismo que el plan. Lo que distingue un recorrido de otro es la ruta, los parámetros, hasta dónde llegó y cuándo se hizo.
- Los nombres de las paradas se guardan en el idioma que tenía la app al grabar.
- Si se agrega otra zona, conviene crear su `bitacora.json` vacío (si falta, solo sale un 404 en la consola).
