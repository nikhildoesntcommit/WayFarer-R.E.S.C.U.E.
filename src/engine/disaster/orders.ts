import { mmiFromPga } from './earthquake';

/**
 * Who actually leaves? Most people inside a hazard footprint do not evacuate: sturdy buildings let them shelter in place,
 * and orders target the dangerous part. Evacuating the whole footprint, as V1 did, sends tens of millions of people down a
 * road skeleton and drowns every shelter. These shares are ASSUMPTIONS (see DEVIATIONS.md), chosen to match the scale of
 * real operations (Fani 2019: about 1.2 million moved out of roughly 15 million in the footprint, i.e. under one in ten).
 */
export const ORDERS = {
  cyclone: { surge: 1.0, wind50: 0.5, wind35: 0.25, wind25: 0.08 },
  /** flood depth (m) -> share of residents who must leave (homes uninhabitable, access cut) */
  flood: [{ depth: 1.0, share: 1.0 }, { depth: 0.3, share: 0.6 }, { depth: 0, share: 0.2 }],
  /** earthquake: Mercalli intensity -> share of residents displaced by damaged buildings (HAZUS-like) */
  quake: [{ mmi: 9, share: 0.7 }, { mmi: 8, share: 0.35 }, { mmi: 7, share: 0.1 }, { mmi: 0, share: 0.02 }],
} as const;

export function cycloneShare(wind: number, surgeDepth: number): number {
  if (surgeDepth > 0.1) return ORDERS.cyclone.surge;
  if (wind >= 50) return ORDERS.cyclone.wind50;
  if (wind >= 35) return ORDERS.cyclone.wind35;
  if (wind >= 25) return ORDERS.cyclone.wind25;
  return 0;
}

export function floodShare(depthM: number): number {
  for (const b of ORDERS.flood) if (depthM >= b.depth) return b.share;
  return 0;
}

export function quakeShare(pgaG: number): number {
  const mmi = mmiFromPga(pgaG);
  for (const b of ORDERS.quake) if (mmi >= b.mmi) return b.share;
  return 0;
}
