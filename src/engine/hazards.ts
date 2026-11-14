import { FIRE, SIM, WEIDMANN } from '../constants';
import type { Hazard, Plan, WorldPoint } from '../types';
import { pointInPolygon, polygonCentroid } from '../utils/geo';
import { cellCentre, type Grid } from './grid';
import { fastMarchingFlat } from './fmm';

/**
 * Routing state valid from time `t` until the next epoch.
 * Hazards are deterministic given the plan, so every epoch (and its travel-time fields) is computed once and
 * shared by all Monte Carlo runs instead of being recomputed inside each run.
 */
export interface FieldEpoch {
  t: number;
  walk: Uint8Array;
  blockedExits: Set<string>;
  /** Travel-time field per exit, indexed like `exitIds`. All Infinity for a blocked exit. */
  T: Float32Array[];
}

interface ZoneHazard {
  activeAt: number;
  mask: Uint8Array;
}
export interface FireHazard {
  activeAt: number;
  x: number;
  y: number;
  /** walking distance (m) from the ignition point through open space; Infinity if unreachable */
  dist: Float32Array;
  /** absolute time at which each cell starts to burn / fills with smoke; Infinity = never */
  flameAt: Float32Array;
  smokeAt: Float32Array;
}

export interface HazardRuntime {
  epochs: FieldEpoch[];
  zones: ZoneHazard[];
  fires: FireHazard[];
  /** time at which each blocked_exit hazard fires */
  blockedExitAt: Map<string, number>;
}

/** Heat release (kW) of the design fire `s` seconds after ignition. */
export function heatRelease(s: number): number {
  return Math.min(FIRE.peakKW, FIRE.alphaKWs2 * s * s);
}

/** Flaming radius (m) `s` seconds after ignition, from the burning area. */
export function flameRadius(s: number): number {
  return Math.sqrt(heatRelease(s) / FIRE.hrrpuaKWm2 / Math.PI);
}

/** Radius reached by the smoke front, tabulated every FIRE.stepS: integrates Alpert's ceiling-jet speed as the fire grows. */
export function smokeFrontTable(): Float32Array {
  const n = Math.ceil(FIRE.maxSmokeTimeS / FIRE.stepS) + 1;
  const R = new Float32Array(n);
  const H = FIRE.ceilingHeightM;
  let r = 0.18 * H;
  for (let k = 1; k < n; k++) {
    const q = Math.max(1, heatRelease(k * FIRE.stepS));
    const u = (0.195 * Math.cbrt(q) * Math.sqrt(H)) / Math.pow(Math.max(r, 0.18 * H), 5 / 6);
    r += u * FIRE.stepS;
    R[k] = r;
  }
  return R;
}

