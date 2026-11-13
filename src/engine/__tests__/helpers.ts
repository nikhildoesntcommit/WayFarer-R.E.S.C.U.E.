import { deriveGeometry, emptyPlan, placeDoor } from '../../draw/tools';
import { deriveExits } from '../../utils/exits';
import type { Hazard, Plan, WorldPolygon } from '../../types';

export type Side = 'bottom' | 'right' | 'top' | 'left';

export interface RoomSpec {
  w: number;
  h: number;
  exits: { side: Side; width: number; at?: number }[];
  clusters: { rect: [number, number, number, number]; people: number; mix?: Partial<Plan['clusters'][number]['groupMix']> }[];
  hazards?: Hazard[];
  metresPerCell?: number;
}

const rect = ([x0, y0, x1, y1]: [number, number, number, number]): WorldPolygon => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

/** A rectangular room whose four walls are drawn wall segments; exits are doors cut into those walls. */
export function makeRoomPlan(spec: RoomSpec): Plan {
  const { w, h } = spec;
  let plan = emptyPlan('test room', 'draw');
  plan.wallSegments = [
    { id: 'wall-bottom', a: { x: 0, y: 0 }, b: { x: w, y: 0 } },
    { id: 'wall-right', a: { x: w, y: 0 }, b: { x: w, y: h } },
    { id: 'wall-top', a: { x: w, y: h }, b: { x: 0, y: h } },
    { id: 'wall-left', a: { x: 0, y: h }, b: { x: 0, y: 0 } },
  ];
  plan.clusters = spec.clusters.map((c, i) => ({
    id: `zone-${i + 1}`, label: `Zone ${i + 1}`, polygonWorld: rect(c.rect), people: c.people,
    groupMix: { adult: 1, child: 0, elderly: 0, wheelchair: 0, ...c.mix },
  }));
  plan = deriveGeometry(plan);
  if (spec.metresPerCell) plan.metresPerCell = spec.metresPerCell;
  const mid: Record<Side, { x: number; y: number }> = {
    bottom: { x: w / 2, y: 0 }, right: { x: w, y: h / 2 }, top: { x: w / 2, y: h }, left: { x: 0, y: h / 2 },
  };
  spec.exits.forEach((e, i) => {
    const p = { ...mid[e.side] };
    if (e.at !== undefined) {
      if (e.side === 'bottom' || e.side === 'top') p.x = e.at;
      else p.y = e.at;
    }
    const d = placeDoor(plan, `wall-${e.side}`, p, e.width);
    if (!d) throw new Error('door did not fit');
    d.id = `exit-${String.fromCharCode(65 + i)}`;
    plan.doors.push(d);
  });
  plan = deriveExits(plan); // doors in the outer walls become final exits by geometry
  plan.hazards = spec.hazards ?? [];
  return plan;
}
