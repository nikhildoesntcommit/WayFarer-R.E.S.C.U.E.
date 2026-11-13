import { MAP } from '../../constants';
import { MinHeap } from '../fmm';
import type { IndiaGrid } from '../../types';
import { cellIndexOf, hav, NEIGHBOURS8, sumPopulation } from './geo';

/** Holland (1980) wind profile — spec §9.4. */
export function hollandWindMS(vmax: number, rKm: number, rmaxKm: number = MAP.cyclone.rmaxKmDefault, B: number = MAP.cyclone.hollandBDefault): number {
  const r = Math.max(1, rKm);
  const x = Math.pow(rmaxKm / r, B);
  return vmax * Math.sqrt(x * Math.exp(1 - x));
}

/** Radius of maximum wind (km), Willoughby & Rahn (2004): Rmax = 46.4 exp(-0.0155 V + 0.0169 lat). */
export function rmaxKm(vmaxMS: number, latDeg: number): number {
  return Math.min(90, Math.max(15, 46.4 * Math.exp(-0.0155 * vmaxMS + 0.0169 * Math.abs(latDeg))));
}

/** Holland B from the central pressure deficit; pressure from the Atkinson–Holliday wind–pressure relation. */
export function hollandB(vmaxMS: number): number {
  const kt = Math.max(20, vmaxMS * 1.94384);
  const pc = 1010 - Math.pow(kt / 6.7, 1 / 0.644);
  return Math.min(2.5, Math.max(1, 1.5 + (980 - pc) / 120));
}

/** Kaplan & DeMaria (1995) inland decay: V(t) = Vb + (R V0 - Vb) exp(-alpha t), t hours since landfall. */
export function inlandDecayMS(v0: number, hoursOnLand: number): number {
  const { vb, alphaPerHour, landfallReduction } = MAP.cyclone.decay;
  return vb + (landfallReduction * v0 - vb) * Math.exp(-alphaPerHour * hoursOnLand);
}

/** Radius (km) inside which the wind is at least gale force for a storm of this strength (no translation term). */
export function galeRadiusKm(vmax: number, rmax: number): number {
  if (vmax <= MAP.cyclone.galeWindMS) return 0;
  const B = hollandB(Math.max(vmax, 18));
  let r = rmax;
  while (r < 1500 && hollandWindMS(vmax, r, rmax, B) >= MAP.cyclone.galeWindMS) r += 5;
  return r;
}

export interface TrackPoint {
  t: number; // s after the alert
  lat: number;
  lon: number;
  vmax: number; // m/s
  rmaxKm: number;
  onLand: boolean;
}

export interface CycloneResult {
  windByCell: Float32Array; // peak 10-m sustained wind over the whole passage (m/s)
  affectedCellIndices: number[];
  surgeCellIndices: number[];
  surgeDepthByCell: Float32Array;
  /** seconds after the alert at which travel becomes unsafe (gale-force wind or surge arrives); Infinity = never */
  blockTimeByCell: Float32Array;
  track: TrackPoint[];
  headingDeg: number;
  speedKmh: number;
  leadS: number;
  peakSurgeM: number;
  totalPopulation: number;
}

const KM_PER_DEG = 111.195;
const D2R = Math.PI / 180;

/**
 * Bearing (deg clockwise from north) in which a storm moves to cross the coast at this point: from the open sea towards
 * the land. Estimated from where the sea lies within 150 km. Returns null if there is no sea nearby (an inland tap).
 */
export function defaultHeadingDeg(grid: IndiaGrid, lat: number, lon: number): number | null {
  const span = Math.ceil(150 / (grid.resDeg * KM_PER_DEG));
  const i0 = cellIndexOf(grid, lat, lon);
  if (i0 < 0) return null;
  const r0 = (i0 / grid.cols) | 0;
  const c0 = i0 - r0 * grid.cols;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let r = Math.max(0, r0 - span); r <= Math.min(grid.rows - 1, r0 + span); r++)
    for (let c = Math.max(0, c0 - span); c <= Math.min(grid.cols - 1, c0 + span); c++) {
      const i = r * grid.cols + c;
      if (grid.landMask[i]) continue;
      const dx = (grid.lon[i]! - lon) * Math.cos(lat * D2R);
      const dy = grid.lat[i]! - lat;
      const d = Math.hypot(dx, dy);
      if (d * KM_PER_DEG > 150) continue;
      sx += dx / Math.max(d, 0.02);
      sy += dy / Math.max(d, 0.02);
      n++;
    }
  if (n < 3) return null;
  // the storm travels away from the sea centroid: opposite to the mean direction towards the sea
  const brg = (Math.atan2(-sx, -sy) / D2R + 360) % 360;
  return Math.round(brg);
}

