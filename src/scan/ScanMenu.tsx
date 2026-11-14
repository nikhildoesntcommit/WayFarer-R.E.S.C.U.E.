import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { arSupported } from './arSupport';

/** The four ways to describe a room, with the one that suits the phone offered first. */
export function ScanMenu() {
  const [ar, setAr] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void arSupported().then((v) => alive && setAr(v));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="screen">
      <header className="topbar">
        <Link to="/" className="btn small" data-testid="scan-back">← Home</Link>
        <h2>Scan a room</h2>
      </header>
      <main className="page" aria-label="Ways to scan a room">
        <p className="muted">Pick whichever is easiest where you are. All of them end in the same plan, which you can then correct on the next screens.</p>
        <div className="setting">
          <h3>Walk around with the camera (AR)</h3>
          <div className="ctl">
            {ar ? <Link className="btn primary" to="/scan/ar" data-testid="scan-opt-ar">Start AR scan</Link> : <span className="btn" aria-disabled="true">{ar === null ? 'Checking…' : 'Not on this phone'}</span>}
          </div>
          <p>Point the camera at the floor, walk to each corner and tap. The phone tracks its own movement, so you can see the room from anywhere, including a large hall. The most accurate option, and phones with a depth sensor are used automatically for a tighter result. Needs an Android phone with Chrome and AR support; iPhones and iPads do not allow this in a web page.</p>
        </div>
        <div className="setting">
          <h3>Walk along the walls</h3>
          <div className="ctl"><Link className="btn primary" to="/scan/walk" data-testid="scan-opt-walk">Start walking scan</Link></div>
          <p>For any phone with motion sensors. Hold the phone flat, walk along each wall and tap at every corner; the phone counts your steps. Accuracy is a few percent, and you fix the scale on the next screen with one tape measurement.</p>
        </div>
        <div className="setting">
          <h3>Type the size</h3>
          <div className="ctl"><Link className="btn primary" to="/scan/size" data-testid="scan-opt-size">Enter the size</Link></div>
          <p>The quickest and most exact way if you know the length and width: a rectangular room or an L-shaped one.</p>
        </div>
        <div className="setting">
          <h3>Aim from one spot (any camera)</h3>
          <div className="ctl"><Link className={ar === false ? 'btn primary' : 'btn'} to="/scan/camera" data-testid="scan-opt-camera">Open the camera</Link></div>
          <p>The quick option for any phone, including iPhones. Stand in one place, put the crosshair on each floor corner and tap; the lens does not matter, only the phone’s tilt and compass. Every corner must be visible from where you stand. Each corner shows its likely error in centimetres.</p>
        </div>
      </main>
    </div>
  );
}
