import { MAP } from '../../constants';
import type { IndiaGrid } from '../../types';
import { hav, sumPopulation } from './geo';

export type PgaCoefficients = { a: number; b: number; c: number; d: number; e: number };

/** log10(PGA_g) = a + b*M - c*log10(Rh + d*exp(e*M)) — spec §9.2. */
export function pgaG(magnitude: number, hypocentralKm: number, k: PgaCoefficients = MAP.earthquake.pgaCoefficients): number {
  return Math.pow(10, k.a + k.b * magnitude - k.c * Math.log10(hypocentralKm + k.d * Math.exp(k.e * magnitude)));
}

/** Probability that a road crossing a cell with this PGA is blocked at t = 0 (assumption, see constants). */
export function roadBlockProbability(pga: number): number {
  const { roadBlockPgaG, roadBlockPgaFullG, roadBlockMaxProb } = MAP.earthquake;
  if (pga < roadBlockPgaG) return 0;
  return Math.min(1, (pga - roadBlockPgaG) / (roadBlockPgaFullG - roadBlockPgaG)) * roadBlockMaxProb;
}

/** Surface rupture length (km), Wells & Coppersmith (1994), all fault types: log10 L = -2.44 + 0.59 M. */
export function ruptureLengthKm(magnitude: number): number {
  return Math.pow(10, -2.44 + 0.59 * magnitude);
}

