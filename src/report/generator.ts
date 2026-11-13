import { peopleSources } from '../utils/sources';
import { exitLabels } from '../ai/rules';
import { overallStatus, type Status } from '../ai/findings';
import { fmtDuration } from '../ai/templates';
import { APP } from '../constants';
import type { Finding, MapScenario, Plan, SimulationResult } from '../types';

export interface ReportRow {
  label: string;
  value: string;
}

export interface ReportModel {
  title: string;
  subtitle: string;
  status: Status;
  rows: ReportRow[];
  exits: { name: string; share: string; load: string; queue: string }[];
  findings: { n: number; severity: Finding['severity']; category: string; message: string; recommendation: string }[];
  footer: { model: string; seed: number; runs: number; generated: string; disclaimer: string; dataTier?: string; version: string };
}

const f0 = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : '—');

function describeScenario(s: MapScenario): string {
  const where = `${s.originLat.toFixed(2)}°N, ${s.originLon.toFixed(2)}°E`;
  switch (s.disasterKind) {
    case 'earthquake': return `Earthquake M${s.magnitude?.toFixed(1)} at ${where}`;
    case 'flood': return `Flood after ${Math.round(s.rainfallMm ?? 0)} mm of rain in 24 h, near ${where}`;
    case 'cyclone': return `Cyclone category ${s.category} making landfall near ${where}${s.headingDeg !== undefined ? `, moving ${Math.round(s.headingDeg)}°` : ''}, ${s.leadHours ?? 12} h warning`;
  }
}

export function buildReport(args: {
  plan: Plan | null;
  scenario: MapScenario | null;
  result: SimulationResult;
  findings: Finding[];
  seed: number;
  dataTier?: string;
  now?: Date;
}): ReportModel {
  const { plan, scenario, result, findings, seed } = args;
  const status = overallStatus(result, findings);
  const names = exitLabels(plan);
  const total = result.totalPeople ?? 0;
  const isMap = !!result.mapStats;
  const T = (v: number) => (isMap ? `${(v / 3600).toFixed(1)} h` : `${f0(v)} s`);
  const rows: ReportRow[] = [
    { label: '95th-percentile time to evacuate', value: `${T(result.p95)} (95% CI ${T(result.ci95P95Lower)}–${T(result.ci95P95Upper)}) — ${fmtDuration(result.p95)}` },
    { label: 'Median time (P50)', value: `${T(result.p50)} (95% CI ${T(result.ci95P50Lower)}–${T(result.ci95P50Upper)})` },
    { label: 'Mean ± standard deviation', value: `${T(result.mean)} ± ${T(result.stdDev)}` },
    { label: isMap ? 'Population at risk' : 'People modelled', value: total.toLocaleString('en-IN') },
    { label: 'Evacuated (mean per trial)', value: (result.evacuated / result.runs).toFixed(isMap ? 0 : 1) },
    { label: 'Casualties (mean per trial)', value: (result.casualties / result.runs).toFixed(isMap ? 0 : 1) },
    { label: 'Not out at the time cap (mean per trial)', value: (result.remaining / result.runs).toFixed(isMap ? 0 : 1) },
    { label: 'Conservation check', value: result.conservationPass ? 'passed' : 'FAILED' },
  ];
  if (result.peakDensity !== undefined) rows.push({ label: 'Peak crowd density', value: `${result.peakDensity.toFixed(2)} persons/m²` });
  if (result.unreachable.length) {
    rows.push({ label: 'Unreachable', value: result.unreachable.map((id) => (plan ? peopleSources(plan) : []).find((c) => c.id === id)?.label ?? id).join(', ') });
  }
  const exits = Object.keys(result.exitLoads).map((id) => ({
    name: names[id] ?? id,
    share: `${Math.round((result.exitUtilisation[id] ?? 0) * 100)}%`,
    load: (result.exitLoads[id] ?? 0).toFixed(0),
    queue: fmtDuration(result.exitQueueTimes[id] ?? 0),
  }));
  return {
    title: isMap && scenario ? describeScenario(scenario) : plan?.name ?? 'Evacuation analysis',
    subtitle: isMap ? 'Regional evacuation analysis' : 'Building evacuation analysis',
    status,
    rows,
    exits: isMap ? [] : exits,
    findings: findings.map((f, i) => ({ n: i + 1, severity: f.severity, category: f.category.replace(/_/g, ' '), message: f.message, recommendation: f.recommendation })),
    footer: {
      model: APP.modelVersion,
      seed,
      runs: result.runs,
      generated: (args.now ?? new Date()).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      disclaimer: APP.disclaimer,
      dataTier: args.dataTier,
      version: APP.version,
    },
  };
}

/** Machine-readable export: the inputs and the numbers, no raw per-person arrays. */
export function reportJSON(args: { plan: Plan | null; scenario: MapScenario | null; result: SimulationResult; findings: Finding[]; model: ReportModel }): string {
  const { result } = args;
  return JSON.stringify(
    {
      app: APP.name,
      version: APP.version,
      engine: APP.modelVersion,
      generatedAt: new Date().toISOString(),
      plan: args.plan,
      scenario: args.scenario,
      summary: {
        runs: result.runs,
        p50: result.p50,
        p95: result.p95,
        mean: result.mean,
        stdDev: result.stdDev,
        ci95P50: [result.ci95P50Lower, result.ci95P50Upper],
        ci95P95: [result.ci95P95Lower, result.ci95P95Upper],
        evacuated: result.evacuated,
        casualties: result.casualties,
        remaining: result.remaining,
        totalPeople: result.totalPeople,
        exitLoads: result.exitLoads,
        exitUtilisation: result.exitUtilisation,
        exitQueueTimes: result.exitQueueTimes,
        unreachable: result.unreachable,
        conservationPass: result.conservationPass,
        mapStats: result.mapStats,
      },
      status: args.model.status,
      findings: args.findings,
      footer: args.model.footer,
    },
    null,
    2,
  );
}
