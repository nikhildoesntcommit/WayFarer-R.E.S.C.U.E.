import { create } from 'zustand';
import { applyColours, paletteFor } from './theme';

/** Accessibility settings. Stored on this device only (localStorage); the app works identically if storage is blocked. */
export interface Settings {
  /** 1 = normal; scales every rem-based size */
  textScale: 1 | 1.15 | 1.3 | 1.5;
  highContrast: boolean;
  colourBlind: boolean;
  reducedMotion: boolean;
  largeTargets: boolean;
}

export const TEXT_SCALES: { value: Settings['textScale']; label: string }[] = [
  { value: 1, label: 'Standard' },
  { value: 1.15, label: 'Large' },
  { value: 1.3, label: 'Larger' },
  { value: 1.5, label: 'Largest' },
];

const KEY = 'wayfarer.settings.v1';

export function systemPrefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function defaultSettings(): Settings {
  return { textScale: 1, highContrast: false, colourBlind: false, reducedMotion: systemPrefersReducedMotion(), largeTargets: false };
}

function load(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      textScale: [1, 1.15, 1.3, 1.5].includes(p.textScale as number) ? (p.textScale as Settings['textScale']) : d.textScale,
      highContrast: typeof p.highContrast === 'boolean' ? p.highContrast : d.highContrast,
      colourBlind: typeof p.colourBlind === 'boolean' ? p.colourBlind : d.colourBlind,
      reducedMotion: typeof p.reducedMotion === 'boolean' ? p.reducedMotion : d.reducedMotion,
      largeTargets: typeof p.largeTargets === 'boolean' ? p.largeTargets : d.largeTargets,
    };
  } catch {
    return d;
  }
}

/** Push the settings into the document: data attributes for CSS, custom properties and the canvas palette. */
export function applySettings(s: Settings): void {
  applyColours(paletteFor(s.highContrast, s.colourBlind));
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--text-scale', String(s.textScale));
  root.dataset.contrast = s.highContrast ? 'high' : 'normal';
  root.dataset.palette = s.colourBlind ? 'cb' : 'standard';
  root.dataset.motion = s.reducedMotion ? 'reduced' : 'full';
  root.dataset.touch = s.largeTargets ? 'large' : 'normal';
}

interface SettingsState {
  settings: Settings;
  set: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: load(),
  set: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    applySettings(settings);
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* private mode or blocked storage: the change still applies for this visit */
    }
  },
  reset: () => {
    const settings = defaultSettings();
    set({ settings });
    applySettings(settings);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
}));

/** Read outside React (canvas / animation code). */
export const motionReduced = (): boolean => useSettings.getState().settings.reducedMotion;

/** Call once before first render so there is no flash of the wrong palette. */
export function initSettings(): void {
  applySettings(useSettings.getState().settings);
}
