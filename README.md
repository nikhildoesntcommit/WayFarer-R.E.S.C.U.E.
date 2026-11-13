# WayFarer R.E.S.C.U.E.

An offline-capable progressive web app that estimates how long a crowd needs to get out of a building, or how a region
might evacuate after an earthquake, flood or cyclone. Everything runs in the browser: no backend, no account, no
analytics. A planning aid, **not** a certified safety assessment.

Stack (as specified): React 18 + TypeScript + Vite, React Router 6, Zustand, plain CSS variables, `vite-plugin-pwa`
(Workbox), `idb`, MapLibre GL JS, Canvas 2D (marching-squares contours), Vitest, Playwright, optional WebLLM.

## Run it

```bash
npm install
npm run dev              # http://localhost:5173  (camera needs HTTPS, see below)
npm run build            # type-check + production build into dist/
npm run preview          # serve dist/ on http://localhost:4173 (service worker active)
npm test                 # 96 unit tests (engine, findings, camera geometry, disaster models, demo plan)
npx playwright install chromium
npm run test:e2e         # builds, serves, drives the real app (draw, scan fallback, map, offline, report/PDF)
npm run lint
```

`dist/` is included in the zip, built from these sources, so you can also just upload it to any static host.

### Publish on GitHub Pages (the supported deployment)
1. Create a repository (for example `wayfarer-rescue`), push this folder to its `main` branch.
2. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow `.github/workflows/pages.yml` runs the unit tests, builds with `VITE_BASE=/<repo-name>/` and publishes `dist/`.
   The site is then at `https://<user>.github.io/<repo-name>/`. To build by hand: `PAGES_BASE=/<repo-name>/ npm run build:pages`.
4. The build writes `dist/404.html` (single-page-app fallback, so a reload on `/results` works) and `dist/.nojekyll`.
Plans are saved in the browser (IndexedDB) and settings in `localStorage`; nothing leaves the device.

### HTTPS (required for the camera)
Browsers expose the camera and motion sensors only on `https://` pages (and `localhost`). Deploy `dist/` to any static
host that serves HTTPS (Netlify, Cloudflare Pages, GitHub Pages, Vercel, an nginx with a certificate). To try the scan
screen on a phone before deploying, tunnel `npm run preview` through an HTTPS tunnel. After one online visit the app
works with the network off (service worker precache, 6.5 MB including the map data).

## The three ways in

| Path | What you do | Where it ends |
|---|---|---|
| **A. Scan a room** `/scan` → `/calibrate` → `/mark` | Stand in the room, aim the crosshair at each floor corner and tap. Phone height + gyroscope pitch + compass heading give each corner's position. You then fix the scale with one measured distance. | 200-trial simulation |
| **B. Draw a layout** `/draw` → `/mark` | Walls, doors, zones; calibrate against a known distance. | 200-trial simulation |
| **C. India map** `/map` → `/map-simulate` | Choose earthquake / flood / cyclone, tap the origin, set the severity, see affected area and population, simulate the road-network evacuation. | Same results screens |

All paths end in `/results` (P50/P95 with bootstrap confidence intervals, exit loads, density contours, rule-based
findings), `/whatif` (re-run with one suggested change, same seed, paired comparison) and `/report` (print/PDF + JSON).

## How the numbers are made (short version)
* **Walking speed:** Weidmann (1993) fundamental diagram, scaled per person (adult/child/elderly/wheelchair).
* **Routing:** first-order Fast Marching Method travel-time field per exit; agents descend it on an 8-neighbour grid.
* **Doors:** SFPE effective width (width − 0.3 m) × 1.3 persons/s/m, FIFO single-server queue.
* **Hazards:** blocked exits, no-go zones, expanding fire (0.5 m/s). Fields are recomputed per hazard "epoch".
* **Monte Carlo:** 200 seeded trials (mulberry32), lognormal pre-movement delays, bootstrap CIs (1000 resamples).
  The same seed always gives the same answer. Every run checks that people are conserved (in = out + dead + inside).
* **Findings:** a fixed rule table over the results; every finding carries its evidence. An optional on-device LLM
  (WebLLM, Phi-3-mini) may only re-word a finding and is rejected if it changes a number; it has a 10 s timeout.
  It needs WebGPU and ≥ 4 GB of device memory and downloads about 2 GB on first use. Build with
  `VITE_DISABLE_LLM=1 npm run build` to remove that behaviour entirely. Its 6 MB runtime is excluded from the offline precache.
