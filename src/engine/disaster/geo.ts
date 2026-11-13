import { MAP } from '../../constants';
import type { IndiaGrid } from '../../types';

const D2R = Math.PI / 180;

/** Haversine, km. Duplicated (inlined) from utils/geo for the hot per-cell loops. */
export function hav(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * MAP.earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function cellIndexOf(grid: IndiaGrid, lat: number, lon: number): number {
  const r = Math.floor((lat - grid.minLat) / grid.resDeg);
  const c = Math.floor((lon - grid.minLon) / grid.resDeg);
  if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) return -1;
  return r * grid.cols + c;
}

/** km² of one 0.05° cell at the given latitude. */
export function cellAreaKm2(grid: IndiaGrid, lat: number): number {
  const kmPerDeg = (Math.PI * MAP.earthRadiusKm) / 180;
  return grid.resDeg * kmPerDeg * grid.resDeg * kmPerDeg * Math.cos(lat * D2R);
}

export function sumPopulation(grid: IndiaGrid, cells: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < cells.length; i++) s += grid.population[cells[i]!]!;
  return s;
}

export const NEIGHBOURS8: [number, number][] = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
