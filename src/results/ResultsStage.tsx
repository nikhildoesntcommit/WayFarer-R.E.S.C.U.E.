import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContourMap } from './ContourMap';
import { FindingsPanel } from './FindingsPanel';
import { NumbersPanel } from './NumbersPanel';
import { WhatIfPanel } from './WhatIfPanel';
import { MapResultPanel } from '../map/MapResultPanel';
import { useApp } from '../store';
import type { Finding, FindingAction } from '../types';

export function ResultsStage({ whatIfOpen = false }: { whatIfOpen?: boolean }) {
  const nav = useNavigate();
  const { plan, result, findings, hydrated, scenario } = useApp();
  const [whatIf, setWhatIf] = useState<{ open: boolean; pick: { finding: Finding; action: FindingAction } | null }>({ open: whatIfOpen, pick: null });

  // a plan that was restored from storage has no result: results are cheap to regenerate from the seed
  useEffect(() => {
    if (!hydrated) return;
    if (!result) nav(plan ? '/simulate' : scenario ? '/map-simulate' : '/', { replace: true });
  }, [hydrated, result, plan, scenario, nav]);

  if (!result) return <div className="page"><p className="muted">Loading…</p></div>;
  const isMap = !!result.mapStats;
  const actionable = findings.filter((f) => f.action && f.action.kind !== 'reassign_shelter');

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn small" onClick={() => nav(isMap ? '/map' : '/mark')}>← Back</button>
        <h2>Results</h2>
        <button className="btn small" onClick={() => setWhatIf({ open: true, pick: null })} disabled={!plan || actionable.length === 0} data-testid="open-whatif">What-if</button>
        <button className="btn primary" onClick={() => nav('/report')} data-testid="open-report">Report</button>
      </header>
      <div className="results">
        <div>
          <NumbersPanel plan={plan} result={result} findings={findings} />
          {isMap ? <MapResultPanel result={result} /> : plan ? (
            <div className="panel">
              <ContourMap plan={plan} result={result} />
            </div>
          ) : null}
        </div>
        <FindingsPanel findings={findings} plan={plan} runs={result.runs} onTry={(finding, action) => setWhatIf({ open: true, pick: { finding, action } })} />
      </div>
      {whatIf.open && plan ? (
        <WhatIfPanel
          key={whatIf.pick?.finding.id ?? 'pick'}
          plan={plan}
          result={result}
          actionable={actionable}
          initial={whatIf.pick}
          onClose={() => {
            setWhatIf({ open: false, pick: null });
            if (whatIfOpen) nav('/results', { replace: true });
          }}
        />
      ) : null}
    </div>
  );
}
