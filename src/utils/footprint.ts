import { SIM } from '../constants';
import { polygonTouchesRect } from '../engine/grid';
import type { WallSegment, WorldPolygon } from '../types';
import { boundingBox, polygonArea, simplifyPolyline, thickSegmentPolygon } from './geo';
import { chainSegments, contourSegments } from './contour';

export interface Footprint {
  /** True when the walls enclose at least one open area. Doors are NOT openings here: a door sits in a wall. */
  closed: boolean;
  /** Outline of everything the walls enclose (outer face of the outer wall). Empty when not closed. */
  polygon: WorldPolygon;
  /** Open floor area (excluding wall cells) inside the footprint, m². */
  interiorAreaM2: number;
}

const MIN_INTERIOR_M2 = 1;

/**
 * Flood-fill the wall raster from outside: whatever the water cannot reach is the building.
 * This is how "closed perimeter" is decided for hand-drawn walls, and where buildingPerimeterWorld comes from.
 */
export function traceFootprint(segments: WallSegment[]): Footprint {
  const none: Footprint = { closed: false, polygon: [], interiorAreaM2: 0 };
  if (segments.length < 3) return none;
  const pts = segments.flatMap((s) => [s.a, s.b]);
  const bb = boundingBox(pts);
  const pad = 1;
  const minX = bb.minX - pad;
  const minY = bb.minY - pad;
  const extent = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) + 2 * pad;
  const res = Math.max(0.1, extent / 700);
  const W = Math.ceil((bb.maxX - bb.minX + 2 * pad) / res);
  const H = Math.ceil((bb.maxY - bb.minY + 2 * pad) / res);
  const wall = new Uint8Array(W * H);
  for (const s of segments) {
    // lengthen by half a thickness so walls meeting at a corner overlap
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const e = SIM.wallThicknessM / 2;
    const a = { x: s.a.x - (dx / len) * e, y: s.a.y - (dy / len) * e };
    const b = { x: s.b.x + (dx / len) * e, y: s.b.y + (dy / len) * e };
    const poly = thickSegmentPolygon(a, b, SIM.wallThicknessM);
    const pb = boundingBox(poly);
    const c0 = Math.max(0, Math.floor((pb.minX - minX) / res));
    const c1 = Math.min(W - 1, Math.floor((pb.maxX - minX) / res));
    const r0 = Math.max(0, Math.floor((pb.minY - minY) / res));
    const r1 = Math.min(H - 1, Math.floor((pb.maxY - minY) / res));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const x0 = minX + c * res;
        const y0 = minY + r * res;
        if (polygonTouchesRect(poly, x0, y0, x0 + res, y0 + res)) wall[r * W + c] = 1;
      }
  }
  // flood fill the outside (4-connected) from the padded corner
  const outside = new Uint8Array(W * H);
  const stack: number[] = [0];
  outside[0] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const r = (i / W) | 0;
    const c = i - r * W;
    const push = (j: number) => {
      if (!outside[j] && !wall[j]) { outside[j] = 1; stack.push(j); }
    };
    if (r > 0) push(i - W);
    if (r < H - 1) push(i + W);
    if (c > 0) push(i - 1);
    if (c < W - 1) push(i + 1);
  }
  let interior = 0;
  const enclosed = new Float32Array(W * H);
  for (let i = 0; i < enclosed.length; i++) {
    if (!outside[i]) {
      enclosed[i] = 1;
      if (!wall[i]) interior++;
    }
  }
  const area = interior * res * res;
  if (area < MIN_INTERIOR_M2) return none;

  const chains = chainSegments(contourSegments(enclosed, H, W, 0.5));
  let best: [number, number][] | null = null;
  let bestArea = 0;
  for (const ch of chains) {
    const ring: WorldPolygon = ch.map(([x, y]) => ({ x: minX + (x + 0.5) * res, y: minY + (y + 0.5) * res }));
    const a = polygonArea(ring);
    if (a > bestArea) { bestArea = a; best = ch; }
  }
  if (!best) return none;
  let ring: WorldPolygon = best.map(([x, y]) => ({ x: minX + (x + 0.5) * res, y: minY + (y + 0.5) * res }));
  const f = ring[0]!;
  const l = ring[ring.length - 1]!;
  if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-6) ring = ring.slice(0, -1);
  ring = simplifyPolyline(ring, res * 0.6, true);
  return { closed: ring.length >= 3, polygon: ring, interiorAreaM2: area };
}
