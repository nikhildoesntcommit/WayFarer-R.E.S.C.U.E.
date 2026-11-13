// Builds every runtime data asset in public/data from the downloaded sources (see scripts/fetch-sources.sh).
//
//   node scripts/prepare-data.mjs <sourceRoot> [outDir]
//
// <sourceRoot> layout (all produced by fetch-sources.sh):
//   topo/topo10.nc                              ETOPO1 resampled to 10 arc-min (fatiando-data/earth-topography-10arcmin)
//   ne/ne_10m_roads.geojson                     Natural Earth 10m roads
//   ne/ne_10m_rivers_lake_centerlines.geojson   Natural Earth 10m rivers
//   ne/ne_10m_populated_places_simple.geojson   Natural Earth 10m populated places
//   ne-ind/ne_10m_admin_0_countries_ind.geojson Natural Earth 10m admin-0, India point of view
//   districts/india_district.geojson            GADM 2.x district polygons (geohacker/india)
//   census/india-districts-census-2011.csv      Census of India 2011, district totals (nishusharma1608/India-Census-2011-Analysis)
//
// This is the FALLBACK data tier allowed by the specification (§3): the full-resolution WorldPop / Copernicus
// rasters are not reachable from the build sandbox. All downloaded files are treated as untrusted DATA:
// they are parsed with JSON.parse / split only, never evaluated.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import h5wasm from 'h5wasm/node';

const src = resolve(process.argv[2] ?? '.');
const out = resolve(process.argv[3] ?? join(import.meta.dirname, '..', 'public', 'data'));
mkdirSync(out, { recursive: true });

// ---- grid definition (spec §9.1: 0.05 degree grid covering India) ----
const RES = 0.05;
const MIN_LON = 68.0;
const MAX_LON = 97.5;
const MIN_LAT = 6.5;
const MAX_LAT = 37.5;
const COLS = Math.round((MAX_LON - MIN_LON) / RES);
const ROWS = Math.round((MAX_LAT - MIN_LAT) / RES);
const cellLat = (r) => MIN_LAT + (r + 0.5) * RES;
const cellLon = (c) => MIN_LON + (c + 0.5) * RES;
const KM_PER_DEG = 111.195;

const readJSON = (p) => JSON.parse(readFileSync(join(src, p), 'utf8'));
const kb = (p) => `${(statSync(p).size / 1024).toFixed(0)} KB`;
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------------------------
function polygonsOf(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

function pipRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** Point in polygon-with-holes: inside the outer ring and outside every hole. */
function pipPolygon(x, y, rings) {
  if (!pipRing(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (pipRing(x, y, rings[k])) return false;
  return true;
}
function ringBBox(ring) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of ring) {
    if (p[0] < a) a = p[0];
    if (p[1] < b) b = p[1];
    if (p[0] > c) c = p[0];
    if (p[1] > d) d = p[1];
  }
  return [a, b, c, d];
}
function ringAreaKm2(ring) {
  // equirectangular at the ring's mean latitude: adequate for district-scale areas
  let s = 0;
  let latSum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    latSum += ring[i][1];
  }
  const cos = Math.cos(((latSum / ring.length) * Math.PI) / 180);
  return (Math.abs(s) / 2) * KM_PER_DEG * KM_PER_DEG * cos;
}
function polygonAreaKm2(rings) {
  let a = ringAreaKm2(rings[0]);
  for (let k = 1; k < rings.length; k++) a -= ringAreaKm2(rings[k]);
  return Math.max(a, 0);
}
/** Douglas–Peucker simplification of an open or closed ring (tolerance in degrees). */
function simplify(points, tol) {
  if (points.length < 5) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = points[i0];
    const b = points[i1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let maxD = 0;
    let idx = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const p = points[i];
      let d;
      if (len2 === 0) d = Math.hypot(p[0] - a[0], p[1] - a[1]);
      else {
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
        d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
      }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([i0, idx], [idx, i1]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}
const similarity = (a, b) => (a.length === 0 && b.length === 0 ? 1 : 1 - levenshtein(a, b) / Math.max(a.length, b.length));

// ---------------------------------------------------------------------------------------------
// 1. India outline (India point of view), simplified, properties stripped to `name`
// ---------------------------------------------------------------------------------------------
console.log('admin0 ...');
const world = readJSON('ne-ind/ne_10m_admin_0_countries_ind.geojson');
const indiaFeature = world.features.find((f) => (f.properties?.ADM0_A3 ?? f.properties?.adm0_a3) === 'IND');
if (!indiaFeature) throw new Error('India not found in admin0 source');
const indiaPolys = polygonsOf(indiaFeature.geometry).map((rings) =>
  rings.map((ring) => simplify(ring, 0.004).map((p) => [round(p[0], 4), round(p[1], 4)])),
);
// drop slivers smaller than three vertices after simplification
const indiaPolysClean = indiaPolys.filter((rings) => rings[0].length >= 4);
writeFileSync(
  join(out, 'india-admin0.geojson'),
  JSON.stringify({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { name: 'India' }, geometry: { type: 'MultiPolygon', coordinates: indiaPolysClean } }],
  }),
);
console.log('  india-admin0.geojson', kb(join(out, 'india-admin0.geojson')));

