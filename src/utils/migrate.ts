import { rebuildPlan } from '../draw/tools';
import type { Plan } from '../types';

/**
 * Bring any stored or imported plan up to the current model:
 *  - version 1 (areas called zones/clusters, exits ticked by hand) -> version 2 (hotspots, exits from geometry)
 * Exits are always re-derived, so an interior door that an old plan had ticked as "exit" stops being one.
 */
export function migratePlan(raw: Plan): Plan {
  const p = { ...raw, version: 2 as const, hotspots: raw.hotspots ?? [], clusters: raw.clusters ?? [], hazards: raw.hazards ?? [] };
  if ((p.wallSegments?.length ?? 0) === 0 && p.doors.length > 0) return p; // legacy plan without centre-lines: nothing to derive from
  return rebuildPlan(p);
}
