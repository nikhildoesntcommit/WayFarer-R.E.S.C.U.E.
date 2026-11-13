import { describe, expect, it } from 'vitest';
import { AimError, computeCornerPosition, headingDeg, motionVariance, tapToVideoPixels } from '../geometry';

const base = { phoneHeightM: 1.4, videoWidth: 1080, videoHeight: 1920 };

describe('camera corner geometry', () => {
  it('45° below the horizon with a 1.4 m phone is 1.4 m away, straight ahead of the heading', () => {
    const p = computeCornerPosition({ ...base, beta: 45, headingDeg: 0, tapX: 540, tapY: 960 });
    expect(p.distanceM).toBeCloseTo(1.4, 6);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(1.4, 6);
  });
  it('heading 90° (east) puts the point on +x', () => {
    const p = computeCornerPosition({ ...base, beta: 45, headingDeg: 90, tapX: 540, tapY: 960 });
    expect(p.x).toBeCloseTo(1.4, 6);
    expect(Math.abs(p.y)).toBeLessThan(1e-6);
  });
  it('tapping lower in the frame makes the point nearer', () => {
    const mid = computeCornerPosition({ ...base, beta: 70, headingDeg: 0, tapX: 540, tapY: 960 });
    const low = computeCornerPosition({ ...base, beta: 70, headingDeg: 0, tapX: 540, tapY: 1500 });
    expect(low.distanceM).toBeLessThan(mid.distanceM);
  });
  it('a point on the horizon is rejected, not turned into a huge distance', () => {
    expect(() => computeCornerPosition({ ...base, beta: 90, headingDeg: 0, tapX: 540, tapY: 960 })).toThrow(AimError);
    expect(() => computeCornerPosition({ ...base, beta: 89.5, headingDeg: 0, tapX: 540, tapY: 960 })).toThrow(AimError);
  });
  it('doubling the phone height doubles the distance', () => {
    const a = computeCornerPosition({ ...base, beta: 60, headingDeg: 30, tapX: 540, tapY: 960 });
    const b = computeCornerPosition({ ...base, phoneHeightM: 2.8, beta: 60, headingDeg: 30, tapX: 540, tapY: 960 });
    expect(b.distanceM / a.distanceM).toBeCloseTo(2, 9);
  });
});

describe('heading', () => {
  it('Android alpha is counter-clockwise: alpha 90° is a heading of 270° (west)', () => {
    expect(headingDeg(90)).toBe(270);
    expect(headingDeg(0)).toBe(0);
    expect(headingDeg(350)).toBeCloseTo(10, 9);
  });
  it('iOS compass heading is used as given', () => {
    expect(headingDeg(123, 90)).toBe(90);
    expect(headingDeg(123, 370)).toBe(10);
  });
});

describe('tap mapping and stillness', () => {
  it('object-fit: cover crops the long side', () => {
    // 1080x1920 video shown in a 400x400 box: scale = max(400/1080, 400/1920) = 0.370; box centre maps to video centre
    const c = tapToVideoPixels(200, 200, 400, 400, 1080, 1920);
    expect(c.x).toBeCloseTo(540, 6);
    expect(c.y).toBeCloseTo(960, 6);
    const top = tapToVideoPixels(200, 0, 400, 400, 1080, 1920);
    expect(top.y).toBeCloseTo(960 - 200 / (400 / 1080), 3);
  });
  it('variance is zero for a still phone and large for a shaken one', () => {
    expect(motionVariance([9.81, 9.81, 9.81, 9.81, 9.81])).toBeCloseTo(0, 9);
    expect(motionVariance([9, 11, 8, 12, 9.5, 10.5])).toBeGreaterThan(0.6);
  });
});
