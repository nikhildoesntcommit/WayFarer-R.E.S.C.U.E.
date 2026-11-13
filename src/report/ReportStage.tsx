import { assetUrl } from '../utils/url';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stamp } from '../components/Modal';
import { statusKind } from '../results/NumbersPanel';
import { ContourMap } from '../results/ContourMap';
import { useApp } from '../store';
import { buildReport, reportJSON } from './generator';
import './print.css';

export function ReportStage() {
  const nav = useNavigate();
  const { plan, scenario, result, findings, analystName, mentorName, setSignatures, hydrated } = useApp();
  const [dataTier, setDataTier] = useState<string | undefined>();

  useEffect(() => {
    if (!hydrated) return;
    if (!result) nav(plan ? '/simulate' : '/', { replace: true });
  }, [hydrated, result, plan, nav]);

  // the map path states which data tier it ran on
  useEffect(() => {
    if (!result?.mapStats) return;
    fetch(assetUrl('data/data-manifest.json'))
      .then((r) => r.json())
      .then((m: { tier?: string }) => setDataTier(m.tier))
      .catch(() => setDataTier('unknown'));
  }, [result]);

  const seed = plan?.masterSeed ?? scenario?.masterSeed ?? 0;
  const model = useMemo(() => (result ? buildReport({ plan, scenario, result, findings, seed, dataTier }) : null), [plan, scenario, result, findings, seed, dataTier]);
  if (!result || !model) return <div className="page"><p className="muted">Loading…</p></div>;

  const download = () => {
    const blob = new Blob([reportJSON({ plan, scenario, result, findings, model })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wayfarer-${(model.title || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-seed${seed}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn small" onClick={() => nav('/results')}>← Results</button>
        <h2>Report</h2>
      </header>
      <div className="report-bar">
        <label className="field">
          <span className="label">Analyst</span>
          <input value={analystName} onChange={(e) => setSignatures(e.target.value, mentorName)} aria-label="Analyst name" />
        </label>
        <label className="field">
          <span className="label">Mentor</span>
          <input value={mentorName} onChange={(e) => setSignatures(analystName, e.target.value)} aria-label="Mentor name" />
        </label>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => window.print()} data-testid="print">Print / Save PDF</button>
        <button className="btn" onClick={download} data-testid="share-json">Share JSON</button>
      </div>
      <div className="page" style={{ maxWidth: 'none' }}>
        <article className="report-sheet" data-testid="report">
          <header className="report-head">
            <div>
              <span className="label">{model.subtitle}</span>
              <h1>{model.title}</h1>
            </div>
            <Stamp kind={statusKind(model.status)}>{model.status}</Stamp>
          </header>

          <h2>Results</h2>
          <table className="data">
            <tbody>
              {model.rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row" style={{ width: '45%' }}>{r.label}</th>
                  <td className="n" style={{ textAlign: 'left' }}>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {model.exits.length > 0 ? (
            <>
              <h2>Exits</h2>
              <table className="data">
                <thead><tr><th>Exit</th><th>Share of crowd</th><th>People / trial</th><th>Mean queue</th></tr></thead>
                <tbody>
                  {model.exits.map((e) => (
                    <tr key={e.name}><td>{e.name}</td><td className="n">{e.share}</td><td className="n">{e.load}</td><td className="n">{e.queue}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {plan && !result.mapStats ? (
            <>
              <h2>Crowd density</h2>
              <div className="report-map"><ContourMap plan={plan} result={result} /></div>
            </>
          ) : null}

          <h2>Findings</h2>
          {model.findings.length === 0 ? <p>No rule was triggered.</p> : null}
          {model.findings.map((f) => (
            <div key={f.n} className={`report-finding ${f.severity}`}>
              <span className="n">{f.n}.</span>
              <span className="sev">{f.severity} · {f.category}</span>
              <p style={{ margin: '2px 0' }}>{f.message}</p>
              <p style={{ margin: 0 }}><em>Recommendation:</em> {f.recommendation}</p>
            </div>
          ))}

          <div className="sign">
            <div><div className="line">{analystName}</div><span className="label">Analyst</span></div>
            <div><div className="line">{mentorName}</div><span className="label">Mentor</span></div>
          </div>

          <footer className="report-foot">
            Engine: {model.footer.model} · v{model.footer.version} · seed {model.footer.seed} · {model.footer.runs} trials · generated {model.footer.generated}
            {model.footer.dataTier ? <> · data tier: {model.footer.dataTier}</> : null}
            <br />
            {model.footer.disclaimer}
          </footer>
        </article>
      </div>
    </div>
  );
}
