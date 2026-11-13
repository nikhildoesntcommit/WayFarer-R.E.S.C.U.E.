import { SEEDS } from '../constants';
import { deriveGeometry, emptyPlan, polygonToSegments } from '../draw/tools';
import type { Plan, WorldPolygon } from '../types';
import { polygonArea } from '../utils/geo';

/** Scan result -> plan. Every polygon edge is a wall; doors/exits are placed on the marking screen. */
export function buildCameraPlan(corners: WorldPolygon, name = 'Scanned room'): Plan {
  const base = emptyPlan(name, 'camera');
  const withWalls: Plan = { ...base, wallSegments: polygonToSegments(corners), masterSeed: SEEDS.master };
  return deriveGeometry(withWalls, { perimeter: corners });
}

export function scanArea(corners: WorldPolygon): number {
  return corners.length >= 3 ? polygonArea(corners) : 0;
}
