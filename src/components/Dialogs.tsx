import { useState } from 'react';
import { DOOR } from '../constants';
import { DOOR_WIDTH_CHOICES_M } from '../draw/tools';
import type { GroupMix } from '../types';
import { Modal } from './Modal';

export function DoorDialog({
  initialWidth = 1.0,
  title = 'Door',
  hint,
  onOk,
  onCancel,
  onDelete,
}: {
  initialWidth?: number;
  title?: string;
  hint?: string;
  onOk: (widthM: number) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [width, setWidth] = useState(String(initialWidth));
  const w = Number(width);
  const valid = Number.isFinite(w) && w >= DOOR.minUsableWidthM && w <= 10;
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="field">
        <label className="label" htmlFor="door-width">Clear width (m)</label>
        <input
          id="door-width"
          list="door-widths"
          inputMode="decimal"
          value={width}
          onChange={(e) => setWidth(e.target.value)}
          aria-invalid={!valid}
        />
        <datalist id="door-widths">
          {DOOR_WIDTH_CHOICES_M.map((v) => <option key={v} value={v} />)}
        </datalist>
        {!valid ? <span className="danger">Enter a width between {DOOR.minUsableWidthM} and 10 m.</span> : null}
      </div>
      <p className="muted">{hint ?? 'A door in the outer wall is a final exit; a door between rooms is just a passage. The app works this out from where you put it.'}</p>
      <div className="actions">
        {onDelete ? <button className="btn danger" onClick={onDelete}>Delete</button> : null}
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={!valid} onClick={() => onOk(w)}>OK</button>
      </div>
    </Modal>
  );
}

export const DEFAULT_MIX: GroupMix = { adult: 0.8, child: 0.1, elderly: 0.08, wheelchair: 0.02 };

export interface PeopleValues {
  label: string;
  people: number;
  mix: GroupMix;
  radiusM: number;
}

