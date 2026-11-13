import { useEffect, useMemo, useState } from 'react';
import { IndiaMap } from './IndiaMap';
import { loadIndiaData, type IndiaData } from './data/loader';
import { buildOverlay } from './overlay';
import { analyseScenario } from '../engine/disaster/analyse';
import { MAP } from '../constants';
import { useApp } from '../store';
import type { MapAnalysis, SimulationResult } from '../types';

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');

export function MapResultPanel({ result }: { result: SimulationResult }) {
  const scenario = useApp((s) => s.scenario);
  const stored = useApp((s) => s.mapAnalysis);
  const [data, setData] = useState<IndiaData | null>(null);
  const [analysis, setAnalysis] = useState<MapAnalysis | null>(stored);

  useEffect(() => {
    let alive = true;
    void loadIndiaData().then((r) => {
      if (!alive || r.status !== 'ok') return;
      setData(r.data);
      if (!stored && scenario) {
        const a = analyseScenario(scenario, r.data);
        if (a.status === 'ok') setAnalysis(a.data);
      }
    });
    return () => {
      alive = false;
    };
  }, [stored, scenario]);

  const overlay = useMemo(() => (analysis && data ? buildOverlay(analysis, data.grid) : null), [analysis, data]);
  const ms = result.mapStats;
  if (!ms) return null;
  return (
    <div className="panel" data-testid="map-results">
      <h3>Affected area</h3>
      <div style={{ height: 340, border: '1px solid var(--rule)', borderRadius: 6, overflow: 'hidden' }}>
        {data ? <IndiaMap data={data} overlay={overlay} kind={scenario?.disasterKind} pin={scenario ? { lat: scenario.originLat, lon: scenario.originLon } : null} fitOverlay /> : <p className="muted" style={{ padding: 12 }}>Loading map…</p>}
      </div>
      {overlay ? <div className="legend" style={{ marginTop: 6 }}><span className="label">{overlay.legend.title}</span>{overlay.legend.items.map((i) => <span key={i.label}><i style={{ background: i.colour }} />{i.label}</span>)}</div> : null}
      <p className="muted" style={{ fontSize: '0.82rem' }}>
        {analysis && analysis.evacPopulation !== undefined ? <><strong>{fmt(analysis.totalPopulation)}</strong> people live in the affected area; <strong>{fmt(analysis.evacPopulation)}</strong> are ordered or forced to leave and the other {fmt(analysis.totalPopulation - analysis.evacPopulation)} are assumed to shelter in place. </> : null}
        Times are hours after the alert. P95 is the time the last evacuee of a trial gets out of the danger zone; people caught by the hazard on the way are “casualties”, and those who had not got out by the 72 h cap are “still inside”. Beds are planned afterwards: each evacuee is assigned to the nearest shelter that still has room, within about {Math.round(MAP.evac.maxShelterTravelS / 3600)} h of driving.
        {ms.unreachablePopulation > 0 ? <> {fmt(ms.unreachablePopulation)} people in the area have no road route and are not part of the 200 trials.</> : null}
      </p>
      {ms.totalShelterCapacity !== undefined ? <p className="muted" style={{ fontSize: '0.82rem' }}>Assumed capacity of all shelters outside the hazard: {fmt(ms.totalShelterCapacity)}.{(ms.plannedOverflow ?? 0) > 0 ? <> About <strong>{fmt(ms.plannedOverflow ?? 0)}</strong> evacuees found no shelter with room within range and are shown against their nearest one, over its capacity.</> : null}</p> : null}
      <h3 style={{ marginTop: 10 }}>Shelters used</h3>
      <table className="data">
        <thead><tr><th>Shelter</th><th className="n">People (mean)</th><th className="n">Assumed capacity</th><th className="n">Share of capacity</th></tr></thead>
        <tbody>
          {ms.shelterLoads.filter((s) => s.load > 0).sort((a, b) => b.load - a.load).slice(0, 10).map((s) => (
            <tr key={s.shelterId}>
              <td>{s.name}</td>
              <td className="n">{fmt(s.load)}</td>
              <td className="n">{fmt(s.capacity)}</td>
              <td className={`n ${s.load > s.capacity ? 'danger' : ''}`}>{Math.round((s.load / Math.max(1, s.capacity)) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ms.edgeFlowShare.length > 0 ? (
        <>
          <h3 style={{ marginTop: 10 }}>Busiest roads</h3>
          <table className="data">
            <tbody>
              {ms.edgeFlowShare.slice(0, 6).map((e) => (
                <tr key={e.edgeId}><td>{e.label}</td><td className="n">{Math.round(e.share * 100)}% of evacuees</td></tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}
