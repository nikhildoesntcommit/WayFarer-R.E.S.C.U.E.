export interface WorldPoint { x: number; y: number; }
export type WorldPolygon = WorldPoint[];

export interface Cell {
  row: number;
  col: number;
}

export type CellType = 'WALKABLE' | 'WALL' | 'OBSTACLE' | 'DOOR' | 'EXIT' | 'HAZARD';

export interface Door {
  id: string;
  wallId: string;
  startWorld: WorldPoint;
  endWorld: WorldPoint;
  widthM: number;
  isExit: boolean;
}

export interface GroupMix {
  adult: number;
  child: number;
  elderly: number;
  wheelchair: number;
}

/**
 * A "people area": floor space where a number of people are spread evenly at the moment the alarm sounds.
 * (The type keeps its historical name; the interface calls it an area. It has nothing to do with walls.)
 */
export interface Cluster {
  id: string;
  label: string;
  polygonWorld: WorldPolygon;
  people: number;
  groupMix: GroupMix;
  /** Set only on the synthetic cluster built from a hotspot (see utils/sources.ts); never stored in a plan. */
  hotspot?: { at: WorldPoint; radiusM: number };
}

/**
 * A point where extra people are gathered (a food stall, a notice board, a stage). Their number is ADDED to any
 * area they stand in; they bunch around `at`, thinning out to nothing at `radiusM`.
 */
export interface Hotspot {
  id: string;
  label: string;
  at: WorldPoint;
  people: number;
  radiusM: number;
  groupMix: GroupMix;
}

export interface Hazard {
  id: string;
  kind: 'blocked_exit' | 'no_go_zone' | 'fire_origin';
  polygonWorld?: WorldPolygon;
  doorId?: string;
  activeAtSeconds: number;
}

/** A drawn wall centre-line. wallsWorld polygons are derived from these. */
export interface WallSegment {
  id: string;
  a: WorldPoint;
  b: WorldPoint;
}

export interface Plan {
  /** 2 = people areas + hotspots, exits derived from the outer wall. Version-1 plans are migrated on load. */
  version: 2;
  id: string;
  name: string;
  source: 'camera' | 'draw';
  metresPerCell: number;
  buildingPerimeterWorld: WorldPolygon;
  wallsWorld: WorldPolygon[];
  obstaclesWorld: WorldPolygon[];
  doors: Door[];
  /** People areas (historical name). */
  clusters: Cluster[];
  hotspots: Hotspot[];
  hazards: Hazard[];
  alarmTimeSeconds: number;
  masterSeed: number;
  createdAt: number;
  updatedAt: number;
  // ---- Additions required by the spec's own features (flagged in the hand-over notes) ----
  /** Wall centre-lines: needed so doors/exits can be placed on, and plans re-edited from, a wall. */
  wallSegments?: WallSegment[];
  /** Per-cluster exit override. Required for the "reassign cluster to Exit B" what-if. */
  clusterExitAssignment?: Record<string, string>;
}

export interface MapScenario {
  id: string;
  disasterKind: 'earthquake' | 'flood' | 'cyclone';
  originLat: number;
  originLon: number;
  magnitude?: number; // earthquake
  waterLevelM?: number; // flood (V1 scenarios; V2 uses rainfallMm)
  riseRateMperHr?: number; // flood (V1)
  rainfallMm?: number; // flood: rainfall in 24 h that triggers it
  category?: 1 | 2 | 3 | 4 | 5; // cyclone
  headingDeg?: number; // cyclone: direction of travel, degrees clockwise from north (omitted = from the sea, across the coast)
  speedKmh?: number; // cyclone: translation speed
  leadHours?: number; // cyclone: warning time before landfall
  strikeDeg?: number; // earthquake: fault direction
  masterSeed: number;
  createdAt: number;
}

export interface SimulationResult {
  strategy: 'as_marked';
  runs: number;
  completionTimes: Float32Array;
  exitTimes: Float32Array;
  p50: number;
  p95: number;
  mean: number;
  stdDev: number;
  ci95P50Lower: number;
  ci95P50Upper: number;
  ci95P95Lower: number;
  ci95P95Upper: number;
  /** Sums over all runs; divide by `runs` for the per-run mean. evacuated+casualties+remaining === runs*totalPeople. */
  evacuated: number;
  casualties: number;
  remaining: number;
  unreachable: string[];
  /** Mean persons per run through each exit. */
  exitLoads: Record<string, number>;
  /** exitLoads / totalPeople (share of the crowd that used the exit). */
  exitUtilisation: Record<string, number>;
  /** Mean queue wait (s) at each exit, over everyone who queued. */
  exitQueueTimes: Record<string, number>;
  /** Mean over runs of each cell's peak local density (persons/m²), row-major. */
  densityHeatmap: Float32Array;
  heatmapRows: number;
  heatmapCols: number;
  conservationPass: boolean;

