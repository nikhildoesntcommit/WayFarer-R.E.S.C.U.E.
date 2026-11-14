import { buildSimContext } from '../engine/agents';
import type { Plan } from '../types';
import { polygonCentroid } from '../utils/geo';

/** Names, in order, of the numbers the estimator model is given. Keep in step with `scripts/surrogate/train.py`. */
export const FEATURE_NAMES = [
  'ln_people', 'mean_exit_time_s', 'p90_exit_time_s', 'capacity_pps', 'clear_time_s', 'n_exits',
  'alarm_s', 'fire', 'fire_to_exit_m', 'fire_to_people_m', 'vulnerable_share',
] as const;

/**
 * Turn a plan into the numbers the estimator needs. Everything is physical and cheap: one fast-marching solve gives each
 * person's walking time to the nearest exit; the door capacities give how fast the exits can drain the room.
 */
export function planFeatures(plan: Plan): number[] | null {
  let ctx;
  try {
    ctx = buildSimContext(plan);
  } catch {
    return null;
  }
  if (ctx.exitIds.length === 0 || ctx.totalPeople <= 0) return null;
  const T0 = ctx.hazards.epochs[0]!.T;
  const times: { t: number; w: number }[] = [];
  let vulnerable = 0;
  let people = 0;
  for (const cl of ctx.clusters) {
    if (cl.cells.length === 0 || cl.people <= 0) continue;
    const w = cl.people / cl.cells.length;
    for (const c of cl.cells) {
      let best = Infinity;
      for (let e = 0; e < T0.length; e++) best = Math.min(best, T0[e]![c]!);
      if (Number.isFinite(best)) times.push({ t: best, w });
    }
    vulnerable += cl.people * (1 - (cl.mix.adult ?? 1));
    people += cl.people;
  }
  if (times.length === 0) return null;
  times.sort((a, b) => a.t - b.t);
  const totalW = times.reduce((s, x) => s + x.w, 0);
  const mean = times.reduce((s, x) => s + x.t * x.w, 0) / totalW;
  let acc = 0;
  let p90 = times[times.length - 1]!.t;
  for (const x of times) {
    acc += x.w;
    if (acc >= 0.9 * totalW) { p90 = x.t; break; }
  }
  let capacity = 0;
  for (const c of ctx.capacity) capacity += c;
  const fire = plan.hazards.find((h) => h.kind === 'fire_origin' && h.polygonWorld && h.polygonWorld.length > 0);
  let fireToExit = 0;
  let fireToPeople = 0;
  if (fire) {
    const f = polygonCentroid(fire.polygonWorld!);
    const exits = plan.doors.filter((d) => ctx.exitIds.includes(d.id));
    fireToExit = Math.min(...exits.map((d) => Math.hypot((d.startWorld.x + d.endWorld.x) / 2 - f.x, (d.startWorld.y + d.endWorld.y) / 2 - f.y)));
    let sw = 0;
    let sd = 0;
    for (const cl of plan.clusters) {
      const c = polygonCentroid(cl.polygonWorld);
      sd += cl.people * Math.hypot(c.x - f.x, c.y - f.y);
      sw += cl.people;
    }
    fireToPeople = sw > 0 ? sd / sw : 0;
  }
  return [
    Math.log(Math.max(1, ctx.totalPeople)), mean, p90, capacity, ctx.totalPeople / Math.max(1e-6, capacity), ctx.exitIds.length,
    plan.alarmTimeSeconds, fire ? 1 : 0, fireToExit, fireToPeople, people > 0 ? vulnerable / people : 0,
  ];
}
