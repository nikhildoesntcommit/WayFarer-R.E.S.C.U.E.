import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../store';
import { buildCameraPlan } from './planBuilder';
import { polygonFromSize, sizeProblem, type RoomShape, type RoomSize } from './shapes';

/** Describe the room by its measurements. Exact, instant, and works on any device. */
export function SizeScan() {
  const nav = useNavigate();
  const setPlan = useApp((s) => s.setPlan);
  const setSource = useApp((s) => s.setSource);
  const [shape, setShape] = useState<RoomShape>('rectangle');
  const [v, setV] = useState({ length: '', width: '', nl: '', nw: '' });
  const size: RoomSize = { shape, length: Number(v.length), width: Number(v.width), notchLength: Number(v.nl), notchWidth: Number(v.nw) };
  const problem = v.length === '' || v.width === '' ? 'Enter the length and width in metres.' : sizeProblem(size);
  const field = (key: keyof typeof v, label: string, testid: string) => (
    <label className="field">
      <span className="label">{label}</span>
      <input inputMode="decimal" value={v[key]} data-testid={testid} onChange={(e) => setV({ ...v, [key]: e.target.value })} aria-label={label} />
    </label>
  );
  const make = () => {
    if (problem) return;
    setSource('camera');
    setPlan(buildCameraPlan(polygonFromSize(size), shape === 'rectangle' ? 'Room (typed size)' : 'L-shaped room (typed size)'));
    nav('/mark');
  };
  return (
    <div className="screen">
      <header className="topbar">
        <Link to="/scan" className="btn small">← Back</Link>
        <h2>Type the size</h2>
      </header>
      <main className="page" aria-label="Room size">
        <div className="seg" role="group" aria-label="Shape">
          <button className={`btn small ${shape === 'rectangle' ? 'active' : ''}`} aria-pressed={shape === 'rectangle'} onClick={() => setShape('rectangle')} data-testid="shape-rect">Rectangle</button>
          <button className={`btn small ${shape === 'l-shape' ? 'active' : ''}`} aria-pressed={shape === 'l-shape'} onClick={() => setShape('l-shape')} data-testid="shape-l">L-shape</button>
        </div>
        <div className="panel">
          {field('length', 'Length (m)', 'size-length')}
          {field('width', 'Width (m)', 'size-width')}
          {shape === 'l-shape' ? (
            <>
              <p className="muted">The L-shape is the rectangle with one corner (top right) cut away:</p>
              {field('nl', 'Missing corner, along the length (m)', 'size-nl')}
              {field('nw', 'Missing corner, along the width (m)', 'size-nw')}
            </>
          ) : null}
        </div>
        {problem && v.length !== '' ? <p className="danger" role="alert">{problem}</p> : null}
        <button className="btn primary" disabled={!!problem} onClick={make} data-testid="size-make">Make the plan</button>
      </main>
    </div>
  );
}
