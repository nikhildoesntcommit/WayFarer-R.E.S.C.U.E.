import type { WorldPoint } from '../types';

/** Approximate field of view across the video width (spec §8.2). Real devices differ by ±10°; the calibrate step corrects the scale. */
export const CAMERA_FOV_DEG = 60;
export const DEFAULT_PHONE_HEIGHT_M = 1.4;
export const MAX_FLOOR_DISTANCE_M = 60;

export class AimError extends Error {}

/**
 * Compass heading (degrees clockwise from north) of the direction the back camera faces.
 *  - iOS reports it directly as `webkitCompassHeading`;
 *  - the W3C `alpha` grows COUNTER-clockwise, so the heading is 360 - alpha. (The specification's sample code uses alpha
 *    directly, which mirrors the plan on Android; see DEVIATIONS.md.)
 */
export function headingDeg(alpha: number, webkitCompassHeading?: number | null): number {
  if (webkitCompassHeading !== undefined && webkitCompassHeading !== null && Number.isFinite(webkitCompassHeading)) {
    return ((webkitCompassHeading % 360) + 360) % 360;
  }
  return (((360 - alpha) % 360) + 360) % 360;
}

/**
 * Floor position of the point under pixel (tapX, tapY), relative to the phone, x = east, y = north (metres).
 * beta: device pitch (90° = upright, camera level; smaller = camera tilted down).
 */
export function computeCornerPosition(a: {
  beta: number;
  headingDeg: number;
  phoneHeightM: number;
  videoWidth: number;
  videoHeight: number;
  tapX: number;
  tapY: number;
  fovDeg?: number;
}): { x: number; y: number; distanceM: number; angleBelowDeg: number } {
  const fov = ((a.fovDeg ?? CAMERA_FOV_DEG) * Math.PI) / 180;
  const focalPx = a.videoWidth / 2 / Math.tan(fov / 2);
  const pixelOffsetRad = Math.atan((a.tapY - a.videoHeight / 2) / focalPx);
  const tiltBelow = ((90 - a.beta) * Math.PI) / 180; // camera axis below horizontal
  const angleBelow = tiltBelow + pixelOffsetRad;
  if (!(angleBelow > 0.02)) throw new AimError('Aim lower: the point is at or above the horizon.');
  const distanceM = a.phoneHeightM / Math.tan(angleBelow);
  if (distanceM > MAX_FLOOR_DISTANCE_M) throw new AimError('That point is too far away to measure. Aim lower or move closer.');
  const h = (a.headingDeg * Math.PI) / 180;
  return { x: distanceM * Math.sin(h), y: distanceM * Math.cos(h), distanceM, angleBelowDeg: (angleBelow * 180) / Math.PI };
}

/** Map a tap on an `object-fit: cover` video element to pixel coordinates of the video frame. */
export function tapToVideoPixels(tapX: number, tapY: number, boxW: number, boxH: number, vidW: number, vidH: number): { x: number; y: number } {
  const s = Math.max(boxW / vidW, boxH / vidH);
  return { x: (tapX - boxW / 2) / s + vidW / 2, y: (tapY - boxH / 2) / s + vidH / 2 };
}

/** Standard deviation of acceleration magnitude: > ~0.6 m/s² means the phone is being moved. */
export function motionVariance(samples: number[]): number {
  if (samples.length < 4) return 0;
  const m = samples.reduce((s, v) => s + v, 0) / samples.length;
  return Math.sqrt(samples.reduce((s, v) => s + (v - m) ** 2, 0) / samples.length);
}
export const HOLD_STILL_THRESHOLD = 0.6;
export const DUPLICATE_CORNER_M = 0.5;

export function nearestCornerDistance(corners: WorldPoint[], p: WorldPoint): number {
  let d = Infinity;
  for (const c of corners) d = Math.min(d, Math.hypot(c.x - p.x, c.y - p.y));
  return d;
}

/** One orientation reading, kept in a short history so a tap can use the median of the last few instead of one noisy sample. */
export interface AimSample { t: number; beta: number; heading: number }

export function median(v: number[]): number {
  if (v.length === 0) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Signed difference a − b of two compass angles, in (−180, 180]. */
export function angleDiffDeg(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/**
 * The aim at the moment of a tap: the median pitch and compass heading over the last `windowMs`, plus how much they wandered
 * (a robust spread, in degrees). Replaces the old "hold perfectly still" gate: a tap is accepted when the aim was steady
 * enough, and the spread is turned into an honest ± figure for the corner.
 */
export function aimFromSamples(samples: AimSample[], now: number, windowMs = 400): { beta: number; heading: number; spreadDeg: number; n: number } | null {
  let w = samples.filter((s) => now - s.t <= windowMs);
  // some browsers send an orientation event only when the value changes: a still phone then has no recent event, so the
  // last known reading IS the steady aim
  if (w.length === 0 && samples.length > 0) w = [samples[samples.length - 1]!];
  if (w.length === 0) return null;
  const beta = median(w.map((s) => s.beta));
  const ref = median(w.map((s) => angleDiffDeg(s.heading, w[0]!.heading))) + w[0]!.heading;
  const heading = ((ref % 360) + 360) % 360;
  const dev = w.map((s) => Math.max(Math.abs(s.beta - beta), Math.abs(angleDiffDeg(s.heading, heading))));
  return { beta, heading, spreadDeg: median(dev) * 1.4826 + Math.max(...dev) * 0.25, n: w.length };
}

/**
 * Position error (metres) of a floor point found from the downward angle: d = h / tan(θ), so δd = (d² + h²)/h · δθ.
 * `sigmaDeg` is the angle uncertainty (sensor noise and how steadily the phone was held); the height error is a pure scale
 * error that the calibration step removes.
 */
export function aimUncertaintyM(distanceM: number, phoneHeightM: number, sigmaDeg: number): number {
  return ((distanceM * distanceM + phoneHeightM * phoneHeightM) / phoneHeightM) * ((sigmaDeg * Math.PI) / 180);
}

/** Baseline sensor noise of phone pitch (degrees); consumer gyro/accelerometer fusion is good to about this. */
export const PITCH_NOISE_DEG = 0.5;
/** A tap is refused only when the aim wandered more than this (degrees) while it was taken. */
export const MAX_AIM_SPREAD_DEG = 3;