  // ---- Optional extras the rules need (the spec's rule table references values the base type lacks) ----
  totalPeople?: number;
  exitQueueMaxTimes?: Record<string, number>;
  peakDensity?: number;
  peakDensityCell?: Cell;
  bottleneckSeconds?: number;
  bottleneckCell?: Cell;
  casualtyHotspot?: { x: number; y: number; meanPerRun: number };
  clusterMeanTimes?: Record<string, number>;
  clusterExitShare?: Record<string, Record<string, number>>;
  clusterPeople?: Record<string, number>;
  /** Present for Path C results. */
  mapStats?: MapSimStats;
}

export interface Finding {
  id: string;
  severity: 'critical' | 'warning' | 'note';
  category:
    | 'exit_overload'
    | 'bottleneck'
    | 'queue'
    | 'unreachable'
    | 'casualty'
    | 'slow_cluster'
    | 'imbalance'
    | 'road_bottleneck'
    | 'shelter_overload';
  message: string;
  evidence: Record<string, unknown>;
  recommendation: string;
  predictedImprovementSeconds?: number;
  /** Machine-readable change the "Try this" button applies. Absent => no automatic what-if exists. */
  action?: FindingAction;
}

export type FindingAction =
  | { kind: 'widen_exit'; doorId: string; newWidthM: number }
  | { kind: 'reassign_cluster'; clusterId: string; toExitId: string }
  | { kind: 'add_exit'; door: Door }
  | { kind: 'reassign_shelter'; fromShelterId: string; toShelterId: string; people: number };

// ---------------------------------------------------------------------------
// Path C (map) shared shapes
// ---------------------------------------------------------------------------

export interface IndiaGrid {
  rows: number;
  cols: number;
  minLat: number;
  minLon: number;
  resDeg: number;
  /** Cell-centre coordinates, row-major (row 0 = southernmost row). */
  lat: Float32Array;
  lon: Float32Array;
  elevationM: Float32Array;
  population: Float32Array;
  /** 1 = inside India's outline */
  landMask: Uint8Array;
  /** 1 = land cell touching the sea */
  coastMask: Uint8Array;
}

export interface MapAnalysis {
  scenario: MapScenario;
  affectedCellIndices: number[];
  surgeCellIndices: number[];
  /** PGA (g) / wind (m/s) / flood depth (m) per grid cell, for contour rendering. */
  fieldByCell: Float32Array | null;
  totalPopulation: number;
  areaKm2: number;
  settlements: { name: string; population: number }[];
  // ---- extras the road-network simulation needs ----
  /** Earthquake: probability that a road crossing the cell is blocked at t = 0. */
  blockProbByCell?: Float32Array | null;
  /** Flood / cyclone: seconds after the alert at which the cell stops being passable (Infinity = never). */
  blockTimeByCell?: Float32Array | null;
  /** Flood depth (m) per cell for rendering. */
  depthByCell?: Float32Array | null;
  /** Human label of the affected region (nearest town to the origin). */
  regionName: string;
  /** Seconds after the alert at which the hazard first reaches each cell (for the animated replay); Infinity = never. */
  arrivalTimeByCell?: Float32Array | null;
  /** Length of the animated replay in scenario seconds. */
  durationS?: number;
  /** Cyclone eye track. */
  track?: { t: number; lat: number; lon: number; vmax: number; rmaxKm: number }[];
  /** Plain-language facts about how the hazard was modelled, shown to the user. */
  facts?: string[];
  /** Plausibility notes (rarity of the event at this place). */
  notes?: string[];
  /** Share of each cell's residents who are ordered or forced to leave (the rest shelter in place). */
  evacShareByCell?: Float32Array | null;
  /** People who evacuate (the footprint population weighted by the shares). */
  evacPopulation?: number;
}

export interface MapSimStats {
  edgeFlowShare: { edgeId: string; share: number; label: string }[];
  shelterLoads: { shelterId: string; name: string; load: number; capacity: number; lat?: number; lon?: number }[];
  unreachablePopulation: number;
  /** evacuees for whom no shelter had spare capacity (they are sent to their nearest shelter regardless) */
  plannedOverflow?: number;
  totalShelterCapacity?: number;
  /** Minutes by which the hazard reaches a road before 90% of the population has escaped, if it does. */
  floodTimingGapMin?: number;
  floodRegion?: string;
}

export type DataStatus<T> =
  | { status: 'ok'; data: T }
  | { status: 'missing'; reason: string };
