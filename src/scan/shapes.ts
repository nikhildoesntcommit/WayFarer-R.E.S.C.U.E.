import type { WorldPolygon } from '../types';

export type RoomShape = 'rectangle' | 'l-shape';

export interface RoomSize {
  shape: RoomShape;
  length: number;
  width: number;
  /** L-shape only: the size of the rectangle cut out of one corner */
  notchLength?: number;
  notchWidth?: number;
}

export const SIZE_LIMITS = { min: 1, max: 500 };

const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= SIZE_LIMITS.min && v <= SIZE_LIMITS.max;

/** Why this size cannot be a room, or null if it can. */
export function sizeProblem(s: RoomSize): string | null {
  if (!ok(s.length) || !ok(s.width)) return `Length and width must each be between ${SIZE_LIMITS.min} and ${SIZE_LIMITS.max} m.`;
  if (s.shape === 'l-shape') {
    if (!ok(s.notchLength) || !ok(s.notchWidth)) return 'Give the size of the missing corner.';
    if (s.notchLength >= s.length || s.notchWidth >= s.width) return 'The missing corner must be smaller than the room.';
  }
  return null;
}

/** Corners of the room in metres, anticlockwise, with the south-west corner at the origin. */
export function polygonFromSize(s: RoomSize): WorldPolygon {
  const problem = sizeProblem(s);
  if (problem) throw new Error(problem);
  const { length: L, width: W } = s;
  if (s.shape === 'rectangle') return [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W }, { x: 0, y: W }];
  const a = s.notchLength!;
  const b = s.notchWidth!;
  return [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W - b }, { x: L - a, y: W - b }, { x: L - a, y: W }, { x: 0, y: W }];
}
