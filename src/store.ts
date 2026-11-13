import { create } from 'zustand';
import type { Finding, MapAnalysis, MapScenario, Plan, SimulationResult, WorldPoint } from './types';

export type Source = 'camera' | 'draw' | 'map';

interface AppState {
  source: Source | null;
  plan: Plan | null;
  scenario: MapScenario | null;
  mapAnalysis: MapAnalysis | null;
  result: SimulationResult | null;
  findings: Finding[];
  /** Camera -> /calibrate hand-off: corner polygon in metres (plan coordinates). */
  scanPolygon: WorldPoint[] | null;
  analystName: string;
  mentorName: string;
  hydrated: boolean;

  setSource: (s: Source | null) => void;
  setPlan: (p: Plan | null) => void;
  /** Immutable update; stamps updatedAt (which triggers the 500 ms autosave). */
  patchPlan: (fn: (p: Plan) => Plan) => void;
  setScenario: (s: MapScenario | null) => void;
  setMapAnalysis: (m: MapAnalysis | null) => void;
  setResult: (r: SimulationResult | null, f?: Finding[]) => void;
  setScanPolygon: (p: WorldPoint[] | null) => void;
  setSignatures: (analyst: string, mentor: string) => void;
  setHydrated: () => void;
  reset: () => void;
}

export const useApp = create<AppState>((set, get) => ({
  source: null,
  plan: null,
  scenario: null,
  mapAnalysis: null,
  result: null,
  findings: [],
  scanPolygon: null,
  analystName: '',
  mentorName: '',
  hydrated: false,

  setSource: (source) => set({ source }),
  setPlan: (plan) => set({ plan, result: null, findings: [] }),
  patchPlan: (fn) => {
    const p = get().plan;
    if (!p) return;
    set({ plan: { ...fn(p), updatedAt: Date.now() }, result: null, findings: [] });
  },
  setScenario: (scenario) => set({ scenario }),
  setMapAnalysis: (mapAnalysis) => set({ mapAnalysis }),
  setResult: (result, findings = []) => set({ result, findings }),
  setScanPolygon: (scanPolygon) => set({ scanPolygon }),
  setSignatures: (analystName, mentorName) => set({ analystName, mentorName }),
  setHydrated: () => set({ hydrated: true }),
  reset: () =>
    set({ source: null, plan: null, scenario: null, mapAnalysis: null, result: null, findings: [], scanPolygon: null }),
}));