export function computeCyclone(
  landfallLat: number,
  landfallLon: number,
  category: 1 | 2 | 3 | 4 | 5,
  grid: IndiaGrid,
  opts: { headingDeg?: number; speedKmh?: number; leadHours?: number } = {},
): CycloneResult | { error: string } {
  const heading = opts.headingDeg ?? defaultHeadingDeg(grid, landfallLat, landfallLon);
  if (heading === null) return { error: 'Cyclones make landfall on a coast. Tap a point on or near the coastline.' };
  const speed = opts.speedKmh ?? MAP.cyclone.translationKmhDefault;
  const leadS = (opts.leadHours ?? MAP.cyclone.leadHoursDefault) * 3600;
  const v0 = MAP.cyclone.categoryVmaxMS[category - 1]!;
  const n = grid.rows * grid.cols;

  // planar frame (km east, km north) centred on the landfall point
  const cosLat = Math.cos(landfallLat * D2R);
  const hx = Math.sin(heading * D2R);
  const hy = Math.cos(heading * D2R);
  const toX = (lon: number) => (lon - landfallLon) * KM_PER_DEG * cosLat;
  const toY = (lat: number) => (lat - landfallLat) * KM_PER_DEG;
  const vTrans = (speed * 1000) / 3600; // m/s

  // ---- track every 30 minutes from the alert to 24 h after landfall
  const track: TrackPoint[] = [];
  const dt = 1800;
  const tEnd = leadS + 24 * 3600;
  let hoursOnLand = 0;
  for (let t = 0; t <= tEnd + 1e-6; t += dt) {
    const s = (speed * (t - leadS)) / 3600; // km along the heading (negative = still at sea)
    const lat = landfallLat + (s * hy) / KM_PER_DEG;
    const lon = landfallLon + (s * hx) / (KM_PER_DEG * cosLat);
    const ci = cellIndexOf(grid, lat, lon);
    const onLand = t >= leadS && ci >= 0 && grid.landMask[ci] === 1;
    if (onLand) hoursOnLand += dt / 3600;
    const vmax = onLand || hoursOnLand > 0 ? inlandDecayMS(v0, hoursOnLand) : v0;
    track.push({ t, lat, lon, vmax: Math.max(0, vmax), rmaxKm: rmaxKm(Math.max(vmax, 18), lat), onLand });
  }
  // a track that never gets onto land within 3 hours of "landfall" is not a landfall
  const after = track.filter((p) => p.t >= leadS + 3600 && p.t <= leadS + 3 * 3600);
  if (!after.some((p) => p.onLand)) return { error: 'With that heading the storm turns away from the coast. Choose a heading that points inland.' };

  // ---- wind field over the window around the track
  const wind = new Float32Array(n);
  const block = new Float32Array(n).fill(Infinity);
  const margin = 8 * Math.max(...track.map((p) => p.rmaxKm)) / KM_PER_DEG + 0.5;
  const latLo = Math.min(...track.map((p) => p.lat)) - margin;
  const latHi = Math.max(...track.map((p) => p.lat)) + margin;
  const lonLo = Math.min(...track.map((p) => p.lon)) - margin;
  const lonHi = Math.max(...track.map((p) => p.lon)) + margin;
  const gale = MAP.cyclone.galeWindMS;
  const pts = track.map((p) => ({ x: toX(p.lon), y: toY(p.lat), v: p.vmax, rm: p.rmaxKm, B: hollandB(Math.max(p.vmax, 18)), t: p.t }));
  for (let i = 0; i < n; i++) {
    const la = grid.lat[i]!;
    const lo = grid.lon[i]!;
    if (!grid.landMask[i] || la < latLo || la > latHi || lo < lonLo || lo > lonHi) continue;
    const cx = toX(lo);
    const cy = toY(la);
    let peak = 0;
    for (const p of pts) {
      if (p.v < 8) continue;
      const dx = cx - p.x;
      const dy = cy - p.y;
      const r = Math.hypot(dx, dy);
      if (r > 8 * p.rm) continue;
      const vh = hollandWindMS(p.v, r, p.rm, p.B);
      // counter-clockwise (northern-hemisphere) circulation turned 20° inward, plus half the forward speed
      // (so the right-hand side of the track is the dangerous side)
      const rr = Math.max(r, 1e-6);
      const tx = -dy / rr;
      const ty = dx / rr;
      const ix = -dx / rr;
      const iy = -dy / rr;
      const c20 = Math.cos(20 * D2R);
      const s20 = Math.sin(20 * D2R);
      const ux = vh * (c20 * tx + s20 * ix) + 0.5 * vTrans * hx;
      const uy = vh * (c20 * ty + s20 * iy) + 0.5 * vTrans * hy;
      const w = vh < 1 ? 0 : Math.hypot(ux, uy);
      if (w > peak) peak = w;
      if (w >= gale && p.t < block[i]!) block[i] = p.t;
    }
    wind[i] = peak;
  }

  // ---- storm surge: peak at the coast right of the track, decaying along the coast and inland
  const rmL = track.find((p) => p.t >= leadS)!.rmaxKm;
  const s0 = MAP.cyclone.surgePeakM[category - 1]!;
  const rx = hy; // right-hand normal of the heading
  const ry = -hx;
  const px = rx * rmL;
  const py = ry * rmL;
  const sigma = 1.5 * rmL;
  const level = new Float32Array(n).fill(-Infinity);
  const heap = new MinHeap();
  for (let i = 0; i < n; i++) {
    if (!grid.coastMask[i]) continue;
    const d = Math.hypot(toX(grid.lon[i]!) - px, toY(grid.lat[i]!) - py);
    const s = s0 * Math.exp(-(d * d) / (2 * sigma * sigma));
    if (s < 0.3 || s <= grid.elevationM[i]!) continue;
    level[i] = s;
    heap.push(-s, i);
  }
  const surgeDepth = new Float32Array(n);
  const surge: number[] = [];
  const done = new Uint8Array(n);
  while (heap.size > 0) {
    const { val: i } = heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    surgeDepth[i] = level[i]! - grid.elevationM[i]!;
    surge.push(i);
    const r = (i / grid.cols) | 0;
    const c = i - r * grid.cols;
    for (const [dr, dc] of NEIGHBOURS8) {
      const rr2 = r + dr;
      const cc = c + dc;
      if (rr2 < 0 || cc < 0 || rr2 >= grid.rows || cc >= grid.cols) continue;
      const j = rr2 * grid.cols + cc;
      if (done[j] || !grid.landMask[j]) continue;
      const lv = level[i]! - MAP.cyclone.surgeDecayMPerKm * hav(grid.lat[i]!, grid.lon[i]!, grid.lat[j]!, grid.lon[j]!);
      if (lv > grid.elevationM[j]! && lv > level[j]!) {
        level[j] = lv;
        heap.push(-lv, j);
      }
    }
  }
  // surge reaches the coast as the eye comes within ~2 Rmax; never later than landfall
  for (const i of surge) {
    const cx = toX(grid.lon[i]!);
    const cy = toY(grid.lat[i]!);
    let tArr = leadS;
    for (const p of pts) {
      if (Math.hypot(cx - p.x, cy - p.y) <= 2 * rmL) { tArr = Math.min(tArr, p.t); break; }
    }
    if (tArr < block[i]!) block[i] = tArr;
  }

  const affected: number[] = [];
  for (let i = 0; i < n; i++) if ((wind[i]! >= MAP.cyclone.damagingWindMS && grid.landMask[i]) || surgeDepth[i]! > 0.1) affected.push(i);
  return {
    windByCell: wind,
    affectedCellIndices: affected,
    surgeCellIndices: surge.filter((i) => surgeDepth[i]! > 0.1),
    surgeDepthByCell: surgeDepth,
    blockTimeByCell: block,
    track,
    headingDeg: heading,
    speedKmh: speed,
    leadS,
    peakSurgeM: s0,
    totalPopulation: sumPopulation(grid, affected),
  };
}
