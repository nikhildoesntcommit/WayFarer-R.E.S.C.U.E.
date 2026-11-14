import { useState } from 'react';
import { Link } from 'react-router-dom';
import { APP, MONTE_CARLO } from './constants';

type Tab = 'project' | 'guide' | 'build';
const TABS: { id: Tab; label: string }[] = [
  { id: 'project', label: 'The project' },
  { id: 'guide', label: 'How to use it' },
  { id: 'build', label: 'Build details' },
];

function Project() {
  return (
    <div data-testid="help-project">
      <dl>
        <dt>Title</dt><dd>{APP.name}</dd>
        <dt>Exhibition theme</dt><dd>{APP.exhibition.theme}</dd>
        <dt>Sub-theme</dt><dd>{APP.exhibition.subTheme}</dd>
        <dt>Category</dt><dd>{APP.exhibition.category}</dd>
        <dt>School</dt><dd>{APP.exhibition.school}</dd>
        <dt>Made by</dt><dd>{APP.exhibition.authors}</dd>
      </dl>
      <h2>What it is</h2>
      <p>
        {APP.name} is an evacuation-analysis tool that runs on a phone or laptop, with no internet needed. You give it a space (a room you scan with the camera,
        a hall or event venue you draw, or a district of India threatened by a flood, cyclone or earthquake) and it answers a question that is usually
        guessed: <em>if everyone has to leave at once, how long does it take, who gets stuck, and what is the cheapest change that helps?</em>
      </p>
      <h2>The mathematics inside</h2>
      <ul>
        <li><strong>Walking speed falls as a crowd thickens.</strong> Each person’s speed follows the Weidmann (1993) speed–density relationship, so a packed corridor is slow and an empty one is fast.</li>
        <li><strong>Doors have a hard limit.</strong> Flow through a door is capped at about 1.3 people per second for every metre of usable width (SFPE), after subtracting the space people keep clear of the frame.</li>
        <li><strong>Shortest routes by a wave.</strong> A first-order fast-marching solver of the eikonal equation spreads a “wavefront” out from every exit across the floor plan, giving each point its true walking time to the nearest way out around walls.</li>
        <li><strong>People choose, and choose imperfectly.</strong> Each person estimates the time to every exit, including the queue they can see, with a small perception error, and may switch exit once or twice. About 70 % walk with companions (pairs, families), who start together and move at the pace of the slowest. A fire grows like a real design fire; its smoke spreads through the open space (not through walls), slows people, and harms those who stay in it, while routes bend away from it.</li>
        <li><strong>{MONTE_CARLO.defaultRuns} randomised trials.</strong> Starting positions, reaction delays, walking speeds and perception errors are drawn at random in every trial (Monte Carlo). The app reports the median (P50) and the 95th-percentile (P95) evacuation time with confidence intervals, not a single hopeful number.</li>
        <li><strong>Fair what-if tests.</strong> A proposed change is re-run with the same random numbers (common random numbers), so a difference in the result is caused by the change and not by luck.</li>
        <li><strong>A small neural network, trained on this app’s own simulator.</strong> Thousands of random rooms were run through the full simulation, and a compact network (11 inputs, two layers of 32) learned to predict the evacuation time and the share of people lost from the room’s physical features: crowd size, walking times to the exits, door capacity, alarm delay, fire distance, vulnerable share. It gives an instant estimate while you mark the plan and a cross-check on the results page. It learns the simulator, not reality, and it says so when a room is outside what it was trained on.</li>
        <li><strong>An optional on-device language model.</strong> If the browser supports WebGPU, the results page can offer a plain-language wording of the summary. The model (about 0.4 GB, downloaded once on request) is a small general model, not fine-tuned, held to the facts by its instructions and by a check that rejects any wording that changes a number.</li>
        <li><strong>A conservation check.</strong> After every run, people out + casualties + still inside must equal the number who started. If not, the app says so.</li>
      </ul>
      <h2>Where the district-scale models come from</h2>
      <ul>
        <li><strong>Cyclone:</strong> Holland (1980) wind profile, Willoughby–Rahn radius of maximum wind, a pressure–wind relation, Kaplan–DeMaria inland decay and a Saffir–Simpson storm surge that dies away inland. The storm <em>moves</em> along its heading and the affected area is the area it sweeps.</li>
        <li><strong>Earthquake:</strong> Wells &amp; Coppersmith rupture length from magnitude, shaking by distance from the whole fault (not a point), Worden (2012) intensity, and S-wave arrival time. A magnitude the region’s faults cannot produce is refused.</li>
        <li><strong>Flood:</strong> SCS Curve Number runoff from rain, Priority-Flood drainage over the elevation grid, a Leopold–Maddock river stage and a rising-limb hydrograph. Rain that is implausible for the place (e.g. 300 mm in the Thar) is refused, with the reason.</li>
        <li><strong>Evacuation:</strong> only people the hazard’s severity orders out (or traps) are moved; the rest shelter in place. They walk or drive to a safe refuge, then a capacity-aware plan assigns them to the nearest shelter with room.</li>
      </ul>
      <p>Curriculum references used for the project: <a href="https://academic.cbseit.in/science_ex" target="_blank" rel="noreferrer">academic.cbseit.in/science_ex</a>, <a href="https://cbseacademic.nic.in" target="_blank" rel="noreferrer">cbseacademic.nic.in</a> and the CBSE <a href="https://cbseacademic.nic.in/web_material/Circulars/2026/69_Circular_2026.pdf" target="_blank" rel="noreferrer">Circular 69 (2026)</a>.</p>
      <p className="callout">{APP.disclaimer} It estimates, it does not certify. The model’s behavioural parameters are standard textbook values, not calibrated against drills of your building.</p>
    </div>
  );
}

