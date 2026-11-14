import { Link, useNavigate } from 'react-router-dom';
import { APP } from './constants';
import { useApp } from './store';

const PATHS = [
  { id: 'A', to: '/scan', cls: 'exit-a', title: 'Scan a room', text: 'One room, one hall, one floor. Walk around with AR, walk the walls, or type the size. Builds a floor plan from your phone.' },
  { id: 'B', to: '/draw', cls: 'exit-b', title: 'Draw a layout', text: 'A planned event or any space you design yourself. Draw the plan from scratch.' },
  { id: 'C', to: '/map', cls: 'exit-c', title: 'Use the map', text: 'A natural disaster. Pick an area of India, choose the disaster type, mark where it began.' },
] as const;

export function Home() {
  const plan = useApp((s) => s.plan);
  const reset = useApp((s) => s.reset);
  const nav = useNavigate();
  return (
    <div className="screen-home">
      <header className="brand">
        <div className="brand-row">
          <div>
            <h1>{APP.name}</h1>
            <p>How long does it take to get everyone out?</p>
          </div>
          <nav className="brand-actions" aria-label="Help and settings">
            <Link to="/settings" className="btn" data-testid="open-settings" aria-label="Settings">⚙ Settings</Link>
            <Link to="/help" className="btn" data-testid="open-help" aria-label="Help">? Help</Link>
          </nav>
        </div>
      </header>
      <div className="tape" aria-hidden="true" />
      <main className="page">
        {plan ? (
          <div className="panel">
            <span className="label">Last plan</span>
            <p style={{ margin: '4px 0 8px' }}>
              <strong>{plan.name}</strong> — {plan.clusters.length} area(s), {(plan.hotspots ?? []).length} hotspot(s), {plan.doors.filter((d) => d.isExit).length} exit(s)
            </p>
            <button className="btn primary" onClick={() => nav('/mark')}>Resume</button>{' '}
            <button className="btn" onClick={() => reset()}>Discard</button>
          </div>
        ) : null}
        {PATHS.map((p) => (
          <Link key={p.id} to={p.to} className={`card ${p.cls}`} onClick={() => reset()}>
            <span className="path">PATH {p.id}</span>
            <h2>{p.title}</h2>
            <p>{p.text}</p>
          </Link>
        ))}
      </main>
    </div>
  );
}
