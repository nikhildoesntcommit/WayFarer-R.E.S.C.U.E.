import { PlanEditor } from '../components/PlanEditor';

/** Shared by Path A and B: mark exits, clusters and hazards on the plan. */
export function MarkingStage() {
  return <PlanEditor mode="mark" />;
}
