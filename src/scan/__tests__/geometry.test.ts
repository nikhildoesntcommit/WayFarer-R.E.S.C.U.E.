import { describe, expect, it } from 'vitest';
import { aimFromSamples, aimUncertaintyM, AimError, angleDiffDeg, computeCornerPosition, headingDeg, median, motionVariance, tapToVideoPixels } from '../geometry';

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

describe('aim averaging and honest uncertainty', () => {
  it('the median ignores a single wild reading', () => {
    expect(median([10, 10.2, 9.9, 10.1, 25])).toBeCloseTo(10.1, 5);
  });
  it('compass angles are compared around north: 359° and 1° are 2° apart', () => {
    expect(angleDiffDeg(1, 359)).toBe(2);
    expect(angleDiffDeg(359, 1)).toBe(-2);
  });
  it('a steady aim near north averages to north, not to 180°', () => {
    const t0 = 1000;
    const s = [359.6, 0.3, 359.8, 0.1, 0.0].map((h, i) => ({ t: t0 + i * 50, beta: 45 + (i % 2) * 0.1, heading: h }));
    const a = aimFromSamples(s, t0 + 250)!;
    expect(Math.min(a.heading, 360 - a.heading)).toBeLessThan(0.5);
    expect(a.spreadDeg).toBeLessThan(1);
  });
  it('an aim that swings widely reports a large spread; old samples are ignored', () => {
    const s = [{ t: 0, beta: 10, heading: 0 }, { t: 900, beta: 40, heading: 0 }, { t: 950, beta: 50, heading: 0 }, { t: 1000, beta: 60, heading: 0 }];
    const a = aimFromSamples(s, 1000)!;
    expect(a.n).toBe(3);
    expect(a.spreadDeg).toBeGreaterThan(3);
    expect(aimFromSamples([], 0)).toBeNull();
    // events only on change: a long-still phone keeps its last reading
    expect(aimFromSamples([{ t: 0, beta: 50, heading: 10 }], 5000)!.spreadDeg).toBe(0);
  });
  it('error grows with the square of the distance and is a few centimetres up close', () => {
    const near = aimUncertaintyM(1.4, 1.4, 0.5);
    const far = aimUncertaintyM(6, 1.4, 0.5);
    expect(near).toBeLessThan(0.03);
    expect(far / near).toBeGreaterThan(8);
  });
  it('the picture centre is lens-independent: a different field of view gives the same point', () => {
    const o = { phoneHeightM: 1.4, videoWidth: 1080, videoHeight: 1920, beta: 55, headingDeg: 30, tapX: 540, tapY: 960 };
    const a = computeCornerPosition({ ...o, fovDeg: 50 });
    const b = computeCornerPosition({ ...o, fovDeg: 95 });
    expect(a.distanceM).toBeCloseTo(b.distanceM, 9);
  });
});
