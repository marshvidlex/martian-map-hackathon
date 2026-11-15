# Martian Map

**A Marswalk planner for astronauts.** Pick a site on Mars, place the habitat and the stops you want to visit, and Martian Map finds the safest walking route, checks oxygen and radiation, and tells you if the walk is **GO** or **NO-GO**. Then you can review it on a 3D table and walk it in first person from inside the helmet.

**Live demo:** https://marshvidlex.github.io/martian-map-hackathon/

Built for the NASA Space Apps Challenge 2026 (Querétaro, Mexico).

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

The new site appears in the **Site** selector.

---

## Project structure

```
scripts/
  procesar.py        crops a site, computes slope and roughness, exports layers and HiRISE tiles
  crateres.py        detects craters with the YOLO model (best.pt) and writes crateres.json
  geologia.py        rasterizes the USGS geologic map into a colored layer
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
