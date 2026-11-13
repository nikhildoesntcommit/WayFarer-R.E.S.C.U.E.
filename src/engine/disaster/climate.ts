import { hav } from './geo';

/**
 * Mean annual rainfall (mm) at ~90 Indian places: rounded long-period normals compiled by hand from published IMD station
 * climatology. It is NOT a downloaded dataset, it is a coarse prior (±25 %), used to decide whether a rainfall-triggered
 * flood is plausible at a place and how extreme a given 24-hour rainfall is *for that place*.
 */
const STATIONS: [number, number, number][] = [
  [26.9, 70.9, 180], [28.0, 73.3, 280], [25.75, 71.4, 280], [26.3, 73.0, 360], [23.25, 69.7, 380], [28.3, 75.0, 400],
  [29.9, 73.9, 280], [26.9, 75.8, 650], [24.6, 73.7, 620], [25.2, 75.8, 780], [26.45, 74.6, 520], [22.3, 70.8, 600],
  [23.0, 72.6, 780], [21.2, 72.8, 1200], [22.3, 73.2, 900], [28.6, 77.2, 790], [31.6, 74.9, 650], [30.7, 76.8, 1100],
  [30.9, 75.85, 700], [27.2, 78.0, 660], [26.85, 80.9, 900], [26.45, 80.35, 800], [25.3, 83.0, 1000], [25.6, 85.1, 1100],
  [24.8, 85.0, 1050], [23.35, 85.3, 1400], [22.6, 88.4, 1750], [26.7, 88.4, 3500], [27.05, 88.25, 3000], [27.3, 88.6, 3500],
  [26.15, 91.75, 1700], [25.6, 91.9, 2300], [25.3, 91.7, 11000], [27.5, 95.0, 2800], [23.85, 91.3, 2200], [24.8, 93.95, 1350],
  [23.7, 92.7, 2100], [25.7, 94.1, 1800], [27.1, 93.6, 3000], [34.1, 74.8, 650], [34.15, 77.6, 100], [32.7, 74.85, 1100],
  [31.1, 77.2, 1600], [30.3, 78.0, 2000], [29.95, 78.15, 1200], [29.4, 79.5, 2500], [23.25, 77.4, 1150], [22.7, 75.85, 950],
  [23.2, 79.95, 1350], [21.25, 81.6, 1300], [21.15, 79.1, 1100], [20.3, 85.8, 1550], [19.8, 85.8, 1450], [17.7, 83.3, 1100],
  [16.5, 80.65, 950], [17.4, 78.5, 800], [18.0, 79.6, 950], [13.1, 80.3, 1400], [11.9, 79.8, 1250], [9.9, 78.1, 850],
  [11.0, 77.0, 650], [10.8, 78.7, 850], [12.97, 77.6, 970], [12.3, 76.65, 800], [12.9, 74.85, 3500], [15.5, 73.8, 3000],
  [19.1, 72.9, 2400], [18.5, 73.85, 700], [20.0, 73.8, 700], [17.7, 75.9, 550], [19.9, 75.3, 700], [16.7, 74.25, 1050],
  [17.9, 73.65, 6000], [9.95, 76.3, 3000], [8.5, 76.95, 1800], [11.25, 75.8, 3000], [15.15, 76.9, 550], [14.7, 77.6, 550],
  [15.8, 78.0, 650], [21.5, 83.95, 1500], [22.8, 86.2, 1300], [11.65, 92.75, 3000], [25.45, 81.85, 1000], [26.75, 83.4, 1200],
  [25.45, 78.55, 880], [26.2, 78.2, 800], [28.35, 79.4, 1000], [29.0, 77.7, 800], [29.15, 75.7, 450], [30.2, 74.95, 400],
  [34.55, 76.1, 300], [21.9, 72.0, 600], [24.2, 72.4, 700], [27.0, 74.2, 500], [20.9, 74.8, 650], [14.5, 75.4, 700],
];

/** Mean annual rainfall estimate (mm) by inverse-distance weighting of the six nearest stations, in log space. */
export function annualRainfallMm(lat: number, lon: number): number {
  const d = STATIONS.map(([la, lo, mm]) => ({ d: Math.max(15, hav(lat, lon, la, lo)), mm })).sort((a, b) => a.d - b.d).slice(0, 6);
  let w = 0;
  let s = 0;
  for (const x of d) {
    const k = 1 / (x.d * x.d);
    w += k;
    s += k * Math.log(x.mm);
  }
  return Math.exp(s / w);
}

/**
 * A 24-hour rainfall that is extreme for the place (order of a 1-in-100-year to record event). Regression through
 * well-known records, rounded: arid W Rajasthan ~270 mm, Delhi ~375, Chennai ~480, Mumbai ~630, Cherrapunji ~2000.
 */
export function extremeDailyRainMm(annualMm: number): number {
  return 250 + 0.16 * annualMm;
}

export type FloodPlausibility = 'ordinary' | 'rare' | 'extreme' | 'not_credible';

export interface RainAssessment {
  annualMm: number;
  extremeMm: number;
  ratio: number;
  level: FloodPlausibility;
  climate: string;
  note: string;
}

/** Climate class by annual rainfall (IMD-style, simplified). */
export function climateClass(annualMm: number): string {
  if (annualMm < 250) return 'hyper-arid';
  if (annualMm < 500) return 'arid';
  if (annualMm < 800) return 'semi-arid';
  if (annualMm < 1500) return 'sub-humid';
  if (annualMm < 2500) return 'humid';
  return 'very humid';
}

/** How believable is `rainMm` in 24 h at this place? Above 1.6x the local extreme it is refused. */
export function assessRainfall(lat: number, lon: number, rainMm: number): RainAssessment {
  const annualMm = annualRainfallMm(lat, lon);
  const extremeMm = extremeDailyRainMm(annualMm);
  const ratio = rainMm / extremeMm;
  const climate = climateClass(annualMm);
  const a = Math.round(annualMm / 10) * 10;
  const e = Math.round(extremeMm / 10) * 10;
  let level: FloodPlausibility;
  let note: string;
  if (ratio <= 0.45) {
    level = 'ordinary';
    note = `A heavy but ordinary monsoon day here (${climate}, about ${a} mm a year; an extreme day is about ${e} mm).`;
  } else if (ratio <= 1.0) {
    level = 'rare';
    note = `A rare event here (${climate}, about ${a} mm a year): ${Math.round(rainMm)} mm in 24 h is ${Math.round(ratio * 100)}% of an extreme local day (about ${e} mm).`;
  } else if (ratio <= 1.6) {
    level = 'extreme';
    note = `An extreme, record-class event for a ${climate} place (about ${a} mm a year). It has happened (Barmer 2006, Mumbai 2005) but only a few times.`;
  } else {
    level = 'not_credible';
    note = `Not credible here: ${Math.round(rainMm)} mm in 24 h is far beyond the largest day expected in a ${climate} place (about ${a} mm a year; extreme day about ${e} mm). Choose a lower rainfall, or a wetter place.`;
  }
  return { annualMm, extremeMm, ratio, level, climate, note };
}
