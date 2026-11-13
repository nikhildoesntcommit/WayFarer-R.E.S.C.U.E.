import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeGrid, type IndiaData } from '../../../map/data/loader';

const dir = resolve(__dirname, '../../../../public/data');
const j = <T>(f: string): T => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as T;

let cached: IndiaData | null = null;
/** The bundled data, read from disk (the app fetches the same files over HTTP). */
export function loadFromDisk(): IndiaData {
  if (cached) return cached;
  const fc = j<{ features: { properties: Record<string, unknown>; geometry: { coordinates: [number, number] } }[] }>('india-shelters.geojson');
  const man = j<{ tier: string; notice: string }>('data-manifest.json');
  cached = {
    grid: decodeGrid(j('india-grid.json')),
    roads: j('india-roads.geojson'),
    rivers: j('india-rivers.geojson'),
    shelters: fc.features.map((f) => ({
      id: String(f.properties.id), name: String(f.properties.name), state: String(f.properties.state ?? ''),
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      population: Number(f.properties.population), capacity: Number(f.properties.capacity),
    })),
    tier: man.tier, notice: man.notice,
  };
  return cached;
}