const bboxes = indiaPolysClean.map((rings) => ringBBox(rings[0]));
function insideIndia(lon, lat) {
  for (let k = 0; k < indiaPolysClean.length; k++) {
    const b = bboxes[k];
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (pipPolygon(lon, lat, indiaPolysClean[k])) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// 2. Elevation: ETOPO1 (10 arc-min) bilinear-resampled onto the 0.05° grid
// ---------------------------------------------------------------------------------------------
console.log('elevation ...');
await h5wasm.ready;
const nc = new h5wasm.File(join(src, 'topo/topo10.nc'), 'r');
const lons = nc.get('longitude').value;
const lats = nc.get('latitude').value;
const topoDs = nc.get('topography');
const topo = topoDs.value;
const [d0, d1] = topoDs.shape; // expected [lat, lon]
if (d0 !== lats.length || d1 !== lons.length) throw new Error(`unexpected topography shape ${topoDs.shape}`);
const lon0 = lons[0];
const lat0 = lats[0];
const dLon = lons[1] - lons[0];
const dLat = lats[1] - lats[0];
function topoAt(i, j) {
  return topo[Math.max(0, Math.min(d0 - 1, i)) * d1 + Math.max(0, Math.min(d1 - 1, j))];
}
function sampleElevation(lon, lat) {
  const fi = (lat - lat0) / dLat;
  const fj = (lon - lon0) / dLon;
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  const ti = fi - i;
  const tj = fj - j;
  return (
    topoAt(i, j) * (1 - ti) * (1 - tj) + topoAt(i, j + 1) * (1 - ti) * tj + topoAt(i + 1, j) * ti * (1 - tj) + topoAt(i + 1, j + 1) * ti * tj
  );
}
const elevation = new Int16Array(ROWS * COLS);
const land = new Uint8Array(ROWS * COLS);
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const lat = cellLat(r);
    const lon = cellLon(c);
    elevation[r * COLS + c] = Math.round(sampleElevation(lon, lat));
    land[r * COLS + c] = insideIndia(lon, lat) ? 1 : 0;
  }
}
// Land cells that the 18 km source blurs below sea level are clamped to 0 m (they are land by the India outline).
for (let i = 0; i < elevation.length; i++) if (land[i] && elevation[i] < 0) elevation[i] = 0;

// coast: an India land cell with an 8-neighbour that lies outside India and at or below sea level
const coast = new Uint8Array(ROWS * COLS);
let coastCells = 0;
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c;
    if (!land[i]) continue;
    let wet = false;
    for (let dr = -1; dr <= 1 && !wet; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= ROWS || cc >= COLS) continue;
        const j = rr * COLS + cc;
        if (!land[j] && elevation[j] <= 0) { wet = true; break; }
      }
    if (wet) { coast[i] = 1; coastCells++; }
  }
}
console.log(`  land cells: ${land.reduce((s, v) => s + v, 0)}, coastal: ${coastCells}`);

