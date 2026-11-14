import { useEffect, useMemo, useState } from 'react';
import { narrate, narratorSupported } from '../ai/narrator';
import { estimatePlan, estimatorInfo } from '../ai/surrogate';
import { situationSummary } from '../ai/summary';
import type { Finding, MapScenario, Plan, SimulationResult } from '../types';

const secs = (s: number) => (s >= 120 ? `${(s / 60).toFixed(1)} min` : `${Math.round(s)} s`);

/** "What happened": the situation summary, the trained estimator's cross-check and the optional on-device wording. */
export function SummaryCard({ result, findings, plan, scenario }: { result: SimulationResult; findings: Finding[]; plan: Plan | null; scenario: MapScenario | null }) {
  const summary = useMemo(() => situationSummary(result, findings, plan, scenario), [result, findings, plan, scenario]);
  const est = useMemo(() => (plan && !result.mapStats ? estimatePlan(plan) : null), [plan, result]);
  const [canNarrate, setCanNarrate] = useState(false);
  useEffect(() => {
    let alive = true;
    void narratorSupported().then((v) => alive && setCanNarrate(v));
    return () => { alive = false; };
  }, []);
  const [ai, setAi] = useState<{ state: 'idle' | 'working' | 'done' | 'failed'; text?: string; note?: string }>({ state: 'idle' });

  const run = async () => {
    setAi({ state: 'working', note: 'Preparing the on-device model (first time only)…' });
    const text = await narrate(summary, (note) => setAi((a) => (a.state === 'working' ? { ...a, note } : a)));
    setAi(text ? { state: 'done', text } : { state: 'failed' });
  };

  const agree = est ? result.p95 >= est.p95Low && result.p95 <= est.p95High : null;
  return (
    <section className="panel summary" aria-label="Summary" data-testid="summary">
      <h2 style={{ marginTop: 0 }}>What happened</h2>
      <p><strong>{summary.headline}</strong></p>
      {summary.points.map((t, i) => <p key={i} style={{ margin: '6px 0' }}>{t}</p>)}
      {est ? (
        <p className="muted" style={{ fontSize: '0.88rem' }} data-testid="estimate-check">
          <strong>Cross-check.</strong> A small neural network trained on {estimatorInfo.trainedOn.toLocaleString('en-IN')} simulated rooms estimates the P95 at{' '}
          <span className="num">{secs(est.p95)}</span> (likely {secs(est.p95Low)}–{secs(est.p95High)}); the full simulation gives <span className="num">{secs(result.p95)}</span>.{' '}
          {est.outOfRange.length > 0
            ? `This room is outside what the network was trained on (${est.outOfRange.slice(0, 2).join(', ')}), so the estimate is not reliable.`
            : agree
              ? 'They agree.'
              : 'They disagree by more than the network’s usual error: check the layout for something unusual (a blocked route, a hotspot beside an exit).'}
        </p>
      ) : null}
      {canNarrate ? (
        <div>
          {ai.state === 'idle' || ai.state === 'failed' ? (
            <button className="btn small" onClick={() => void run()} data-testid="narrate">Explain in plain words (on-device AI)</button>
          ) : null}
          {ai.state === 'working' ? <p className="muted" role="status">{ai.note}</p> : null}
          {ai.state === 'failed' ? <p className="muted">The on-device model could not produce a wording that kept every figure exact, so none is shown.</p> : null}
          {ai.state === 'done' ? <p data-testid="narration"><em>{ai.text}</em> <span className="muted" style={{ fontSize: '0.8rem' }}>Reworded by a small on-device model; every number was checked against the simulation.</span></p> : null}
        </div>
      ) : null}
    </section>
  );
}
