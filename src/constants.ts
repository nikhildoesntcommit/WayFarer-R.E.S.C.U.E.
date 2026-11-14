// Every model parameter lives here, with its source. No magic numbers elsewhere in the codebase.

export const WEIDMANN = {
  v0: 1.34, // m/s, Weidmann 1993 free-flow walking speed
  rhoMax: 5.4, // persons/m², Weidmann 1993
  gamma: 1.913, // m²/person, Weidmann 1993
} as const;

export const DOOR = {
  specificFlowDefault: 1.3, // persons/(m·s), SFPE planning value
  boundaryLayerPerSide: 0.15, // m, SFPE Handbook
  minUsableWidthM: 0.4, // m, below this the door is invalid
} as const;

export const WALKING_SPEED = {
  adultMean: 1.34, adultStdDev: 0.26, adultMin: 0.8, adultMax: 1.8,
  childMean: 0.9, childStdDev: 0.2, childMin: 0.4, childMax: 1.4,
  elderlyMean: 0.8, elderlyStdDev: 0.2, elderlyMin: 0.4, elderlyMax: 1.2,
  wheelchairMean: 0.7, wheelchairStdDev: 0.15, wheelchairMin: 0.3, wheelchairMax: 1.1,
} as const;

export const PRE_MOVEMENT = {
  median: 41, // s, calibrated so P(≤40s)≈49%, P(≤100s)≈90%
  sigma: 0.7, // lognormal sigma
} as const;

export const MONTE_CARLO = {
  defaultRuns: 200,
  searchRuns: 100,
  bootstrapIterations: 1000,
  progressEvery: 20, // runs between progress messages
} as const;

export const DENSITY = {
  neighbourhoodRadiusM: 1.0,
} as const;

export const BSI = {
  rhoSafe: 2.0, // persons/m², project-defined threshold (Fruin LOS boundary)
  rhoCritical: 3.5, // persons/m², USCG congestion threshold
  jMax: 1.225, // persons/(m·s), Weidmann max specific flow
  epsilon: 0.01,
  flagDuration: 10, // s, density must exceed threshold this long
} as const;

export const SEEDS = {
  master: 42,
} as const;

// ---- Route choice (V2). Bounded-rational, queue-aware exit choice; none of this is in the original specification. ----
export const ROUTE = {
  /** Share of people who keep checking whether another exit would be quicker. The rest follow their first choice. */
  replannerShare: 0.7,
  /** Each person misjudges each exit's travel time by a fixed lognormal factor (sigma), so near-equal exits are split. */
  perceptionSigma: 0.1,
  thinkIntervalS: 2, // s between a re-planner's reconsiderations
  viewTimeS: 20, // s of walking: an exit's queue is only visible (and counted) from this close
  commitTimeS: 4, // s from the door: nobody changes their mind this close
  switchMargin: 0.15, // the new exit must look at least this much (fraction) quicker...
  switchMinGainS: 4, // ...and at least this many seconds quicker (hysteresis against flip-flopping)
  switchPenaltyS: 3, // s, the cost of turning around
  maxSwitches: 2, // a person changes their mind at most this often
  enRouteWeight: 0.5, // people walking toward an exit count this much (each) as if already waiting in its queue
} as const;

// ---- Simulation numerics (not in the original table; named here so nothing is magic) ----
export const SIM = {
  dtS: 0.1, // s, time step (spec §6.5)
  maxTimeS: 1200, // s, safety cap (spec §6.5)
  minSpeedMS: 0.05, // m/s, soft floor prevents numerical deadlock (spec §6.5)
  fireAvoidBandM: 4, // m beyond the fire front within which routes are penalised (heat, smoke, panic)
  fireMinSpeedFactor: 0.2, // effective speed factor for routing right at the fire front (1 at the edge of the band)
  fireTickS: 1, // s, how often the routing fields are recomputed while a fire grows
  defaultMetresPerCell: 0.5, // m, simulation grid resolution
  maxCellsPerSide: 200, // grid is coarsened if a plan would exceed this
  wallThicknessM: 0.2, // m, drawn wall thickness
  perimeterMarginM: 1.0, // m, margin added around the walls when the perimeter is derived
  casualtyBinM: Math.SQRT2, // m, side of a "2 m²" casualty-clustering region
  diagonalCost: Math.SQRT2,
  separationM: 0.45, // m, minimum centre-to-centre spacing (body width, Fruin). 0 reproduces the literal point-agent model of the spec.
  traceIntervalS: 0.5, // s, animation frame spacing for the preview run
  maxTraceFrames: 800,
  fireMaxEpochs: 40, // routing-field recomputations allowed per growing fire
  doorEndToleranceCells: 0.25, // fraction of a cell the door opening may overhang the door ends
  doorBandCells: 1.0, // cells either side of a wall centre-line that a door clears
} as const;