/** One dialog for both kinds of people source: an area (spread evenly over floor) and a hotspot (bunched at a point). */
export function PeopleDialog({
  kind,
  title,
  initialLabel = '',
  initialPeople = 30,
  initialMix = DEFAULT_MIX,
  initialRadius = 2,
  onOk,
  onCancel,
  onDelete,
}: {
  kind: 'area' | 'hotspot';
  title?: string;
  initialLabel?: string;
  initialPeople?: number;
  initialMix?: GroupMix;
  initialRadius?: number;
  onOk: (v: PeopleValues) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [people, setPeople] = useState(String(initialPeople));
  const [radius, setRadius] = useState(String(initialRadius));
  const pct = (v: number) => String(Math.round(v * 100));
  const [adult, setAdult] = useState(pct(initialMix.adult));
  const [child, setChild] = useState(pct(initialMix.child));
  const [elderly, setElderly] = useState(pct(initialMix.elderly));
  const [wheelchair, setWheelchair] = useState(pct(initialMix.wheelchair));
  const n = Number(people);
  const r = Number(radius);
  const mix = [adult, child, elderly, wheelchair].map((v) => Math.max(0, Number(v) || 0));
  const sum = mix.reduce((a, b) => a + b, 0);
  const validPeople = Number.isInteger(n) && n >= 0 && n <= 5000;
  const validRadius = kind === 'area' || (Number.isFinite(r) && r >= 0.5 && r <= 15);
  const validMix = sum > 0;
  const row = (id: string, text: string, v: string, set: (s: string) => void) => (
    <div className="field" style={{ flex: 1, minWidth: 90 }} key={id}>
      <label className="label" htmlFor={id}>{text} %</label>
      <input id={id} inputMode="numeric" value={v} onChange={(e) => set(e.target.value)} />
    </div>
  );
  return (
    <Modal title={title ?? (kind === 'area' ? 'People area' : 'Hotspot')} onClose={onCancel}>
      <p className="muted">
        {kind === 'area'
          ? 'People are spread evenly over this floor space when the alarm sounds. It does not need walls around it.'
          : 'A single place where extra people gather, such as a food stall. They bunch around the point and are added to anyone already standing there.'}
      </p>
      <div className="field">
        <label className="label" htmlFor="zone-label">Name</label>
        <input id="zone-label" value={label} placeholder={kind === 'area' ? 'e.g. Playground' : 'e.g. Food stall'} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="zone-people">People {kind === 'area' ? 'in this area' : 'gathered here'}</label>
        <input id="zone-people" inputMode="numeric" value={people} onChange={(e) => setPeople(e.target.value)} aria-invalid={!validPeople} />
        {!validPeople ? <span className="danger">Whole number from 0 to 5000.</span> : null}
      </div>
      {kind === 'hotspot' ? (
        <div className="field">
          <label className="label" htmlFor="hotspot-radius">Spread (m): how far from the point they stand</label>
          <input id="hotspot-radius" inputMode="decimal" value={radius} onChange={(e) => setRadius(e.target.value)} aria-invalid={!validRadius} />
          {!validRadius ? <span className="danger">0.5 to 15 m.</span> : null}
        </div>
      ) : null}
      <span className="label">Group mix (shares are normalised)</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        {row('mix-adult', 'Adult', adult, setAdult)}
        {row('mix-child', 'Child', child, setChild)}
        {row('mix-elderly', 'Elderly', elderly, setElderly)}
        {row('mix-wheelchair', 'Wheelchair', wheelchair, setWheelchair)}
      </div>
      {!validMix ? <span className="danger">At least one share must be above zero.</span> : null}
      <div className="actions">
        {onDelete ? <button className="btn danger" onClick={onDelete}>Delete</button> : null}
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button
          className="btn primary"
          disabled={!validPeople || !validMix || !validRadius}
          onClick={() =>
            onOk({
              label: label.trim(),
              people: n,
              radiusM: kind === 'hotspot' ? r : 0,
              mix: { adult: mix[0]! / sum, child: mix[1]! / sum, elderly: mix[2]! / sum, wheelchair: mix[3]! / sum },
            })
          }
        >
          OK
        </button>
      </div>
    </Modal>
  );
}

export function TimeDialog({
  title,
  help,
  initial = 30,
  onOk,
  onCancel,
  onDelete,
}: {
  title: string;
  help?: string;
  initial?: number;
  onOk: (activeAtSeconds: number) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [t, setT] = useState(String(initial));
  const v = Number(t);
  const valid = Number.isFinite(v) && v >= 0 && v <= 1200;
  return (
    <Modal title={title} onClose={onCancel}>
      {help ? <p className="muted">{help}</p> : null}
      <div className="field">
        <label className="label" htmlFor="haz-time">Active from (seconds after the alarm)</label>
        <input id="haz-time" inputMode="numeric" value={t} onChange={(e) => setT(e.target.value)} aria-invalid={!valid} />
        {!valid ? <span className="danger">0 to 1200 seconds.</span> : null}
      </div>
      <div className="actions">
        {onDelete ? <button className="btn danger" onClick={onDelete}>Delete</button> : null}
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={!valid} onClick={() => onOk(v)}>OK</button>
      </div>
    </Modal>
  );
}

export function DistanceDialog({ measured, onOk, onCancel }: { measured: number; onOk: (realM: number) => void; onCancel: () => void }) {
  const [d, setD] = useState('');
  const v = Number(d);
  const valid = Number.isFinite(v) && v > 0.1 && v < 1000;
  return (
    <Modal title="Calibrate" onClose={onCancel}>
      <p>
        The two points you tapped are <span className="num">{measured.toFixed(2)}<span className="unit">m</span></span> apart in the drawing.
        How far apart are they in reality?
      </p>
      <div className="field">
        <label className="label" htmlFor="real-d">Real distance (m)</label>
        <input id="real-d" inputMode="decimal" autoFocus value={d} onChange={(e) => setD(e.target.value)} />
      </div>
      <div className="actions">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={!valid} onClick={() => onOk(v)}>Rescale plan</button>
      </div>
    </Modal>
  );
}
