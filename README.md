# Martian Map

**A Marswalk planner for astronauts.** Pick a site on Mars, place the habitat and the stops you want to visit, and Martian Map finds the safest walking route, checks oxygen and radiation, and tells you if the walk is **GO** or **NO-GO**. Then you can review it on a 3D table and walk it in first person from inside the helmet.

**Live demo:** https://marshvidlex.github.io/martian-map-hackathon/

Built for the NASA Space Apps Challenge 2026 (Querétaro, Mexico).

**From orbit to boots on the ground:** choose a site on Mars, land safely, plan the walk, check it in 3D and walk it with a helmet HUD. All offline, all with real NASA/USGS data.

---

## Mission flow (5 phases)

The app follows the same order NASA uses to go from site selection to a surface traverse. A bar at the top shows the phase; each phase shows only what that decision needs.

| Phase | What the crew does | What the app shows |
|---|---|---|
| 1. MARS | Choose a landing site on the global map | Viking colour mosaic, 10 historic landing sites, which ones have terrain data ready |
| 2. LAND | Choose where the habitat touches down | Landing-safety map (green / amber / red) and the 3 safest spots; red areas are refused with the reason and the nearest safe spot |
| 3. PLAN | Place the EVA stops | Safest walking route, oxygen, dose, GO / NO-GO; layers grouped as Safety (open), Science and Base map (folded) |
| 4. REVIEW | Check and approve | 3D table + mission checklist: landing spot, slope, craters on the route, oxygen, radiation |
| 5. EXECUTE | Walk | First-person helmet visor with live telemetry, alerts and an abort button |

---

## Validation (how we know it works)

| Check | Result |
|---|---|
| Landing safety vs. the real Perseverance landing spot (18.4446° N, 77.4509° E) | Marked **safe (green)** by our analysis |
| Perseverance's real path is walkable for our planner | **99.8 %** of the 20 m cells the rover drove through pass our 15° slope / 1 m roughness limits |
| Our route vs. Perseverance's real path (24 legs of 800 m inside the zone) | Mean distance between both paths **43 m**; **69 %** of our route lies within 50 m of the rover's path; our route is **29 % shorter** (the rover also detours to science targets) |
| Crater detection precision / recall | Measured against a hand-labelled ground truth with `docs/etiquetar.html` + `scripts/evaluar_crateres.py` — see `docs/data/zonas/jezero/evaluacion_crateres.json` |
| Surface radiation | Uses the dose rate measured by Curiosity's RAD (0.67 mSv/day) |

Reproduce the route check with Node.js: `node scripts/validar_ruta.js jezero` (it runs the same `ruta.js` as the web page).

### Real data vs. demo values

| Value | Real or demo | Source |
|---|---|---|
| Terrain elevation, slope, roughness | Real | CTX and HiRISE DTMs (USGS) |
| Landing limits: slope ≤ 15° at 5 m and 20–40 m, ≤ 5° at 200–500 m, rocks ≤ 0.6 m | Real (engineering constraints) | JPL, *MSL Landing Site Selection – User's Guide to Engineering Constraints* |
| Surface radiation 0.67 mSv/day | Real (measured) | Hassler et al. 2014, Curiosity RAD |
| Geologic units | Real | USGS SIM 3464 |
| Perseverance path and landing spot | Real | NASA/JPL `M20_traverse.json` |
| Walking speed 3 km/h (Tobler) | Model | Tobler 1993 |
| Suit oxygen 8 h, 20 % reserve, 30 min per stop, load 20 kg | Demo | Our assumptions |
| Solar storm ×50, dose limit 1 mSv per EVA | Demo | Our assumptions |

---

## What it does

### 1. Mission planner (2D map)
- Orbital map of Jezero Crater with layers you can turn on and off: CTX photo, elevation, slope, HiRISE roughness, geologic units (USGS SIM 3464) and the real traverse of the Perseverance rover.
- When you zoom in, the CTX photo is replaced by HiRISE photo tiles (~50 cm per pixel).
- Tap to place the habitat, tap again to add stops.
- For every leg it finds the fastest safe path and shows:
  - total distance, time, max slope and total climb
  - oxygen used (bar) and radiation dose (bar)
  - a timeline with the arrival time at each stop (T+)
  - an elevation profile
  - a **GO / NO-GO** verdict and the reason