/** First index whose value reaches `d` (the table is non-decreasing), or -1. */
function firstReaching(table: Float32Array, d: number): number {
  if (d <= table[0]!) return 0;
  if (table[table.length - 1]! < d) return -1;
  let lo = 0;
  let hi = table.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (table[mid]! >= d) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function fireOrigin(h: Hazard): WorldPoint {
  const p = h.polygonWorld ?? [];
  return p.length === 0 ? { x: 0, y: 0 } : p.length === 1 ? p[0]! : polygonCentroid(p);
}

export interface HazardOptions {
  /** Penalise routes that pass close to a fire (default true). false = the V1 behaviour: only the burning cells are blocked. */
  fireAvoidance?: boolean;
}

export function buildHazardRuntime(plan: Plan, grid: Grid, exitIds: string[], opts: HazardOptions = {}): HazardRuntime {
  const avoid = opts.fireAvoidance !== false;
  const { rows, cols } = grid;
  const zones: ZoneHazard[] = [];
  const fires: FireHazard[] = [];
  const blockedExitAt = new Map<string, number>();
  const smokeTable = smokeFrontTable();

  for (const h of plan.hazards) {
    if (h.kind === 'no_go_zone' && h.polygonWorld && h.polygonWorld.length >= 3) {
      const mask = new Uint8Array(rows * cols);
      for (let i = 0; i < mask.length; i++) if (pointInPolygon(cellCentre(grid, i), h.polygonWorld)) mask[i] = 1;
      zones.push({ activeAt: h.activeAtSeconds, mask });
    } else if (h.kind === 'fire_origin') {
      const o = fireOrigin(h);
      fires.push(buildFire(grid, h.activeAtSeconds, o, smokeTable));
    } else if (h.kind === 'blocked_exit' && h.doorId) {
      const prev = blockedExitAt.get(h.doorId);
      if (prev === undefined || h.activeAtSeconds < prev) blockedExitAt.set(h.doorId, h.activeAtSeconds);
    }
  }

  // Epoch boundaries
  const times = new Set<number>([0]);
  for (const z of zones) times.add(z.activeAt);
  for (const t of blockedExitAt.values()) times.add(t);
  for (const f of fires) {
    times.add(f.activeAt);
    let span = 0;
    for (let i = 0; i < f.smokeAt.length; i++) if (Number.isFinite(f.smokeAt[i]!)) span = Math.max(span, f.smokeAt[i]! - f.activeAt);
    const duration = Math.min(span, FIRE.maxSmokeTimeS);
    const tick = Math.max(SIM.fireTickS, duration / SIM.fireMaxEpochs);
    for (let t = f.activeAt + tick; t <= f.activeAt + duration + tick; t += tick) times.add(Math.round(t * 1000) / 1000);
  }
  const sorted = [...times].filter((t) => t >= 0).sort((a, b) => a - b);

  const epochs: FieldEpoch[] = [];
  for (const t of sorted) {
    const walk = grid.walk.slice();
    for (const z of zones) if (t >= z.activeAt) for (let i = 0; i < walk.length; i++) if (z.mask[i]) walk[i] = 0;
    for (const f of fires) {
      if (t < f.activeAt) continue;
      for (let i = 0; i < walk.length; i++) if (walk[i] && f.flameAt[i]! <= t) walk[i] = 0;
    }
    const blocked = new Set<string>();
    for (const [id, at] of blockedExitAt) {
      if (t >= at) {
        blocked.add(id);
        for (const cell of grid.exits.get(id) ?? []) walk[cell.row * cols + cell.col] = 0;
      }
    }
    // Routing speed: full walking speed; slower in smoke and in a band around the flames so that routes bend away from them.
    let speed: Float32Array | undefined;
    const burning = fires.filter((f) => t >= f.activeAt);
    if (avoid && burning.length > 0) {
      speed = new Float32Array(rows * cols).fill(WEIDMANN.v0);
      for (let i = 0; i < speed.length; i++) {
        if (!walk[i]) continue;
        let k = 1;
        let d = Infinity;
        for (const f of burning) {
          if (f.smokeAt[i]! <= t) k = FIRE.smokeSpeedFactor;
          d = Math.min(d, f.dist[i]! - flameRadius(t - f.activeAt));
        }
        if (d < SIM.fireAvoidBandM) k = Math.min(k, SIM.fireMinSpeedFactor + (1 - SIM.fireMinSpeedFactor) * Math.max(0, d) / SIM.fireAvoidBandM);
        speed[i] = WEIDMANN.v0 * k;
      }
    }
    const T = exitIds.map((id) => {
      if (blocked.has(id)) return new Float32Array(rows * cols).fill(Infinity);
      const src = (grid.exits.get(id) ?? []).map((c) => c.row * cols + c.col);
      return fastMarchingFlat(walk, rows, cols, src, speed ?? WEIDMANN.v0, grid.metresPerCell);
    });
    epochs.push({ t, walk, blockedExits: blocked, T });
  }
  return { epochs, zones, fires, blockedExitAt };
}

/** Walking distances, flame arrival and smoke arrival for one fire. Both fronts follow open space, never through walls. */
function buildFire(grid: Grid, activeAt: number, o: WorldPoint, smokeTable: Float32Array): FireHazard {
  const { rows, cols } = grid;
  const n = rows * cols;
  // nearest walkable cell to the ignition point
  let src = -1;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    if (!grid.walk[i]) continue;
    const c = cellCentre(grid, i);
    const d = Math.hypot(c.x - o.x, c.y - o.y);
    if (d < best) { best = d; src = i; }
  }
  const dist = new Float32Array(n).fill(Infinity);
  const flameAt = new Float32Array(n).fill(Infinity);
  const smokeAt = new Float32Array(n).fill(Infinity);
  if (src >= 0) {
    const g = fastMarchingFlat(grid.walk, rows, cols, [src], 1, grid.metresPerCell); // speed 1 m/s: seconds are metres
    const flame = new Float32Array(Math.ceil(FIRE.maxSmokeTimeS / FIRE.stepS) + 1);
    for (let k = 0; k < flame.length; k++) flame[k] = flameRadius(k * FIRE.stepS);
    for (let i = 0; i < n; i++) {
      dist[i] = g[i]!;
      if (!Number.isFinite(g[i]!)) continue;
      const kf = firstReaching(flame, g[i]!);
      if (kf >= 0) flameAt[i] = activeAt + kf * FIRE.stepS;
      const ks = firstReaching(smokeTable, g[i]!);
      if (ks >= 0) smokeAt[i] = activeAt + ks * FIRE.stepS;
    }
  }
  return { activeAt, x: o.x, y: o.y, dist, flameAt, smokeAt };
}

/** Just the fires of a plan (no routing fields): used by the preview to draw flames and smoke spreading. */
export function buildFires(plan: Plan, grid: Grid): FireHazard[] {
  const table = smokeFrontTable();
  return plan.hazards.filter((h) => h.kind === 'fire_origin').map((h) => buildFire(grid, h.activeAtSeconds, fireOrigin(h), table));
}

/** Index of the epoch in force at time t. */
export function epochIndexAt(rt: HazardRuntime, t: number): number {
  let lo = 0;
  let hi = rt.epochs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rt.epochs[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Is a person in `cellIdx` inside an active no-go zone or in flames at time t? (Immediately fatal.) */
export function inHazard(rt: HazardRuntime, _x: number, _y: number, cellIdx: number, t: number): boolean {
  for (const z of rt.zones) if (t >= z.activeAt && z.mask[cellIdx]) return true;
  for (const f of rt.fires) if (t >= f.activeAt && f.flameAt[cellIdx]! <= t) return true;
  return false;
}

/** Share of a lethal dose accumulated per second by someone standing in this cell now (0 if there is no smoke). */
export function smokeDoseRate(rt: HazardRuntime, cellIdx: number, t: number): number {
  let rate = 0;
  for (const f of rt.fires) {
    if (t < f.activeAt || f.smokeAt[cellIdx]! > t) continue;
    const far = 1 / FIRE.doseFarS;
    const near = 1 / FIRE.doseNearS;
    rate = Math.max(rate, far + (near - far) * Math.exp(-f.dist[cellIdx]! / FIRE.doseDecayM));
  }
  return rate;
}
