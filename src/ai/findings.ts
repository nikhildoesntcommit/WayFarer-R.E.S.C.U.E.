import { peopleSources } from '../utils/sources';
import { FINDINGS } from '../constants';
import { runMonteCarlo } from '../engine/montecarlo';
import type { ProgressInfo } from '../engine/pipeline';
import type { Finding, FindingAction, Plan, SimulationResult } from '../types';
import { dist } from '../utils/geo';
import { generateFindings } from './rules';

export { generateFindings };

export type Status = 'PASS' | 'PASS WITH MODIFICATIONS' | 'CRITICAL';

/** Report stamp: any critical finding, any casualty or anyone left inside => CRITICAL. */
export function overallStatus(result: SimulationResult, findings: Finding[]): Status {
  if (findings.some((f) => f.severity === 'critical') || result.casualties > 0 || result.remaining > 0) return 'CRITICAL';
  if (findings.some((f) => f.severity === 'warning')) return 'PASS WITH MODIFICATIONS';
  return 'PASS';
}

/** Apply a finding's recommended change to a copy of the plan. */
export function applyAction(plan: Plan, action: FindingAction): Plan {
  switch (action.kind) {
    case 'widen_exit': {
      const doors = plan.doors.map((d) => {
        if (d.id !== action.doorId) return d;
        const seg = (plan.wallSegments ?? []).find((s) => s.id === d.wallId);
        const cx = (d.startWorld.x + d.endWorld.x) / 2;
        const cy = (d.startWorld.y + d.endWorld.y) / 2;
        const ox = d.endWorld.x - d.startWorld.x;
        const oy = d.endWorld.y - d.startWorld.y;
        const len = Math.hypot(ox, oy) || 1;
        let width = action.newWidthM;
        let c = { x: cx, y: cy };
        if (seg) {
          const wl = dist(seg.a, seg.b);
          width = Math.min(width, wl); // cannot be wider than the wall it sits in
          const ux = (seg.b.x - seg.a.x) / wl;
          const uy = (seg.b.y - seg.a.y) / wl;
          const proj = (cx - seg.a.x) * ux + (cy - seg.a.y) * uy;
          const t = Math.min(wl - width / 2, Math.max(width / 2, proj));
          c = { x: seg.a.x + ux * t, y: seg.a.y + uy * t };
          return { ...d, widthM: width, startWorld: { x: c.x - (ux * width) / 2, y: c.y - (uy * width) / 2 }, endWorld: { x: c.x + (ux * width) / 2, y: c.y + (uy * width) / 2 } };
        }
        return { ...d, widthM: width, startWorld: { x: c.x - (ox / len) * (width / 2), y: c.y - (oy / len) * (width / 2) }, endWorld: { x: c.x + (ox / len) * (width / 2), y: c.y + (oy / len) * (width / 2) } };
      });
      return { ...plan, doors };
    }
    case 'reassign_cluster':
      return { ...plan, clusterExitAssignment: { ...(plan.clusterExitAssignment ?? {}), [action.clusterId]: action.toExitId } };
    case 'add_exit':
      return { ...plan, doors: [...plan.doors.filter((d) => d.id !== action.door.id), action.door] };
    case 'reassign_shelter':
      return plan; // map-path change: applied by the map simulation, not the plan
  }
}

export function describeAction(action: FindingAction, plan: Plan | null): string {
  switch (action.kind) {
    case 'widen_exit':
      return `Widen the exit to ${action.newWidthM.toFixed(2)} m (×${FINDINGS.widenFactor}).`;
    case 'reassign_cluster': {
      const c = (plan ? peopleSources(plan) : []).find((x) => x.id === action.clusterId);
      return `Send ${c?.label ?? 'the zone'} to the other exit.`;
    }
    case 'add_exit':
      return `Add a ${action.door.widthM.toFixed(1)} m exit on the nearest wall.`;
    case 'reassign_shelter':
      return `Redirect ${action.people.toLocaleString('en-IN')} people to the alternate shelter.`;
  }
}

export interface WhatIfOutcome {
  plan: Plan;
  before: SimulationResult;
  after: SimulationResult;
  deltaP95: number;
  deltaP50: number;
}

/** Re-run with the recommended change applied, with the SAME master seed and run count, so the comparison is paired. */
export async function evaluateWhatIf(
  plan: Plan,
  before: SimulationResult,
  action: FindingAction,
  onProgress?: (p: ProgressInfo) => void,
): Promise<WhatIfOutcome> {
  const changed = applyAction(plan, action);
  const after = await runMonteCarlo(changed, before.runs, plan.masterSeed, onProgress);
  return { plan: changed, before, after, deltaP95: after.p95 - before.p95, deltaP50: after.p50 - before.p50 };
}