- **Craters detected with YOLO**: a crater layer with a confidence filter, the craters the route crosses highlighted in amber and listed in the mission panel (size, depth, leg).
- **Crater explorer** ("Craters" mode): a detail map with every detected crater (colour by diameter, confidence or depth/diameter), stats, a size-frequency histogram you can tap to filter, filters (ID, confidence, diameter range, CTX/HiRISE, only on route), sorting and a list with HiRISE thumbnails. Each crater has a card with the HiRISE crop, a W–E cross-section from the HiRISE DTM, depth, freshness, geologic unit and actions: add as stop, view in 3D, show in planner.
- **Select zone**: drag a rectangle on the map; the map flies to it, its craters pop in one by one and a card shows area, crater count, density and mean slope.
- Safety layers: **walk-back zone** (where you can still walk home if the rover fails) and a **solar storm** scenario.

### 2. 3D table
- The whole site as a 3D model with adjustable relief (1x to 6x).
- Drape any layer on the terrain: photo, elevation, slope, roughness or geology (with unit names floating over the terrain).
- "Go to" list: fly to the habitat, any stop or any point of interest. Double-click the ground to zoom in.
- Each place shows a card with its coordinates, elevation, slope, arrival time and geologic unit.
- "Fly the route" moves the camera along the planned path like a drone.
- 3D habitat (dome, airlock, lab module, solar panels, antenna, pressurised rover) at the habitat point, facing the first stop.
- Detected craters drawn as rings on the terrain; the ones on the route appear in the "Go to" list with a pulsing ring.

### 3. Visor (first person EVA)
- Walk the approved mission at eye height (1.70 m), with HiRISE terrain near you and CTX terrain in the distance.
- HUD: heading, next stop, suit O₂ ring, mission time, distance, dose and time to get back.
- Automatic alerts: oxygen on reserve, steep slope ahead, rough terrain ahead, crater rim ahead, working at a stop.
- Crater rims drawn on the ground around you (amber = on your route) and on the minimap. You leave through the airlock of a full-size habitat.
- Speed x1 to x300, gyroscope on tablets, minimap.
- **Replay Perseverance mission:** drive the real NASA/JPL traverse of the rover from Mastcam-Z height, with sol and Earth date.

### 4. Global Mars map and landing safety
- Start screen with the whole planet (Viking MDIM 2.1 colour mosaic, cut into tiles that ship with the app) and 10 historic landing sites. Sites with processed terrain are marked **READY**; selecting one shows only that site's data (photo, HiRISE, traverse, craters) on the globe.
- **Landing safety** (`scripts/aterrizaje.py`): every 10 m of the site is graded safe / caution / no-landing using the MSL engineering constraints, craters (YOLO + relief check, rim plus margin), sand dunes (geologic unit Aeb) and a 50 m clear radius. The habitat cannot be placed on a red cell; "Suggest landing sites" marks the 3 spots farthest from any hazard.

### Other
- English / Spanish toggle.
- Works offline after the first visit (service worker), so it can run on a tablet without internet.

---

## How the route and the safety check work

The terrain is turned into a grid of ~20 × 20 m cells. Each cell keeps its elevation, slope and roughness.

