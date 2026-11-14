import { useMemo, useState } from 'react';
import { describeEvidence } from '../ai/evidence';
import { describeAction } from '../ai/findings';
import type { Finding, FindingAction, Plan } from '../types';

type Filter = 'all' | Finding['severity'];

export function FindingsPanel({ findings, plan, runs, onTry }: { findings: Finding[]; plan: Plan | null; runs?: number; onTry: (f: Finding, a: FindingAction) => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const shown = useMemo(() => (filter === 'all' ? findings : findings.filter((f) => f.severity === filter)), [findings, filter]);
  const count = (s: Filter) => (s === 'all' ? findings.length : findings.filter((f) => f.severity === s).length);

  return (
    <section aria-label="Findings">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2>Findings</h2>
      </div>
      <div className="filters" role="group" aria-label="Filter findings">
        {(['all', 'critical', 'warning', 'note'] as const).map((f) => (
          <button key={f} className={`btn small${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)} aria-pressed={filter === f}>
            {f} ({count(f)})
          </button>
        ))}
      </div>
      {shown.length === 0 ? <p className="muted">{findings.length === 0 ? 'No findings: nothing in the simulation tripped a rule.' : 'No findings at this severity.'}</p> : null}
      {shown.map((f) => (
        <article key={f.id} className={`finding ${f.severity}`} data-testid="finding">
          <div className="label">{f.severity} · {f.category.replace(/_/g, ' ')}</div>
          <p style={{ margin: '4px 0 0' }}>{f.message}</p>
          <div className="rec"><strong>Recommendation.</strong> {f.recommendation}</div>
          {f.predictedImprovementSeconds !== undefined ? (
            <div className="muted num" style={{ fontSize: '0.82rem' }}>Rule-of-thumb estimate: about {Math.round(f.predictedImprovementSeconds)} s faster (verify with “Try this”).</div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {f.action && plan ? (
              <button className="btn small primary" onClick={() => onTry(f, f.action!)} title={describeAction(f.action, plan)} data-testid="try-this">
                Try this
              </button>
            ) : null}
            <button className="btn small" onClick={() => setOpen((o) => ({ ...o, [f.id]: !o[f.id] }))} aria-expanded={!!open[f.id]} data-testid="evidence-toggle">
              {open[f.id] ? 'Hide the evidence' : 'Why? Show the evidence'}
            </button>
          </div>
          {open[f.id] ? <Evidence finding={f} runs={runs} /> : null}
        </article>
      ))}
    </section>
  );
}

function Evidence({ finding, runs }: { finding: Finding; runs?: number }) {
  const v = describeEvidence(finding, { runs });
  return (
    <div className="ev" data-testid="evidence">
      <p className="ev-summary"><strong>In plain words.</strong> {v.summary}</p>
      <dl className="ev-list">
        {v.rows.map((r) => (
          <div key={r.label} className="ev-row">
            <dt>{r.label}</dt>
            <dd>
              <span className="num">{r.value}</span>
              {r.bar !== undefined ? (
                <span className="ev-bar" role="img" aria-label={`${Math.round(Math.max(0, Math.min(1, r.bar)) * 100)} percent`}>
                  <span style={{ width: `${Math.max(0, Math.min(1, r.bar)) * 100}%` }} />
                </span>
              ) : null}
              {r.hint ? <span className="ev-hint">{r.hint}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className="ev-basis muted">{v.basis}</p>
    </div>
  );
}
