import { useNavigate } from 'react-router-dom';
import { SettingsPage } from './SettingsPage';
import { buildDemoPlan } from './demo/demoPlan';
import { useApp } from './store';

/** Route wrapper: adds the "try it without a camera" section to the settings page. */
export function SettingsRoute() {
  const nav = useNavigate();
  const load = () => {
    const app = useApp.getState();
    app.reset();
    app.setPlan(buildDemoPlan());
    nav('/mark');
  };
  return (
    <SettingsPage
      extra={
        <div className="setting">
          <h3>Example building</h3>
          <div className="ctl">
            <button className="btn small" data-testid="load-demo" onClick={load}>Load example plan</button>
          </div>
          <p>Replaces the current plan with a ready-made floor plan so you can try the simulation, the what-if tools and the report without scanning or drawing anything. It does not touch your settings.</p>
        </div>
      }
    />
  );
}
