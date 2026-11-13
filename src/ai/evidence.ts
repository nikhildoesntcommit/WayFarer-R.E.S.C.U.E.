import type { Finding } from '../types';
import { fmtDuration } from './templates';

/**
 * Evidence, written for people. A finding carries the raw numbers it was built from (`finding.evidence`); this turns
 * them into a short plain-language reading plus labelled rows with units, instead of showing the data structure.
 */
export interface EvidenceRow {
  label: string;
  value: string;
  /** one short sentence on what the number means */
  hint?: string;
  /** 0..1: drawn as a bar under the row */
  bar?: number;
}
export interface EvidenceView {
  /** "In plain words": why the rule fired */
  summary: string;
  rows: EvidenceRow[];
  /** how the numbers were obtained */
  basis: string;
}

type E = Record<string, unknown>;
const num = (e: E, k: string): number => Number(e[k]);
const str = (e: E, k: string, fallback = ''): string => (e[k] === undefined || e[k] === null ? fallback : String(e[k]));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const m2 = (v: number) => `${v.toFixed(2)} m`;
const people = (v: number) => `${Math.round(v).toLocaleString('en-IN')} ${Math.round(v) === 1 ? 'person' : 'people'}`;
const at = (e: E) => `(${num(e, 'xM').toFixed(1)} m, ${num(e, 'yM').toFixed(1)} m) on the plan`;
const has = (e: E, k: string) => e[k] !== undefined && e[k] !== null && !Number.isNaN(num(e, k));

/** Fallback for any evidence key this file does not know yet: "queueMeanSeconds" -> "Queue mean seconds: 12.3". */
function humanise(e: E): EvidenceRow[] {
  return Object.entries(e)
    .filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object')
    .map(([k, v]) => {
      const label = k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
      return { label: label.charAt(0).toUpperCase() + label.slice(1), value: typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v) };
    });
}

function exitRows(e: E): EvidenceRow[] {
  const rows: EvidenceRow[] = [
    {
      label: `Who used ${str(e, 'exitLabel')}`,
      value: `${people(num(e, 'loadPersons'))} of ${num(e, 'totalPeople')} (${pct(num(e, 'utilisation'))})`,
      hint: 'Average over all simulated evacuations.',
      bar: num(e, 'utilisation'),
    },
    {
      label: 'Door width',
      value: `${m2(num(e, 'widthM'))} drawn, ${m2(num(e, 'effectiveWidthM'))} usable`,
      hint: 'People keep about 15 cm clear of each door frame, so the usable width is 30 cm less than the drawn width.',
    },
    {
      label: 'Most it can let through',
      value: `${num(e, 'capacityPersonsPerSecond').toFixed(2)} people per second (about ${Math.round(num(e, 'capacityPersonsPerSecond') * 60)} per minute)`,
      hint: 'Standard flow through a doorway (SFPE): 1.3 people per second for every metre of usable width.',
    },
    { label: 'Average wait at the door', value: fmtDuration(num(e, 'queueMeanSeconds')) },
    { label: 'Longest wait at the door', value: fmtDuration(num(e, 'queueMaxSeconds')), hint: 'The longest single wait, averaged over the evacuations.' },
  ];
  if (has(e, 'underusedUtilisation')) {
    rows.push({
      label: `Who used ${str(e, 'underusedLabel')}`,
      value: pct(num(e, 'underusedUtilisation')),
      hint: 'The least-used exit, for comparison.',
      bar: num(e, 'underusedUtilisation'),
    });
  }
  return rows;
}