/** Modified Mercalli Intensity from PGA (g), Worden et al. (2012). */
export function mmiFromPga(pgaGs: number): number {
  const lg = Math.log10(Math.max(1e-6, pgaGs * 980.665)); // cm/s²
  const v = lg <= 1.57 ? 1.78 + 1.55 * lg : -1.6 + 3.7 * lg;
  return Math.min(10, Math.max(1, v));
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const mmiRoman = (mmi: number): string => ROMAN[Math.min(10, Math.max(1, Math.round(mmi)))]!;

export interface EarthquakeResult {
  pgaByCell: Float32Array;
  /** s after the shaking starts at which the S-wave (strong shaking) reaches the cell */
  arrivalByCell: Float32Array;
  affectedCellIndices: number[];
  totalPopulation: number;
  ruptureKm: number;
  strikeDeg: number;
  peakMmi: number;
}

/**
 * Ground shaking from a finite fault. A magnitude 7+ earthquake is not a point: the rupture is tens to hundreds of km long
 * (Wells & Coppersmith), and the distance that matters is to the nearest point of that line, not to the epicentre.
 * The fault is centred on the epicentre and runs along `strikeDeg`.
 */
export function computeEarthquake(
  originLat: number,
  originLon: number,
  magnitude: number,
  depthKm: number,
  grid: IndiaGrid,
  strikeDeg: number = MAP.earthquake.strikeDegDefault,
): EarthquakeResult {
  const n = grid.rows * grid.cols;
  const L = ruptureLengthKm(magnitude);
  const D2R = Math.PI / 180;
  const cosLat = Math.cos(originLat * D2R);
  const ux = Math.sin(strikeDeg * D2R);
  const uy = Math.cos(strikeDeg * D2R);
  const pga = new Float32Array(n);
  const arrival = new Float32Array(n);
  const affected: number[] = [];
  let peak = 0;
  for (let i = 0; i < n; i++) {
    // planar offset (km) from the epicentre, then distance to the finite line segment
    const dx = (grid.lon[i]! - originLon) * 111.195 * cosLat;
    const dy = (grid.lat[i]! - originLat) * 111.195;
    const along = Math.max(-L / 2, Math.min(L / 2, dx * ux + dy * uy));
    let Rjb = Math.hypot(dx - along * ux, dy - along * uy);
    if (Rjb > 400) Rjb = hav(originLat, originLon, grid.lat[i]!, grid.lon[i]!); // far field: spherical distance
    const Rh = Math.sqrt(Rjb * Rjb + depthKm * depthKm);
    const v = pgaG(magnitude, Rh);
    pga[i] = v;
    arrival[i] = Rh / MAP.earthquake.sWaveKmS;
    if (grid.landMask[i]) {
      if (v > peak) peak = v;
      if (v > MAP.earthquake.damageThresholdPGA) affected.push(i);
    }
  }
  return { pgaByCell: pga, arrivalByCell: arrival, affectedCellIndices: affected, totalPopulation: sumPopulation(grid, affected), ruptureKm: L, strikeDeg, peakMmi: mmiFromPga(peak) };
}

/** Back-compatible point-source entry (used by the unit tests): the same model with a negligible rupture. */
export function computeEarthquakeAffected(originLat: number, originLon: number, magnitude: number, depthKm: number, grid: IndiaGrid) {
  const r = computeEarthquake(originLat, originLon, magnitude, depthKm, grid);
  return { pgaByCell: r.pgaByCell, affectedCellIndices: r.affectedCellIndices, totalPopulation: r.totalPopulation };
}

// ---- plausibility: the largest credible earthquake by seismic zone (coarse boxes after BIS IS 1893:2016) ----
export type SeismicZone = 'V' | 'IV' | 'III' | 'II';
export const MMAX: Record<SeismicZone, number> = { V: 8.7, IV: 8.0, III: 7.0, II: 6.5 };
const ZONE_TEXT: Record<SeismicZone, string> = {
  V: 'very high seismic hazard (Zone V)',
  IV: 'high seismic hazard (Zone IV)',
  III: 'moderate seismic hazard (Zone III)',
  II: 'low seismic hazard (Zone II, stable peninsular India)',
};

/** Coarse seismic zone of a point; deliberately simple, see DEVIATIONS.md. */
export function seismicZone(lat: number, lon: number): SeismicZone {
  if (lon >= 89.5 && lat >= 21.5) return 'V'; // North-East India
  if (lon >= 92 && lat < 14) return 'V'; // Andaman & Nicobar
  if (lat >= 29.5 && lon <= 80.6) return 'V'; // Kashmir, Himachal, Uttarakhand
  if (lat >= 22.4 && lat <= 24.6 && lon <= 71.6) return 'V'; // Kachchh
  if (lat >= 26.4 && lon >= 76.4 && lon < 89.5) return 'IV'; // Himalayan foothills and the northern plains incl. Delhi, north Bihar, Sikkim
  if (lat >= 22.5 && lat < 26.4 && lon >= 83 && lon < 89.5) return 'III'; // Gangetic plain east
  if (lat >= 20 && lon >= 68 && lon < 76.4) return lat >= 22.4 ? 'IV' : 'III'; // Gujarat / Rajasthan west
  if (lat >= 22 && lon >= 76.4 && lon < 83) return 'III'; // central
  if (lat < 22 && lon < 74 && lat > 15) return 'III'; // Konkan / Koyna
  if (lat < 12 && lon < 78) return 'III'; // Kerala
  if (lat > 22 && lat < 26.4) return 'III';
  return 'II';
}

export interface QuakeAssessment {
  zone: SeismicZone;
  mmax: number;
  level: 'ok' | 'rare' | 'not_credible';
  note: string;
}

export function assessMagnitude(lat: number, lon: number, magnitude: number): QuakeAssessment {
  const zone = seismicZone(lat, lon);
  const mmax = MMAX[zone];
  if (magnitude <= mmax - 0.5) return { zone, mmax, level: 'ok', note: `This is a region of ${ZONE_TEXT[zone]}; the largest credible earthquake here is about M ${mmax.toFixed(1)}.` };
  if (magnitude <= mmax + 0.2) return { zone, mmax, level: 'rare', note: `Near the largest credible earthquake for a region of ${ZONE_TEXT[zone]} (about M ${mmax.toFixed(1)}): possible, but extremely rare.` };
  return { zone, mmax, level: 'not_credible', note: `Not credible here: a region of ${ZONE_TEXT[zone]} has not produced and is not expected to produce a magnitude above about ${mmax.toFixed(1)}. Lower the magnitude or move the epicentre.` };
}
