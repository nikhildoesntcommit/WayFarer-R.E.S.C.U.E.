import { MAP, PRE_MOVEMENT } from '../constants';
import type { Finding, MapScenario, Plan, SimulationResult } from '../types';
import { fmtDuration } from './templates';

/**
 * A situation summary written from THIS run's numbers (no language model). Each sentence is chosen by a rule that tests
 * what actually limited the result, so two different rooms read differently, and each sentence states the figure it rests on.
 */
export interface Summary { headline: string; points: string[] }

const pct = (x: number) => `${Math.round(100 * x)}%`;
const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
/** small counts keep a decimal, so 0.1 people per trial is not rounded to a contradictory "0" */
const few = (n: number) => (n > 0 && n < 10 ? n.toFixed(1) : fmt(n));

export function situationSummary(result: SimulationResult, findings: Finding[], plan: Plan | null, scenario: MapScenario | null): Summary {
  return result.mapStats ? regional(result, findings, scenario) : building(result, findings, plan);
}

function building(r: SimulationResult, findings: Finding[], plan: Plan | null): Summary {
  const total = r.totalPeople ?? 0;
  const per = (x: number) => x / Math.max(1, r.runs);
  const lost = per(r.casualties);
  const inside = per(r.remaining);
  const exits = Object.keys(r.exitLoads);
  const alarm = plan?.alarmTimeSeconds ?? 0;
  const reaction95 = PRE_MOVEMENT.median * Math.exp(1.645 * PRE_MOVEMENT.sigma);
  const hasFire = !!plan?.hazards.some((h) => h.kind === 'fire_origin');
  const points: string[] = [];

  const headline = r.casualties === 0 && r.remaining === 0
    ? `All ${fmt(total)} people get out; half are out within ${fmtDuration(r.p50)} and 95% within ${fmtDuration(r.p95)}.`
    : lost + inside < 1
      ? `Almost everyone gets out of ${fmt(total)}: in a typical trial all do, but over the ${r.runs} trials about ${few(lost + inside)} person per trial is lost or left inside. Half are out within ${fmtDuration(r.p50)}, 95% within ${fmtDuration(r.p95)}.`
      : `Not everyone gets out: on average ${few(lost)} are lost and ${few(inside)} are still inside out of ${fmt(total)}; the people who do escape take ${fmtDuration(r.p95)} (P95).`;

  // what limits the time: reaction, queue, or distance?
  const waits = exits.map((id) => ({ id, w: r.exitQueueTimes[id] ?? 0, share: r.exitUtilisation[id] ?? 0 }));
  const worst = waits.sort((a, b) => b.w - a.w)[0];
  const movement = r.p95 - alarm - reaction95;
  if (r.p95 > 0 && alarm + reaction95 >= 0.5 * r.p95 && (!worst || worst.w < 0.25 * r.p95)) {
    points.push(`Reaction time dominates: about ${fmtDuration(alarm + reaction95)} of the ${fmtDuration(r.p95)} is people noticing the alarm and deciding to move (95th-percentile reaction ${fmtDuration(reaction95)}). A faster alarm, a trained warden or a drill would save more than any wider door.`);
  } else if (worst && worst.w >= 0.25 * r.p95) {
    points.push(`Queueing dominates: people wait about ${fmtDuration(worst.w)} on average at ${worst.id}, roughly ${pct(worst.w / r.p95)} of the P95 time. The exit, not the walk, is the limit.`);
  } else if (movement > 0) {
    points.push(`Distance dominates: after reacting, the slowest people spend about ${fmtDuration(Math.max(0, movement))} walking and queueing. More or better-placed exits help more than a faster alarm.`);
  }
  // balance between exits
  if (exits.length >= 2) {
    const loads = exits.map((id) => ({ id, s: r.exitUtilisation[id] ?? 0 })).sort((a, b) => b.s - a.s);
    if (loads[0]!.s > 0.75) points.push(`${pct(loads[0]!.s)} of the crowd uses ${loads[0]!.id} although there are ${exits.length} exits: the others are barely used, so the effective capacity is far below the nominal.`);
    else points.push(`The ${exits.length} exits are used fairly evenly (largest share ${pct(loads[0]!.s)}).`);
  } else if (exits.length === 1) {
    points.push(`There is a single exit. Everything depends on it: if it is blocked or reached by smoke, nobody has another way out.`);
  }
  if (hasFire) {
    if (r.casualties > 0) points.push(`The fire changes the outcome: ${few(lost)} people per trial are caught by smoke or flames. Those in the burning area and those whose route is cut off are the ones lost.`);
    else points.push(`A fire is modelled but smoke does not catch anyone in time: it spreads at ceiling-jet speed, yet people reach the exits first in every trial that was run.`);
  }
  const top = findings.filter((f) => f.severity === 'critical')[0] ?? findings[0];
  if (top) points.push(`Most important finding: ${top.recommendation}`);
  return { headline, points };
}

function regional(r: SimulationResult, findings: Finding[], s: MapScenario | null): Summary {
  const ms = r.mapStats!;
  const total = r.totalPeople ?? 0;
  const per = (x: number) => x / Math.max(1, r.runs);
  const gotOut = per(r.evacuated);
  const caught = per(r.casualties);
  const points: string[] = [];
  const kind = s?.disasterKind ?? 'cyclone';
  const lead = kind === 'cyclone' ? (s?.leadHours ?? MAP.cyclone.leadHoursDefault) : undefined;
  const p95h = r.p95 / 3600;
  const headline = `${fmt(total)} people are ordered or forced out; on average ${fmt(gotOut)} reach safety, ${fmt(caught)} (${pct(caught / Math.max(1, total))}) are caught by the hazard on the road, and the last evacuees arrive about ${p95h.toFixed(1)} h after the alert.`;
  if (lead !== undefined) {
    if (p95h > lead) points.push(`The evacuation needs about ${p95h.toFixed(1)} h but there is only ${lead} h of warning: the shortfall is what exposes people. The cheapest remedy is an earlier order, not more shelters.`);
    else points.push(`The evacuation (${p95h.toFixed(1)} h) finishes inside the ${lead} h warning, so people caught on the road are those who left late or sit on a congested route.`);
  }
  if (ms.edgeFlowShare[0] && ms.edgeFlowShare[0].share > 0.2) points.push(`One road carries ${pct(ms.edgeFlowShare[0].share)} of all evacuees (${ms.edgeFlowShare[0].label}). Staggering departures or opening a parallel route would relieve it.`);
  if (ms.plannedOverflow !== undefined && ms.plannedOverflow > 0) {
    const cap = ms.totalShelterCapacity ?? 0;
    points.push(`Formal shelters cover ${pct(Math.min(1, cap / Math.max(1, gotOut + ms.plannedOverflow)))} of the evacuees: about ${fmt(ms.plannedOverflow)} reach safety but find no bed within range and need school, community or temporary shelter.`);
  }
  if (ms.unreachablePopulation > 0) points.push(`About ${fmt(ms.unreachablePopulation)} people have no road route out in this data: they need a separate plan (boats, helicopters, shelter in place).`);
  if (ms.floodTimingGapMin !== undefined && ms.floodTimingGapMin > 0) points.push(`The flood closes the first evacuation road about ${Math.round(ms.floodTimingGapMin)} minutes before 90% have escaped.`);
  const top = findings.filter((f) => f.severity === 'critical')[0];
  if (top) points.push(`Most important finding: ${top.recommendation}`);
  return { headline, points };
}
