import { SIM } from '../constants';
import type { Cell, Plan, WorldPoint, WorldPolygon } from '../types';
import { boundingBox, pointInPolygon } from '../utils/geo';

export interface Grid {
  rows: number;
  cols: number;
  metresPerCell: number;
  /** World coordinates of the grid's lower-left corner. Row r spans y in [originY + r*m, originY + (r+1)*m). */
  originX: number;
  originY: number;
  /** Specification shape: walkable[row][col]. */
  walkable: boolean[][];
  /** Same information, flat and typed (row-major) for the hot loops. */
  walk: Uint8Array;
  /** Cells blocked by a wall polygon (before door openings were cleared). */
  wallBlocked: Uint8Array;
  /** Every door's opening cells. */
  doors: Map<string, Cell[]>;
  /** Opening cells of exit doors only. */
  exits: Map<string, Cell[]>;
}

export const cellIndex = (g: Pick<Grid, 'cols'>, row: number, col: number): number => row * g.cols + col;

export function cellOfPoint(g: Grid, x: number, y: number): Cell | null {
  const col = Math.floor((x - g.originX) / g.metresPerCell);
  const row = Math.floor((y - g.originY) / g.metresPerCell);
  if (row < 0 || col < 0 || row >= g.rows || col >= g.cols) return null;
  return { row, col };
}

export function cellCentre(g: Pick<Grid, 'originX' | 'originY' | 'metresPerCell' | 'cols'>, idx: number): WorldPoint {
  const row = (idx / g.cols) | 0;
  const col = idx - row * g.cols;
  return { x: g.originX + (col + 0.5) * g.metresPerCell, y: g.originY + (row + 0.5) * g.metresPerCell };
}

function segmentsIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = o(cx, cy, dx, dy, ax, ay);
  const d2 = o(cx, cy, dx, dy, bx, by);
  const d3 = o(ax, ay, bx, by, cx, cy);
  const d4 = o(ax, ay, bx, by, dx, dy);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Does the polygon overlap the axis-aligned square [x0,x1]x[y0,y1]? (Conservative: touching counts.) */
export function polygonTouchesRect(poly: WorldPolygon, x0: number, y0: number, x1: number, y1: number): boolean {
  for (const p of poly) if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) return true;
  if (pointInPolygon({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, poly)) return true;
  const corners: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    for (let k = 0; k < 4; k++) {
      const c = corners[k]!;
      const d = corners[(k + 1) % 4]!;
      if (segmentsIntersect(a.x, a.y, b.x, b.y, c[0], c[1], d[0], d[1])) return true;
    }
  }
  return false;
}

/**
 * Plan -> grid (spec §6.2).
 *  - cells whose centre lies inside the perimeter are walkable (even-odd);
 *  - wall polygons block every cell they touch (conservative, so a 0.2 m wall cannot leak between 0.5 m cells);
 *  - obstacles block cells whose centre they contain;
 *  - each door clears the wall cells across its opening and records them (exit doors also feed `exits`).
 */
export function rasterize(plan: Plan): Grid {
  const m = plan.metresPerCell;
  const per = plan.buildingPerimeterWorld;
  if (per.length < 3) throw new Error('The plan has no closed perimeter.');
  const bb = boundingBox(per);
  const rows = Math.max(1, Math.ceil((bb.maxY - bb.minY) / m));
  const cols = Math.max(1, Math.ceil((bb.maxX - bb.minX) / m));
  const walk = new Uint8Array(rows * cols);
  const wallBlocked = new Uint8Array(rows * cols);
  const g: Grid = {
    rows, cols, metresPerCell: m, originX: bb.minX, originY: bb.minY,
    walkable: [], walk, wallBlocked, doors: new Map(), exits: new Map(),
  };

  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const ctr = cellCentre(g, r * cols + c);
      if (pointInPolygon(ctr, per)) walk[r * cols + c] = 1;
    }

  const forPolygonCells = (poly: WorldPolygon, fn: (idx: number, r: number, c: number) => void, conservative: boolean) => {
    const pb = boundingBox(poly);
    const c0 = Math.max(0, Math.floor((pb.minX - g.originX) / m));
    const c1 = Math.min(cols - 1, Math.floor((pb.maxX - g.originX) / m));
    const r0 = Math.max(0, Math.floor((pb.minY - g.originY) / m));
    const r1 = Math.min(rows - 1, Math.floor((pb.maxY - g.originY) / m));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const x0 = g.originX + c * m;
        const y0 = g.originY + r * m;
        const hit = conservative
          ? polygonTouchesRect(poly, x0, y0, x0 + m, y0 + m)
          : pointInPolygon({ x: x0 + m / 2, y: y0 + m / 2 }, poly);
        if (hit) fn(r * cols + c, r, c);
      }
  };

  for (const w of plan.wallsWorld) {
    forPolygonCells(w, (i) => { walk[i] = 0; wallBlocked[i] = 1; }, true);
  }
  for (const o of plan.obstaclesWorld) {
    forPolygonCells(o, (i) => { walk[i] = 0; }, false);
  }

  for (const d of plan.doors) {
    const dx = d.endWorld.x - d.startWorld.x;
    const dy = d.endWorld.y - d.startWorld.y;
    const len = Math.hypot(dx, dy) || 1e-9;
    const ux = dx / len;
    const uy = dy / len;
    const tol = SIM.doorEndToleranceCells * m;
    const maxPerp = SIM.wallThicknessM / 2 + SIM.doorBandCells * m;
    const minX = Math.min(d.startWorld.x, d.endWorld.x) - maxPerp - m;
    const maxX = Math.max(d.startWorld.x, d.endWorld.x) + maxPerp + m;
    const minY = Math.min(d.startWorld.y, d.endWorld.y) - maxPerp - m;
    const maxY = Math.max(d.startWorld.y, d.endWorld.y) + maxPerp + m;
    const c0 = Math.max(0, Math.floor((minX - g.originX) / m));
    const c1 = Math.min(cols - 1, Math.floor((maxX - g.originX) / m));
    const r0 = Math.max(0, Math.floor((minY - g.originY) / m));
    const r1 = Math.min(rows - 1, Math.floor((maxY - g.originY) / m));
    const band: Cell[] = [];
    const loose: Cell[] = [];
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const ctr = cellCentre(g, r * cols + c);
        const px = ctr.x - d.startWorld.x;
        const py = ctr.y - d.startWorld.y;
        const along = px * ux + py * uy;
        const perp = Math.abs(-px * uy + py * ux);
        if (along < -tol || along > len + tol) continue;
        if (perp <= maxPerp && wallBlocked[r * cols + c]) band.push({ row: r, col: c });
        else if (perp <= m * 0.75) loose.push({ row: r, col: c });
      }
    let cells = band;
    if (cells.length === 0) cells = loose; // door drawn where no wall cell exists: open the cells under it
    if (cells.length === 0) {
      const mid = { x: (d.startWorld.x + d.endWorld.x) / 2, y: (d.startWorld.y + d.endWorld.y) / 2 };
      const cell = cellOfPoint(g, mid.x, mid.y);
      if (cell) cells = [cell];
    }
    for (const cell of cells) {
      const i = cell.row * cols + cell.col;
      walk[i] = 1;
      wallBlocked[i] = 0;
    }
    g.doors.set(d.id, cells);
    if (d.isExit) g.exits.set(d.id, cells);
  }

  g.walkable = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => walk[r * cols + c] === 1));
  return g;
}