// ---------------------------------------------------------------------------------------------
// 3. Population: Census 2011 district totals spread uniformly over GADM district polygons
// ---------------------------------------------------------------------------------------------
console.log('population ...');
const csvText = readFileSync(join(src, 'census/india-districts-census-2011.csv'), 'utf8');
function parseCSVLine(line) {
  const cells = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}
const csvLines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
const header = parseCSVLine(csvLines[0]);
const iState = header.indexOf('State name');
const iDist = header.indexOf('District name');
const iPop = header.indexOf('Population');
if (iState < 0 || iDist < 0 || iPop < 0) throw new Error('census CSV header changed');
const censusRows = csvLines.slice(1).map((l) => {
  const c = parseCSVLine(l);
  return { state: c[iState], district: c[iDist], pop: Number(c[iPop]) };
});
const censusTotal = censusRows.reduce((s, r) => s + r.pop, 0);

const STATE_ALIAS = {
  'andaman and nicobar islands': 'andaman and nicobar',
  'nct of delhi': 'delhi',
  pondicherry: 'puducherry',
  uttarakhand: 'uttaranchal',
  orissa: 'orissa',
};
const normState = (s) => {
  const k = s.toLowerCase().trim();
  return (STATE_ALIAS[k] ?? k).replace(/[^a-z]/g, '');
};
const normDist = (s) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/\b(district|urban|rural|city)\b/g, '').replace(/[^a-z]/g, '');

const districts = readJSON('districts/india_district.geojson').features.map((f) => {
  const polys = polygonsOf(f.geometry);
  return {
    state: normState(f.properties.NAME_1),
    name: normDist(f.properties.NAME_2 ?? ''),
    rawName: f.properties.NAME_2,
    polys,
    bbox: polys.map((p) => ringBBox(p[0])),
    areaKm2: polys.reduce((s, p) => s + polygonAreaKm2(p), 0),
    pop: 0,
    matched: false,
  };
});

const censusByState = new Map();
for (const r of censusRows) {
  const k = normState(r.state);
  if (!censusByState.has(k)) censusByState.set(k, []);
  censusByState.get(k).push({ ...r, name: normDist(r.district) });
}
const MATCH_MIN = 0.78;
let matchedCensus = 0;
for (const [st, rows] of censusByState) {
  const dd = districts.filter((d) => d.state === st);
  let leftover = 0;
  for (const row of rows) {
    let best = null;
    let bestS = 0;
    for (const d of dd) {
      const s = similarity(row.name, d.name);
      if (s > bestS) { bestS = s; best = d; }
    }
    if (best && bestS >= MATCH_MIN) {
      best.pop += row.pop;
      best.matched = true;
      matchedCensus += row.pop;
    } else leftover += row.pop;
  }
  // Unmatched census population (districts created after the GADM vintage, spelling variants) is shared out over the
  // state's unmatched polygons by area, so state totals are preserved exactly.
  const free = dd.filter((d) => !d.matched);
  const freeArea = free.reduce((s, d) => s + d.areaKm2, 0);
  if (leftover > 0) {
    const pool = freeArea > 0 ? free : dd;
    const poolArea = pool.reduce((s, d) => s + d.areaKm2, 0) || 1;
    for (const d of pool) d.pop += (leftover * d.areaKm2) / poolArea;
  }
}
console.log(`  census total ${censusTotal.toLocaleString('en-IN')}, matched by name ${((100 * matchedCensus) / censusTotal).toFixed(1)}%`);

