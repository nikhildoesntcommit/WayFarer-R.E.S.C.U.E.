// Filters Natural Earth 50m admin0 + admin1 to India and strips properties to `name`.
// Usage: node scripts/extract-natural-earth.mjs <dir with the two downloaded ne_*.geojson files> [outDir]
// Source: https://github.com/nvkelso/natural-earth-vector (public domain).
// The downloaded files are treated as untrusted DATA: parsed with JSON.parse only, never evaluated.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const inDir = resolve(process.argv[2] ?? '.');
const outDir = resolve(process.argv[3] ?? join(import.meta.dirname, '..', 'public', 'data'));
mkdirSync(outDir, { recursive: true });

const load = (name) => JSON.parse(readFileSync(join(inDir, name), 'utf8'));

// Round coordinates to 4 decimals (~11 m): far below the 1:50m source accuracy, and shrinks the file.
const round = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4] : c.map(round));

function strip(feature, name) {
  return {
    type: 'Feature',
    properties: { name },
    geometry: { type: feature.geometry.type, coordinates: round(feature.geometry.coordinates) },
  };
}

const admin0 = load('ne_50m_admin_0_countries.geojson');
const india0 = admin0.features.filter((f) => {
  const p = f.properties ?? {};
  return p.ADM0_A3 === 'IND' || p.ISO_A3 === 'IND' || p.NAME === 'India';
});
if (india0.length !== 1) throw new Error(`expected exactly 1 India admin0 feature, found ${india0.length}`);

const admin1 = load('ne_50m_admin_1_states_provinces.geojson');
const india1 = admin1.features.filter((f) => {
  const p = f.properties ?? {};
  return p.adm0_a3 === 'IND' || p.iso_a2 === 'IN' || p.admin === 'India';
});
if (india1.length === 0) throw new Error('no India admin1 features found');

const out0 = { type: 'FeatureCollection', features: india0.map((f) => strip(f, 'India')) };
const out1 = {
  type: 'FeatureCollection',
  features: india1.map((f) => strip(f, String(f.properties.name ?? f.properties.NAME ?? 'unnamed'))),
};
writeFileSync(join(outDir, 'india-admin0.geojson'), JSON.stringify(out0));
writeFileSync(join(outDir, 'india-admin1.geojson'), JSON.stringify(out1));
for (const f of ['india-admin0.geojson', 'india-admin1.geojson']) {
  console.log(f, (statSync(join(outDir, f)).size / 1024).toFixed(1), 'KB');
}
console.log('admin1 features:', out1.features.length);
