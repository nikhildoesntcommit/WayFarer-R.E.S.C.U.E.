import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IndiaMap } from './IndiaMap';
import { loadIndiaData, type IndiaData } from './data/loader';
import { buildOverlay } from './overlay';
import { MAP, SEEDS } from '../constants';
import { analyseScenario } from '../engine/disaster/analyse';
import { assessRainfall } from '../engine/disaster/climate';
import { defaultHeadingDeg } from '../engine/disaster/cyclone';
import { assessMagnitude } from '../engine/disaster/earthquake';
import { useApp } from '../store';
import type { MapAnalysis, MapScenario } from '../types';
import { uid } from '../draw/tools';

type Kind = MapScenario['disasterKind'];
type Step = 'kind' | 'origin' | 'result';

const KINDS: { id: Kind; title: string; text: string; icon: JSX.Element }[] = [
  {
    id: 'earthquake', title: 'Earthquake',
    text: 'Tap the epicentre and choose a magnitude. A large earthquake ruptures a long fault, and the shaking is strongest along it.',
    icon: <svg viewBox="0 0 56 40" aria-hidden="true"><path d="M2 20h10l4-12 6 24 6-20 5 14 4-6h17" /></svg>,
  },
  {
    id: 'flood', title: 'Flood',
    text: 'Tap a point on a river and choose how much rain falls in 24 hours. The river rises, and water spreads only to connected low ground. Dry regions need extreme rain.',
    icon: <svg viewBox="0 0 56 40" aria-hidden="true"><path d="M2 14q7-8 13 0t13 0 13 0 13 0M2 26q7-8 13 0t13 0 13 0 13 0" /></svg>,
  },
  {
    id: 'cyclone', title: 'Cyclone',
    text: 'Tap the landfall point on the coast and choose a category. The storm moves, weakens over land, and its wind and surge close the roads.',
    icon: <svg viewBox="0 0 56 40" aria-hidden="true"><path d="M28 20m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M28 17c0-8 10-12 16-8M28 23c0 8-10 12-16 8M31 20c8 0 12 10 8 16M25 20c-8 0-12-10-8-16" /></svg>,
  },
];

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');

