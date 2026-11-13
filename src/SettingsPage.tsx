import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TEXT_SCALES, useSettings, type Settings } from './settings';

function Toggle({ id, title, text, checked, onChange }: { id: string; title: string; text: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="setting">
      <h3 id={`${id}-t`}>{title}</h3>
      <div className="ctl">
        <span className="switch-state" aria-hidden="true">{checked ? 'On' : 'Off'}</span>
        <input className="switch" type="checkbox" role="switch" id={id} data-testid={id} aria-labelledby={`${id}-t`} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </div>
      <p>{text}</p>
    </div>
  );
}

export function SettingsPage({ extra }: { extra?: ReactNode }) {
  const { settings, set, reset } = useSettings();
  const s: Settings = settings;
  return (
    <div className="screen">
      <header className="topbar">
        <Link to="/" className="btn small" data-testid="settings-back">← Home</Link>
        <h2>Settings</h2>
        <button className="btn small" onClick={reset} data-testid="settings-reset">Reset all</button>
      </header>
      <main className="page" aria-label="Settings">
        <p className="muted">Accessibility options. They apply everywhere in the app, are kept on this device only, and take effect immediately.</p>

        <div className="setting">
          <h3 id="ts-t">Text size</h3>
          <div className="ctl">
            <div className="seg" role="group" aria-labelledby="ts-t">
              {TEXT_SCALES.map((t) => (
                <button key={t.value} className={`btn small ${s.textScale === t.value ? 'active' : ''}`} aria-pressed={s.textScale === t.value} data-testid={`text-${t.value}`} onClick={() => set({ textScale: t.value })}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <p>Enlarges all text and spacing. Numbers on the plan stay readable; use the zoom buttons to enlarge the plan itself.</p>
        </div>

        <Toggle id="set-contrast" title="High contrast" text="Pure black on white, black borders and thicker outlines. For bright sunlight or low vision." checked={s.highContrast} onChange={(v) => set({ highContrast: v })} />
        <Toggle id="set-cb" title="Colour-blind-safe colours" text="Danger is shown in orange and safe in blue instead of red and green; warnings also change their border style. Every status is also written as a word." checked={s.colourBlind} onChange={(v) => set({ colourBlind: v })} />
        <Toggle id="set-motion" title="Reduce motion" text="Turns off animated reveals and fades. Starts on if your device already asks for reduced motion." checked={s.reducedMotion} onChange={(v) => set({ reducedMotion: v })} />
        <Toggle id="set-touch" title="Larger touch targets" text="Makes buttons, fields and tool icons taller so they are easier to hit with a thumb or a shaky hand." checked={s.largeTargets} onChange={(v) => set({ largeTargets: v })} />

        <div className="sample" aria-label="Preview of the colours in use">
          <span className="label">Preview</span>
          <div className="swatches">
            <span style={{ background: 'var(--olive)' }}>Exit / safe</span>
            <span style={{ background: 'var(--brass)' }}>Caution</span>
            <span style={{ background: 'var(--vermillion)' }}>Danger / fire</span>
          </div>
        </div>
        {extra}
      </main>
    </div>
  );
}
