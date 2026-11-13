import type { Cluster, Hotspot, Plan, WorldPolygon } from '../types';

const CIRCLE_SIDES = 20;

function circle(h: Hotspot): WorldPolygon {
  return Array.from({ length: CIRCLE_SIDES }, (_, i) => {
    const a = (2 * Math.PI * i) / CIRCLE_SIDES;
    return { x: h.at.x + h.radiusM * Math.cos(a), y: h.at.y + h.radiusM * Math.sin(a) };
  });
}

/** A hotspot seen as a people source: the engine, the findings and the report treat both kinds the same way. */
export function hotspotAsCluster(h: Hotspot): Cluster {
  return { id: h.id, label: h.label, polygonWorld: circle(h), people: h.people, groupMix: h.groupMix, hotspot: { at: h.at, radiusM: h.radiusM } };
}

/** Everything that puts people on the floor: areas first, then hotspots. */
export function peopleSources(plan: Pick<Plan, 'clusters'> & Partial<Pick<Plan, 'hotspots'>>): Cluster[] {
  return [...plan.clusters, ...(plan.hotspots ?? []).map(hotspotAsCluster)];
}

export function totalPeople(plan: Pick<Plan, 'clusters'> & Partial<Pick<Plan, 'hotspots'>>): number {
  return peopleSources(plan).reduce((s, c) => s + Math.max(0, Math.round(c.people)), 0);
}
