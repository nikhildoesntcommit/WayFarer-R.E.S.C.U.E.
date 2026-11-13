import { SIM, WEIDMANN } from '../constants';
import type { Hazard, Plan, WorldPoint } from '../types';
import { boundingBox, pointInPolygon, polygonCentroid } from '../utils/geo';
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
interface FireHazard {
  activeAt: number;
  x: number;
  y: number;
}

export interface HazardRuntime {
  epochs: FieldEpoch[];
  zones: ZoneHazard[];
  fires: FireHazard[];
  /** time at which each blocked_exit hazard fires */
  blockedExitAt: Map<string, number>;
}

export function fireRadius(activeAt: number, t: number): number {
  return t < activeAt ? -1 : Math.min(SIM.fireMaxRadiusM, SIM.fireGrowthMS * (t - activeAt));
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

  for (const h of plan.hazards) {
    if (h.kind === 'no_go_zone' && h.polygonWorld && h.polygonWorld.length >= 3) {
      const mask = new Uint8Array(rows * cols);
      for (let i = 0; i < mask.length; i++) if (pointInPolygon(cellCentre(grid, i), h.polygonWorld)) mask[i] = 1;
      zones.push({ activeAt: h.activeAtSeconds, mask });
    } else if (h.kind === 'fire_origin') {
      const o = fireOrigin(h);
      fires.push({ activeAt: h.activeAtSeconds, x: o.x, y: o.y });
    } else if (h.kind === 'blocked_exit' && h.doorId) {
      const prev = blockedExitAt.get(h.doorId);
      if (prev === undefined || h.activeAtSeconds < prev) blockedExitAt.set(h.doorId, h.activeAtSeconds);
    }
  }

  // Epoch boundaries
  const times = new Set<number>([0]);
  for (const z of zones) times.add(z.activeAt);
  for (const t of blockedExitAt.values()) times.add(t);
  const bb = boundingBox(plan.buildingPerimeterWorld);
  for (const f of fires) {
    times.add(f.activeAt);
    const far = Math.max(
      ...[
        [bb.minX, bb.minY], [bb.maxX, bb.minY], [bb.maxX, bb.maxY], [bb.minX, bb.maxY],
      ].map(([x, y]) => Math.hypot(x! - f.x, y! - f.y)),
    );
    const duration = Math.min(far, SIM.fireMaxRadiusM) / SIM.fireGrowthMS;
    const tick = Math.max(SIM.fireTickS, duration / SIM.fireMaxEpochs);
    for (let t = f.activeAt + tick; t <= f.activeAt + duration + tick; t += tick) times.add(Math.round(t * 1000) / 1000);
  }
  const sorted = [...times].filter((t) => t >= 0).sort((a, b) => a - b);

  const epochs: FieldEpoch[] = [];
  for (const t of sorted) {
    const walk = grid.walk.slice();
    for (const z of zones) if (t >= z.activeAt) for (let i = 0; i < walk.length; i++) if (z.mask[i]) walk[i] = 0;
    for (const f of fires) {
      const rad = fireRadius(f.activeAt, t);
      if (rad < 0) continue;
      for (let i = 0; i < walk.length; i++) {
        if (!walk[i]) continue;
        const c = cellCentre(grid, i);
        if (Math.hypot(c.x - f.x, c.y - f.y) <= rad) walk[i] = 0;
      }
    }
    const blocked = new Set<string>();
    for (const [id, at] of blockedExitAt) {
      if (t >= at) {
        blocked.add(id);
        for (const cell of grid.exits.get(id) ?? []) walk[cell.row * cols + cell.col] = 0;
      }
    }
    // Routing speed: full walking speed, slowed in the band just outside every burning region so that routes bend away from it.
    let speed: Float32Array | undefined;
    const burning = fires.filter((f) => fireRadius(f.activeAt, t) >= 0);
    if (avoid && burning.length > 0) {
      speed = new Float32Array(rows * cols).fill(WEIDMANN.v0);
      for (let i = 0; i < speed.length; i++) {
        if (!walk[i]) continue;
        const c = cellCentre(grid, i);
        let d = Infinity;
        for (const f of burning) d = Math.min(d, Math.hypot(c.x - f.x, c.y - f.y) - fireRadius(f.activeAt, t));
        if (d < SIM.fireAvoidBandM) {
          const k = SIM.fireMinSpeedFactor + (1 - SIM.fireMinSpeedFactor) * Math.max(0, d) / SIM.fireAvoidBandM;
          speed[i] = WEIDMANN.v0 * k;
        }
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

/** Is a person standing at (x,y) in `cellIdx` inside an active hazard zone at time t? */
export function inHazard(rt: HazardRuntime, x: number, y: number, cellIdx: number, t: number): boolean {
  for (const z of rt.zones) if (t >= z.activeAt && z.mask[cellIdx]) return true;
  for (const f of rt.fires) {
    const rad = fireRadius(f.activeAt, t);
    if (rad >= 0 && Math.hypot(x - f.x, y - f.y) <= rad) return true;
  }
  return false;
}