| Step | How |
|---|---|
| Blocked cells | Slope over the limit (15° by default), roughness over 1 m, or no data |
| Walking speed | Tobler's hiking function: depends on whether you go up or down. Flat ground = 3 km/h, minus 5% for every 10 kg of extra load |
| Path | A* search over the grid (8 neighbours), minimising **time**, not distance |
| Oxygen | Walking time + work time at each stop. The suit's safety reserve (20%) can't be used |
| Radiation | 0.67 mSv per day on the surface (demo value, close to the ~0.64 mSv/day measured by Curiosity's RAD), × 50 during a solar storm, compared with a per-EVA limit |
| Verdict | GO only if oxygen and dose are both fine. If oxygen is short, it says how many stops are reachable |

---

## Data used

All the data is public and comes from NASA and USGS.

| Data | Source |
|---|---|
| CTX DTM, 20 m/px | USGS Astrogeology, Mars 2020 Terrain Relative Navigation CTX DTM Mosaic |
| CTX orthophoto, 6 m/px | USGS Astrogeology, Mars 2020 TRN CTX Orthorectified Image Mosaic |
| HiRISE DTM, 1 m/px | USGS Astrogeology, Mars 2020 TRN HiRISE DTM Mosaic |
| HiRISE orthophoto, 25 cm/px | USGS Astrogeology, Mars 2020 TRN HiRISE Orthorectified Image Mosaic |
| Geologic units | Sun, V., and Stack, K., 2020, *Geologic map of Jezero crater and the Nili Planum region, Mars*, USGS Scientific Investigations Map 3464, https://doi.org/10.3133/sim3464 |
| Perseverance traverse | NASA/JPL-Caltech, "Where is Perseverance?" (`M20_traverse.json`) |
| Surface radiation | Hassler, D. M., et al., 2014, *Mars' surface radiation environment measured with the Mars Science Laboratory's Curiosity rover*, Science 343 |
| Site reference | NASA JPL Mars Trek |

Walking model: Tobler, W. (1993), *Three presentations on geographical analysis and modeling*.

Libraries: [Leaflet](https://leafletjs.com/) 1.9.4 (2D map) and [Three.js](https://threejs.org/) 0.187 (3D). Both are stored in `docs/lib/` so the app works without internet.

---

## Run it on your computer

You only need Python (any recent version) to serve the page.

**Windows (PowerShell)**
```powershell
git clone https://github.com/marshvidlex/martian-map-hackathon.git
cd martian-map-hackathon\docs
python -m http.server 8000
```

**Mac / Linux**
```bash
git clone https://github.com/marshvidlex/martian-map-hackathon.git
cd martian-map-hackathon/docs
python3 -m http.server 8000
```

Open http://localhost:8000. To use it on a tablet, connect it to the same Wi-Fi and open `http://<your-computer-IP>:8000`.

> The page must be opened through a server (not by double-clicking `index.html`), because the browser blocks loading the data files from disk.

---

## Add a new site

The heavy GeoTIFF files are not in the repository. The Python scripts turn them into the small files the page uses.

```bash
python -m venv .venv
# Windows: .venv\Scripts\Activate.ps1    Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

1. Put the site's files in `datos_crudos/<site>/` with their original names.
2. Create `datos_crudos/<site>/zona.json`:
   ```json
   {
     "nombre": "Site name",
     "lat": 18.46,
     "lon": 77.42,
     "km": 6,
     "dem": "<CTX DTM file>.tif",
     "foto": "<CTX orthophoto file>.tif",
     "hirise": "<HiRISE DTM file>.tif",
     "orto": "<HiRISE orthophoto file>.tif"
   }
   ```
   `hirise` and `orto` are optional. If the DEM is finer than 20 m (for example a 1 m mosaic), it is averaged to 20 m automatically.
3. Process it:
   ```bash
   python scripts/procesar.py --zona <site>
   ```
4. Optional, geologic layer from a shapefile:
   ```bash
   python scripts/geologia.py --zona <site> --shp path/to/GeoUnits.shp
   ```
5. Optional, rover traverse: copy `M20_traverse.json` into `docs/data/zonas/<site>/`.
6. Optional, craters: put the YOLO weights in `docs/data/zonas/<site>/crater_data/best.pt` and run
   ```bash
   python scripts/crateres.py --zona <site>
   ```
   It writes `crateres.json` (about 8 min for Jezero on an Apple M-series GPU; it uses CUDA, MPS or CPU).
   Add `--cache crudos.json` to keep the raw detections; then `--cache crudos.json --reusar` re-runs only the filters in seconds.

7. Relief check and landing safety (after the craters, in this order):
   ```bash
   python scripts/validar_crateres.py --zona <site>
   python scripts/aterrizaje.py --zona <site>
   ```

Shortcut for steps 1–2: `python scripts/descargar_zona.py --zona <site> --lat <lat> --lon <lon east> --nombre "<name>"` downloads only a 6 × 6 km window of the CTX (and HiRISE, if any) DTM and orthophoto from the USGS STAC catalog.

### How the crater detection is made more accurate

The model is a YOLOv8n with one class (`Crater`) trained at 640 px. Run as-is on our images it missed the small craters and marked dune troughs and bright mesas. `crateres.py` adds:

| Step | Why |
|---|---|
| Two sources: CTX (~6 m/px) for craters of 40 m–1.3 km, HiRISE (~0.5 m/px) for 3–150 m | Each crater is seen at a resolution where it is 20–300 px |
| Sliced inference (overlapping windows resized to 640 px) at 3 scales | Small craters reach the size the model was trained on |
| CLAHE contrast and test-time augmentation; each pass is a vote | Mars photos have low contrast; more independent votes = more confidence |
| Shape filters: round boxes only, boxes cut by a window edge dropped | Removes elongated features and half craters |
| Box fusion in metres across windows, scales and sources | One crater = one record, centre and size averaged by confidence |
| Texture check (structure-tensor coherence around the crater) | Dune fields and ridges are strongly oriented; real cratered ground is not |
| Relief check on the HiRISE DEM (2 m): regional slope removed, rim higher than the floor in at least 7 of 8 directions | A crater is a hole. Mesas, rocks, slopes and channels are rejected |
| Second relief pass (`scripts/validar_crateres.py`): rim higher than the floor in 12 directions, round rim, centre lower than the surroundings; centre and diameter refitted on the DEM | Each crater ends up **confirmed**, **photo only** (too small or too shallow for a 2 m DEM, e.g. sand-filled craters) or **rejected** (mesas and slopes on the delta). Rejected craters are hidden by the confidence filter and can be reviewed in the explorer |

The new site appears in the **Site** selector.

---

## Project structure

```
scripts/
  procesar.py        crops a site, computes slope and roughness, exports layers and HiRISE tiles
  crateres.py        detects craters with the YOLO model (best.pt) and writes crateres.json
  geologia.py        rasterizes the USGS geologic map into a colored layer
  validar_crateres.py relief check of the YOLO craters (confirm / refit / reject)
  aterrizaje.py      landing-safety map and suggested landing spots
  evaluar_crateres.py precision / recall of the crater detector against hand labels
  validar_ruta.js    compares our routes with Perseverance's real traverse (Node.js)
  cortar_marte.py    cuts the global Viking mosaic into map tiles
  descargar_zona.py  searches the USGS STAC catalog for CTX/HiRISE DTMs around a point
  revisar_tif.py     prints the info of a GeoTIFF
  hacer_iconos.py    app icons
docs/                the web app (this folder is what GitHub Pages publishes)
  index.html
  css/estilos.css
  js/ruta.js         A*, Tobler speed, oxygen, dose, GO/NO-GO
  js/app.js          2D map, layers, mission panel
  js/vista3d.js      3D table
  js/casco.js        first-person visor
  js/replay.js       Perseverance replay
  js/crateres.js     crater layer, craters on the route, "Select zone" tool
  js/explorador.js   crater explorer (detail map, list, filters, crater card)
  js/habitat3d.js    3D habitat model (3D table and visor)
  js/marte.js        global Mars map and landing sites
  js/aterrizaje.js   landing-safety layer and suggested sites
  js/fases.js        5-phase mission flow (Mars, Land, Plan, Review, Execute)
  etiquetar.html     tool to hand-label craters (ground truth)
  js/idioma.js       English / Spanish texts
  data/zonas/<site>/ processed data of each site
  sw.js              offline mode
```

---

## Demo values and limitations

These values are **our assumptions for the demo**, not official NASA numbers. All of them can be changed in *Mission parameters*:

- Speed on flat ground 3 km/h, −5% per 10 kg of load
- Suit oxygen 8 h with a 20% reserve, 30 min of work per stop
- Max slope 15°, max roughness 1 m
- Solar storm multiplier ×50, dose limit 1 mSv per EVA

Limitations:
- The grid is 20 m, so it plans which zones to cross, not where to put each foot. HiRISE roughness helps to avoid rocky areas.
- The geologic map is 1:75,000 and may be offset 100–200 m from the CTX mosaic (as its readme says).
- The radiation model uses one average value; it does not include shielding by terrain.

---

## Use of AI

We used Claude (Anthropic) as a coding and writing assistant: to help write and debug the Python scripts and the web app, to translate the interface, and to draft documentation. The team chose the data, designed the features, tested everything and made the decisions.

---

## Team

- David Martínez Molina, coordination, GitHub and publishing
- Erik Germán Ayala Castillo, data processing (Python)
- Ricardo Sosa, route algorithm and safety
- Frida Sofía Coronel Olvera, 2D map and interface
- Josué Alexander Munguía Ramírez, 3D table and visor
- Fer, science, points of interest and presentation

## Science objectives

The EVA starts from science, not from a random walk. `data/zonas/jezero/ciencia.json` defines three objectives and `poi.json` holds 9 real places Perseverance studied inside our 6 km zone. Each place says what to study, how (instrument), whether a sample is taken, the sol Perseverance was there and a NASA source link. Coordinates come from the rover position on that sol in `M20_traverse.json`.

| Objective | Places |
|---|---|
| Search for signs of ancient life (delta) | Skinner Ridge, Wildcat Ridge (most abundant organics found by SHERLOC), Amalik, Belva crater rim |
| Read the history of the crater floor | Octavia E. Butler Landing, Rochette (first cores), Brac, Issole |
| Recover the Three Forks samples | Three Forks Sample Depot (first sample depot on another planet) |

In the PLAN step the crew ticks objectives and presses "Add selected objectives to the route": stops are added nearest-first from the habitat. The REVIEW checklist shows how many objectives and targets the route covers.

