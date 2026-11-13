import { useEffect, useRef, useState } from 'react';
import { describeAction, evaluateWhatIf, generateFindings, type WhatIfOutcome } from '../ai/findings';
import { Modal, Num } from '../components/Modal';
import { MONTE_CARLO } from '../constants';
import { useApp } from '../store';
import type { Finding, FindingAction, Plan, SimulationResult } from '../types';

function Delta({ before, after, unit = 's', lowerIsBetter = true, digits = 0 }: { before: number; after: number; unit?: string; lowerIsBetter?: boolean; digits?: number }) {
  const d = after - before;
  const good = lowerIsBetter ? d < -1e-9 : d > 1e-9;
  const bad = lowerIsBetter ? d > 1e-9 : d < -1e-9;
  return (
    <span className={`num ${good ? 'ok' : bad ? 'danger' : ''}`}>
      {d > 0 ? '+' : ''}
      {d.toFixed(digits)}
      <span className="unit">{unit}</span>
    </span>
  );
}

/** Paired before/after comparison: same seed, same run count, one change. */
export function WhatIfPanel({
  plan,
  result,
  actionable,
  initial,
  onClose,
}: {
  plan: Plan;
  result: SimulationResult;
  actionable: Finding[];
  initial: { finding: Finding; action: FindingAction } | null;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<{ finding: Finding; action: FindingAction } | null>(initial);
  const [outcome, setOutcome] = useState<WhatIfOutcome | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const token = useRef(0);

  useEffect(() => {
    if (!picked) return;
    const counter = token;
    const mine = ++counter.current;
    setOutcome(null);
    setError('');
    setProgress(0);
    evaluateWhatIf(plan, result, picked.action, (p) => token.current === mine && setProgress(p.completed / p.total))
      .then((o) => token.current === mine && setOutcome(o))
      .catch((e: Error) => token.current === mine && setError(e.message));
    return () => {
      counter.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  const keep = () => {
    if (!outcome) return;
    const findings = generateFindings(outcome.after, outcome.plan, null);
    useApp.setState({ plan: { ...outcome.plan, updatedAt: Date.now() }, result: outcome.after, findings });
    onClose();
  };

  return (
    <Modal title="What if…" onClose={onClose}>
      {actionable.length === 0 ? <p className="muted">None of the findings carries an automatic change to test.</p> : null}
      {!initial ? (
        <div className="field">
          <label className="label" htmlFor="whatif-pick">Change to test</label>
          <select
            id="whatif-pick"
            value={picked ? actionable.findIndex((f) => f.id === picked.finding.id) : -1}
            onChange={(e) => {
              const f = actionable[Number(e.target.value)];
              setPicked(f?.action ? { finding: f, action: f.action } : null);
            }}
          >
            <option value={-1}>Choose a finding…</option>
            {actionable.map((f, i) => (
              <option key={f.id} value={i}>{f.category.replace(/_/g, ' ')}: {describeAction(f.action!, plan)}</option>
            ))}
          </select>
        </div>
      ) : null}
      {picked ? <p><strong>{describeAction(picked.action, plan)}</strong></p> : null}
      {picked && !outcome && !error ? (
        <div>
          <div className="bar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <p className="muted">Re-running {result.runs || MONTE_CARLO.defaultRuns} trials with the same seed…</p>
        </div>
      ) : null}
      {error ? <p className="danger" role="alert">{error}</p> : null}
      {outcome ? (
        <table className="data" data-testid="whatif-table">
          <thead>
            <tr><th></th><th className="n">Before</th><th className="n">After</th><th className="n">Change</th></tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">P95</th>
              <td className="n"><Num v={outcome.before.p95} unit="s" /></td>
              <td className="n"><Num v={outcome.after.p95} unit="s" /></td>
              <td className="n"><Delta before={outcome.before.p95} after={outcome.after.p95} /></td>
            </tr>
            <tr>
              <th scope="row">P50</th>
              <td className="n"><Num v={outcome.before.p50} unit="s" /></td>
              <td className="n"><Num v={outcome.after.p50} unit="s" /></td>
              <td className="n"><Delta before={outcome.before.p50} after={outcome.after.p50} /></td>
            </tr>
            <tr>
              <th scope="row">Casualties / trial</th>
              <td className="n"><Num v={outcome.before.casualties / outcome.before.runs} digits={1} /></td>
              <td className="n"><Num v={outcome.after.casualties / outcome.after.runs} digits={1} /></td>
              <td className="n"><Delta before={outcome.before.casualties / outcome.before.runs} after={outcome.after.casualties / outcome.after.runs} unit="" digits={1} /></td>
            </tr>
          </tbody>
        </table>
      ) : null}
      {outcome ? (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Both runs use seed {plan.masterSeed} and {outcome.after.runs} trials, so the difference is the change, not luck. A change inside the confidence intervals ({Math.round(outcome.before.ci95P95Lower)}–{Math.round(outcome.before.ci95P95Upper)} s) is weak evidence.
        </p>
      ) : null}
      <div className="actions">
        <button className="btn" onClick={onClose}>{outcome ? 'Revert' : 'Close'}</button>
        <button className="btn primary" disabled={!outcome} onClick={keep} data-testid="keep-change">Keep change</button>
      </div>
    </Modal>
  );
}
