import { MinHeap } from '../fmm';
import type { IndiaGrid } from '../../types';
import { NEIGHBOURS8 } from './geo';

/**
 * Drainage from the elevation grid by Priority-Flood (Barnes, Lehman & Mulla 2014): cells are visited lowest-first
 * starting from the outlets (sea and the edge of the grid), so every depression is filled and each cell drains to
 * the neighbour that discovered it. Accumulating in reverse visiting order gives the number of upstream cells.
 */
export interface Drainage {
  /** upstream cell count including the cell itself */
  accumulation: Int32Array;
  receiver: Int32Array;
}

export function computeDrainage(grid: IndiaGrid): Drainage {
  const { rows, cols } = grid;
  const n = rows * cols;
  const receiver = new Int32Array(n).fill(-1);
  const level = new Float32Array(n);
  const done = new Uint8Array(n);
  const order = new Int32Array(n);
  let count = 0;
  const heap = new MinHeap();
  for (let i = 0; i < n; i++) {
    const r = (i / cols) | 0;
    const c = i - r * cols;
    const outlet = !grid.landMask[i] || r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
    if (outlet) {
      level[i] = grid.elevationM[i]!;
      done[i] = 1; // queued
      heap.push(level[i]!, i);
    }
  }
  while (heap.size > 0) {
    const { val: i } = heap.pop();
    order[count++] = i;
    const r = (i / cols) | 0;
    const c = i - r * cols;
    for (const [dr, dc] of NEIGHBOURS8) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      const j = rr * cols + cc;
      if (done[j]) continue;
      done[j] = 1;
      receiver[j] = i;
      level[j] = Math.max(grid.elevationM[j]!, level[i]!);
      heap.push(level[j]!, j);
    }
  }
  const accumulation = new Int32Array(n).fill(1);
  for (let k = count - 1; k >= 0; k--) {
    const j = order[k]!;
    const p = receiver[j]!;
    if (p >= 0) accumulation[p] = accumulation[p]! + accumulation[j]!;
  }
  return { accumulation, receiver };
}

const cache = new WeakMap<object, Drainage>();
export function drainageOf(grid: IndiaGrid): Drainage {
  let d = cache.get(grid);
  if (!d) {
    d = computeDrainage(grid);
    cache.set(grid, d);
  }
  return d;
}

/** SCS Curve Number direct runoff (mm) from rainfall P (mm). */
export function scsRunoffMm(pMm: number, cn: number): number {
  const s = 25400 / cn - 254;
  const ia = 0.2 * s;
  return pMm <= ia ? 0 : ((pMm - ia) * (pMm - ia)) / (pMm + 0.8 * s);
}
