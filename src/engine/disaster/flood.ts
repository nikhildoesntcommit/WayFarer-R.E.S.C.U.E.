import { MAP } from '../../constants';
import { MinHeap } from '../fmm';
import type { IndiaGrid } from '../../types';
import type { LineCollection } from '../../map/data/loader';
import { assessRainfall, type RainAssessment } from './climate';
import { cellAreaKm2, cellIndexOf, hav, NEIGHBOURS8, sumPopulation } from './geo';
import { drainageOf, scsRunoffMm } from './hydrology';

/** Cells that a river polyline passes through. */
export function rasterizeRivers(grid: IndiaGrid, rivers: LineCollection): Uint8Array {
  const out = new Uint8Array(grid.rows * grid.cols);
  const step = grid.resDeg / 3;
  for (const f of rivers.features) {
    const pts = f.geometry.coordinates;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [x0, y0] = pts[k]!;
      const [x1, y1] = pts[k + 1]!;
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / step));
      for (let s = 0; s <= n; s++) {
        const i = cellIndexOf(grid, y0 + ((y1 - y0) * s) / n, x0 + ((x1 - x0) * s) / n);
        if (i >= 0) out[i] = 1;
      }
    }
  }
  return out;
}

export type FloodResult =
  | {
      ok: true;
      floodedCellIndices: number[];
      totalPopulation: number;
      /** water level (m) the flood surface needs to reach each cell; Infinity if unreachable */
      requiredLevel: Float32Array;
      /** surface level at which the first seed cell is wet: the flood "starts" here */
      baseLevel: number;
      depthByCell: Float32Array;
      seedCells: number[];
    }
  | { ok: false; reason: string };

/**
 * Bathtub flood with connectivity (spec §9.3), as a priority flood: requiredLevel[c] is the lowest flood surface that
 * wets c through a connected path from a seed, so the flooded set is {requiredLevel <= waterLevel} and, for a rising
 * river, c is wet from t = (requiredLevel - baseLevel) / riseRate.
 *
 * Seeds: river cells near the origin. The specification's 2 km / 500 m radii are smaller than one 0.05° (~5.5 km) cell,
 * so they are widened to "the river passes through a cell within 2 km + half a cell diagonal of the origin".
 */
export function computeFloodAffected(
  originLat: number,
  originLon: number,
  waterLevelM: number,
  grid: IndiaGrid,
  riverCells: Uint8Array,
  maxBfsDist: number = MAP.flood.connectivityMaxDistCells,
  seedCells?: number[],
): FloodResult {
  const n = grid.rows * grid.cols;
  const halfDiagKm = (grid.resDeg * 111.195 * Math.SQRT2) / 2;
  let seeds = seedCells;
  if (!seeds) {
    seeds = [];
    for (let i = 0; i < n; i++) {
      if (!riverCells[i] || !grid.landMask[i]) continue;
      if (hav(originLat, originLon, grid.lat[i]!, grid.lon[i]!) <= MAP.flood.originSearchKm + halfDiagKm) seeds.push(i);
    }
  }
  if (seeds.length === 0) return { ok: false, reason: 'No river passes near that point. Tap on or right beside a river.' };

  const req = new Float32Array(n).fill(Infinity);
  const steps = new Int16Array(n).fill(-1);
  const heap = new MinHeap();
  let base = Infinity;
  for (const s of seeds) {
    req[s] = grid.elevationM[s]!;
    steps[s] = 0;
    base = Math.min(base, req[s]!);
    heap.push(req[s]!, s);
  }
  const done = new Uint8Array(n);
  while (heap.size > 0) {
    const { key, val: i } = heap.pop();
    if (done[i] || key > req[i]!) continue;
    done[i] = 1;
    if (steps[i]! >= maxBfsDist) continue;
    const r = (i / grid.cols) | 0;
    const c = i - r * grid.cols;
    for (const [dr, dc] of NEIGHBOURS8) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= grid.rows || cc >= grid.cols) continue;
      const j = rr * grid.cols + cc;
      if (done[j] || !grid.landMask[j]) continue;
      const level = Math.max(key, grid.elevationM[j]!);
      if (level < req[j]!) {
        req[j] = Math.fround(level);
        steps[j] = steps[i]! + 1;
        heap.push(req[j]!, j);
      }
    }
  }

  const flooded: number[] = [];
  const depth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (req[i]! <= waterLevelM) {
      flooded.push(i);
      depth[i] = Math.max(0, waterLevelM - grid.elevationM[i]!);
    }
  }
  return { ok: true, floodedCellIndices: flooded, totalPopulation: sumPopulation(grid, flooded), requiredLevel: req, baseLevel: base, depthByCell: depth, seedCells: seeds };
}

// ---------------------------------------------------------------------------------------------------------------
// V2: rainfall-driven flood. Rain -> runoff (SCS Curve Number) -> peak discharge from the catchment (drainage area from
// Priority-Flood on the DEM) -> river stage rise above the banks (Leopold & Maddock hydraulic geometry) -> bathtub fill
// with connectivity -> a rising-limb hydrograph gives the time at which each cell goes under.
// ---------------------------------------------------------------------------------------------------------------