/** Path C wizard: choose disaster -> origin and severity -> affected area and population. */
export function DisasterSetup() {
  const nav = useNavigate();
  const setSource = useApp((s) => s.setSource);
  const setScenario = useApp((s) => s.setScenario);
  const setMapAnalysis = useApp((s) => s.setMapAnalysis);
  const [data, setData] = useState<IndiaData | null>(null);
  const [dataError, setDataError] = useState('');
  const [mapError, setMapError] = useState('');
  const [step, setStep] = useState<Step>('kind');
  const [kind, setKind] = useState<Kind>('earthquake');
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [latStr, setLatStr] = useState('');
  const [lonStr, setLonStr] = useState('');
  const [magnitude, setMagnitude] = useState(7.0);
  const [rain, setRain] = useState(200);
  const [strike, setStrike] = useState<number>(MAP.earthquake.strikeDegDefault);
  const [autoHeading, setAutoHeading] = useState(true);
  const [heading, setHeading] = useState(315);
  const [speed, setSpeed] = useState<number>(MAP.cyclone.translationKmhDefault);
  const [lead, setLead] = useState<number>(MAP.cyclone.leadHoursDefault);
  const [category, setCategory] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [analysis, setAnalysis] = useState<MapAnalysis | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSource('map');
    let alive = true;
    void loadIndiaData().then((r) => {
      if (!alive) return;
      if (r.status === 'ok') setData(r.data);
      else setDataError(r.reason);
    });
    return () => {
      alive = false;
    };
  }, [setSource]);

  const rainCheck = useMemo(() => (pin ? assessRainfall(pin.lat, pin.lon, rain) : null), [pin, rain]);
  const quakeCheck = useMemo(() => (pin ? assessMagnitude(pin.lat, pin.lon, magnitude) : null), [pin, magnitude]);
  const autoHeadingDeg = useMemo(() => (data && pin ? defaultHeadingDeg(data.grid, pin.lat, pin.lon) : null), [data, pin]);
  const blocked = (kind === 'flood' && rainCheck?.level === 'not_credible') || (kind === 'earthquake' && quakeCheck?.level === 'not_credible');

  const place = (lat: number, lon: number) => {
    setPin({ lat, lon });
    setLatStr(lat.toFixed(3));
    setLonStr(lon.toFixed(3));
    setAnalysis(null);
    setMessage('');
  };

  const typed = () => {
    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= 6 && lat <= 38 && lon >= 67 && lon <= 98) place(lat, lon);
    else setMessage('Latitude must be 6–38 and longitude 67–98 (decimal degrees).');
  };

  const compute = () => {
    if (!data || !pin) return;
    setBusy(true);
    setMessage('');
    // let the button repaint before the (short) synchronous computation
    window.setTimeout(() => {
      const scenario: MapScenario = {
        id: uid('scn'), disasterKind: kind, originLat: pin.lat, originLon: pin.lon, masterSeed: SEEDS.master, createdAt: Date.now(),
        ...(kind === 'earthquake' ? { magnitude, strikeDeg: strike } : {}),
        ...(kind === 'flood' ? { rainfallMm: rain } : {}),
        ...(kind === 'cyclone' ? { category, speedKmh: speed, leadHours: lead, ...(autoHeading ? {} : { headingDeg: heading }) } : {}),
      };
      const r = analyseScenario(scenario, data);
      setBusy(false);
      if (r.status !== 'ok') {
        setMessage(r.reason);
        return;
      }
      setScenario(scenario);
      setMapAnalysis(r.data);
      setAnalysis(r.data);
      setStep('result');
    }, 20);
  };

  const overlay = useMemo(() => (analysis && data ? buildOverlay(analysis, data.grid) : null), [analysis, data]);
  const vmax = MAP.cyclone.categoryVmaxMS[category - 1]!;

  if (dataError) {
    return (
      <div className="screen"><div className="page">
        <h1>Map data unavailable</h1>
        <p className="danger" role="alert" data-testid="map-data-error">{dataError}</p>
        <p>The map path needs the bundled data files. Load the app once with a connection so they are stored for offline use.</p>
        <button className="btn" onClick={() => nav('/')}>Back</button>
      </div></div>
    );
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn small" onClick={() => (step === 'kind' ? nav('/') : setStep(step === 'result' ? 'origin' : 'kind'))}>← Back</button>
        <h2>Map: {step === 'kind' ? 'choose a disaster' : step === 'origin' ? `${KINDS.find((k) => k.id === kind)!.title}: origin and severity` : 'affected area'}</h2>
      </header>

      {step === 'kind' ? (
        <div className="page">
          <span className="step-tag">STEP C1</span>
          <div className="wizard-cards">
            {KINDS.map((k) => (
              <button key={k.id} className="card" data-testid={`kind-${k.id}`} onClick={() => { setKind(k.id); setAnalysis(null); setStep('origin'); }}>
                {k.icon}
                <h2>{k.title}</h2>
                <p>{k.text}</p>
              </button>
            ))}
          </div>
          {data ? <p className="muted" style={{ fontSize: '0.85rem' }}>Data tier: <strong>{data.tier}</strong>. {data.notice}</p> : <p className="muted">Loading map data…</p>}
        </div>
      ) : (
        <>
          <div className="panel" style={{ margin: 0, borderRadius: 0, borderLeft: 0, borderRight: 0 }}>
            <span className="step-tag">STEP {step === 'origin' ? 'C2' : 'C3'}</span>
            {step === 'origin' ? (
              <>
                <p style={{ margin: '2px 0 8px' }}>
                  {mapError ? <span className="danger">{mapError} Enter the coordinates below instead.</span> : kind === 'flood' ? 'Tap a point on a river.' : kind === 'earthquake' ? 'Tap the epicentre.' : 'Tap the landfall point.'}
                </p>
                <div className="sev">
                  <label className="field" style={{ margin: 0 }}>
                    <span className="label">Latitude (°N)</span>
                    <input value={latStr} inputMode="decimal" onChange={(e) => setLatStr(e.target.value)} onBlur={typed} onKeyDown={(e) => e.key === 'Enter' && typed()} aria-label="Latitude" data-testid="lat" />
                  </label>
                  <label className="field" style={{ margin: 0 }}>
                    <span className="label">Longitude (°E)</span>
                    <input value={lonStr} inputMode="decimal" onChange={(e) => setLonStr(e.target.value)} onBlur={typed} onKeyDown={(e) => e.key === 'Enter' && typed()} aria-label="Longitude" data-testid="lon" />
                  </label>
                  {kind === 'earthquake' ? (
                    <label className="field" style={{ margin: 0 }}>
                      <span className="label">Magnitude <span className="num">{magnitude.toFixed(1)}</span></span>
                      <input type="range" min={MAP.earthquake.magnitudeMin} max={MAP.earthquake.magnitudeMax} step={0.1} value={magnitude} onChange={(e) => { setMagnitude(Number(e.target.value)); setAnalysis(null); }} aria-label="Magnitude" data-testid="magnitude" />
                    </label>
                  ) : null}
                  {kind === 'earthquake' ? (
                    <label className="field" style={{ margin: 0 }}>
                      <span className="label">Fault direction <span className="num">{strike}°</span> from north</span>
                      <input type="range" min={0} max={175} step={5} value={strike} onChange={(e) => { setStrike(Number(e.target.value)); setAnalysis(null); }} aria-label="Fault direction" data-testid="strike" />
                    </label>
                  ) : null}
                  {kind === 'flood' ? (
                    <label className="field" style={{ margin: 0 }}>
                      <span className="label">Rain in 24 hours <span className="num">{rain}<span className="unit">mm</span></span></span>
                      <input type="range" min={50} max={700} step={10} value={rain} onChange={(e) => { setRain(Number(e.target.value)); setAnalysis(null); }} aria-label="Rainfall in 24 hours" data-testid="rain" />
                    </label>
                  ) : null}
                  {kind === 'cyclone' ? (
                    <label className="field" style={{ margin: 0 }}>
                      <span className="label">Category <span className="num">{category}</span> · max sustained wind <span className="num">{vmax}<span className="unit">m/s</span></span></span>
                      <input type="range" min={1} max={5} step={1} value={category} onChange={(e) => { setCategory(Number(e.target.value) as 1 | 2 | 3 | 4 | 5); setAnalysis(null); }} aria-label="Cyclone category" data-testid="category" />
                    </label>
                  ) : null}
                  {kind === 'cyclone' ? (
                    <>
                      <label className="field" style={{ margin: 0 }}>
                        <span className="label">Direction of travel <span className="num">{autoHeading ? (autoHeadingDeg !== null ? `${autoHeadingDeg}° (from the sea)` : 'from the sea') : `${heading}°`}</span></span>
                        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input type="checkbox" checked={autoHeading} onChange={(e) => { setAutoHeading(e.target.checked); setAnalysis(null); }} aria-label="Choose the direction automatically" data-testid="auto-heading" />
                          <span className="muted">automatic</span>
                          <input type="range" min={0} max={355} step={5} value={heading} disabled={autoHeading} onChange={(e) => { setHeading(Number(e.target.value)); setAnalysis(null); }} aria-label="Direction of travel in degrees" style={{ flex: 1 }} />
                        </span>
                      </label>
                      <label className="field" style={{ margin: 0 }}>
                        <span className="label">Speed <span className="num">{speed}<span className="unit">km/h</span></span></span>
                        <input type="range" min={8} max={40} step={1} value={speed} onChange={(e) => { setSpeed(Number(e.target.value)); setAnalysis(null); }} aria-label="Storm speed" />
                      </label>
                      <label className="field" style={{ margin: 0 }}>
                        <span className="label">Warning before landfall <span className="num">{lead}<span className="unit">h</span></span></span>
                        <input type="range" min={3} max={48} step={1} value={lead} onChange={(e) => { setLead(Number(e.target.value)); setAnalysis(null); }} aria-label="Warning time before landfall" data-testid="lead" />
                      </label>
                    </>
                  ) : null}
                </div>
                {kind === 'flood' && rainCheck ? <p className={rainCheck.level === 'not_credible' ? 'danger' : 'muted'} role={rainCheck.level === 'not_credible' ? 'alert' : undefined} style={{ margin: '8px 0 0' }} data-testid="plausibility">{rainCheck.note}</p> : null}
                {kind === 'earthquake' && quakeCheck ? <p className={quakeCheck.level === 'not_credible' ? 'danger' : 'muted'} role={quakeCheck.level === 'not_credible' ? 'alert' : undefined} style={{ margin: '8px 0 0' }} data-testid="plausibility">{quakeCheck.note}</p> : null}
                {message ? <p className="danger" role="alert" style={{ margin: '8px 0 0' }}>{message}</p> : null}
                <p style={{ margin: '8px 0 0' }}>
                  <button className="btn primary" disabled={!pin || busy || !data || blocked} onClick={compute} data-testid="compute">{busy ? 'Computing…' : 'Compute affected area'}</button>
                </p>
              </>
            ) : analysis ? (
              <>
                <p style={{ margin: '2px 0' }} data-testid="affected-summary">
                  Affected area: <strong className="num">{fmt(analysis.areaKm2)}</strong> km². Affected population: <strong className="num" data-testid="affected-pop">{fmt(analysis.totalPopulation)}</strong> people.
                  {analysis.settlements.length > 0 ? <> Major settlements: {analysis.settlements.map((s) => `${s.name} (${fmt(s.population)})`).join(', ')}.</> : null}
                </p>
                {analysis.notes && analysis.notes.length > 0 ? <p className="muted" style={{ margin: '0 0 6px', fontSize: '0.85rem' }}>{analysis.notes.join(' ')}</p> : null}
                {analysis.facts && analysis.facts.length > 0 ? (
                  <details style={{ margin: '0 0 6px' }}>
                    <summary>How this {kind} was modelled</summary>
                    <ul style={{ margin: '4px 0', paddingLeft: '1.2em', fontSize: '0.88rem' }} data-testid="model-facts">{analysis.facts.map((f) => <li key={f}>{f}</li>)}</ul>
                  </details>
                ) : null}
                {data ? <p className="muted" style={{ margin: '0 0 6px', fontSize: '0.82rem' }}>Data tier: {data.tier}. Population is district-uniform and elevation is coarse; treat extents as indicative.</p> : null}
                {overlay ? <div className="legend" aria-label="Legend"><span className="label">{overlay.legend.title}</span>{overlay.legend.items.map((i) => <span key={i.label}><i style={{ background: i.colour }} />{i.label}</span>)}</div> : null}
                <p style={{ margin: '8px 0 0' }}>
                  <button className="btn primary" onClick={() => nav('/map-simulate')} data-testid="begin-sim">Begin evacuation simulation</button>
                </p>
              </>
            ) : null}
          </div>
          <div className="map-wrap">
            {data ? (
              <IndiaMap data={data} pin={pin} overlay={step === 'result' ? overlay : null} kind={kind} fitOverlay={step === 'result'} onPick={step === 'origin' ? place : undefined} onUnavailable={setMapError} />
            ) : <p className="muted" style={{ padding: 16 }}>Loading map data…</p>}
          </div>
        </>
      )}
    </div>
  );
}