export function describeEvidence(f: Finding, ctx: { runs?: number } = {}): EvidenceView {
  const e = f.evidence as E;
  const runs = ctx.runs ? `${ctx.runs} simulated evacuations` : 'the simulated evacuations';
  const basis = `Each figure is an average over ${runs}. People start at different times and walk at different speeds in every one, so no single run is quoted.`;

  switch (f.category) {
    case 'exit_overload':
    case 'queue': {
      const queued = num(e, 'queueMeanSeconds') >= 2;
      return {
        summary:
          `${str(e, 'exitLabel')} takes ${pct(num(e, 'utilisation'))} of the people but can only pass ${num(e, 'capacityPersonsPerSecond').toFixed(2)} per second. ` +
          (queued
            ? `People arrive faster than that, so they wait: ${fmtDuration(num(e, 'queueMeanSeconds'))} on average and ${fmtDuration(num(e, 'queueMaxSeconds'))} at worst.`
            : `Nobody waits long yet, but one door is doing most of the work, so anything that blocks it would hurt badly.`),
        rows: exitRows(e),
        basis,
      };
    }
    case 'bottleneck':
      if (f.id === 'conservation_failure') break;
      return {
        summary:
          `Around ${at(e)} the crowd is packed tighter than ${num(e, 'thresholdPerM2')} people per square metre (the point where people can barely move) for ${num(e, 'secondsAbove').toFixed(0)} seconds per evacuation. ` +
          `There, walking slows to ${num(e, 'speedAtPeak').toFixed(2)} m/s, about ${pct(num(e, 'speedAtPeak') / 1.34)} of normal speed.`,
        rows: [
          { label: 'Where', value: at(e) },
          { label: 'Crowding limit', value: `${num(e, 'thresholdPerM2')} people per m²`, hint: 'Above this, movement is restricted (US Coast Guard congestion threshold).' },
          { label: 'Time above the limit', value: `${num(e, 'secondsAbove').toFixed(0)} s per evacuation` },
          { label: 'Densest moment', value: `${num(e, 'peakDensity').toFixed(1)} people per m²` },
          { label: 'Walking speed at that density', value: `${num(e, 'speedAtPeak').toFixed(2)} m/s`, hint: 'Free walking speed is about 1.34 m/s.' },
          ...(e.nearestExitLabel ? [{ label: 'Nearest exit', value: `${str(e, 'nearestExitLabel')}, ${m2(num(e, 'widthM'))} wide` }] : []),
        ],
        basis,
      };
    case 'unreachable':
      if (has(e, 'people') && e.zoneLabel !== undefined) {
        return {
          summary: `${str(e, 'zoneLabel')} holds ${people(num(e, 'people'))}, but there is no walkable route from it to any final exit. In every evacuation they are still inside at the end.`,
          rows: [
            { label: 'Where', value: str(e, 'zoneLabel') },
            { label: 'People who cannot leave', value: people(num(e, 'people')) },
            { label: 'Closest outer wall', value: `the ${str(e, 'side')} side`, hint: 'A door cut into this wall is the most likely fix.' },
          ],
          basis: 'This is a geometric check (is there a gap in the walls between here and an exit?), so it is the same in every evacuation.',
        };
      }
      return {
        summary: `${people(num(e, 'population'))} (${pct(num(e, 'share'))} of the affected population) live where no usable road leads to a shelter.`,
        rows: [
          { label: 'People cut off', value: people(num(e, 'population')) },
          { label: 'Share of the affected population', value: pct(num(e, 'share')), bar: num(e, 'share') },
        ],
        basis: 'Based on the simplified road network shipped with the app, which is much sparser than the real one.',
      };
    case 'casualty':
      return {
        summary: `A hazard catches an average of ${num(e, 'meanPerRun').toFixed(1)} people per evacuation in the same small patch near ${at(e)}, out of ${num(e, 'totalCasualtiesPerRun').toFixed(1)} caught in total.`,
        rows: [
          { label: 'Where people are caught', value: at(e) },
          { label: 'Caught in that patch', value: `${num(e, 'meanPerRun').toFixed(1)} per evacuation` },
          { label: 'Caught anywhere', value: `${num(e, 'totalCasualtiesPerRun').toFixed(1)} per evacuation` },
        ],
        basis,
      };
    case 'slow_cluster':
      return {
        summary: `On average ${str(e, 'clusterLabel')} takes ${fmtDuration(num(e, 'meanSeconds'))} to get out. That is longer than 95% of individual people anywhere in the building (${fmtDuration(num(e, 'p95PersonSeconds'))}).`,
        rows: [
          { label: 'Group', value: str(e, 'clusterLabel') },
          { label: 'Average time to leave', value: fmtDuration(num(e, 'meanSeconds')) },
          { label: 'Time that 95% of all people beat', value: fmtDuration(num(e, 'p95PersonSeconds')) },
        ],
        basis,
      };
    case 'road_bottleneck':
      if (f.id === 'flood_timing') {
        return {
          summary: `The hazard reaches the roads about ${num(e, 'gapMin').toFixed(1)} minutes before nine in ten of the affected ${people(num(e, 'population'))} would have got away.`,
          rows: [
            { label: 'Area', value: str(e, 'region') },
            { label: 'Affected population', value: people(num(e, 'population')) },
            { label: 'Hazard arrives before escape is complete by', value: `${num(e, 'gapMin').toFixed(1)} min`, hint: 'Compared in the typical (median) evacuation.' },
          ],
          basis,
        };
      }
      return {
        summary: `${pct(num(e, 'share'))} of everyone who evacuates drives over ${str(e, 'label')}. If it jams or is cut, most of the evacuation stops with it.`,
        rows: [
          { label: 'Road or bridge', value: str(e, 'label') },
          { label: 'Share of all evacuees', value: pct(num(e, 'share')), bar: num(e, 'share') },
        ],
        basis,
      };
    case 'shelter_overload': {
      const over = f.id.startsWith('shelter_overload');
      return {
        summary: over
          ? `${str(e, 'shelterName')} would receive ${people(num(e, 'load'))} but is assumed to hold ${people(num(e, 'capacity'))}, so it is ${pct(num(e, 'ratio'))} full.`
          : `${str(e, 'shelterName')} would be only ${pct(num(e, 'ratio'))} full while other shelters overflow.`,
        rows: [
          { label: 'Shelter', value: str(e, 'shelterName') },
          { label: 'People sent there', value: people(num(e, 'load')) },
          { label: 'Capacity (assumed)', value: people(num(e, 'capacity')), hint: 'Capacities are an assumption (10% of the town’s population), not surveyed data.' },
          { label: 'How full', value: pct(num(e, 'ratio')), bar: Math.min(1, num(e, 'ratio')) },
          ...(has(e, 'excess') && num(e, 'excess') > 0 ? [{ label: 'Over capacity by', value: people(num(e, 'excess')) }] : []),
          ...(e.alternateName ? [{ label: 'Nearest shelter with room', value: str(e, 'alternateName') }] : []),
        ],
        basis,
      };
    }
    default:
      break;
  }
  if (f.id === 'conservation_failure') {
    return {
      summary: `The head-count did not balance: ${num(e, 'evacuated')} out + ${num(e, 'casualties')} caught + ${num(e, 'remaining')} still inside should equal ${num(e, 'expected')}. The program checks this on every run, so a mismatch means a bug, not a property of your plan.`,
      rows: [
        { label: 'Got out', value: String(num(e, 'evacuated')) },
        { label: 'Caught by a hazard', value: String(num(e, 'casualties')) },
        { label: 'Still inside', value: String(num(e, 'remaining')) },
        { label: 'Should add up to', value: String(num(e, 'expected')) },
      ],
      basis: 'Please run the simulation again.',
    };
  }
  return { summary: f.message, rows: humanise(e), basis };
}
