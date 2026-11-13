import { SEEDS, SIM } from '../constants';
import type { Cluster, Door, GroupMix, Hotspot, Plan, WallSegment, WorldPoint, WorldPolygon } from '../types';
import { deriveExits } from '../utils/exits';
import { traceFootprint } from '../utils/footprint';
import { boundingBox, closestOnSegment, dist, thickSegmentPolygon } from '../utils/geo';

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyPlan(name: string, source: 'camera' | 'draw'): Plan {
  const now = Date.now();
  return {
    version: 2,
    id: uid('plan'),
    name,
    source,
    metresPerCell: SIM.defaultMetresPerCell,
    buildingPerimeterWorld: [],
    wallsWorld: [],
    obstaclesWorld: [],
    doors: [],
    clusters: [],
    hotspots: [],
    hazards: [],
    alarmTimeSeconds: 0,
    masterSeed: SEEDS.master,
    createdAt: now,
    updatedAt: now,
    wallSegments: [],
    clusterExitAssignment: {},
  };
}

/** Coarsen the simulation grid only if the plan would otherwise exceed SIM.maxCellsPerSide cells per side. */
export function autoMetresPerCell(widthM: number, heightM: number): number {
  const longest = Math.max(widthM, heightM);
  const needed = longest / SIM.maxCellsPerSide;
  if (needed <= SIM.defaultMetresPerCell) return SIM.defaultMetresPerCell;
  return Math.ceil(needed * 20) / 20; // round up to 0.05 m
}

export function polygonToSegments(poly: WorldPolygon, idPrefix = 'wall'): WallSegment[] {
  return poly.map((p, i) => ({ id: `${idPrefix}-${i}`, a: p, b: poly[(i + 1) % poly.length]! }));
}

