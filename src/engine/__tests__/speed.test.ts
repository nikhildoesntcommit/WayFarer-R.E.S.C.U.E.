import { describe, expect, it } from 'vitest';
import { weidmannSpeed } from '../speed';

describe('Weidmann fundamental diagram', () => {
  it('gives 0.700 m/s at 1.75 persons/m² and the 1.225 persons/(m·s) capacity flow', () => {
    expect(weidmannSpeed(1.75)).toBeCloseTo(0.7, 3);
    expect(weidmannSpeed(1.75) * 1.75).toBeCloseTo(1.225, 3);
  });
  it('stops at jam density and is free-flow when empty', () => {
    expect(weidmannSpeed(5.4)).toBeCloseTo(0, 6);
    expect(weidmannSpeed(0)).toBe(1.34);
  });
  it('never goes negative beyond jam density', () => {
    expect(weidmannSpeed(9)).toBe(0);
  });
  it('is monotonically decreasing in density', () => {
    let prev = Infinity;
    for (let r = 0.1; r <= 5.4; r += 0.1) {
      const v = weidmannSpeed(r);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
});
