import { assetUrl } from '../../utils/url';
import type { DataStatus, IndiaGrid } from '../../types';

export interface Shelter {
  id: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  population: number;
  capacity: number;
}

export interface LineCollection {
  features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: [number, number][] } }[];
}

export interface IndiaData {
  grid: IndiaGrid;
  roads: LineCollection;
  rivers: LineCollection;
  shelters: Shelter[];
  tier: string;
  notice: string;
}

function b64(s: string): ArrayBuffer {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

interface RawGrid {
  rows: number;
  cols: number;
  minLat: number;
  minLon: number;
  resDeg: number;
  elevationM: string;
  population: string;
  landMask: string;
  coastMask: string;
}

export function decodeGrid(raw: RawGrid): IndiaGrid {
  const n = raw.rows * raw.cols;
  const elev16 = new Int16Array(b64(raw.elevationM));
  const pop = new Float32Array(b64(raw.population));
  const land = new Uint8Array(b64(raw.landMask));
  const coast = new Uint8Array(b64(raw.coastMask));
  if (elev16.length !== n || pop.length !== n || land.length !== n || coast.length !== n) {
    throw new Error(`The bundled grid is inconsistent: expected ${n} cells per layer.`);
  }
  const lat = new Float32Array(n);
  const lon = new Float32Array(n);
  const elevationM = new Float32Array(n);
  for (let r = 0; r < raw.rows; r++)
    for (let c = 0; c < raw.cols; c++) {
      const i = r * raw.cols + c;
      lat[i] = raw.minLat + (r + 0.5) * raw.resDeg;
      lon[i] = raw.minLon + (c + 0.5) * raw.resDeg;
      elevationM[i] = elev16[i]!;
    }
  return { rows: raw.rows, cols: raw.cols, minLat: raw.minLat, minLon: raw.minLon, resDeg: raw.resDeg, lat, lon, elevationM, population: pop, landMask: land, coastMask: coast };
}

let cache: Promise<DataStatus<IndiaData>> | null = null;

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

/**
 * Every bundled map asset, decoded once. Missing or corrupt data is reported as a status, never thrown into the UI:
 * the spec requires a visible "data missing" message instead of a fake result.
 */
export function loadIndiaData(): Promise<DataStatus<IndiaData>> {
  if (!cache) {
    cache = (async (): Promise<DataStatus<IndiaData>> => {
      try {
        const [rawGrid, roads, rivers, shelterFc, manifest] = await Promise.all([
          getJSON<RawGrid>(assetUrl('data/india-grid.json')),
          getJSON<LineCollection>(assetUrl('data/india-roads.geojson')),
          getJSON<LineCollection>(assetUrl('data/india-rivers.geojson')),
          getJSON<{ features: { properties: Record<string, unknown>; geometry: { coordinates: [number, number] } }[] }>(assetUrl('data/india-shelters.geojson')),
          getJSON<{ tier: string; notice: string }>(assetUrl('data/data-manifest.json')),
        ]);
        const shelters: Shelter[] = shelterFc.features.map((f) => ({
          id: String(f.properties.id),
          name: String(f.properties.name),
          state: String(f.properties.state ?? ''),
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          population: Number(f.properties.population),
          capacity: Number(f.properties.capacity),
        }));
        return { status: 'ok', data: { grid: decodeGrid(rawGrid), roads, rivers, shelters, tier: manifest.tier, notice: manifest.notice } };
      } catch (e) {
        cache = null; // allow a retry
        return { status: 'missing', reason: `The map data could not be loaded (${(e as Error).message}).` };
      }
    })();
  }
  return cache;
}