const population = new Float32Array(ROWS * COLS);
const cosLat = (r) => Math.cos((cellLat(r) * Math.PI) / 180);
let placedTotal = 0;
for (const d of districts) {
  if (d.pop <= 0) continue;
  const cells = [];
  let wsum = 0;
  d.polys.forEach((rings, k) => {
    const [x0, y0, x1, y1] = d.bbox[k];
    const c0 = Math.max(0, Math.floor((x0 - MIN_LON) / RES));
    const c1 = Math.min(COLS - 1, Math.floor((x1 - MIN_LON) / RES));
    const r0 = Math.max(0, Math.floor((y0 - MIN_LAT) / RES));
    const r1 = Math.min(ROWS - 1, Math.floor((y1 - MIN_LAT) / RES));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        if (pipPolygon(cellLon(c), cellLat(r), rings)) {
          const w = cosLat(r);
          cells.push([r * COLS + c, w]);
          wsum += w;
        }
      }
  });
  if (cells.length === 0) {
    // district smaller than one cell: put it on the cell containing its first vertex
    const p = d.polys[0][0][0];
    const r = Math.min(ROWS - 1, Math.max(0, Math.floor((p[1] - MIN_LAT) / RES)));
    const c = Math.min(COLS - 1, Math.max(0, Math.floor((p[0] - MIN_LON) / RES)));
    population[r * COLS + c] += d.pop;
    placedTotal += d.pop;
    continue;
  }
  for (const [i, w] of cells) population[i] += (d.pop * w) / wsum;
  placedTotal += d.pop;
}
let gridTotal = 0;
for (let i = 0; i < population.length; i++) gridTotal += population[i];
console.log(`  grid population ${Math.round(gridTotal).toLocaleString('en-IN')} (placed ${Math.round(placedTotal).toLocaleString('en-IN')})`);

// ---------------------------------------------------------------------------------------------
// 4. grid asset
// ---------------------------------------------------------------------------------------------
const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');
const grid = {
  version: 1,
  tier: 'fallback',
  rows: ROWS,
  cols: COLS,
  minLat: MIN_LAT,
  minLon: MIN_LON,
  resDeg: RES,
  encoding: { elevationM: 'int16-le base64, row-major, row 0 = south', population: 'float32-le base64, persons per cell', landMask: 'uint8 base64, 1 = inside India outline', coastMask: 'uint8 base64, 1 = India land cell touching sea' },
  elevationM: b64(elevation),
  population: b64(new Float32Array(population)),
  landMask: b64(land),
  coastMask: b64(coast),
  meta: {
    populationSource: 'Census of India 2011 district totals (nishusharma1608/India-Census-2011-Analysis), spread uniformly over GADM 2.x district polygons (geohacker/india), re-normalised so every state total is preserved.',
    populationYear: 2011,
    populationResolutionNote: 'Uniform density inside each district: cities are NOT concentrated. The specified WorldPop 2020 1 km raster was unreachable at build time.',
    elevationSource: 'ETOPO1 as 10 arc-minute grid (fatiando-data/earth-topography-10arcmin), bilinear-resampled to 0.05 degrees.',
    elevationResolutionNote: 'True resolution is about 18 km: valleys, embankments and river-bank heights are averaged away. Flood and surge extents are indicative only. The specified Copernicus 90 m DEM was unreachable at build time.',
    outlineSource: 'Natural Earth 10m admin-0, India point of view.',
    totalPopulation: Math.round(gridTotal),
  },
};
writeFileSync(join(out, 'india-grid.json'), JSON.stringify(grid));
console.log('  india-grid.json', kb(join(out, 'india-grid.json')));

