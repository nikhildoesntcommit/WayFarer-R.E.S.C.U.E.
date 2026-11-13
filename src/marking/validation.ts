import { DOOR, SIM } from '../constants';
import { fastMarchingFlat } from '../engine/fmm';
import { cellCentre, rasterize } from '../engine/grid';
import type { Plan } from '../types';
import { pointInPolygon } from '../utils/geo';
import { traceFootprint } from '../utils/footprint';
import { peopleSources, totalPeople } from '../utils/sources';
import { planAreaProblems } from './areas';

export interface Check {
  id: 'perimeter' | 'exits' | 'zones' | 'connected' | 'people' | 'doors' | 'areas' | 'resolution';
  label: string;
  ok: boolean;
  /** A blocking check prevents the simulation from starting. */
  blocking: boolean;
  detail: string;
}

export interface Validation {
  checks: Check[];
  perimeterClosed: boolean;
  canMark: boolean;
  canSimulate: boolean;
  /** Zones whose floor cannot reach any exit. */
  unreachableZones: string[];
}

/** Is the floor plan a closed building? Camera scans carry their own perimeter; drawn plans are traced from the walls. */
export function perimeterIsClosed(plan: Plan): boolean {
  if (plan.source === 'camera' && plan.buildingPerimeterWorld.length >= 3 && (plan.wallSegments ?? []).length >= 3) return true;
  return traceFootprint(plan.wallSegments ?? []).closed;
}

/**
 * Pre-flight validation (spec: validation bar on the draw and marking screens).
 * Only things that make the simulation meaningless are blocking; an unreachable zone is reported (and again as a finding).
 */
export function validatePlan(plan: Plan): Validation {
  const closed = perimeterIsClosed(plan);
  const exits = plan.doors.filter((d) => d.isExit);
  const narrow = plan.doors.filter((d) => d.widthM < DOOR.minUsableWidthM);
  const people = totalPeople(plan);
  const zones = peopleSources(plan).filter((c) => c.polygonWorld.length >= 3);
  const areaProblems = planAreaProblems(plan);

  const unreachable: string[] = [];
  let connectedDetail = 'Not checked yet.';
  let connected = false;
  if (closed && exits.length > 0 && zones.length > 0) {
    try {
      const g = rasterize(plan);
      const src: number[] = [];
      for (const e of exits) for (const c of g.exits.get(e.id) ?? []) src.push(c.row * g.cols + c.col);
      const T = fastMarchingFlat(g.walk, g.rows, g.cols, src, 1, 1);
      for (const z of zones) {
        let ok = false;
        for (let i = 0; i < g.walk.length && !ok; i++) {
          if (!g.walk[i] || !Number.isFinite(T[i]!)) continue;
          if (pointInPolygon(cellCentre(g, i), z.polygonWorld)) ok = true;
        }
        if (!ok) unreachable.push(z.id);
      }
      connected = unreachable.length === 0;
      connectedDetail = connected
        ? 'Everyone can reach a final exit.'
        : `${unreachable.length} area(s) or hotspot(s) have no walkable route to a final exit.`;
    } catch (e) {
      connectedDetail = (e as Error).message;
    }
  } else {
    connectedDetail = 'Needs a closed outer wall, a final exit and some people.';
  }

  const checks: Check[] = [
    {
      id: 'perimeter',
      label: 'Perimeter closed',
      ok: closed,
      blocking: true,
      detail: closed ? 'The walls enclose a floor area.' : 'The walls do not enclose a floor area. Close every corner.',
    },
    {
      id: 'exits',
      label: 'Final exit on the outer wall',
      ok: exits.length > 0,
      blocking: true,
      detail: exits.length > 0 ? `${exits.length} final exit(s) in the outer wall.` : closed ? 'No door in the outer wall yet. Doors between rooms do not count as ways out.' : 'No final exit yet. Close the outer wall, then put a door in it.',
    },
    {
      id: 'zones',
      label: 'People placed',
      ok: zones.length > 0,
      blocking: true,
      detail: zones.length > 0 ? `${plan.clusters.length} area(s) and ${(plan.hotspots ?? []).length} hotspot(s) placed.` : 'Place a people area (or a hotspot) where people are when the alarm sounds.',
    },
    {
      id: 'people',
      label: 'People > 0',
      ok: people > 0,
      blocking: true,
      detail: people > 0 ? `${people} people in total.` : 'The areas and hotspots contain nobody.',
    },
    {
      id: 'areas',
      label: 'Areas clean',
      ok: areaProblems.length === 0,
      blocking: true,
      detail: areaProblems.length === 0 ? 'No overlapping or self-crossing areas.' : `${areaProblems[0]} Fix or delete it (Select tool).`,
    },
    {
      id: 'doors',
      label: 'Doors wide enough',
      ok: narrow.length === 0,
      blocking: true,
      detail: narrow.length === 0 ? 'All doors have a usable width.' : `${narrow.length} door(s) are narrower than the ${DOOR.minUsableWidthM} m minimum.`,
    },
    {
      id: 'resolution',
      label: 'Simulation detail',
      ok: plan.metresPerCell <= SIM.defaultMetresPerCell + 1e-9,
      blocking: false,
      detail: plan.metresPerCell <= SIM.defaultMetresPerCell + 1e-9
        ? `Floor simulated in ${plan.metresPerCell} m cells.`
        : `This plan is large, so the floor is simulated in ${plan.metresPerCell.toFixed(2)} m cells. Door widths still set exit capacity exactly, but narrow passages may behave wider than drawn.`,
    },
    {
      id: 'connected',
      label: 'Everyone can reach an exit',
      ok: connected,
      blocking: false,
      detail: connectedDetail,
    },
  ];
  return {
    checks,
    perimeterClosed: closed,
    canMark: closed,
    canSimulate: checks.filter((c) => c.blocking).every((c) => c.ok),
    unreachableZones: unreachable,
  };
}
