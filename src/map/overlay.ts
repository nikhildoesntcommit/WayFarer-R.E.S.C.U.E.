import { MAP } from '../constants';
import type { IndiaGrid, MapAnalysis } from '../types';
import { chainSegments, contourSegments } from '../utils/contour';

export interface Overlay {
  cells: GeoJSON.FeatureCollection<GeoJSON.Polygon>;
  contours: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  legend: { title: string; items: { label: string; colour: string }[] };
}

export const EQ_COLOURS = ['#F4D9C8', '#EDB79C', '#E48C6F', '#D85F44', '#C8381C', '#8E2513'];
export const WIND_COLOURS = ['#F4D9C8', '#E48C6F', '#C8381C', '#8E2513'];
export const WATER_COLOURS = ['#BCD3E3', '#8DB4CE', '#5E93B6', '#3E6A8A'];
export const FLOOD_DEPTH_LEVELS_M = [0.5, 1, 2, 4];

function square(grid: IndiaGrid, i: number): GeoJSON.Position[] {
  const r = (i / grid.cols) | 0;
  const c = i - r * grid.cols;
  const x0 = grid.minLon + c * grid.resDeg;
  const y0 = grid.minLat + r * grid.resDeg;
  const x1 = x0 + grid.resDeg;
  const y1 = y0 + grid.resDeg;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
}

function bandOf(v: number, levels: readonly number[]): number {
  let b = 0;
  for (const l of levels) if (v >= l) b++;
  return b;
}

/** Contour lines of `field` at `levels`, restricted to the window where the field reaches the lowest level. */
function contours(grid: IndiaGrid, field: Float32Array, levels: readonly number[]): GeoJSON.Feature<GeoJSON.LineString>[] {
  const lo = levels[0]!;
  let r0 = grid.rows, r1 = -1, c0 = grid.cols, c1 = -1;
  for (let i = 0; i < field.length; i++) {
    if (field[i]! < lo) continue;
    const r = (i / grid.cols) | 0;
    const c = i - r * grid.cols;
    if (r < r0) r0 = r;
    if (r > r1) r1 = r;
    if (c < c0) c0 = c;
    if (c > c1) c1 = c;
  }
  if (r1 < 0) return [];
  r0 = Math.max(0, r0 - 1); r1 = Math.min(grid.rows - 1, r1 + 1);
  c0 = Math.max(0, c0 - 1); c1 = Math.min(grid.cols - 1, c1 + 1);
  const rows = r1 - r0 + 1;
  const cols = c1 - c0 + 1;
  const sub = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) sub[r * cols + c] = field[(r0 + r) * grid.cols + c0 + c]!;
  const out: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (const level of levels) {
    for (const line of chainSegments(contourSegments(sub, rows, cols, level))) {
      if (line.length < 3) continue;
      out.push({
        type: 'Feature',
        properties: { level },
        geometry: {
          type: 'LineString',
          coordinates: line.map(([x, y]) => [grid.minLon + (c0 + x + 0.5) * grid.resDeg, grid.minLat + (r0 + y + 0.5) * grid.resDeg]),
        },
      });
    }
  }
  return out;
}

export function buildOverlay(a: MapAnalysis, grid: IndiaGrid): Overlay {
  const kind = a.scenario.disasterKind;
  // `t`: seconds after the alert at which the hazard reaches the cell; the animated replay reveals cells in this order
  const arrive = (i: number): number => {
    const v = a.arrivalTimeByCell?.[i];
    return v !== undefined && Number.isFinite(v) ? v : 0;
  };
  const surge = new Set(a.surgeCellIndices);
  const cells: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  let lines: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  let legend: Overlay['legend'];

  if (kind === 'earthquake') {
    const levels = MAP.earthquake.pgaThresholdsG;
    for (const i of a.affectedCellIndices) {
      const v = a.fieldByCell?.[i] ?? 0;
      cells.push({ type: 'Feature', properties: { band: Math.max(0, bandOf(v, levels) - 1), v, t: arrive(i) }, geometry: { type: 'Polygon', coordinates: [square(grid, i)] } });
    }
    if (a.fieldByCell) lines = contours(grid, a.fieldByCell, levels);
    legend = { title: 'Peak ground acceleration (g)', items: levels.map((l, k) => ({ label: String(l), colour: EQ_COLOURS[k]! })) };
  } else if (kind === 'flood') {
    for (const i of a.affectedCellIndices) {
      const v = a.depthByCell?.[i] ?? 0;
      cells.push({ type: 'Feature', properties: { band: bandOf(v, FLOOD_DEPTH_LEVELS_M), v, t: arrive(i) }, geometry: { type: 'Polygon', coordinates: [square(grid, i)] } });
    }
    legend = { title: 'Flood depth (m, indicative)', items: [{ label: '<0.5', colour: WATER_COLOURS[0]! }, ...FLOOD_DEPTH_LEVELS_M.slice(1).map((l, k) => ({ label: `≥${l}`, colour: WATER_COLOURS[k + 1]! }))] };
  } else {
    const levels = MAP.cyclone.windContoursMS;
    for (const i of a.affectedCellIndices) {
      const v = a.fieldByCell?.[i] ?? 0;
      cells.push({ type: 'Feature', properties: { band: surge.has(i) ? 10 : Math.max(0, bandOf(v, levels) - 1), v, t: arrive(i) }, geometry: { type: 'Polygon', coordinates: [square(grid, i)] } });
    }
    if (a.fieldByCell) lines = contours(grid, a.fieldByCell, levels);
    legend = {
      title: 'Wind speed (m/s) and storm surge',
      items: [...levels.map((l, k) => ({ label: String(l), colour: WIND_COLOURS[k]! })), { label: 'surge', colour: WATER_COLOURS[2]! }],
    };
  }
  return { cells: { type: 'FeatureCollection', features: cells }, contours: { type: 'FeatureCollection', features: lines }, legend };
}