// ---------------------------------------------------------------------------------------------
// 5. roads, rivers, shelters / settlements
// ---------------------------------------------------------------------------------------------
console.log('roads ...');
const roadsSrc = readJSON('ne/ne_10m_roads.geojson');
const roadFeatures = [];
for (const f of roadsSrc.features) {
  const g = f.geometry;
  const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  const kept = lines.filter((l) => l.some((p) => p[0] >= MIN_LON && p[0] <= MAX_LON && p[1] >= MIN_LAT && p[1] <= MAX_LAT && insideIndia(p[0], p[1])));
  if (kept.length === 0 || f.properties.type === 'Track') continue;
  for (const l of kept) {
    roadFeatures.push({
      type: 'Feature',
      properties: { name: f.properties.name || f.properties.label || '', kind: f.properties.type === 'Major Highway' ? 'major' : 'road', ref: f.properties.label2 || '' },
      geometry: { type: 'LineString', coordinates: l.map((p) => [round(p[0], 4), round(p[1], 4)]) },
    });
  }
}
writeFileSync(join(out, 'india-roads.geojson'), JSON.stringify({ type: 'FeatureCollection', features: roadFeatures }));
console.log(`  india-roads.geojson ${roadFeatures.length} lines`, kb(join(out, 'india-roads.geojson')));

console.log('rivers ...');
const riversSrc = readJSON('ne/ne_10m_rivers_lake_centerlines.geojson');
const riverFeatures = [];
for (const f of riversSrc.features) {
  const g = f.geometry;
  const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  for (const l of lines) {
    if (!l.some((p) => p[0] >= MIN_LON && p[0] <= MAX_LON && p[1] >= MIN_LAT && p[1] <= MAX_LAT)) continue;
    riverFeatures.push({
      type: 'Feature',
      properties: { name: f.properties.name_en || f.properties.name || '', scalerank: f.properties.scalerank },
      geometry: { type: 'LineString', coordinates: l.map((p) => [round(p[0], 4), round(p[1], 4)]) },
    });
  }
}
writeFileSync(join(out, 'india-rivers.geojson'), JSON.stringify({ type: 'FeatureCollection', features: riverFeatures }));
console.log(`  india-rivers.geojson ${riverFeatures.length} lines`, kb(join(out, 'india-rivers.geojson')));

console.log('shelters ...');
const SHELTER_CAPACITY_FRACTION = 0.1; // ASSUMPTION: a town can shelter 10% of its population (no real shelter inventory available)
const SHELTER_MIN_POP = 50000;
const placesSrc = readJSON('ne/ne_10m_populated_places_simple.geojson');
const shelterFeatures = placesSrc.features
  .filter((f) => f.properties.iso_a2 === 'IN' && f.properties.pop_max >= SHELTER_MIN_POP)
  .map((f, i) => ({
    type: 'Feature',
    properties: {
      id: `place-${i}`,
      name: f.properties.name,
      population: f.properties.pop_max,
      capacity: Math.round(f.properties.pop_max * SHELTER_CAPACITY_FRACTION),
      state: f.properties.adm1name,
      capacityBasis: 'assumed: 10% of town population',
    },
    geometry: { type: 'Point', coordinates: [round(f.properties.longitude, 4), round(f.properties.latitude, 4)] },
  }));
writeFileSync(
  join(out, 'india-shelters.geojson'),
  JSON.stringify({
    type: 'FeatureCollection',
    metadata: { source: 'Natural Earth 10m populated places (pop_max >= 50,000)', note: 'Stand-in for the OSM school / community centre / hospital extract, which was unreachable at build time. Capacities are assumed (10% of population).' },
    features: shelterFeatures,
  }),
);
console.log(`  india-shelters.geojson ${shelterFeatures.length} places`, kb(join(out, 'india-shelters.geojson')));

writeFileSync(
  join(out, 'data-manifest.json'),
  JSON.stringify(
    {
      tier: 'fallback',
      built: new Date().toISOString().slice(0, 10),
      files: ['india-admin0.geojson', 'india-admin1.geojson', 'india-roads.geojson', 'india-rivers.geojson', 'india-shelters.geojson', 'india-grid.json'],
      notice:
        'Fallback data tier: population is Census 2011 at district resolution (uniform within district); elevation is ETOPO1 at ~18 km; roads are the Natural Earth national-highway skeleton; shelters are towns of 50,000+ with an assumed capacity. Treat map-path outputs as indicative.',
    },
    null,
    2,
  ),
);
console.log('done');
