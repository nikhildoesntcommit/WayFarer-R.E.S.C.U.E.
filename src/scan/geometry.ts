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
