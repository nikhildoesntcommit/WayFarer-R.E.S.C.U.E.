import type { Plan, WorldPoint, WorldPolygon } from '../types';
import { boundingBox, pointInPolygon, polygonArea } from '../utils/geo';

/** Smallest people area worth simulating, in m². */
export const MIN_AREA_M2 = 1;
/** Two areas may share this much floor (sampling noise and shared edges) before they count as overlapping. */
const OVERLAP_TOLERANCE_M2 = 0.25;
const OVERLAP_TOLERANCE_FRACTION = 0.02;

const orient = (p: WorldPoint, q: WorldPoint, r: WorldPoint): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
const EPS = 1e-9;

function onSegment(p: WorldPoint, q: WorldPoint, r: WorldPoint): boolean {
  return Math.min(p.x, r.x) - EPS <= q.x && q.x <= Math.max(p.x, r.x) + EPS && Math.min(p.y, r.y) - EPS <= q.y && q.y <= Math.max(p.y, r.y) + EPS;
}

/** Do the closed segments ab and cd share any point? */
function segmentsTouch(a: WorldPoint, b: WorldPoint, c: WorldPoint, d: WorldPoint): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS)) && ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS))) return true;
  if (Math.abs(o1) <= EPS && onSegment(a, c, b)) return true;
  if (Math.abs(o2) <= EPS && onSegment(a, d, b)) return true;
  if (Math.abs(o3) <= EPS && onSegment(c, a, d)) return true;
  if (Math.abs(o4) <= EPS && onSegment(c, b, d)) return true;
  return false;
}

/** A simple polygon: at least three corners and no edge crossing or touching a non-neighbouring edge (no bow-ties). */
export function isSimplePolygon(poly: WorldPolygon): boolean {
  const n = poly.length;
  if (n < 3) return false;
  if (polygonArea(poly) < 1e-6) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // neighbours share a corner by construction
      if (segmentsTouch(a, b, poly[j]!, poly[(j + 1) % n]!)) return false;
    }
  }
  return true;
}

function sampleStep(poly: WorldPolygon): number {
  const bb = boundingBox(poly);
  return Math.min(0.5, Math.max(0.1, Math.sqrt((bb.maxX - bb.minX) * (bb.maxY - bb.minY)) / 80));
}

/** Floor area (m²) covered by BOTH polygons, by point sampling (error well below the tolerance used by callers). */
export function overlapAreaM2(a: WorldPolygon, b: WorldPolygon): number {
  const ba = boundingBox(a);
  const bb = boundingBox(b);
  const x0 = Math.max(ba.minX, bb.minX);
  const x1 = Math.min(ba.maxX, bb.maxX);
  const y0 = Math.max(ba.minY, bb.minY);
  const y1 = Math.min(ba.maxY, bb.maxY);
  if (x0 >= x1 || y0 >= y1) return 0;
  const step = Math.min(sampleStep(a), sampleStep(b));
  let n = 0;
  for (let x = x0 + step / 2; x < x1; x += step)
    for (let y = y0 + step / 2; y < y1; y += step) {
      const p = { x, y };
      if (pointInPolygon(p, a) && pointInPolygon(p, b)) n++;
    }
  return n * step * step;
}

/** Share of the polygon that lies inside the building outline (0..1), by sampling. */
export function shareInside(poly: WorldPolygon, outline: WorldPolygon): number {
  if (outline.length < 3) return 1; // nothing to compare against yet
  const bb = boundingBox(poly);
  const step = sampleStep(poly);
  let inPoly = 0;
  let inBoth = 0;
  for (let x = bb.minX + step / 2; x < bb.maxX; x += step)
    for (let y = bb.minY + step / 2; y < bb.maxY; y += step) {
      const p = { x, y };
      if (!pointInPolygon(p, poly)) continue;
      inPoly++;
      if (pointInPolygon(p, outline)) inBoth++;
    }
  return inPoly === 0 ? 0 : inBoth / inPoly;
}

export type AreaCheck = { ok: true } | { ok: false; reason: string };

/** Is this outline acceptable as a NEW people area of the plan? */
export function checkNewArea(plan: Plan, poly: WorldPolygon): AreaCheck {
  if (poly.length < 3) return { ok: false, reason: 'An area needs at least three corners.' };
  if (!isSimplePolygon(poly)) return { ok: false, reason: 'The outline crosses itself. Redraw it so the edges do not cross.' };
  if (polygonArea(poly) < MIN_AREA_M2) return { ok: false, reason: `That area is under ${MIN_AREA_M2} m². Draw a larger one.` };
  if (plan.buildingPerimeterWorld.length >= 3 && shareInside(poly, plan.buildingPerimeterWorld) < 0.5) {
    return { ok: false, reason: 'Most of this area is outside the building. Draw it on the floor.' };
  }
  for (const other of plan.clusters) {
    const o = overlapAreaM2(poly, other.polygonWorld);
    if (o > OVERLAP_TOLERANCE_M2 && o > OVERLAP_TOLERANCE_FRACTION * Math.min(polygonArea(poly), polygonArea(other.polygonWorld))) {
      return { ok: false, reason: `This overlaps "${other.label}". People areas must not overlap: shrink it, or remove the other one first.` };
    }
  }
  return { ok: true };
}

/** Problems among the areas already in a plan (older files can contain overlaps and bow-ties). */
export function planAreaProblems(plan: Plan): string[] {
  const out: string[] = [];
  for (const c of plan.clusters) {
    if (c.polygonWorld.length >= 3 && !isSimplePolygon(c.polygonWorld)) out.push(`"${c.label}" has an outline that crosses itself.`);
  }
  for (let i = 0; i < plan.clusters.length; i++)
    for (let j = i + 1; j < plan.clusters.length; j++) {
      const a = plan.clusters[i]!;
      const b = plan.clusters[j]!;
      if (a.polygonWorld.length < 3 || b.polygonWorld.length < 3) continue;
      const o = overlapAreaM2(a.polygonWorld, b.polygonWorld);
      if (o > OVERLAP_TOLERANCE_M2 && o > OVERLAP_TOLERANCE_FRACTION * Math.min(polygonArea(a.polygonWorld), polygonArea(b.polygonWorld))) {
        out.push(`"${a.label}" and "${b.label}" overlap.`);
      }
    }
  return out;
}
