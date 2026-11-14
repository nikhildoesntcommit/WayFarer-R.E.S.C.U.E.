import { describe, expect, it } from 'vitest';
import { polygonArea } from '../../utils/geo';
import { polygonFromSize, sizeProblem } from '../shapes';

describe('room by size', () => {
  it('a rectangle has the area length × width', () => {
    expect(polygonArea(polygonFromSize({ shape: 'rectangle', length: 8, width: 5 }))).toBeCloseTo(40, 9);
  });
  it('an L-shape is the rectangle minus the missing corner', () => {
    const p = polygonFromSize({ shape: 'l-shape', length: 10, width: 6, notchLength: 4, notchWidth: 3 });
    expect(p).toHaveLength(6);
    expect(polygonArea(p)).toBeCloseTo(60 - 12, 9);
  });
  it('refuses sizes that are not rooms', () => {
    expect(sizeProblem({ shape: 'rectangle', length: 0, width: 5 })).toMatch(/between/);
    expect(sizeProblem({ shape: 'rectangle', length: NaN, width: 5 })).toMatch(/between/);
    expect(sizeProblem({ shape: 'l-shape', length: 5, width: 5, notchLength: 6, notchWidth: 1 })).toMatch(/smaller/);
    expect(() => polygonFromSize({ shape: 'rectangle', length: 1000, width: 5 })).toThrow();
  });
});
