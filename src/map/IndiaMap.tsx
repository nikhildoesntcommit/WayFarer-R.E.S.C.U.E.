import { assetUrl } from '../utils/url';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { IndiaData } from './data/loader';
import { EQ_COLOURS, WATER_COLOURS, WIND_COLOURS, type Overlay } from './overlay';

const INDIA_BOUNDS: [[number, number], [number, number]] = [[67.5, 6.0], [98.0, 37.8]];
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

interface Props {
  data: IndiaData;
  pin?: { lat: number; lon: number } | null;
  overlay?: Overlay | null;
  kind?: 'earthquake' | 'flood' | 'cyclone';
  onPick?: (lat: number, lon: number) => void;
  /** frame the overlay when it changes */
  fitOverlay?: boolean;
  onUnavailable?: (reason: string) => void;
  /** animated replay: show only cells the hazard has reached by this many seconds after the alert (null = show everything) */
  clockS?: number | null;
  /** cyclone: planned track and the eye with its gale-force radius */
  track?: { lat: number; lon: number }[] | null;
  eye?: { lat: number; lon: number; radiusKm: number } | null;
}

function circle(lat: number, lon: number, rKm: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const ring: GeoJSON.Position[] = [];
  for (let k = 0; k <= 48; k++) {
    const a = (k / 48) * 2 * Math.PI;
    ring.push([lon + (rKm * Math.sin(a)) / (111.195 * Math.cos((lat * Math.PI) / 180)), lat + (rKm * Math.cos(a)) / 111.195]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/** Offline vector map of India (no tiles, no glyph server): outline, states, roads, rivers, towns and the hazard overlay. */
export function IndiaMap({ data, pin, overlay, kind, onPick, fitOverlay, onUnavailable, clockS = null, track = null, eye = null }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const labels = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const trackRef = useRef(track);
  trackRef.current = track;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!host.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: host.current,
        style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#F4EBDC' } }] },
        bounds: INDIA_BOUNDS,
        fitBoundsOptions: { padding: 12 },
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        maxBounds: [[55, -2], [110, 45]],
      });
    } catch (e) {
      onUnavailable?.(`The map could not start (${(e as Error).message}). WebGL may be disabled on this device.`);
      return;
    }
    map.current = m;
    m.touchZoomRotate.disableRotation();
    m.on('error', (ev) => {
      const msg = String((ev as { error?: Error }).error?.message ?? '');
      if (/webgl/i.test(msg)) onUnavailable?.('This device cannot draw the map (WebGL is unavailable).');
    });
    m.on('load', () => {
      m.addSource('admin0', { type: 'geojson', data: assetUrl('data/india-admin0.geojson') });
      m.addSource('admin1', { type: 'geojson', data: assetUrl('data/india-admin1.geojson') });
      m.addSource('rivers', { type: 'geojson', data: data.rivers as unknown as GeoJSON.FeatureCollection });
      m.addSource('roads', { type: 'geojson', data: data.roads as unknown as GeoJSON.FeatureCollection });
      m.addSource('towns', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: data.shelters.map((s) => ({ type: 'Feature', properties: { name: s.name }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })) },
      });
      m.addSource('cells', { type: 'geojson', data: EMPTY });
      m.addSource('contours', { type: 'geojson', data: EMPTY });
      m.addSource('track', { type: 'geojson', data: EMPTY });
      m.addSource('eye', { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'admin0-fill', type: 'fill', source: 'admin0', paint: { 'fill-color': '#EDE2CC' } });
      m.addLayer({ id: 'admin1-line', type: 'line', source: 'admin1', paint: { 'line-color': '#D9CDB5', 'line-width': 0.8 } });
      m.addLayer({ id: 'rivers', type: 'line', source: 'rivers', paint: { 'line-color': '#7A9BB5', 'line-width': 0.9, 'line-opacity': 0.8 } });
      m.addLayer({ id: 'roads', type: 'line', source: 'roads', paint: { 'line-color': '#7A8694', 'line-width': 0.8 } });
      m.addLayer({
        id: 'cells-fill', type: 'fill', source: 'cells',
        paint: {
          'fill-opacity': 0.62,
          'fill-color': [
            'case',
            ['==', ['get', 'band'], 10], WATER_COLOURS[2]!,
            ['match', ['get', 'kind'],
              'earthquake', ['step', ['get', 'band'], EQ_COLOURS[0]!, 1, EQ_COLOURS[1]!, 2, EQ_COLOURS[2]!, 3, EQ_COLOURS[3]!, 4, EQ_COLOURS[4]!, 5, EQ_COLOURS[5]!],
              'flood', ['step', ['get', 'band'], WATER_COLOURS[0]!, 1, WATER_COLOURS[0]!, 2, WATER_COLOURS[1]!, 3, WATER_COLOURS[2]!, 4, WATER_COLOURS[3]!],
              ['step', ['get', 'band'], WIND_COLOURS[0]!, 1, WIND_COLOURS[1]!, 2, WIND_COLOURS[2]!, 3, WIND_COLOURS[3]!]],
          ],
        },
      });
      m.addLayer({ id: 'contours', type: 'line', source: 'contours', paint: { 'line-color': '#C8381C', 'line-width': 1, 'line-opacity': 0.7 } });
      m.addLayer({ id: 'eye-fill', type: 'fill', source: 'eye', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#C8381C', 'fill-opacity': 0.12 } });
      m.addLayer({ id: 'eye-line', type: 'line', source: 'eye', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': '#C8381C', 'line-width': 1.5 } });
      m.addLayer({ id: 'track-line', type: 'line', source: 'track', paint: { 'line-color': '#182230', 'line-width': 1.6, 'line-dasharray': [2, 2] } });
      m.addLayer({ id: 'eye-dot', type: 'circle', source: 'eye', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#182230', 'circle-stroke-color': '#F4EBDC', 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'admin0-line', type: 'line', source: 'admin0', paint: { 'line-color': '#182230', 'line-width': 1.2 } });
      m.addLayer({ id: 'towns', type: 'circle', source: 'towns', paint: { 'circle-radius': 2.2, 'circle-color': '#B8862A' } });
      setReady(true);
    });
    m.on('click', (e) => onPickRef.current?.(e.lngLat.lat, e.lngLat.lng));

    // town names as DOM labels: the offline style has no glyph server
    const top = [...data.shelters].sort((a, b) => b.population - a.population).slice(0, 28);
    labels.current = top.map((t) => {
      const el = document.createElement('span');
      el.className = 'map-town';
      el.textContent = t.name;
      return new maplibregl.Marker({ element: el, anchor: 'left', offset: [5, 0] }).setLngLat([t.lon, t.lat]).addTo(m);
    });
    return () => {
      labels.current.forEach((l) => l.remove());
      labels.current = [];
      marker.current?.remove();
      marker.current = null;
      m.remove();
      map.current = null;
      setReady(false);
    };
    // the data object is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // pin
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!pin) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      const el = document.createElement('div');
      el.className = 'map-pin';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'Origin');
      marker.current = new maplibregl.Marker({ element: el }).setLngLat([pin.lon, pin.lat]).addTo(m);
    } else marker.current.setLngLat([pin.lon, pin.lat]);
  }, [pin, ready]);

  // overlay
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const cells = (m.getSource('cells') as maplibregl.GeoJSONSource | undefined);
    const lines = (m.getSource('contours') as maplibregl.GeoJSONSource | undefined);
    if (!cells || !lines) return;
    if (!overlay) {
      cells.setData(EMPTY);
      lines.setData(EMPTY);
      return;
    }
    cells.setData({ ...overlay.cells, features: overlay.cells.features.map((f) => ({ ...f, properties: { ...f.properties, kind } })) });
    lines.setData(overlay.contours);
    if (fitOverlay && overlay.cells.features.length > 0) {
      const b = new maplibregl.LngLatBounds();
      for (const f of overlay.cells.features) for (const p of f.geometry.coordinates[0]!) b.extend(p as [number, number]);
      if (clockS !== null) for (const p of trackRef.current ?? []) b.extend([p.lon, p.lat]);
      m.fitBounds(b, { padding: 40, maxZoom: 8, duration: 0 });
    }
    // clockS is read only to decide whether to include the track in the fit; re-running every clock tick would refit the camera 60 times a second
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, ready, kind, fitOverlay]);

  // animated replay: reveal cells by arrival time, hide the final contour lines while it runs
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setFilter('cells-fill', clockS === null ? null : ['<=', ['get', 't'], clockS]);
    m.setLayoutProperty('contours', 'visibility', clockS === null ? 'visible' : 'none');
  }, [clockS, ready, overlay]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const t = m.getSource('track') as maplibregl.GeoJSONSource | undefined;
    t?.setData(track && track.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: track.map((p) => [p.lon, p.lat]) } } : EMPTY);
  }, [track, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const e = m.getSource('eye') as maplibregl.GeoJSONSource | undefined;
    e?.setData(
      eye
        ? { type: 'FeatureCollection', features: [...(eye.radiusKm > 0 ? [circle(eye.lat, eye.lon, eye.radiusKm)] : []), { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [eye.lon, eye.lat] } }] }
        : EMPTY,
    );
  }, [eye, ready]);

  return <div ref={host} className="india-map" data-testid="india-map" data-ready={ready ? '1' : '0'} />;
}
