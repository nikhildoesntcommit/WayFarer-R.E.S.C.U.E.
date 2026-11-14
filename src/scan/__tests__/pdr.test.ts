import { describe, expect, it } from 'vitest';
import { closeLoop, Pdr, snapRightAngles, strideFromWalk } from '../pdr';

/** Synthetic walking: 1.8 steps per second, 2.2 m/s² amplitude on top of gravity, 50 Hz. */
function walk(pdr: Pdr, seconds: number, heading: number, t0: number, noise = 0, rnd = () => 0.5): number {
  const hz = 50;
  for (let k = 0; k < seconds * hz; k++) {
    const t = t0 + k / hz;
    const a = 9.81 + 2.2 * Math.sin(2 * Math.PI * 1.8 * t) + noise * (rnd() - 0.5);
    pdr.feed(t, a, heading);
  }
  return t0 + seconds;
}

describe('step counting and position', () => {
  it('counts the steps of a steady walk within one step', () => {
    const p = new Pdr(0.7);
    walk(p, 10, 0, 0);
    expect(Math.abs(p.steps - 18)).toBeLessThanOrEqual(2);
  });

  it('does not count steps while standing still, even with sensor noise', () => {
    const p = new Pdr(0.7);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < 500; k++) p.feed(k / 50, 9.81 + 0.4 * (rnd() - 0.5), 90);
    expect(p.steps).toBe(0);
  });

  it('walking north for ten seconds moves the position north by about steps × stride', () => {
    const p = new Pdr(0.7);
    walk(p, 10, 0, 0);
    expect(Math.abs(p.x)).toBeLessThan(0.01);
    expect(p.y).toBeGreaterThan(11);
    expect(p.y).toBeLessThan(14);
  });

  it('walking east moves the position east', () => {
    const p = new Pdr(0.7);
    walk(p, 10, 90, 0);
    expect(p.x).toBeGreaterThan(11);
    expect(Math.abs(p.y)).toBeLessThan(0.01);
  });

  it('calibration: the stride follows a walk of known length', () => {
    expect(strideFromWalk(10, 14)).toBeCloseTo(10 / 14, 6);
    expect(strideFromWalk(10, 0)).toBe(0.7);
  });
});

describe('closing and squaring a walked loop', () => {
  it('a rectangle walked with compass drift and a gap at the end is closed and kept close to its true size', () => {
    // true room 8 × 5; the walker ends 0.5 m short and 0.3 m off, and every leg is slightly rotated by drift
    const walked = [
      { x: 0, y: 0 }, { x: 7.8, y: 0.9 }, { x: 8.4, y: 5.6 }, { x: 0.3, y: 4.9 }, { x: 0.5, y: 0.3 },
    ];
    const closed = closeLoop(walked);
    expect(closed).toHaveLength(4);
    const dx = Math.max(...closed.map((p) => p.x)) - Math.min(...closed.map((p) => p.x));
    const dy = Math.max(...closed.map((p) => p.y)) - Math.min(...closed.map((p) => p.y));
    expect(dx).toBeGreaterThan(7.5);
    expect(dx).toBeLessThan(8.8);
    expect(dy).toBeGreaterThan(4.5);
    expect(dy).toBeLessThan(5.8);
  });

  it('snapping makes a nearly rectangular room exactly rectangular, and refuses a room that is not', () => {
    const near = [{ x: 0, y: 0 }, { x: 7.8, y: 0.9 }, { x: 8.1, y: 5.7 }, { x: 0.2, y: 4.8 }];
    const sq = snapRightAngles(near)!;
    expect(sq).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      const a = sq[i]!;
      const b = sq[(i + 1) % 4]!;
      const c = sq[(i + 2) % 4]!;
      const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
      expect(Math.abs(dot)).toBeLessThan(1e-3);
    }
    const triangle = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 3, y: 4 }];
    expect(snapRightAngles(triangle)).toBeNull();
  });
});
