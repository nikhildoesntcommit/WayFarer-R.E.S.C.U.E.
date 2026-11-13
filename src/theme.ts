/**
 * Colours shared by CSS (custom properties) and the canvases (which cannot read CSS variables cheaply).
 * One source of truth: `applyColours` copies the active palette into both.
 *
 * Design language (V2): safety signage. Near-black ink on a cool light ground, with colour reserved for meaning:
 * green = way out, red = danger, amber = caution. High contrast, bold type, hard edges; nothing is meant to soothe.
 */
export type ColourKey = 'paper' | 'paperEdge' | 'ink' | 'inkSoft' | 'inkFaint' | 'rule' | 'vermillion' | 'brass' | 'olive' | 'signal';
export type Palette = Record<ColourKey, string>;

export const STANDARD: Palette = {
  paper: '#F3F4F6',
  paperEdge: '#E3E6EB',
  ink: '#0B1220',
  inkSoft: '#2B3646',
  inkFaint: '#5B6675',
  rule: '#B4BBC6',
  vermillion: '#D01030', // danger / fire
  brass: '#B35C00', // caution / selection (kept under its V1 name)
  olive: '#0B7A3B', // exit / safe (kept under its V1 name)
  signal: '#FFC20E', // hazard-tape yellow: highlights on dark bars
};

export const HIGH_CONTRAST: Palette = {
  paper: '#FFFFFF',
  paperEdge: '#EDEDED',
  ink: '#000000',
  inkSoft: '#161616',
  inkFaint: '#3D3D3D',
  rule: '#000000',
  vermillion: '#B00020',
  brass: '#8A4500',
  olive: '#005A24',
  signal: '#FFD400',
};

/** Okabe–Ito based: danger and safe no longer differ only in red vs green. */
const COLOUR_BLIND_OVERRIDES: Partial<Palette> = {
  vermillion: '#D55E00',
  olive: '#0072B2',
  brass: '#7A5600',
};

export function paletteFor(highContrast: boolean, colourBlind: boolean): Palette {
  const base = highContrast ? HIGH_CONTRAST : STANDARD;
  if (!colourBlind) return { ...base };
  const o = { ...COLOUR_BLIND_OVERRIDES };
  if (highContrast) o.vermillion = '#C14F00';
  return { ...base, ...o };
}

/** Live palette read by canvas drawing code. Mutated in place by `applyColours`. */
export const COLOURS: Palette = { ...STANDARD };

const CSS_VAR: Record<ColourKey, string> = {
  paper: '--paper',
  paperEdge: '--paper-edge',
  ink: '--ink',
  inkSoft: '--ink-soft',
  inkFaint: '--ink-faint',
  rule: '--rule',
  vermillion: '--vermillion',
  brass: '--brass',
  olive: '--olive',
  signal: '--signal',
};

export function applyColours(p: Palette): void {
  Object.assign(COLOURS, p);
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  (Object.keys(CSS_VAR) as ColourKey[]).forEach((k) => root.style.setProperty(CSS_VAR[k], p[k]));
}

/** '#RRGGBB' + alpha -> 'rgba(r,g,b,a)' so canvas translucency follows the active palette. */
export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