function Guide() {
  return (
    <div data-testid="help-guide">
      <h2>The five steps</h2>
      <ol>
        <li><strong>Describe the space</strong> (three ways, below).</li>
        <li><strong>Mark it</strong>: where the exits are, where people are, where fire starts.</li>
        <li><strong>Simulate</strong>: {MONTE_CARLO.defaultRuns} trials run on your device.</li>
        <li><strong>Read the findings</strong>: plain-language problems, each with a “Why?” that shows the numbers behind it.</li>
        <li><strong>Test a fix and save the report</strong>: “What if…” re-runs with one change; the report is printable.</li>
      </ol>

      <h2>1 · Describe the space</h2>
      <h3>Scan a room (phone)</h3>
      <p>Four ways, from best to simplest. All of them end in the same plan, which you can correct afterwards.</p>
      <ol>
        <li><strong>AR scan (Android, Chrome):</strong> press Start, move the phone slowly until the circle turns green, walk to each corner and tap <em>Place corner</em>. It works in large rooms because the phone tracks its own movement. iPhones do not allow this in a web page.</li>
        <li><strong>Walk along the walls (any phone):</strong> hold the phone flat, stand in a corner, press <em>Start here</em>, walk along each wall tapping <em>Corner</em>, then return to the start and press <em>Finish</em>. Steps are counted for distance. Press <em>Measure it</em> once to teach it your step length.</li>
        <li><strong>Type the size:</strong> a rectangle or an L-shape from its measurements. Exact and instant.</li>
        <li><strong>Aim from one spot:</strong> enter your phone height, aim at each floor corner and tap. Every corner must be visible from where you stand.</li>
      </ol>
      <p>After scanning you may set the true scale by tapping two points whose real distance you know (a door is about 0.9 m), or skip it if the size already looks right.</p>
      <h3>Draw a layout</h3>
      <ol>
        <li><em>Wall</em>: drag to draw one, or tap points to chain walls; tap the last point again to stop. Draw the <strong>outer shell first</strong> and close it.</li>
        <li><em>Door</em>: tap a wall to place a door and give its width. A door in an <strong>interior</strong> wall is only a passage.</li>
        <li><em>Calibrate</em>: if you traced a picture, tap two points whose real distance you know.</li>
        <li>Continue to marking when the outline is closed.</li>
      </ol>
      <h3>Use the map (disasters)</h3>
      <ol>
        <li>Choose the disaster: flood, cyclone or earthquake.</li>
        <li>Tap the map where it begins (or type latitude and longitude) and set its strength. Flood: rainfall in mm. Cyclone: category, heading, forward speed and warning time. Earthquake: magnitude and fault direction.</li>
        <li>Press <em>Compute affected area</em>. If the disaster is not plausible at that place, the app says why instead of drawing it.</li>
        <li>Press <em>Begin evacuation simulation</em>. A ten-second replay shows the hazard spreading across the map with a clock. The result then shows how many people were <em>ordered to leave</em> and how many shelter in place, which shelters overload, and which road everybody depends on. A longer warning time usually saves far more people than any shelter.</li>
      </ol>

      <h2>2 · Mark it</h2>
      <dl>
        <dt>Exit</dt>
        <dd>Tap a <strong>door on the outermost wall</strong>. Only doors in the outer shell lead outside. A door between two rooms is not an exit, so people must keep walking to the real way out.</dd>
        <dt>Area</dt>
        <dd>Paint a region and say how many people are spread across it. A rectangle or any simple polygon. Areas decide only <em>where people start</em>; they have nothing to do with walls and they cannot overlap or cross themselves, or the app tells you why.</dd>
        <dt>Hotspot</dt>
        <dd>A single point where people gather: a food stall, a stage, a door to a ride. Tap it, give a radius and a head-count. People cluster densest at the centre.</dd>
        <dt>Fire</dt>
        <dd>Tap the place where a fire <strong>starts</strong>. It grows over time and people route around it.</dd>
        <dt>Select / Erase</dt>
        <dd>Select to inspect or change something; Erase to delete it.</dd>
      </dl>

      <h2>3 · Move around a large plan</h2>
      <ul>
        <li><strong>Pan:</strong> drag on empty canvas (with no drawing tool active), hold <span className="key">Space</span> and drag, choose the <em>Pan</em> tool, or use two fingers / the trackpad.</li>
        <li><strong>Zoom:</strong> pinch, <span className="key">Ctrl</span> + scroll, or the <span className="key">+</span> / <span className="key">−</span> buttons.</li>
        <li>Dragging a wall or area to the edge of the screen scrolls the view automatically.</li>
        <li>On very large sites the simulation uses a coarser grid; the app tells you when it does.</li>
      </ul>

      <h2>4 · Read the results</h2>
      <ul>
        <li><strong>P50</strong> is the time by which half the people are out; <strong>P95</strong> is the time by which 95 out of 100 are out. P95 is the one that matters for safety.</li>
        <li>The <strong>density map</strong> shows where crowds get thick; anything over 3.5 people per m² is dangerous.</li>
        <li>Each finding has a severity word (<em>critical</em>, <em>warning</em>, <em>note</em>). <strong>Why? Show the evidence</strong> opens a plain-language explanation of how the app reached it.</li>
        <li><strong>What if…</strong> tests one proposed change against the same trials and shows before, after and the difference. <em>Keep change</em> adopts it.</li>
        <li><strong>Report</strong> makes a printable summary with signature lines.</li>
      </ul>

      <h2>If something goes wrong</h2>
      <ul>
        <li>The camera will not start: allow camera access in the browser, or use <em>Draw a layout</em>.</li>
        <li>Nothing is marked as an exit: an exit must be on the outermost, closed wall.</li>
        <li>You want to see a finished example first: <em>Settings → Load example plan</em>.</li>
      </ul>
    </div>
  );
}

