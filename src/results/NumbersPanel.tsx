import { peopleSources } from '../utils/sources';
import { exitLabels } from '../ai/rules';
import { overallStatus } from '../ai/findings';
import { fmtDuration } from '../ai/templates';
import { Num, Stamp } from '../components/Modal';
import type { Finding, Plan, SimulationResult } from '../types';

export function statusKind(s: ReturnType<typeof overallStatus>): 'pass' | 'warn' | 'critical' {
  return s === 'PASS' ? 'pass' : s === 'CRITICAL' ? 'critical' : 'warn';
}

export function NumbersPanel({ plan, result, findings }: { plan: Plan | null; result: SimulationResult; findings: Finding[] }) {
  const status = overallStatus(result, findings);
  const names = exitLabels(plan);
  const total = result.totalPeople ?? 0;
  const per = (n: number) => n / result.runs;
  const isMap = !!result.mapStats;
  const exits = isMap ? [] : Object.keys(result.exitLoads);
  // regional evacuations run for hours, building evacuations for seconds
  const T = (v: number) => (isMap ? v / 3600 : v);
  const u = isMap ? 'h' : 's';
  const d = isMap ? 1 : 0;
  return (
    <section className="panel" aria-label="Key numbers">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <span className="label">95th-percentile evacuation time</span>
          <div className="headline" data-testid="p95">
            {Number.isFinite(result.p95) ? T(result.p95).toFixed(d) : '—'}
            <span className="unit" style={{ fontSize: '1.1rem' }}>{u}</span>
          </div>
          <div className="muted num" style={{ fontSize: '0.85rem' }}>
            95% CI {T(result.ci95P95Lower).toFixed(d)}–{T(result.ci95P95Upper).toFixed(d)} {u} · {fmtDuration(result.p95)}
          </div>
        </div>
        <Stamp kind={statusKind(status)}>{status}</Stamp>
      </div>

      <table className="data" style={{ marginTop: 10 }}>
        <tbody>
          <tr>
            <th scope="row">Median (P50)</th>
            <td className="n"><Num v={T(result.p50)} unit={u} digits={d} /> <span className="muted">({T(result.ci95P50Lower).toFixed(d)}–{T(result.ci95P50Upper).toFixed(d)})</span></td>
          </tr>
          <tr>
            <th scope="row">Mean ± σ</th>
            <td className="n"><Num v={T(result.mean)} unit={u} digits={d} /> ± <Num v={T(result.stdDev)} unit={u} digits={d} /></td>
          </tr>
          <tr>
            <th scope="row">{isMap ? 'People modelled' : 'People (per trial)'}</th>
            <td className="n"><Num v={total} /></td>
          </tr>
          <tr>
            <th scope="row">Evacuated</th>
            <td className="n"><Num v={per(result.evacuated)} digits={isMap ? 0 : 1} /></td>
          </tr>
          <tr>
            <th scope="row">{isMap ? 'Caught on the way' : 'Casualties'}</th>
            <td className={`n ${result.casualties > 0 ? 'danger' : ''}`}><Num v={per(result.casualties)} digits={isMap ? 0 : 1} /></td>
          </tr>
          <tr>
            <th scope="row">Still inside at cap</th>
            <td className={`n ${result.remaining > 0 ? 'danger' : ''}`}><Num v={per(result.remaining)} digits={isMap ? 0 : 1} /></td>
          </tr>
          {result.peakDensity !== undefined ? (
            <tr>
              <th scope="row">Peak density</th>
              <td className="n"><Num v={result.peakDensity} digits={2} unit="/m²" /></td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {exits.length > 0 ? (
        <>
          <h3 style={{ marginTop: 12 }}>Exits</h3>
          {exits.map((id) => {
            const u = result.exitUtilisation[id] ?? 0;
            const cls = u >= 0.9 ? 'critical' : u >= 0.7 ? 'warn' : '';
            return (
              <div key={id} style={{ marginBottom: 8 }} data-testid={`exit-${id}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{names[id] ?? id}</span>
                  <span className="num">
                    {Math.round(u * 100)}<span className="unit">%</span> · {(result.exitLoads[id] ?? 0).toFixed(0)} <span className="unit">people</span> · queue {fmtDuration(result.exitQueueTimes[id] ?? 0)}
                  </span>
                </div>
                <div className={`bar ${cls}`}><span style={{ width: `${Math.min(100, u * 100)}%` }} /></div>
              </div>
            );
          })}
        </>
      ) : null}

      {result.unreachable.length > 0 ? (
        <p className="danger" role="alert">
          Unreachable: {result.unreachable.map((id) => (plan ? peopleSources(plan) : []).find((c) => c.id === id)?.label ?? id).join(', ')} cannot reach any exit.
        </p>
      ) : null}
      {!result.conservationPass ? <p className="danger" role="alert">Conservation check failed: people were created or lost. Do not trust these numbers.</p> : null}
    </section>
  );
}
