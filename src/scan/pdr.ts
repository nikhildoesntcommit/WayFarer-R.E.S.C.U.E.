import type { WorldPoint } from '../types';

/**
 * Pedestrian dead reckoning: position from counting steps and following the compass.
 * Published, standard pieces: peak-detection step counter on the acceleration magnitude (with a minimum time between
 * steps), a constant stride calibrated on a walk of known length, loop closure by the compass (Bowditch) rule, and an
 * optional snap of every wall to the nearest right angle for rooms that are known to be rectangular.
 */
export const PDR = {
  gravity: 9.81,
  /** a step is a peak at least this far above the walking baseline (m/s²) */
  peakHeight: 1.1,
  /** shortest believable time between two steps (s) */
  minStepGapS: 0.3,
  defaultStrideM: 0.7,
  /** how far from a right angle a wall may be before snapping is judged wrong (degrees) */
  snapToleranceDeg: 22,
};

export interface PdrState {
  steps: number;
  position: WorldPoint;
  /** compass heading used for the last step (degrees clockwise from north) */
  headingDeg: number;
}

/** Streaming step counter + position integrator. Call `feed` for every devicemotion/orientation sample. */
export class Pdr {
  strideM: number;
  steps = 0;
  x = 0;
  y = 0;
  private base = PDR.gravity;
  private prev1 = 0;
  private prev2 = 0;
  private lastStepT = -Infinity;
  private heading = 0;
  private lastGoodHeading = 0;
  private smooth = PDR.gravity;

  constructor(strideM = PDR.defaultStrideM) {
    this.strideM = strideM;
  }

  /** `accMag`: |accelerationIncludingGravity| in m/s²; `headingDeg`: compass heading; `tS`: time in seconds. Returns true when a step was counted. */
  feed(tS: number, accMag: number, headingDeg: number): boolean {
    if (Number.isFinite(headingDeg)) {
      this.heading = headingDeg;
      this.lastGoodHeading = headingDeg;
    } else this.heading = this.lastGoodHeading;
    // slow baseline (gravity + drift) and a light low-pass to take the jitter off the signal
    this.base += 0.02 * (accMag - this.base);
    this.smooth += 0.35 * (accMag - this.smooth);
    const v = this.smooth - this.base;
    let stepped = false;
    // a peak: the middle of three samples is the highest and clears the threshold
    if (this.prev1 > this.prev2 && this.prev1 >= v && this.prev1 > PDR.peakHeight * 0.55 && tS - this.lastStepT >= PDR.minStepGapS) {
      stepped = this.prev1 >= PDR.peakHeight * 0.55;
      if (stepped) {
        this.lastStepT = tS;
        this.steps++;
        const h = (this.heading * Math.PI) / 180;
        this.x += this.strideM * Math.sin(h);
        this.y += this.strideM * Math.cos(h);
      }
    }
    this.prev2 = this.prev1;
    this.prev1 = v;
    return stepped;
  }

  position(): WorldPoint {
    return { x: this.x, y: this.y };
  }
}

/** Stride from a calibration walk of known length. */
export function strideFromWalk(knownDistanceM: number, steps: number): number {
  if (!(steps > 0) || !(knownDistanceM > 0)) return PDR.defaultStrideM;
  return Math.min(1.2, Math.max(0.35, knownDistanceM / steps));
}

/**
 * Close a walked loop. `points[0]` is where the walk began, the last point is where the walker believes they are back at
 * the start. The gap is shared out along the path in proportion to distance walked, and the final point is dropped.
 */
export function closeLoop(points: WorldPoint[]): WorldPoint[] {
  if (points.length < 4) return points.slice(0, Math.max(0, points.length - 1));
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const ex = last.x - first.x;
  const ey = last.y - first.y;
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  const total = cum[cum.length - 1] || 1;
  return points.slice(0, -1).map((p, i) => ({ x: p.x - ex * (cum[i]! / total), y: p.y - ey * (cum[i]! / total) }));
}

/** Direction of each wall of a closed polygon, in degrees (atan2 of y,x). */
const wallAngles = (poly: WorldPoint[]): number[] => poly.map((p, i) => {
  const q = poly[(i + 1) % poly.length]!;
  return (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
});

/**
 * Make every wall run along the first wall's direction or at right angles to it, if each wall is already within the
 * tolerance of one. Lengths are kept; the loop is closed again. Returns null when the room is not close to rectilinear.
 */
export function snapRightAngles(poly: WorldPoint[], toleranceDeg = PDR.snapToleranceDeg): WorldPoint[] | null {
  if (poly.length < 3) return null;
  const ang = wallAngles(poly);
  const base = ang[0]!;
  const snapped: number[] = [];
  for (const a of ang) {
    const rel = (((a - base) % 360) + 540) % 360 - 180; // -180..180
    const k = Math.round(rel / 90);
    if (Math.abs(rel - k * 90) > toleranceDeg) return null;
    snapped.push(base + k * 90);
  }
  const lens = poly.map((p, i) => Math.hypot(poly[(i + 1) % poly.length]!.x - p.x, poly[(i + 1) % poly.length]!.y - p.y));
  const dirs = snapped.map((a) => ({ x: Math.cos((a * Math.PI) / 180), y: Math.sin((a * Math.PI) / 180) }));
  // the walls now have exact directions but their lengths leave a gap; the smallest changes to the lengths that close it
  // are delta_i = -d_i . (M^-1 e), with M the sum of d_i d_i^T and e the gap
  let ex = 0;
  let ey = 0;
  let mxx = 0;
  let mxy = 0;
  let myy = 0;
  dirs.forEach((d, i) => {
    ex += lens[i]! * d.x;
    ey += lens[i]! * d.y;
    mxx += d.x * d.x;
    mxy += d.x * d.y;
    myy += d.y * d.y;
  });
  const det = mxx * myy - mxy * mxy;
  if (Math.abs(det) < 1e-6) return null; // every wall parallel: not a room
  const lx = (myy * ex - mxy * ey) / det;
  const ly = (-mxy * ex + mxx * ey) / det;
  const fixed = lens.map((l, i) => l - (dirs[i]!.x * lx + dirs[i]!.y * ly));
  if (fixed.some((l) => !(l > 0.2))) return null;
  const out: WorldPoint[] = [{ x: poly[0]!.x, y: poly[0]!.y }];
  for (let i = 0; i < poly.length - 1; i++) {
    const p = out[out.length - 1]!;
    out.push({ x: p.x + fixed[i]! * dirs[i]!.x, y: p.y + fixed[i]! * dirs[i]!.y });
  }
  return out;
}
