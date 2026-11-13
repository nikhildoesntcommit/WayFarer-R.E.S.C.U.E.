# Deviations, spec defects and assumptions

The specification was "locked" and said not to improve the mathematical models without asking. Where the literal
text could not be implemented, was internally inconsistent, or produced a demonstrably useless result, the choice made
is listed here. Nothing below was changed silently.

## A. Places where the build differs from the literal text

| # | Spec said | What was built | Why | Literal behaviour available? |
|---|---|---|---|---|
| 1 | Earthquake PGA attenuation coefficients as written | Retuned: a=-1.424, b=0.318, c=1.0, d=0.0606, e=0.7 (`MAP.earthquake.pgaCoefficients`) | The literal equation never exceeds ~0.082 g, even at M8 near the epicentre, so the 0.1 g damage threshold is never reached and every earthquake yields an empty footprint. A unit test proves this. | Yes: `specLiteralCoefficients` is kept in `constants.ts` |
| 2 | Agents move strictly by Weidmann speed | A body-separation push (`separationM`) stops agents collapsing onto one cell | Without it, density is meaningless and queues compress to a point | Set `separationM = 0` |
| 3 | Flood start/extent radii 2 km / 500 m | Widened to one grid cell (0.05° ≈ 5.5 km) | Sub-cell radii are not representable on the shipped grid | Needs the full-resolution data tier |
| 4 | Flood depth along a river | Priority-flood "bathtub" with connectivity to river cells; arrival time = (required level − start level)/rise rate | The spec gives no algorithm, only parameters | n/a |
| 5 | Grid of about 150 × 150 cells | 620 × 590 cells at 0.05° covering all of India | 150² cannot hold the country at a usable resolution; the same text elsewhere implies India-wide coverage | n/a |
| 6 | "Four buttons" on the map-path chooser | Three (earthquake, flood, cyclone) | Only three disasters are specified | n/a |
| 7 | Road network from OSM | Natural Earth major roads, snapped at 0.02°, contracted per scenario; contracted edges stand for corridors | OSM was unreachable at build time | Re-run `prepare-data` with real data |
| 8 | Camera heading from `alpha` | `webkitCompassHeading` where present, else `360 − alpha` | The literal use mirrors the plan on Android (alpha increases anticlockwise) | n/a |
| 9 | Road corridor / shelter intake capacities | 60 000 persons/h per corridor direction; shelter gate intake minimum 60 000 persons/h, or 25 % of shelter capacity per hour | The spec gives none; the first values tried (a few thousand/h) capped every run at the 72 h horizon | Tunable in `MAP.roads` |
| 10 | LLM polish | Can be disabled at build time with `VITE_DISABLE_LLM=1`; not in the offline precache | The model is a ~2 GB first-use download | n/a |

## B. Spec inconsistencies that needed a decision
* FMM: neighbour ordering and diagonal seeding are underspecified; the implementation is a first-order per-axis upwind scheme in `Float32` (`Math.fround`, which also fixed an `Infinity` bug).
* Weidmann goes negative past jam density; speed is clamped at a small positive floor.
* The "token bucket" for door capacity is unbounded in the text; implemented as a FIFO single-server queue with service time 1/(1.3·(w−0.3)).
* A Monte-Carlo test described a statistic that conflicts with lognormal pre-movement; the test asserts the lognormal's actual properties.
* The `slow_cluster` finding rule almost never fires with the specified thresholds; left as written.
* Camera: portrait focal length, gamma handedness and `object-fit: cover` mapping are unspecified; defaults chosen and unit-tested (`src/scan/__tests__`).

