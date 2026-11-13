import { describe, expect, it } from 'vitest';
import { runMonteCarloSync } from '../../engine/pipeline';
import { validatePlan } from '../../marking/validation';
import { totalPeople } from '../../utils/sources';
import { buildDemoPlan } from '../demoPlan';

describe('demo plan', () => {
  const plan = buildDemoPlan();

  it('is valid, has three or more final exits, and only outer-wall doors are exits', () => {
    const v = validatePlan(plan);
    expect(v.canSimulate, JSON.stringify(v)).toBe(true);
    const exits = plan.doors.filter((d) => d.isExit).map((d) => d.id).sort();
    expect(exits).toEqual(['exit-east', 'exit-north', 'exit-south', 'exit-west']);
    expect(plan.doors.filter((d) => !d.isExit).length).toBe(4);
    expect(totalPeople(plan)).toBe(545);
  });

  it('simulates, conserves head-count, and is reproducible', () => {
    const a = runMonteCarloSync(plan, 12, plan.masterSeed).result;
    const b = runMonteCarloSync(buildDemoPlan(), 12, plan.masterSeed).result;
    expect(a.conservationPass).toBe(true);
    expect(a.evacuated + a.casualties + a.remaining).toBe(12 * 545);
    expect(a.p95).toBe(b.p95);

  });
});