function rectangle(minX: number, minY: number, maxX: number, maxY: number): WorldPolygon {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/**
 * Rebuild the derived geometry (thick wall polygons, perimeter, grid resolution) from wall centre-lines.
 * If `perimeter` is given (camera scan) it is used as-is; otherwise the perimeter is the walls' bounding box plus a margin,
 * which is equivalent for simulation purposes once the walls are validated as closed (see marking/validation.ts).
 */
export function deriveGeometry(plan: Plan, opts: { perimeter?: WorldPolygon } = {}): Plan {
  const segs = plan.wallSegments ?? [];
  const wallsWorld = segs.map((s) => thickSegmentPolygon(s.a, s.b, SIM.wallThicknessM));
  let perimeter: WorldPolygon = opts.perimeter ?? [];
  if (perimeter.length < 3) {
    const fp = traceFootprint(segs);
    if (fp.closed) perimeter = fp.polygon;
  }
  if (perimeter.length < 3) {
    // Walls not closed (yet): bounding box + margin, so the editor can still draw and rasterize. Validation will say "not closed".
    const pts = [...segs.flatMap((s) => [s.a, s.b]), ...plan.clusters.flatMap((c) => c.polygonWorld), ...(plan.hotspots ?? []).map((h) => h.at)];
    if (pts.length > 0) {
      const bb = boundingBox(pts);
      const m = SIM.perimeterMarginM;
      perimeter = rectangle(bb.minX - m, bb.minY - m, bb.maxX + m, bb.maxY + m);
    }
  }
  let metresPerCell = plan.metresPerCell;
  if (perimeter.length >= 3) {
    const bb = boundingBox(perimeter);
    metresPerCell = autoMetresPerCell(bb.maxX - bb.minX, bb.maxY - bb.minY);
  }
  return deriveExits({ ...plan, wallsWorld, buildingPerimeterWorld: perimeter, metresPerCell });
}

export function nearestSegment(plan: Plan, p: WorldPoint, maxDist: number): { segment: WallSegment; point: WorldPoint; t: number; d: number } | null {
  let best: { segment: WallSegment; point: WorldPoint; t: number; d: number } | null = null;
  for (const segment of plan.wallSegments ?? []) {
    const c = closestOnSegment(p, segment.a, segment.b);
    if (c.d <= maxDist && (!best || c.d < best.d)) best = { segment, ...c };
  }
  return best;
}

/** Place a door of clear width `widthM` centred (as far as the wall allows) on the point nearest to `at`. */
/** Exit status is not chosen here: deriveGeometry works it out from where the door sits (see utils/exits.ts). */
export function placeDoor(plan: Plan, segmentId: string, at: WorldPoint, widthM: number): Door | null {
  const seg = (plan.wallSegments ?? []).find((s) => s.id === segmentId);
  if (!seg) return null;
  const len = dist(seg.a, seg.b);
  if (len < widthM || len === 0) return null; // the wall is shorter than the door
  const dx = (seg.b.x - seg.a.x) / len;
  const dy = (seg.b.y - seg.a.y) / len;
  const proj = (at.x - seg.a.x) * dx + (at.y - seg.a.y) * dy;
  const half = widthM / 2;
  const c = Math.min(len - half, Math.max(half, proj));
  return {
    id: uid('door'),
    wallId: seg.id,
    startWorld: { x: seg.a.x + dx * (c - half), y: seg.a.y + dy * (c - half) },
    endWorld: { x: seg.a.x + dx * (c + half), y: seg.a.y + dy * (c + half) },
    widthM,
    isExit: false,
  };
}

export function normaliseMix(mix: GroupMix): GroupMix {
  const s = mix.adult + mix.child + mix.elderly + mix.wheelchair;
  if (s <= 0) return { adult: 1, child: 0, elderly: 0, wheelchair: 0 };
  return { adult: mix.adult / s, child: mix.child / s, elderly: mix.elderly / s, wheelchair: mix.wheelchair / s };
}

export function newCluster(index: number, polygon: WorldPolygon, people: number, mix: GroupMix): Cluster {
  return { id: uid('area'), label: `Area ${index}`, polygonWorld: polygon, people, groupMix: mix };
}

export function newHotspot(index: number, at: WorldPoint, people: number, radiusM: number, mix: GroupMix): Hotspot {
  return { id: uid('hotspot'), label: `Hotspot ${index}`, at, people, radiusM, groupMix: mix };
}

/** Uniformly rescale all plan geometry (used by Calibrate). Door widths scale with the drawing. */
export function scalePlan(plan: Plan, factor: number): Plan {
  const sp = (p: WorldPoint): WorldPoint => ({ x: p.x * factor, y: p.y * factor });
  const spoly = (q: WorldPolygon): WorldPolygon => q.map(sp);
  return deriveGeometry({
    ...plan,
    wallSegments: (plan.wallSegments ?? []).map((s) => ({ ...s, a: sp(s.a), b: sp(s.b) })),
    obstaclesWorld: plan.obstaclesWorld.map(spoly),
    doors: plan.doors.map((d) => ({ ...d, startWorld: sp(d.startWorld), endWorld: sp(d.endWorld), widthM: d.widthM * factor })),
    clusters: plan.clusters.map((c) => ({ ...c, polygonWorld: spoly(c.polygonWorld) })),
    hotspots: (plan.hotspots ?? []).map((h) => ({ ...h, at: sp(h.at), radiusM: h.radiusM * factor })),
    hazards: plan.hazards.map((h) => ({ ...h, polygonWorld: h.polygonWorld ? spoly(h.polygonWorld) : undefined })),
  }, plan.source === 'camera' ? { perimeter: spoly(plan.buildingPerimeterWorld) } : {});
}

export const DOOR_WIDTH_CHOICES_M = [0.8, 0.9, 1.0, 1.2, 1.5, 1.8, 2.4];

/** Rebuild wall polygons, perimeter and final exits after any change to walls or doors. Camera plans keep their scanned outline. */
export function rebuildPlan(p: Plan): Plan {
  return p.source === 'camera' && p.buildingPerimeterWorld.length >= 3
    ? deriveGeometry(p, { perimeter: p.buildingPerimeterWorld })
    : deriveGeometry(p);
}
