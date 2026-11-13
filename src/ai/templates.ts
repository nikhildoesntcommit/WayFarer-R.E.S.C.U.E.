// Natural-language templates. Every sentence states a number taken from the finding's evidence.

export function fmtDuration(s: number): string {
  if (!Number.isFinite(s)) return 'unknown time';
  if (s < 90) return `${s.toFixed(0)} s`;
  return `${(s / 60).toFixed(1)} min`;
}
const pct = (v: number) => `${Math.round(v * 100)}%`;
const n1 = (v: unknown) => Number(v).toFixed(1);
const n2 = (v: unknown) => Number(v).toFixed(2);
const ev = (e: Record<string, unknown>, k: string) => e[k];

export const templates = {
  exit_overload: (e: Record<string, unknown>) => ({
    message:
      `${ev(e, 'exitLabel')} is carrying ${pct(Number(ev(e, 'utilisation')))} of the crowd (${Math.round(Number(ev(e, 'loadPersons')))} of ${ev(e, 'totalPeople')}) ` +
      `while ${ev(e, 'underusedLabel')} carries only ${pct(Number(ev(e, 'underusedUtilisation')))}. Its effective width (${n2(ev(e, 'effectiveWidthM'))} m) limits throughput to ` +
      `${n2(ev(e, 'capacityPersonsPerSecond'))} persons per second` +
      (Number(ev(e, 'queueMeanSeconds')) >= 2
        ? `, causing a mean queue of ${fmtDuration(Number(ev(e, 'queueMeanSeconds')))}.`
        : `. People barely queue yet, but one door is doing most of the work.`),
    recommendation: ev(e, 'clusterLabel')
      ? `Assign ${ev(e, 'clusterLabel')} (${ev(e, 'clusterPeople')} people) to ${ev(e, 'underusedLabel')} instead of ${ev(e, 'exitLabel')}.`
      : `Reassign some areas from ${ev(e, 'exitLabel')} to ${ev(e, 'underusedLabel')}.`,
  }),
  exit_overload_critical: (e: Record<string, unknown>) => ({
    message:
      `${ev(e, 'exitLabel')} is carrying ${pct(Number(ev(e, 'utilisation')))} of the crowd (${Math.round(Number(ev(e, 'loadPersons')))} of ${ev(e, 'totalPeople')}). ` +
      `Its effective width (${n2(ev(e, 'effectiveWidthM'))} m) limits throughput to ${n2(ev(e, 'capacityPersonsPerSecond'))} persons per second; ` +
      (Number(ev(e, 'queueMeanSeconds')) >= 2 ? `the mean queue is ${fmtDuration(Number(ev(e, 'queueMeanSeconds')))}.` : `queues are short so far, but there is little spare capacity.`),
    recommendation: `Add a second exit near ${ev(e, 'exitLabel')} or widen it from ${n2(ev(e, 'widthM'))} m to ${n2(ev(e, 'newWidthM'))} m.`,
  }),
  bottleneck_density: (e: Record<string, unknown>) => ({
    message:
      `Crowd density near (${n1(ev(e, 'xM'))} m, ${n1(ev(e, 'yM'))} m) stays above ${ev(e, 'thresholdPerM2')} persons/m² for ${n1(ev(e, 'secondsAbove'))} s per trial on average ` +
      `(mean peak ${n1(ev(e, 'peakDensity'))} persons/m²). Walking speed there falls to ${n2(ev(e, 'speedAtPeak'))} m/s.`,
    recommendation: ev(e, 'nearestExitLabel')
      ? `Add an exit or widen the passage at (${n1(ev(e, 'xM'))} m, ${n1(ev(e, 'yM'))} m); the nearest exit is ${ev(e, 'nearestExitLabel')}, ${n2(ev(e, 'widthM'))} m wide.`
      : `Add an exit or widen the passage at (${n1(ev(e, 'xM'))} m, ${n1(ev(e, 'yM'))} m).`,
  }),
  queue_critical: (e: Record<string, unknown>) => ({
    message:
      `The longest wait at ${ev(e, 'exitLabel')} averages ${fmtDuration(Number(ev(e, 'queueMaxSeconds')))} per trial (mean wait ${fmtDuration(Number(ev(e, 'queueMeanSeconds')))}), ` +
      `against a capacity of ${n2(ev(e, 'capacityPersonsPerSecond'))} persons per second through ${n2(ev(e, 'effectiveWidthM'))} m of effective width.`,
    recommendation: `Increase exit capacity at ${ev(e, 'exitLabel')}: widening it from ${n2(ev(e, 'widthM'))} m to ${n2(ev(e, 'newWidthM'))} m.`,
  }),
  queue_warning: (e: Record<string, unknown>) => ({
    message:
      `The longest wait at ${ev(e, 'exitLabel')} averages ${fmtDuration(Number(ev(e, 'queueMaxSeconds')))} per trial (mean wait ${fmtDuration(Number(ev(e, 'queueMeanSeconds')))}) with ` +
      `${Math.round(Number(ev(e, 'loadPersons')))} people using a ${n2(ev(e, 'capacityPersonsPerSecond'))} persons-per-second exit.`,
    recommendation: ev(e, 'clusterLabel')
      ? `Assign fewer people to ${ev(e, 'exitLabel')}: move ${ev(e, 'clusterLabel')} (${ev(e, 'clusterPeople')} people) to ${ev(e, 'underusedLabel')}.`
      : `Assign fewer people to ${ev(e, 'exitLabel')}; widen it from ${n2(ev(e, 'widthM'))} m to ${n2(ev(e, 'newWidthM'))} m.`,
  }),
  unreachable_zones: (e: Record<string, unknown>) => ({
    message: `${ev(e, 'zoneLabel')} (${ev(e, 'people')} people) has no walkable route to any exit; in every trial all ${ev(e, 'people')} remain inside.`,
    recommendation: `Add an exit on the ${ev(e, 'side')} wall of ${ev(e, 'zoneLabel')}.`,
  }),
  casualty_clustering: (e: Record<string, unknown>) => ({
    message:
      `On average ${n1(ev(e, 'meanPerRun'))} people per trial are caught by the hazard in the same 2 m² patch near (${n1(ev(e, 'xM'))} m, ${n1(ev(e, 'yM'))} m); ` +
      `${n1(ev(e, 'totalCasualtiesPerRun'))} casualties per trial in total.`,
    recommendation: `The hazard at (${n1(ev(e, 'xM'))} m, ${n1(ev(e, 'yM'))} m) activates too early for people there to pass; add a route bypass or start the evacuation earlier.`,
  }),
  slow_cluster: (e: Record<string, unknown>) => ({
    message: `${ev(e, 'clusterLabel')} takes ${fmtDuration(Number(ev(e, 'meanSeconds')))} on average to get out, more than the 95th-percentile individual time of ${fmtDuration(Number(ev(e, 'p95PersonSeconds')))}.`,
    recommendation: `Stagger the release of ${ev(e, 'clusterLabel')} to reduce merge density.`,
  }),
  conservation_failure: (e: Record<string, unknown>) => ({
    message: `Head-count did not balance: ${ev(e, 'evacuated')} evacuated + ${ev(e, 'casualties')} casualties + ${ev(e, 'remaining')} remaining ≠ ${ev(e, 'expected')} expected.`,
    recommendation: 'Internal error — please re-run.',
  }),
  road_bottleneck: (e: Record<string, unknown>) => ({
    message: `${pct(Number(ev(e, 'share')))} of all evacuees must use ${ev(e, 'label')}; if it fails or jams, the evacuation fails with it.`,
    recommendation: `The bridge/road at ${ev(e, 'label')} is the critical path — pre-position resources there.`,
  }),
  shelter_overload: (e: Record<string, unknown>) => ({
    message: `${ev(e, 'shelterName')} would receive ${Math.round(Number(ev(e, 'load'))).toLocaleString('en-IN')} people against an assumed capacity of ${Math.round(Number(ev(e, 'capacity'))).toLocaleString('en-IN')} (${pct(Number(ev(e, 'ratio')))}).`,
    recommendation: ev(e, 'alternateName')
      ? `Redirect ${Math.round(Number(ev(e, 'excess'))).toLocaleString('en-IN')} people from ${ev(e, 'shelterName')} to ${ev(e, 'alternateName')}.`
      : `Redirect ${Math.round(Number(ev(e, 'excess'))).toLocaleString('en-IN')} people from ${ev(e, 'shelterName')}; no alternate with spare capacity is reachable.`,
  }),
  shelter_underused: (e: Record<string, unknown>) => ({
    message: `${ev(e, 'shelterName')} is used at only ${pct(Number(ev(e, 'ratio')))} of its assumed capacity (${Math.round(Number(ev(e, 'load'))).toLocaleString('en-IN')} of ${Math.round(Number(ev(e, 'capacity'))).toLocaleString('en-IN')}) while other shelters are over capacity.`,
    recommendation: `Reassign route to ${ev(e, 'shelterName')}.`,
  }),
  flood_timing: (e: Record<string, unknown>) => ({
    message: `The hazard reaches the road network ${n1(ev(e, 'gapMin'))} minutes before 90% of the affected population (${Math.round(Number(ev(e, 'population'))).toLocaleString('en-IN')} people) has escaped in the median trial.`,
    recommendation: `Begin evacuation of ${ev(e, 'region')} at least ${Math.ceil(Number(ev(e, 'gapMin')))} minutes before general alert.`,
  }),
  unreachable_population: (e: Record<string, unknown>) => ({
    message: `${Math.round(Number(ev(e, 'population'))).toLocaleString('en-IN')} people (${pct(Number(ev(e, 'share')))} of the affected population) have no usable road route to any shelter.`,
    recommendation: 'Plan air, boat or on-foot extraction for these settlements, or open an alternative route.',
  }),
} as const;