* **Map path (V2):** published models instead of ad-hoc ones.
  * *Cyclone:* Holland (1980) wind profile, Willoughby–Rahn radius of maximum wind, Atkinson–Holliday pressure–wind,
    Kaplan–DeMaria inland decay, Saffir–Simpson surge decaying 0.35 m per km inland, translation asymmetry. The eye
    moves along the chosen heading and speed; the footprint is the swept area, with arrival time per cell.
  * *Earthquake:* Wells & Coppersmith (1994) rupture length, distance to the whole fault, Worden et al. (2012) MMI, S-wave
    arrival time; magnitudes beyond what the regional seismic zone can produce are refused.
  * *Flood:* rainfall (mm) → SCS Curve Number runoff, Priority-Flood (Barnes 2014) drainage on the DEM, Leopold–Maddock
    stage, rising-limb hydrograph. A climatology check refuses implausible rain (300 mm in the Thar) and says why.
  * *Evacuation:* severity decides who is *ordered out* (`orders.ts`); everyone else shelters in place. Evacuees travel the
    contracted road graph to a refuge just outside the footprint (FIFO queues, roads closing as the hazard arrives), and a
    capacity-constrained greedy transportation plan then assigns them to the nearest shelter with room within 10 h. The
    results panel reports the overflow that nothing could absorb.
  * The affected-area map replays the hazard over about ten seconds with a clock (still frame when "reduce motion" is on).

## Data tier: READ THIS before trusting a map result
The specification's preferred sources (WorldPop 1 km, Copernicus DEM, OSM, HydroSHEDS) were **not reachable** when this
was built. The app ships the fallback tier and says so in the UI, the report and the manifest
(`public/data/data-manifest.json`, `tier: "fallback"`):

* population: Census 2011 district totals spread **uniformly** over district polygons (cities are not concentrated);
* elevation: ETOPO1 at ~18 km effective resolution (river banks and embankments are averaged away);
* roads: the Natural Earth major-road skeleton (758 polylines), not the real network;
* shelters: 207 towns of 50 000+ with an **assumed** capacity of 10 % of the town's population (the V2 capacity-aware plan therefore still overflows in big events; it reports how much);
* rainfall normals and seismic-zone boxes used for the plausibility checks are hand-compiled and coarse;
* rivers: Natural Earth centre-lines.

Flood and surge extents, shelter overload and road bottlenecks are therefore **indicative**. `scripts/fetch-sources.sh`
documents the full-resolution upgrade; `npm run prepare-data` regenerates `public/data/*` in the same formats.

## Layout
```
src/engine/            speed, doors, FMM, grid, hazards, agents, Monte Carlo (+worker); disaster/ = Path C models
src/ai/                rule table, templates, what-if, optional LLM
src/draw, marking/     editors + validation          src/scan/   camera geometry, sensors, calibrate
src/simulation, results, report/   screens           src/map/    wizard, MapLibre map, overlays, data loader
src/settings.ts, theme.ts  accessibility settings + palette    src/demo/   built-in example plan
src/persistence/       IndexedDB autosave (idb)       scripts/    data pipeline
e2e/                   Playwright tests + screenshots
DEVIATIONS.md          every place this build differs from the written specification, and why
```

## What has NOT been verified
* The camera + gyroscope on a **real phone**. The geometry has unit tests and the screen was driven with a synthetic
  camera stream and emulated orientation events in Chromium, but real sensor noise, axis conventions on specific
  devices and iOS Safari behaviour are untested. Expect ±10–20 % distance error; that is why `/calibrate` exists.
* A real HTTPS deployment (not possible from the build environment).
* Safari/Firefox (only Chromium was available). MapLibre needs WebGL; without it the map path falls back to typed coordinates.
* The deployed GitHub Pages site itself: the workflow and the base-path build were exercised locally (`vite preview`, Playwright), never on GitHub.
* Real WebGPU on-device LLM inference. Rules-only findings are what was tested.
* The map-path outputs against any real evacuation record: the model is a structured assumption set, not a calibrated one.