function Build() {
  return (
    <div data-testid="help-build">
      <dl>
        <dt>Version</dt><dd className="num">{APP.version}</dd>
        <dt>Built</dt><dd className="num">{__BUILD_DATE__}</dd>
        <dt>Trials per analysis</dt><dd className="num">{MONTE_CARLO.defaultRuns}</dd>
        <dt>Model</dt><dd>{APP.modelVersion}</dd>
        <dt>Works offline</dt><dd>Yes, after the first load. Plans are stored on this device only.</dd>
      </dl>
      <h2>Data and assumptions</h2>
      <ul>
        <li><strong>Map data tier: fallback.</strong> Census 2011 district population (spread evenly over each district), elevation at about 18 km, a skeleton of major roads, and towns of 50,000+ as shelters. Flood and surge extents, shelter loads and road bottlenecks are indicative.</li>
        <li><strong>Assumed, not measured:</strong> shelter capacity (10 % of a town’s population), the share of people ordered to leave, the smoke dose times, group sizes and how long companions wait for each other. Behaviour is not yet calibrated against recorded drills.</li>
        <li><strong>“Caught on the way”</strong> on the map path means exposed to the hazard on a road when it arrived. It is not a death count.</li>
      </ul>
      <p className="callout">{APP.disclaimer}</p>
    </div>
  );
}

export function HelpPage() {
  const [tab, setTab] = useState<Tab>('project');
  return (
    <div className="screen">
      <header className="topbar">
        <Link to="/" className="btn small" data-testid="help-back">← Home</Link>
        <h2>Help</h2>
      </header>
      <main className="page help" aria-label="Help">
        <div className="help-tabs" role="tablist" aria-label="Help sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`btn small ${tab === t.id ? 'active' : ''}`} data-testid={`help-tab-${t.id}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'project' ? <Project /> : tab === 'guide' ? <Guide /> : <Build />}
      </main>
    </div>
  );
}
