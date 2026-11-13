import { MAP } from '../constants';
import type { WorldPoint, WorldPolygon } from '../types';

// ---------- planar geometry (metres) ----------

export function dist(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Even-odd rule point-in-polygon. */
export function pointInPolygon(p: WorldPoint, poly: WorldPolygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function polygonArea(poly: WorldPolygon): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j]!.x * poly[i]!.y - poly[i]!.x * poly[j]!.y;
  }
  return Math.abs(s) / 2;
}

export function polygonCentroid(poly: WorldPolygon): WorldPoint {
  if (poly.length === 0) return { x: 0, y: 0 };
  if (poly.length < 3) {
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
      y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
    };
  }
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j]!.x * poly[i]!.y - poly[i]!.x * poly[j]!.y;
    a += f;
    cx += (poly[j]!.x + poly[i]!.x) * f;
    cy += (poly[j]!.y + poly[i]!.y) * f;
  }
  if (Math.abs(a) < 1e-12) {
    return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function boundingBox(poly: WorldPolygon): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Closest point on segment ab to p, with the parameter t in [0,1]. */
export function closestOnSegment(p: WorldPoint, a: WorldPoint, b: WorldPoint): { point: WorldPoint; t: number; d: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, t, d: dist(p, point) };
}

/** Thick rectangle polygon around the centre-line segment ab. */
export function thickSegmentPolygon(a: WorldPoint, b: WorldPoint, thickness: number): WorldPolygon {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (thickness / 2);
  const ny = (dx / len) * (thickness / 2);
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
}

/** Points along a polyline edge at most `step` apart (inclusive of both ends). */
export function sampleSegment(a: WorldPoint, b: WorldPoint, step: number): WorldPoint[] {
  const len = dist(a, b);
  const n = Math.max(1, Math.ceil(len / step));
  const out: WorldPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

// ---------- geodesic (km) ----------

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * MAP.earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Douglas–Peucker simplification. For a closed ring the ring is split at its two farthest-apart anchors. */
export function simplifyPolyline(points: WorldPolygon, tol: number, closed = false): WorldPolygon {
  if (points.length < 4) return points;
  const dp = (pts: WorldPolygon): WorldPolygon => {
    if (pts.length < 3) return pts;
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    let maxD = 0;
    let idx = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = closestOnSegment(pts[i]!, a, b).d;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD <= tol || idx < 0) return [a, b];
    const left = dp(pts.slice(0, idx + 1));
    const right = dp(pts.slice(idx));
    return [...left.slice(0, -1), ...right];
  };
  if (!closed) return dp(points);
  // closed ring: anchor at the point farthest from the first one
  let far = 0;
  let fd = -1;
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[0]!, points[i]!);
    if (d > fd) { fd = d; far = i; }
  }
  const h1 = dp(points.slice(0, far + 1));
  const h2 = dp([...points.slice(far), points[0]!]);
  return [...h1.slice(0, -1), ...h2.slice(0, -1)];
}