## C. Limits of the map path (read before using the numbers)
1. **Data is the fallback tier** (see README). Population is uniform within a district; elevation ~18 km; roads a skeleton; shelter capacity assumed at 10 % of town population.
2. Regional evacuation P95 frequently hits the 72 h horizon and the "still inside" count is large. That is driven by the assumed pre-movement delay (median 30 min) and capacities, not by observation.
3. "Nearest shelter ignoring capacity" (the spec's assignment rule) produces extreme overload ratios by construction.
4. Earthquake casualties are reported as 0: there is no building-collapse model, and none was specified.
5. No what-if on the map path (`reassign_shelter` is excluded from "Try this").
6. The single-exit finding fires on traffic share, not on queueing; in tests mean queue ≈ 0.

## C2. V2 changes and the assumptions they add
| # | Change | Why / what is assumed |
|---|---|---|
| V1 | Fire radius capped at 8 m (`fireMaxRadiusM` in `constants.ts`) | Uncapped 0.5 m/s growth swallowed whole rooms and distorted results. **This deviates from the written fire spec.** |
| V2 | Cyclone moves (heading, forward speed, warning time); earthquake is a finite fault; flood is rain-driven | The V1 point-source footprints were static and wrong in shape |
| V3 | Plausibility refusals (flood rain vs climatology, quake Mmax vs seismic zone, cyclone must start at sea) | A Thar flood or a M8.5 in Pune is not a scenario. Climatology and zone boxes are hand-compiled and coarse |
| V4 | Only ordered or trapped people evacuate; the rest shelter in place. Shares in `orders.ts` (cyclone 100 % in surge, 50/25/8 % by wind; flood 100/60/20 % by depth; quake 70/35/10/2 % by MMI) | V1 evacuated the whole footprint (tens of millions) and drowned every shelter. **Shares are assumptions**, scaled to Fani 2019 (about 1.2 M moved of about 15 M exposed); they are not calibrated |
| V5 | Two-stage evacuation: travel to a refuge outside the footprint, then a capacity-constrained greedy assignment to shelters (range-limited, overflow shown against nearest) | Replaces the spec's "nearest shelter ignoring capacity" (see C3). Greedy, not optimal; a min-cost-flow would be better |
| V6 | Replay: hazard revealed by arrival time over ~10 s | Visibility. Plays as a still frame under "reduce motion" |
| V7 | Accessibility settings (text scale, high contrast, colour-blind palette, reduced motion, large targets), Help, example plan | Requested. Settings stay on the device (localStorage) |
| V8 | GitHub Pages build: base path, 404 fallback, `.nojekyll`, Actions workflow | Only the GitHub variant was built; iOS and Mac packaging were deliberately skipped |

Caveat that matters: the "last person out" time (P95/max) is dominated by the lognormal pre-movement tail, not by roads or shelters. Cut the warning delay and the numbers collapse; that sensitivity is real and is shown (36 h of warning gave zero casualties in the cyclone test).

## D. Not verified
* Real phone camera + gyroscope (Android and iOS). Only a synthetic camera stream and emulated orientation events in Chromium.
* A live HTTPS deployment.
* Real WebGPU WebLLM inference. Rules-only findings are what was tested end to end.
* Firefox and Safari.
* Any calibration of the evacuation model against real events.
* The live GitHub Pages deployment (workflow and base path only tested locally).
* The R.E.S.C.U.E. acronym expansion was never supplied; none is invented in the app.
* An independent audit against the original specification was started and never completed.
* Exhibition title and sub-theme cannot be changed after registration (closes 14 Nov 2026); confirm them before then.

## E. Verified
96 unit tests (engine, findings, camera geometry, disasters, evidence, demo plan), type-check, ESLint, and Playwright in Chromium: draw → simulate → results; map earthquake M7 at Delhi → population > 0 → simulate → results; scan without a camera shows an error and "Use draw mode"; offline reload including the map; what-if; report JSON and print-to-PDF; phone-width layout without horizontal overflow; V2: Thar flood refused, Patna rain flood, moving cyclone with replay clock, inland cyclone refused, no great quake on the peninsula, settings persistence, Help authors, example plan. Build verified both at `/` and at a `/wayfarer-rescue/` base.