/**
 * Fire and smoke (V3). Published relations, with assumptions marked.
 * - Heat release follows a t-squared design fire, Q = alpha t^2 (NFPA 72 / SFPE; 0.0469 kW/s^2 is "fast"), until the fuel limits it.
 * - The flaming area is Q divided by the heat release per unit area of burning furnishings.
 * - Smoke is carried by the ceiling jet: radial speed u = 0.195 Q^(1/3) H^(1/2) / r^(5/6) (Alpert 1972). The front is
 *   followed along walkable space, so it stops at walls and flows through open doors.
 * - Smoke slows walking (Jin 1978: roughly half speed in dense smoke) and harms by exposure time, like a fractional
 *   effective dose (ISO 13571): the dose rate is high next to the fire and falls with distance. ASSUMED values below.
 */
export const FIRE = {
  alphaKWs2: 0.0469,
  peakKW: 5000, // ASSUMED: fuel-limited peak heat release of a room fire
  hrrpuaKWm2: 500, // heat release per unit burning area of furnishings
  ceilingHeightM: 3.0, // ASSUMED
  smokeSpeedFactor: 0.5, // walking speed multiplier inside smoke
  doseNearS: 60, // ASSUMED: seconds of exposure to incapacitate right at the fire
  doseFarS: 600, // ASSUMED: seconds of exposure to incapacitate at the thin edge of the smoke
  doseDecayM: 6, // m, how quickly the dose rate falls with distance from the fire
  cueDelayS: 5, // people who are standing in smoke stop waiting and start moving after this
  stepS: 0.5, // s, resolution of the front-tracking table
  maxSmokeTimeS: 900, // s, smoke is followed for at most this long
} as const;

export const FINDINGS = {
  overloadUtilisation: 0.7,
  underusedUtilisation: 0.4,
  criticalUtilisation: 0.9,
  queueCriticalS: 120,
  queueWarningS: 60,
  casualtyClusterCount: 3,
  widenFactor: 1.5, // "Try this" widens a bottleneck exit by this factor
  roadBottleneckShare: 0.6,
  shelterOverloadRatio: 1.5,
  shelterUnderusedRatio: 0.4,
  floodTimingEscapeShare: 0.9,
} as const;

