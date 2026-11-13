import { SEEDS } from '../constants';
import { deriveGeometry, emptyPlan, newCluster, newHotspot, placeDoor, rebuildPlan } from '../draw/tools';
import type { GroupMix, Plan, WallSegment, WorldPoint, WorldPolygon } from '../types';
import { deriveExits } from '../utils/exits';

/**
 * A built-in showcase plan, used from Settings → "Load demo map" and as a fallback when a scan or a drawing fails.
 *
 * A 48 m × 26 m science-expo building: a central exhibition hall, two rooms on each wing, interior doors between them,
 * and three final exits of different widths on the outer wall. 545 people: a crowd across the hall, a food stall and a
 * stage as hotspots, and people in the wing rooms. A fire starts 60 s in beside the widest exit, so the best route is
 * not the nearest one. Fixed seed: the numbers are the same every time on every device.
 */
const W = 48;
const H = 26;
const mix = (over: Partial<GroupMix> = {}): GroupMix => ({ adult: 0.72, child: 0.18, elderly: 0.08, wheelchair: 0.02, ...over });
const rect = (x0: number, y0: number, x1: number, y1: number): WorldPolygon => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

export const DEMO_PLAN_NAME = 'Demo: Science Expo building';

export function buildDemoPlan(): Plan {
  let plan = emptyPlan(DEMO_PLAN_NAME, 'draw');
  const seg = (id: string, a: WorldPoint, b: WorldPoint): WallSegment => ({ id, a, b });
  plan.wallSegments = [
    // outer shell (counter-clockwise from the south-west corner)
    seg('wall-south', { x: 0, y: 0 }, { x: W, y: 0 }),
    seg('wall-east', { x: W, y: 0 }, { x: W, y: H }),
    seg('wall-north', { x: W, y: H }, { x: 0, y: H }),
    seg('wall-west', { x: 0, y: H }, { x: 0, y: 0 }),
    // wing partitions
    seg('wall-hall-west', { x: 12, y: 0 }, { x: 12, y: H }),
    seg('wall-hall-east', { x: 36, y: 0 }, { x: 36, y: H }),
    seg('wall-split-west', { x: 0, y: 13 }, { x: 12, y: 13 }),
    seg('wall-split-east', { x: 36, y: 13 }, { x: W, y: 13 }),
  ];
  plan = deriveGeometry(plan);

  const door = (id: string, wall: string, at: WorldPoint, width: number) => {
    const d = placeDoor(plan, wall, at, width);
    if (!d) throw new Error(`demo door ${id} does not fit`);
    d.id = id;
    plan.doors.push(d);
  };
  // interior doors: passages only
  door('door-w1', 'wall-hall-west', { x: 12, y: 6.5 }, 1.2);
  door('door-w2', 'wall-hall-west', { x: 12, y: 19.5 }, 1.2);
  door('door-e1', 'wall-hall-east', { x: 36, y: 6.5 }, 1.2);
  door('door-e2', 'wall-hall-east', { x: 36, y: 19.5 }, 1.2);
  // final exits on the outer wall
  door('exit-south', 'wall-south', { x: 24, y: 0 }, 2.4);
  door('exit-north', 'wall-north', { x: 24, y: H }, 1.8);
  door('exit-west', 'wall-west', { x: 0, y: 6.5 }, 1.0);
  door('exit-east', 'wall-east', { x: W, y: 19.5 }, 1.2);
  plan = deriveExits(rebuildPlan(plan));

  plan.clusters = [
    newCluster(1, rect(14, 3, 34, 23), 260, mix()),
    newCluster(2, rect(1, 1, 11, 12), 30, mix()),
    newCluster(3, rect(1, 14, 11, 25), 30, mix({ elderly: 0.2, adult: 0.6 })),
    newCluster(4, rect(37, 1, 47, 12), 40, mix()),
    newCluster(5, rect(37, 14, 47, 25), 25, mix()),
  ];
  plan.clusters[0]!.label = 'Exhibition hall';
  plan.clusters[1]!.label = 'West room 1';
  plan.clusters[2]!.label = 'West room 2';
  plan.clusters[3]!.label = 'East room 1';
  plan.clusters[4]!.label = 'East room 2';
  plan.hotspots = [
    newHotspot(1, { x: 30, y: 8 }, 70, 3, mix()),
    newHotspot(2, { x: 24, y: 20 }, 90, 4, mix({ child: 0.25, adult: 0.65 })),
  ];
  plan.hotspots[0]!.label = 'Food stall';
  plan.hotspots[1]!.label = 'Stage';
  plan.hazards = [{ id: 'fire-demo', kind: 'fire_origin', polygonWorld: [{ x: 27, y: 2.5 }], activeAtSeconds: 60 }];
  plan.masterSeed = SEEDS.master;
  plan.name = DEMO_PLAN_NAME;
  return plan;
}