export interface RainFlood {
  ok: true;
  base: Extract<FloodResult, { ok: true }>;
  assessment: RainAssessment;
  stageRiseM: number;
  runoffMm: number;
  peakDischargeM3s: number;
  catchmentKm2: number;
  timeToPeakH: number;
  /** seconds after the rain starts at which the cell is under water; Infinity = never */
  arrivalByCell: Float32Array;
  usedMappedRiver: boolean;
}

const STAGE_COEFF = 0.15; // m per (m³/s)^0.4: bankfull depth of Ganga-scale rivers ~10 m, of a 50 m³/s stream ~0.7 m
const CN_NORMAL = 80;
const CN_ARID = 88; // crusted, sparsely vegetated soils shed most of the rain
const AREA_CAP_KM2 = 20_000; // the rain falls on a footprint, not on the whole basin
const BANKFULL_FRACTION = 0.35; // bankfull ≈ the ~2-year event ≈ this share of an extreme daily rainfall

function peakDischarge(rainMm: number, cn: number, areaKm2: number): { q: number; runoff: number; tp: number } {
  const runoff = scsRunoffMm(rainMm, cn);
  const tp = 4 + 4 * Math.pow(areaKm2 / 100, 0.3); // h
  const q = (runoff * 1e-3 * areaKm2 * 1e6) / (2 * tp * 3600);
  return { q, runoff, tp };
}

export function computeRainFlood(
  originLat: number,
  originLon: number,
  rainMm: number,
  grid: IndiaGrid,
  riverCells: Uint8Array,
): RainFlood | { ok: false; reason: string } {
  const assessment = assessRainfall(originLat, originLon, rainMm);
  if (assessment.level === 'not_credible') return { ok: false, reason: assessment.note };

  // seeds: mapped river near the origin, else the strongest drainage line within 25 km (ephemeral streams, flash floods)
  const n = grid.rows * grid.cols;
  const halfDiagKm = (grid.resDeg * 111.195 * Math.SQRT2) / 2;
  let seeds: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!riverCells[i] || !grid.landMask[i]) continue;
    if (hav(originLat, originLon, grid.lat[i]!, grid.lon[i]!) <= MAP.flood.originSearchKm + halfDiagKm) seeds.push(i);
  }
  const drain = drainageOf(grid);
  const usedMappedRiver = seeds.length > 0;
  if (!usedMappedRiver) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (!grid.landMask[i] || drain.accumulation[i]! < 4) continue;
      if (hav(originLat, originLon, grid.lat[i]!, grid.lon[i]!) > 25) continue;
      if (best < 0 || drain.accumulation[i]! > drain.accumulation[best]!) best = i;
    }
    if (best < 0) return { ok: false, reason: 'No river or drainage line passes near that point, so rain here has nowhere to collect. Tap on or beside a river or valley.' };
    seeds = [best];
  }

  let acc = 1;
  let baseElev = Infinity;
  for (const s of seeds) {
    baseElev = Math.min(baseElev, grid.elevationM[s]!);
    // the mapped river and the DEM's own drainage line rarely coincide on a 5 km grid: take the strongest drainage within 3 cells
    const r0 = (s / grid.cols) | 0;
    const c0 = s - r0 * grid.cols;
    for (let r = Math.max(0, r0 - 3); r <= Math.min(grid.rows - 1, r0 + 3); r++)
      for (let c = Math.max(0, c0 - 3); c <= Math.min(grid.cols - 1, c0 + 3); c++) {
        const j = r * grid.cols + c;
        if (grid.landMask[j]) acc = Math.max(acc, drain.accumulation[j]!);
      }
  }
  const catchmentKm2 = acc * cellAreaKm2(grid, originLat);
  const aEff = Math.max(30, Math.min(AREA_CAP_KM2, catchmentKm2));
  const cn = assessment.annualMm < 500 ? CN_ARID : CN_NORMAL;
  const ev = peakDischarge(rainMm, cn, aEff);
  const bf = peakDischarge(BANKFULL_FRACTION * assessment.extremeMm, cn, aEff);
  const stageRiseM = Math.max(0, STAGE_COEFF * (Math.pow(ev.q, 0.4) - Math.pow(bf.q, 0.4)));
  if (stageRiseM < 0.1) {
    return { ok: false, reason: `Rain of ${Math.round(rainMm)} mm in 24 h stays inside the river banks here: the river rises by only ${stageRiseM.toFixed(2)} m, not enough to flood. Increase the rainfall.` };
  }

  const base = computeFloodAffected(originLat, originLon, baseElev + stageRiseM, grid, riverCells, MAP.flood.connectivityMaxDistCells, seeds);
  if (!base.ok) return base;
  const arrival = new Float32Array(n).fill(Infinity);
  const tpS = ev.tp * 3600;
  const onsetS = 0.5 * tpS; // the channel must fill to bankfull before any water spills onto the floodplain
  for (const i of base.floodedCellIndices) {
    const f = Math.min(1, Math.max(0, (base.requiredLevel[i]! - baseElev) / stageRiseM));
    arrival[i] = onsetS + ((2 * tpS) / Math.PI) * Math.asin(Math.sqrt(f)); // rising limb h(t) = Δh sin²(πt / 2Tp)
  }
  return { ok: true, base, assessment, stageRiseM, runoffMm: ev.runoff, peakDischargeM3s: ev.q, catchmentKm2, timeToPeakH: ev.tp, arrivalByCell: arrival, usedMappedRiver };
}