export const MAP = {
  gridResolutionDeg: 0.05, // ~5.5 km cells
  earthquake: {
    depthKmDefault: 10,
    magnitudeMin: 5.0,
    magnitudeMax: 8.5,
    damageThresholdPGA: 0.1, // g, above this is "damaging"
    pgaThresholdsG: [0.05, 0.1, 0.2, 0.4, 0.8, 1.6],
    // Simplified GMPE: log10(PGA_g) = a + b*M - c*log10(Rh + d*exp(e*M))
    // DEVIATION (see DEVIATIONS.md): the specified set a=-0.5, b=0.3, c=1.1, d=10, e=0.5 can never reach the 0.1 g damage
    // threshold (its peak is 0.082 g, at M8.5 directly above the source), so no earthquake would affect anyone. d and e
    // follow Campbell (1981)'s near-source saturation h = 0.0606*exp(0.7M) km; a, b, c were fitted by hand to
    // M7 ≈ 0.35 g at 10 km and ≈ 0.1 g at ~55 km, M8 ≈ 0.5 g at 10 km. Indicative only, not a calibrated Indian GMPE.
    pgaCoefficients: { a: -1.424, b: 0.318, c: 1.0, d: 0.0606, e: 0.7 },
    specLiteralCoefficients: { a: -0.5, b: 0.3, c: 1.1, d: 10, e: 0.5 },
    roadBlockPgaG: 0.2, // g, below this a road is never blocked
    roadBlockPgaFullG: 1.0, // g, at/above this the blocking probability reaches roadBlockMaxProb
    roadBlockMaxProb: 0.6,
    sWaveKmS: 3.5, // km/s, crustal S-wave speed: strong shaking arrives with it
    strikeDegDefault: 135, // fault direction (deg from north) when none is given; the Himalayan arc runs roughly NW-SE
  },
  flood: {
    defaultRiseRateMperHr: 0.05,
    connectivityMaxDistCells: 10, // max BFS distance from river/coast to be "connected"
    originSearchKm: 2, // river cells must lie within this distance of the tapped origin
    riverSnapKm: 0.5, // ...and within this distance of a river polyline
    coastSeedKm: 1, // coastal seed cells lie within this distance of the sea boundary
  },
  cyclone: {
    categoryVmaxMS: [33, 43, 50, 58, 70], // IMD categories 1-5 max sustained wind
    rmaxKmDefault: 40,
    hollandBDefault: 1.5,
    damagingWindMS: 25,
    windContoursMS: [25, 35, 50, 60],
    surgeMaxElevM: 5, // (V1) cells below this near coast get surge
    surgeRadiusFactor: 2.0, // (V1) multiple of Rmax
    // ---- V2: moving storm ----
    translationKmhDefault: 20, // IMD: Bay of Bengal and Arabian Sea cyclones typically move 10-25 km/h
    leadHoursDefault: 24, // warning time between the alert and landfall (IMD issues a cyclone alert about 48 h and a warning about 24 h ahead; V2 used 12 h)
    galeWindMS: 20, // m/s: travel is unsafe from here (IMD gale >= 17.5 m/s; 20 m/s allows for gusts)
    decay: { vb: 13.7, alphaPerHour: 0.095, landfallReduction: 0.9 }, // Kaplan & DeMaria (1995), V_b = 26.7 kt
    surgePeakM: [1.4, 2.1, 3.2, 4.7, 6.0], // peak coastal surge by category: mid-points of the Saffir-Simpson ranges
    surgeDecayMPerKm: 0.35, // inland attenuation; Odisha 1999 (~7 m surge, reached 15-20 km inland)
  },
  earthRadiusKm: 6371.0088,
  // ---- Path C road-network model (values not given by the specification; every one is an assumption) ----
  roads: {
    snapDeg: 0.02, // vertices closer than this are one junction (the road skeleton is not topologically clean)
    maxAccessKm: 50, // a population cell farther than this from any road node is unreachable
    accessSpeedKmh: 15, // cell centre -> first road node
    roadSpeedKmh: 35, // congested evacuation speed on a national highway
    roadCapacityPerHour: 60_000, // persons/h through one skeleton edge: it stands for a corridor of ~10 parallel roads (≈ 2000 veh/h x 3 persons/veh each)
    shelterIntakeMinPerHour: 60_000, // persons/h a shelter can admit, at least (the gate is never slower than the road that feeds it)...
    shelterIntakeCapacityFractionPerHour: 0.25, // ...or this fraction of its nominal capacity per hour, whichever is larger
  },
  evac: {
    maxShelterTravelS: 4 * 3600, // V3: beds are planned within ~4 h of driving (assumption; V2 used 10 h and sent people across states)
    preMovementMedianS: 1800, // s, warning-to-departure at regional scale (the building value of 41 s is not applicable)
    preMovementSigma: 0.7,
    nodeJitterSigma: 0.25, // per-node, per-trial multiplicative departure noise
    trialJitterSigma: 0.2, // per-trial warning-efficacy noise shared by all nodes
    maxTimeS: 72 * 3600, // s, safety cap
    cyclonLandfallEtaS: 6 * 3600, // s, time from alert to landfall (wind > 35 m/s and surge close roads from then)
    cycloneRoadClosingWindMS: 35,
    eventBudgetPerTrial: 60_000, // cohort-edge events per trial; the number of cohorts per node adapts to stay below it
    maxCohortsPerNode: 8,
    maxShelterRangeKm: 600,
    alternateRangeKm: 120, // a shelter is only proposed as an alternative to an overloaded one if it is this close
  },
} as const;

/** Group behaviour. About 70 % of pedestrians move in groups, mostly pairs (Moussaïd, Perozo, Garnier, Helbing, Theraulaz 2010). The split below is that finding rounded; the gather time is ASSUMED. */
export const GROUPS = {
  size1: 0.3,
  size2: 0.4,
  size3: 0.2, // size 4 takes the remaining 0.1
  gatherS: 5, // s, extra time for companions to find each other before leaving
  spreadM: 1.0, // m, how far apart companions start
} as const;

export const CONTOUR = {
  densityLevels: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0], // persons/m²
  drawInMs: 800,
  lineOpacity: 0.4,
} as const;

export const APP = {
  name: 'WayFarer R.E.S.C.U.E.',
  version: '3.0.0',
  modelVersion: 'wayfarer-engine-3.0 (Weidmann 1993 / SFPE / first-order FMM / queue-aware exit choice)',
  disclaimer: 'A planning tool, not a certified safety assessment.',
  exhibition: {
    theme: 'STEM for Science, Technology, and Innovation for a Sustainable and Vikshit Bharat',
    subTheme: 'Mathematical Modelling and Computational Thinking',
    category: 'Category II (Classes 9–11)',
    school: 'Apeejay School, Saket',
    authors: 'Nikhil Shukla and Hitarth Bisht (Class IX)',
  },
} as const;

