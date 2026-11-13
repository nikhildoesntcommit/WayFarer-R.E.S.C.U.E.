import { describe, expect, it } from 'vitest';
import { fastMarching, fastMarchingFlat } from '../fmm';
import { rasterize } from '../grid';
import { makeRoomPlan } from './helpers';

const V = 1.34;

describe('fast marching', () => {
  it('walks a 10 m corridor in 10/1.34 = 7.46 s (±5%)', () => {
    const h = 0.5;
    const cols = 21; // source cell + 20 cells = 10 m between centres
    const walk = new Uint8Array(3 * cols).fill(1);
    const T = fastMarchingFlat(walk, 3, cols, [1 * cols + 0], V, h);
    const far = T[1 * cols + cols - 1]!;
    expect(far).toBeGreaterThan(7.46 * 0.95);
    expect(far).toBeLessThan(7.46 * 1.05);
  });

  it('has T = 0 at the source and respects the physical lower bound everywhere', () => {
    const rows = 40, cols = 40, h = 0.5;
    const walk = new Uint8Array(rows * cols).fill(1);
    const src = 20 * cols + 20;
    const T = fastMarchingFlat(walk, rows, cols, [src], V, h);
    expect(T[src]).toBe(0);
    for (let i = 0; i < T.length; i++) {
      const dr = ((i / cols) | 0) - 20;
      const dc = (i % cols) - 20;
      const euclid = Math.hypot(dr, dc) * h;
      expect(T[i]!).toBeGreaterThanOrEqual(euclid / V - 1e-4);
    }
    // first-order FMM overestimates the diagonal by a few percent, never wildly
    const diag = T[(20 + 15) * cols + 20 + 15]!;
    expect(diag).toBeLessThan((Math.hypot(15, 15) * h) / V * 1.1);
  });

  it('does not let the wave through a wall except via the door', () => {
    const rows = 20, cols = 20;
    const walk = new Uint8Array(rows * cols).fill(1);
    for (let r = 0; r < rows; r++) walk[r * cols + 10] = 0; // wall column
    let T = fastMarchingFlat(walk, rows, cols, [10 * cols + 2], V, 0.5);
    for (let r = 0; r < rows; r++) expect(T[r * cols + 15]).toBe(Infinity);
    walk[5 * cols + 10] = 1; // a door
    T = fastMarchingFlat(walk, rows, cols, [10 * cols + 2], V, 0.5);
    expect(Number.isFinite(T[5 * cols + 15]!)).toBe(true);
    // and the far side is slower than the straight-line time because the path must detour via the door
    expect(T[15 * cols + 15]!).toBeGreaterThan(T[5 * cols + 15]!);
  });

  it('does not leak through a diagonal gap between two blocked cells', () => {
    const rows = 6, cols = 6;
    const walk = new Uint8Array(rows * cols).fill(1);
    for (let i = 0; i < 6; i++) walk[i * cols + (5 - i)] = 0; // anti-diagonal wall
    const T = fastMarchingFlat(walk, rows, cols, [0], V, 1);
    expect(T[5 * cols + 5]).toBe(Infinity);
  });

  it('spec-shaped wrapper agrees with the flat solver', () => {
    const walkable = Array.from({ length: 5 }, () => new Array<boolean>(8).fill(true));
    const speed = Array.from({ length: 5 }, () => new Array<number>(8).fill(V));
    const T = fastMarching(walkable, [{ row: 2, col: 0 }], speed, 0.5);
    expect(T[2 * 8]).toBe(0);
    expect(T[2 * 8 + 7]!).toBeCloseTo((7 * 0.5) / V, 3);
  });

  it('routes through a rasterised room: cells inside the room reach the exit', () => {
    const plan = makeRoomPlan({ w: 10, h: 10, exits: [{ side: 'bottom', width: 1.2 }], clusters: [{ rect: [2, 2, 8, 8], people: 5 }] });
    const g = rasterize(plan);
    const src = [...g.exits.values()][0]!.map((c) => c.row * g.cols + c.col);
    expect(src.length).toBeGreaterThan(0);
    const T = fastMarchingFlat(g.walk, g.rows, g.cols, src, V, g.metresPerCell);
    const inside = (5.0 - g.originY) / g.metresPerCell | 0;
    const col = ((5.0 - g.originX) / g.metresPerCell) | 0;
    expect(Number.isFinite(T[inside * g.cols + col]!)).toBe(true);
  });
});
