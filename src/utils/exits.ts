import type { Door, Plan, WorldPolygon } from '../types';
import { SIM } from '../constants';
import { pointInPolygon } from './geo';

/** How far either side of the wall centre-line (beyond the wall's own half thickness) a door is probed. */
const PROBE_BEYOND_WALL_M = 0.3;

/**
 * Is this door a way out of the whole building, rather than a door between rooms?
 *
 * A final exit is a door in the outermost enclosing wall: one side of it is inside the building outline, the other side
 * is outside. A door between two rooms has the building on both sides. A door onto an inner courtyard that is itself
 * enclosed by walls also has "inside" on both sides, so it is correctly not an exit.
 * If the walls are not closed yet the outline is only a bounding box and nothing qualifies, which is what the
 * validation bar then reports ("close the outer wall").
 */
export function isFinalExitDoor(door: Pick<Door, 'startWorld' | 'endWorld'>, outline: WorldPolygon): boolean {
  if (outline.length < 3) return false;
  const mx = (door.startWorld.x + door.endWorld.x) / 2;
  const my = (door.startWorld.y + door.endWorld.y) / 2;
  const dx = door.endWorld.x - door.startWorld.x;
  const dy = door.endWorld.y - door.startWorld.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return false;
  const off = SIM.wallThicknessM / 2 + PROBE_BEYOND_WALL_M;
  const nx = -dy / len;
  const ny = dx / len;
  const a = pointInPolygon({ x: mx + nx * off, y: my + ny * off }, outline);
  const b = pointInPolygon({ x: mx - nx * off, y: my - ny * off }, outline);
  return a !== b;
}

/**
 * Recompute which doors are final exits from the geometry alone, and drop anything that referred to a door that no
 * longer is one (a "blocked exit" hazard, a cluster -> exit assignment). The user never ticks "this is an exit".
 */
export function deriveExits(plan: Plan): Plan {
  const doors = plan.doors.map((d) => {
    const isExit = isFinalExitDoor(d, plan.buildingPerimeterWorld);
    return d.isExit === isExit ? d : { ...d, isExit };
  });
  const exitIds = new Set(doors.filter((d) => d.isExit).map((d) => d.id));
  const assign = Object.fromEntries(Object.entries(plan.clusterExitAssignment ?? {}).filter(([, e]) => exitIds.has(e)));
  return {
    ...plan,
    doors,
    hazards: plan.hazards.filter((h) => h.kind !== 'blocked_exit' || (h.doorId !== undefined && exitIds.has(h.doorId))),
    clusterExitAssignment: assign,
  };
}
