import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { MapScenario, Plan } from '../types';
import { useApp } from '../store';
import { migratePlan } from '../utils/migrate';

interface WayfarerDB extends DBSchema {
  plans: { key: string; value: Plan; indexes: { 'by-updated': number } };
  scenarios: { key: string; value: MapScenario };
  settings: { key: string; value: { name: string; value: unknown } };
}

const DB_NAME = 'wayfarer-db';
const AUTOSAVE_DEBOUNCE_MS = 500;

let dbPromise: Promise<IDBPDatabase<WayfarerDB>> | null = null;

function db(): Promise<IDBPDatabase<WayfarerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<WayfarerDB>(DB_NAME, 1, {
      upgrade(d) {
        const plans = d.createObjectStore('plans', { keyPath: 'id' });
        plans.createIndex('by-updated', 'updatedAt');
        d.createObjectStore('scenarios', { keyPath: 'id' });
        d.createObjectStore('settings', { keyPath: 'name' });
      },
    });
  }
  return dbPromise;
}

export async function savePlan(plan: Plan): Promise<void> {
  await (await db()).put('plans', plan);
}

export async function loadLastPlan(): Promise<Plan | null> {
  const d = await db();
  const tx = d.transaction('plans', 'readonly');
  const cursor = await tx.store.index('by-updated').openCursor(null, 'prev');
  return cursor ? cursor.value : null;
}

export async function listPlans(): Promise<Plan[]> {
  const all = await (await db()).getAllFromIndex('plans', 'by-updated');
  return all.reverse();
}

export async function deletePlan(id: string): Promise<void> {
  await (await db()).delete('plans', id);
}

export async function saveScenario(s: MapScenario): Promise<void> {
  await (await db()).put('scenarios', s);
}

export async function loadLastScenario(): Promise<MapScenario | null> {
  const all = await (await db()).getAll('scenarios');
  if (all.length === 0) return null;
  return all.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
}

export async function getSetting<T>(name: string): Promise<T | undefined> {
  const row = await (await db()).get('settings', name);
  return row?.value as T | undefined;
}

export async function setSetting(name: string, value: unknown): Promise<void> {
  await (await db()).put('settings', { name, value });
}

/** Plain-JSON snapshot of a plan. Results are not persisted: they are cheap to regenerate from the seed. */
export function exportPlanJSON(plan: Plan): string {
  return JSON.stringify(plan, null, 2);
}

export function importPlanJSON(text: string): Plan {
  const parsed = JSON.parse(text) as Partial<Plan>;
  if ((![1, 2].includes(parsed.version as number)) || !Array.isArray(parsed.doors) || !Array.isArray(parsed.clusters)) {
    throw new Error('Not a WayFarer plan file (expected a plan with doors and people areas).');
  }
  return migratePlan(parsed as Plan);
}

/**
 * Restore the last-used plan into the store, then autosave every plan edit with a 500 ms debounce.
 * Persistence is best-effort: a failure (private mode, quota) must never break the app.
 */
export async function initPersistence(): Promise<void> {
  const store = useApp;
  try {
    const [plan, scenario, analyst, mentor] = await Promise.all([
      loadLastPlan(),
      loadLastScenario(),
      getSetting<string>('analystName'),
      getSetting<string>('mentorName'),
    ]);
    if (plan) store.setState({ plan: migratePlan(plan), source: plan.source });
    if (scenario) store.setState({ scenario });
    if (analyst || mentor) store.setState({ analystName: analyst ?? '', mentorName: mentor ?? '' });
  } catch (e) {
    console.warn('Persistence restore failed; continuing without it.', e);
  } finally {
    store.getState().setHydrated();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPlan: Plan | null = store.getState().plan;
  let lastScenario: MapScenario | null = store.getState().scenario;
  let lastNames = `${store.getState().analystName}|${store.getState().mentorName}`;

  store.subscribe((s) => {
    const names = `${s.analystName}|${s.mentorName}`;
    if (s.plan === lastPlan && s.scenario === lastScenario && names === lastNames) return;
    lastPlan = s.plan;
    lastScenario = s.scenario;
    lastNames = names;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const cur = store.getState();
      const jobs: Promise<unknown>[] = [];
      if (cur.plan) jobs.push(savePlan(cur.plan));
      if (cur.scenario) jobs.push(saveScenario(cur.scenario));
      jobs.push(setSetting('analystName', cur.analystName), setSetting('mentorName', cur.mentorName));
      Promise.all(jobs).catch((e) => console.warn('Autosave failed.', e));
    }, AUTOSAVE_DEBOUNCE_MS);
  });
}
