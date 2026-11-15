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
- Safety layers: **walk-back zone** (where you can still walk home if the rover fails) and a **solar storm** scenario.

### 2. 3D table
- The whole site as a 3D model with adjustable relief (1x to 6x).
- Drape any layer on the terrain: photo, elevation, slope, roughness or geology (with unit names floating over the terrain).
- "Go to" list: fly to the habitat, any stop or any point of interest. Double-click the ground to zoom in.
- Each place shows a card with its coordinates, elevation, slope, arrival time and geologic unit.
- "Fly the route" moves the camera along the planned path like a drone.

### 3. Visor (first person EVA)
- Walk the approved mission at eye height (1.70 m), with HiRISE terrain near you and CTX terrain in the distance.
- HUD: heading, next stop, suit O₂ ring, mission time, distance, dose and time to get back.
- Automatic alerts: oxygen on reserve, steep slope ahead, rough terrain ahead, working at a stop.
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

The new site appears in the **Site** selector.

---

## Project structure

```
scripts/
  procesar.py        crops a site, computes slope and roughness, exports layers and HiRISE tiles
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
