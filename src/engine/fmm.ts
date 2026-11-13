import type { Cell } from '../types';

/** Binary min-heap keyed by travel time, with lazy deletion (stale entries are skipped by the caller). */
export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= key) break;
      k[i] = k[p]!;
      v[i] = v[p]!;
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  /** Removes and returns the smallest entry. Caller must check size > 0. */
  pop(): { key: number; val: number } {
    const k = this.keys;
    const v = this.vals;
    const topKey = k[0]!;
    const topVal = v[0]!;
    const lastKey = k.pop()!;
    const lastVal = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1]! < k[c]!) c++;
        if (k[c]! >= lastKey) break;
        k[i] = k[c]!;
        v[i] = v[c]!;
        i = c;
      }
      k[i] = lastKey;
      v[i] = lastVal;
    }
    return { key: topKey, val: topVal };
  }
}

const TRIAL = 1;
const KNOWN = 2;

/**
 * First-order Fast Marching Method on a regular grid (flat, row-major arrays).
 * Solves |∇T| = 1/speed from the source cells; T = 0 on the sources, Infinity where unreachable.
 *
 * The upwind update takes, per axis, the smaller KNOWN neighbour value (Sethian 1996). That differs from the
 * wording in the specification (“sort all known cardinal neighbours”), which can pair two OPPOSITE neighbours and
 * under-estimate T, violating the physical lower bound the spec itself requires.
 */
export function fastMarchingFlat(
  walk: Uint8Array,
  rows: number,
  cols: number,
  sources: number[],
  speed: number | Float32Array | Float64Array,
  h: number,
): Float32Array {
  const n = rows * cols;
  const T = new Float32Array(n).fill(Infinity);
  const state = new Uint8Array(n);
  const heap = new MinHeap();
  const spd = (i: number): number => (typeof speed === 'number' ? speed : speed[i]!);

  const solve = (idx: number): number => {
    const r = (idx / cols) | 0;
    const c = idx - r * cols;
    let a = Infinity; // best known along the column axis (up/down)
    let b = Infinity; // best known along the row axis (left/right)
    if (r > 0 && state[idx - cols] === KNOWN) a = Math.min(a, T[idx - cols]!);
    if (r < rows - 1 && state[idx + cols] === KNOWN) a = Math.min(a, T[idx + cols]!);
    if (c > 0 && state[idx - 1] === KNOWN) b = Math.min(b, T[idx - 1]!);
    if (c < cols - 1 && state[idx + 1] === KNOWN) b = Math.min(b, T[idx + 1]!);
    const cc = h / spd(idx);
    if (a === Infinity && b === Infinity) return Infinity;
    if (a === Infinity) return b + cc;
    if (b === Infinity) return a + cc;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (hi - lo < cc) return (lo + hi + Math.sqrt(2 * cc * cc - (hi - lo) * (hi - lo))) / 2;
    return lo + cc;
  };

  const relax = (nb: number): void => {
    if (!walk[nb] || state[nb] === KNOWN) return;
    const t = Math.fround(solve(nb)); // T is Float32: compare like with like or valid entries look stale
    if (t < T[nb]!) {
      T[nb] = t;
      state[nb] = TRIAL;
      heap.push(t, nb);
    }
  };
  const neighbours = (idx: number): void => {
    const r = (idx / cols) | 0;
    const c = idx - r * cols;
    if (r > 0) relax(idx - cols);
    if (r < rows - 1) relax(idx + cols);
    if (c > 0) relax(idx - 1);
    if (c < cols - 1) relax(idx + 1);
  };

  for (const s of sources) {
    if (s < 0 || s >= n || !walk[s]) continue;
    T[s] = 0;
    state[s] = KNOWN;
  }
  for (const s of sources) if (s >= 0 && s < n && walk[s]) neighbours(s);

  while (heap.size > 0) {
    const { key, val } = heap.pop();
    if (state[val] === KNOWN || key > T[val]!) continue; // stale entry
    state[val] = KNOWN;
    neighbours(val);
  }
  return T;
}

/** Specification signature: boolean grid + Cell sources + per-cell speed field. */
export function fastMarching(
  walkable: boolean[][],
  sourceCells: Cell[],
  speedField: number[][],
  metresPerCell: number,
): Float32Array {
  const rows = walkable.length;
  const cols = rows ? walkable[0]!.length : 0;
  const walk = new Uint8Array(rows * cols);
  const speed = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      walk[r * cols + c] = walkable[r]![c] ? 1 : 0;
      speed[r * cols + c] = speedField[r]![c]!;
    }
  return fastMarchingFlat(
    walk,
    rows,
    cols,
    sourceCells.map((s) => s.row * cols + s.col),
    speed,
    metresPerCell,
  );
}
