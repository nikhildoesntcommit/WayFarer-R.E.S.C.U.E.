import { BSI, DENSITY, FIRE, GROUPS, DOOR, PRE_MOVEMENT, ROUTE, SIM, WALKING_SPEED, WEIDMANN } from '../constants';
import type { Cell, GroupMix, Plan } from '../types';
import { pointInPolygon, polygonCentroid } from '../utils/geo';
import type { SeededRandom } from '../utils/seeds';
import { doorCapacity } from './doors';
import { cellCentre, cellOfPoint, rasterize, type Grid } from './grid';
import { buildHazardRuntime, epochIndexAt, inHazard, smokeDoseRate, type HazardOptions, type HazardRuntime } from './hazards';
import { weidmannSpeed } from './speed';
import { peopleSources } from '../utils/sources';

export interface ClusterInfo {
  id: string;
  label: string;
  people: number;
  mix: GroupMix;
  /** Flat indices of the walkable cells inside the cluster polygon (or within a hotspot's radius). */
  cells: number[];
  /** Hotspots only: cumulative sampling weights over `cells` (bunched around the centre). Absent = uniform. */
  cum?: number[];
  /** Exit indices that at least one of the cluster's cells can reach (before any hazard fires). */
  reachableExitIdx: number[];
  preferredExitIdx: number;
}

/** Everything that is identical across Monte Carlo runs of one plan (grid, routing fields, capacities). */
export interface SimContext {
  plan: Plan;
  grid: Grid;
  exitIds: string[];
  exitIndex: Map<string, number>;
  /** persons/s per exit */
  capacity: Float64Array;
  /** per exit: 1 where the flat cell is one of that exit's opening cells */
  exitCellFlag: Uint8Array[];
  hazards: HazardRuntime;
  clusters: ClusterInfo[];
  unreachableClusters: string[];
  totalPeople: number;
}

export interface AgentSampling {
  clusterId: string;
  clusterIdx: number;
  startCell: Cell;
  x: number;
  y: number;
  freeSpeed: number; // m/s
  preMovementDelay: number; // s (already includes the plan's alarm time)
  exitChoice: string; // door ID, '' when no exit is reachable
  exitIdx: number;
  /** Fixed per-exit misjudgement of travel time (lognormal, median 1). Length = number of exits. */
  perceive: number[];
  /** Keeps reconsidering the exit while walking (false for people following a manual cluster -> exit assignment). */
  replans: boolean;
}

export interface TraceFrame {
  t: number;
  pos: Float32Array; // x0,y0,x1,y1,...
  status: Uint8Array; // 0 waiting, 1 walking, 2 queueing, 3 out, 4 casualty, 5 stuck
}

export interface RunResult {
  evacuationTimes: number[]; // per evacuated person
  conservationOk: boolean;
  casualties: number;
  remaining: number;
  exitLoads: Map<string, number>;
  densityAccum: Float32Array; // per-cell PEAK local density over the run (persons/m²)
  peakDensity: number;
  peakDensityCell: Cell;
  // ---- extras used by the analysis layer ----
  lastCompletion: number;
  critSeconds: Float32Array; // per cell: seconds the local density exceeded BSI.rhoCritical
  casualtyCells: { x: number; y: number }[];
  clusterTimeSum: Float64Array;
  clusterTimeCount: Float64Array;
  clusterExitCounts: number[][]; // [cluster][exit]
  queueWaitSum: Float64Array; // per exit
  queueCount: Float64Array;
  queueMax: Float64Array;
  wallViolations: number;
  trace?: TraceFrame[];
}

export interface SimOptions {
  /** V1 behaviour: everyone walks to the exit that was quickest at the start and never reconsiders (for comparisons and tests). */
  staticRouting?: boolean;
  trace?: boolean;
  /** Test hook: no pre-movement delay, everyone starts at t = alarm time. */
  noPreMovement?: boolean;
  /** Test hook: treat every person as an individual (no companion groups). */
  noGroups?: boolean;
}

export function buildSimContext(plan: Plan, hazardOpts: HazardOptions = {}): SimContext {
  const grid = rasterize(plan);
  for (const d of plan.doors) doorCapacity(d.widthM, DOOR.specificFlowDefault, d.id); // throws InvalidDoorError
  const exitIds = plan.doors.filter((d) => d.isExit && grid.exits.has(d.id)).map((d) => d.id);
  const exitIndex = new Map(exitIds.map((id, i) => [id, i]));
  const capacity = new Float64Array(exitIds.length);
  const exitCellFlag = exitIds.map((id, k) => {
    const flag = new Uint8Array(grid.rows * grid.cols);
    for (const c of grid.exits.get(id)!) flag[c.row * grid.cols + c.col] = 1;
    const door = plan.doors.find((d) => d.id === id)!;
    capacity[k] = doorCapacity(door.widthM, DOOR.specificFlowDefault, id);
    return flag;
  });
  const hazards = buildHazardRuntime(plan, grid, exitIds, hazardOpts);
  const T0 = hazards.epochs[0]!.T;
  const walk0 = hazards.epochs[0]!.walk;

  const clusters: ClusterInfo[] = [];
  const unreachableClusters: string[] = [];
  const claimed = new Uint8Array(walk0.length); // a floor cell belongs to ONE people area, so overlapping areas cannot double-count
  for (const cl of peopleSources(plan)) {
    const cells: number[] = [];
    let cum: number[] | undefined;
    if (cl.hotspot) {
      const { at, radiusM } = cl.hotspot;
      const sigma = Math.max(1e-6, radiusM / 2);
      const w: number[] = [];
      for (let i = 0; i < walk0.length; i++) {
        if (!walk0[i]) continue;
        const c = cellCentre(grid, i);
        const d2 = (c.x - at.x) ** 2 + (c.y - at.y) ** 2;
        if (d2 <= radiusM * radiusM) { cells.push(i); w.push(Math.exp(-d2 / (2 * sigma * sigma))); }
      }
      if (cells.length > 0) {
        const total = w.reduce((a, b) => a + b, 0);
        let acc = 0;
        cum = w.map((v) => (acc += v / total));
        cum[cum.length - 1] = 1;
      }
    } else {
      for (let i = 0; i < walk0.length; i++) {
        if (walk0[i] && !claimed[i] && pointInPolygon(cellCentre(grid, i), cl.polygonWorld)) { cells.push(i); claimed[i] = 1; }
      }
    }
    if (cells.length === 0) {
      const ctr = cl.hotspot ? cl.hotspot.at : polygonCentroid(cl.polygonWorld);
      const c = cellOfPoint(grid, ctr.x, ctr.y);
      if (c && walk0[c.row * grid.cols + c.col]) cells.push(c.row * grid.cols + c.col);
    }
    const reachable: number[] = [];
    for (let e = 0; e < exitIds.length; e++) {
      if (cells.some((i) => Number.isFinite(T0[e]![i]))) reachable.push(e);
    }
    if (reachable.length === 0) unreachableClusters.push(cl.id);
    const pref = plan.clusterExitAssignment?.[cl.id];
    clusters.push({
      id: cl.id,
      label: cl.label,
      people: Math.max(0, Math.round(cl.people)),
      mix: cl.groupMix,
      cells,
      cum,
      reachableExitIdx: reachable,
      preferredExitIdx: pref !== undefined ? (exitIndex.get(pref) ?? -1) : -1,
    });
  }
  return {
    plan, grid, exitIds, exitIndex, capacity, exitCellFlag, hazards, clusters, unreachableClusters,
    totalPeople: clusters.reduce((s, c) => s + c.people, 0),
  };
}

type Kind = 'adult' | 'child' | 'elderly' | 'wheelchair';
const SPEED_PARAMS: Record<Kind, [number, number, number, number]> = {
  adult: [WALKING_SPEED.adultMean, WALKING_SPEED.adultStdDev, WALKING_SPEED.adultMin, WALKING_SPEED.adultMax],
  child: [WALKING_SPEED.childMean, WALKING_SPEED.childStdDev, WALKING_SPEED.childMin, WALKING_SPEED.childMax],
  elderly: [WALKING_SPEED.elderlyMean, WALKING_SPEED.elderlyStdDev, WALKING_SPEED.elderlyMin, WALKING_SPEED.elderlyMax],
  wheelchair: [WALKING_SPEED.wheelchairMean, WALKING_SPEED.wheelchairStdDev, WALKING_SPEED.wheelchairMin, WALKING_SPEED.wheelchairMax],
};

function pickKind(mix: GroupMix, u: number): Kind {
  const total = mix.adult + mix.child + mix.elderly + mix.wheelchair;
  if (total <= 0) return 'adult';
  let acc = 0;
  for (const k of ['adult', 'child', 'elderly', 'wheelchair'] as Kind[]) {
    acc += mix[k] / total;
    if (u < acc) return k;
  }
  return 'adult';
}

/** Value of an exit's field at a cell, falling back to the best 4-neighbour when the cell itself is blocked. */
function fieldAt(T: Float32Array, grid: Grid, idx: number): number {
  const v = T[idx]!;
  if (Number.isFinite(v)) return v;
  const { rows, cols } = grid;
  const r = (idx / cols) | 0;
  const c = idx - r * cols;
  let best = Infinity;
  if (r > 0) best = Math.min(best, T[idx - cols]!);
  if (r < rows - 1) best = Math.min(best, T[idx + cols]!);
  if (c > 0) best = Math.min(best, T[idx - 1]!);
  if (c < cols - 1) best = Math.min(best, T[idx + 1]!);
  return best;
}

/**
 * Real crowds are not independent individuals: about 70 % of pedestrians move in groups, mostly pairs (Moussaïd et al. 2010).
 * Companions start together, wait for the slowest to be ready, walk at the pace of the slowest and leave by the same exit
 * (families, friends, a teacher with pupils). Draws are made in a fixed order so that paired runs stay paired.
 */
function formGroups(out: AgentSampling[], start: number, rng: SeededRandom, noPre: boolean): void {
  let i = start;
  while (i < out.length) {
    const u = rng.next();
    let size = u < GROUPS.size1 ? 1 : u < GROUPS.size1 + GROUPS.size2 ? 2 : u < GROUPS.size1 + GROUPS.size2 + GROUPS.size3 ? 3 : 4;
    size = Math.min(size, out.length - i);
    if (size > 1) {
      const lead = out[i]!;
      let slowest = lead.freeSpeed;
      let latest = lead.preMovementDelay;
      for (let k = 1; k < size; k++) {
        slowest = Math.min(slowest, out[i + k]!.freeSpeed);
        latest = Math.max(latest, out[i + k]!.preMovementDelay);
      }
      for (let k = 0; k < size; k++) {
        const a = out[i + k]!;
        a.freeSpeed = slowest;
        a.preMovementDelay = noPre ? a.preMovementDelay : latest + GROUPS.gatherS;
        if (k > 0) {
          a.startCell = lead.startCell;
          a.x = lead.x + (rng.next() - 0.5) * GROUPS.spreadM;
          a.y = lead.y + (rng.next() - 0.5) * GROUPS.spreadM;
          a.exitChoice = lead.exitChoice; a.exitIdx = lead.exitIdx; a.perceive = lead.perceive; a.replans = lead.replans;
        }
      }
    }
    i += size;
  }
}

export function sampleAgents(ctx: SimContext, rng: SeededRandom, opts: SimOptions = {}): AgentSampling[] {
  const { grid, plan } = ctx;
  const T0 = ctx.hazards.epochs[0]!.T;
  const m = grid.metresPerCell;
  const out: AgentSampling[] = [];
  ctx.clusters.forEach((cl, ci) => {
    const clusterStart = out.length;
    for (let k = 0; k < cl.people; k++) {
      if (cl.cells.length === 0) {
        out.push({ clusterId: cl.id, clusterIdx: ci, startCell: { row: 0, col: 0 }, x: 0, y: 0, freeSpeed: WEIDMANN.v0, preMovementDelay: 0, exitChoice: '', exitIdx: -1, perceive: [], replans: false });
        continue;
      }
      let pick: number;
      if (cl.cum) {
        const u = rng.next();
        let lo = 0;
        let hi = cl.cum.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (cl.cum[mid]! < u) lo = mid + 1; else hi = mid; }
        pick = lo;
      } else pick = rng.int(cl.cells.length);
      const idx = cl.cells[pick]!;
      const row = (idx / grid.cols) | 0;
      const col = idx - row * grid.cols;
      const x = grid.originX + (col + rng.next()) * m;
      const y = grid.originY + (row + rng.next()) * m;
      const kind = pickKind(cl.mix, rng.next());
      const [mean, sd, lo, hi] = SPEED_PARAMS[kind];
      const freeSpeed = rng.truncatedNormal(mean, sd, lo, hi);
      const delay = opts.noPreMovement ? 0 : rng.lognormal(PRE_MOVEMENT.median, PRE_MOVEMENT.sigma);
      // Always draw the same random numbers, so a static and a dynamic run of one seed are paired.
      const perceiveRaw = ctx.exitIds.map(() => rng.lognormal(1, ROUTE.perceptionSigma));
      const replanRoll = rng.next();
      const staticMode = opts.staticRouting === true;
      const perceive = staticMode ? perceiveRaw.map(() => 1) : perceiveRaw;
      const forced = cl.preferredExitIdx >= 0 && Number.isFinite(fieldAt(T0[cl.preferredExitIdx]!, grid, idx));
      let exitIdx = -1;
      if (forced) exitIdx = cl.preferredExitIdx;
      else {
        let best = Infinity;
        for (let e = 0; e < ctx.exitIds.length; e++) {
          const v = fieldAt(T0[e]!, grid, idx) * perceive[e]!;
          if (v < best) { best = v; exitIdx = e; }
        }
      }
      const replans = !staticMode && !forced && replanRoll < ROUTE.replannerShare;
      out.push({
        clusterId: cl.id, clusterIdx: ci, startCell: { row, col }, x, y, freeSpeed,
        preMovementDelay: plan.alarmTimeSeconds + delay,
        exitChoice: exitIdx >= 0 ? ctx.exitIds[exitIdx]! : '', exitIdx, perceive, replans,
      });
    }
    if (cl.cells.length > 0 && opts.noGroups !== true) formGroups(out, clusterStart, rng, opts.noPreMovement === true);
  });
  return out;
}

const PENDING = 0;
const MOVING = 1;
const QUEUED = 2;
const OUT = 3;
const DEAD = 4;
const STUCK = 5;

const NB_DR = [-1, -1, -1, 0, 0, 1, 1, 1];
const NB_DC = [-1, 0, 1, -1, 1, -1, 0, 1];

export function simulateRun(ctx: SimContext, agents: AgentSampling[], opts: SimOptions = {}): RunResult {
  const { grid, hazards } = ctx;
  const { rows, cols } = grid;
  const m = grid.metresPerCell;
  const N = agents.length;
  const E = ctx.exitIds.length;
  const dt = SIM.dtS;
  const rad = DENSITY.neighbourhoodRadiusM;
  const rad2 = rad * rad;
  const area = Math.PI * rad2;
  const sepM = SIM.separationM;
  const sep2 = sepM * sepM;

  const x = new Float64Array(N);
  const y = new Float64Array(N);
  const cell = new Int32Array(N);
  const status = new Uint8Array(N);
  const exitIdx = new Int32Array(N);
  const arrival = new Float64Array(N);
  const evacT = new Float64Array(N).fill(NaN);
  const startT = new Float64Array(N);
  const free = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = agents[i]!;
    x[i] = a.x;
    y[i] = a.y;
    cell[i] = a.startCell.row * cols + a.startCell.col;
    exitIdx[i] = a.exitIdx;
    startT[i] = opts.noPreMovement ? ctx.plan.alarmTimeSeconds : a.preMovementDelay;
    free[i] = a.freeSpeed;
    status[i] = a.exitIdx < 0 ? STUCK : PENDING;
  }

  const queues: number[][] = Array.from({ length: E }, () => []);
  const qHead = new Int32Array(E);
  const nextFree = new Float64Array(E);
  const exitLoad = new Float64Array(E);
  const queueWaitSum = new Float64Array(E);
  const queueCount = new Float64Array(E);
  const queueMax = new Float64Array(E);
  const nCl = ctx.clusters.length;
  const clusterTimeSum = new Float64Array(nCl);
  const clusterTimeCount = new Float64Array(nCl);
  const clusterExitCounts = Array.from({ length: nCl }, () => new Array<number>(E).fill(0));
  const peak = new Float32Array(rows * cols);
  const crit = new Float32Array(rows * cols);
  const critStamp = new Int32Array(rows * cols).fill(-1);
  const casualtyCells: { x: number; y: number }[] = [];
  const dose = new Float32Array(N);
  const evacuationTimes: number[] = [];
  let casualties = 0;
  let lastCompletion = 0;
  let wallViolations = 0;
  let peakDensity = 0;
  let peakCell = 0;

  // spatial hash
  const nbx = Math.ceil((cols * m) / rad) + 2;
  const nby = Math.ceil((rows * m) / rad) + 2;
  const head = new Int32Array(nbx * nby).fill(-1);
  const headStamp = new Int32Array(nbx * nby).fill(-1);
  const nextInBucket = new Int32Array(N);
  const bucketOf = (px: number, py: number) => {
    const bx = Math.min(nbx - 1, Math.max(0, Math.floor((px - grid.originX) / rad) + 1));
    const by = Math.min(nby - 1, Math.max(0, Math.floor((py - grid.originY) / rad) + 1));
    return { bx, by };
  };

  let epochI = 0;
  let epoch = hazards.epochs[0]!;
  let active = 0;
  for (let i = 0; i < N; i++) if (status[i] === PENDING) active++;

  const trace: TraceFrame[] | undefined = opts.trace ? [] : undefined;
  const traceEvery = Math.max(1, Math.round(SIM.traceIntervalS / dt));
  const snapshot = (t: number) => {
    if (!trace || trace.length >= SIM.maxTraceFrames) return;
    const pos = new Float32Array(2 * N);
    for (let i = 0; i < N; i++) { pos[2 * i] = x[i]!; pos[2 * i + 1] = y[i]!; }
    trace.push({ t, pos, status: status.slice() });
  };

  /** Pick (or keep) an exit for agent i under the current epoch; mark it stuck if none can be reached. */
  const reroute = (i: number): void => {
    const cur = exitIdx[i]!;
    if (cur >= 0 && !epoch.blockedExits.has(ctx.exitIds[cur]!) && Number.isFinite(fieldAt(epoch.T[cur]!, grid, cell[i]!))) return;
    let best = -1;
    let bestT = Infinity;
    for (let e = 0; e < E; e++) {
      if (epoch.blockedExits.has(ctx.exitIds[e]!)) continue;
      const v = fieldAt(epoch.T[e]!, grid, cell[i]!);
      if (v < bestT) { bestT = v; best = e; }
    }
    exitIdx[i] = best;
    if (best < 0) {
      if (status[i] === MOVING || status[i] === PENDING || status[i] === QUEUED) active--;
      status[i] = STUCK;
    } else if (status[i] === QUEUED) status[i] = MOVING;
  };

  // ---- bounded-rational re-routing (V2) ----
  // Re-planners periodically compare "walking time + the queue I can see" for every exit and switch when another one
  // is clearly quicker. Hysteresis (margin, minimum gain, a turning-round penalty, a cap on changes of mind and a
  // commitment zone near the door) stops the whole crowd flip-flopping between exits.
  const dynamic = !opts.staticRouting && E > 1;
  const nextThink = new Float64Array(N);
  const switches = new Uint8Array(N);
  const queueEst = new Float64Array(E); // expected wait (s) at each exit as people currently in view would see it
  const enRoute = new Float64Array(E);
  let lastTick = -Infinity;
  for (let i = 0; i < N; i++) nextThink[i] = startT[i]! + ((i * 0.6180339887) % 1) * ROUTE.thinkIntervalS;
  const considerSwitch = (i: number): number => {
    const cur = exitIdx[i]!;
    const c = cell[i]!;
    if (!(fieldAt(epoch.T[cur]!, grid, c) > ROUTE.commitTimeS)) return cur; // close to the door (or no path): committed
    const per = agents[i]!.perceive;
    const cost = (e: number): number => {
      const tt = fieldAt(epoch.T[e]!, grid, c);
      if (!Number.isFinite(tt)) return Infinity;
      return tt * per[e]! + (tt <= ROUTE.viewTimeS ? queueEst[e]! : 0);
    };
    const here = cost(cur);
    let best = cur;
    let bestV = here;
    for (let e = 0; e < E; e++) {
      if (e === cur || epoch.blockedExits.has(ctx.exitIds[e]!)) continue;
      const v = cost(e) + ROUTE.switchPenaltyS;
      if (v < bestV) { bestV = v; best = e; }
    }
    return best !== cur && bestV < here * (1 - ROUTE.switchMargin) && here - bestV >= ROUTE.switchMinGainS ? best : cur;
  };

  let step = 0;
  snapshot(0);
  while (active > 0 && step * dt < SIM.maxTimeS) {
    step++;
    const t = step * dt;

    // ---- epoch change: re-route walkers, release queues at exits that just became unusable ----
    const ei = epochIndexAt(hazards, t);
    if (ei !== epochI) {
      const prevBlocked = epoch.blockedExits;
      epochI = ei;
      epoch = hazards.epochs[ei]!;
      for (let e = 0; e < E; e++) {
        if (epoch.blockedExits.has(ctx.exitIds[e]!) && !prevBlocked.has(ctx.exitIds[e]!)) {
          const q = queues[e]!;
          for (let k = qHead[e]!; k < q.length; k++) {
            const a = q[k]!;
            if (status[a] === QUEUED) status[a] = MOVING; // not served yet: back to walking, will re-route below
          }
          qHead[e] = q.length;
        }
      }
      for (let i = 0; i < N; i++) if (status[i] === MOVING) reroute(i);
    }

    // ---- hazards: anyone caught in an active hazard zone is a casualty ----
    if (hazards.zones.length > 0 || hazards.fires.length > 0) {
      for (let i = 0; i < N; i++) {
        const s = status[i]!;
        if (s === OUT || s === DEAD) continue;
        let dead = inHazard(hazards, x[i]!, y[i]!, cell[i]!, t);
        if (!dead && hazards.fires.length > 0) {
          // smoke: slows people, makes those still waiting leave, and harms by exposure time
          const rate = smokeDoseRate(hazards, cell[i]!, t);
          if (rate > 0) {
            dose[i] = dose[i]! + rate * dt;
            if (dose[i]! >= 1) dead = true;
            else if (s === PENDING && startT[i]! > t + FIRE.cueDelayS) startT[i] = t + FIRE.cueDelayS;
          }
        }
        if (dead) {
          if (s === PENDING || s === MOVING || s === QUEUED) active--;
          status[i] = DEAD;
          casualties++;
          casualtyCells.push({ x: x[i]!, y: y[i]! });
        }
      }
    }

    // ---- release agents whose pre-movement time has elapsed ----
    for (let i = 0; i < N; i++) {
      if (status[i] === PENDING && startT[i]! <= t) {
        status[i] = MOVING;
        reroute(i);
      }
    }

    // ---- once a second: how long is each exit's queue, as seen by someone close enough to look? ----
    if (dynamic && t - lastTick >= 1) {
      lastTick = t;
      enRoute.fill(0);
      for (let i = 0; i < N; i++) {
        if (status[i] !== MOVING) continue;
        const e = exitIdx[i]!;
        if (e >= 0 && fieldAt(epoch.T[e]!, grid, cell[i]!) <= ROUTE.viewTimeS) enRoute[e] = enRoute[e]! + 1;
      }
      for (let e = 0; e < E; e++) {
        const q = queues[e]!;
        let waiting = 0;
        for (let k = qHead[e]!; k < q.length; k++) if (status[q[k]!] === QUEUED) waiting++;
        queueEst[e] = (waiting + ROUTE.enRouteWeight * enRoute[e]!) / ctx.capacity[e]!;
      }
    }

    // ---- spatial hash of everyone on the floor (walking + queueing) ----
    for (let i = 0; i < N; i++) {
      const s = status[i]!;
      if (s !== MOVING && s !== QUEUED) continue;
      const { bx, by } = bucketOf(x[i]!, y[i]!);
      const b = by * nbx + bx;
      if (headStamp[b] !== step) { headStamp[b] = step; head[b] = -1; }
      nextInBucket[i] = head[b]!;
      head[b] = i;
    }

    // ---- density statistics + walking ----
    for (let i = 0; i < N; i++) {
      const s = status[i]!;
      if (s !== MOVING && s !== QUEUED) continue;
      const px = x[i]!;
      const py = y[i]!;
      const { bx, by } = bucketOf(px, py);
      let nAll = 0;
      let nMoving = 0;
      let pushX = 0;
      let pushY = 0;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const xx = bx + ox;
          const yy = by + oy;
          if (xx < 0 || yy < 0 || xx >= nbx || yy >= nby) continue;
          const b = yy * nbx + xx;
          if (headStamp[b] !== step) continue;
          for (let j = head[b]!; j >= 0; j = nextInBucket[j]!) {
            if (j === i) continue;
            const dx = x[j]! - px;
            const dy = y[j]! - py;
            const d2 = dx * dx + dy * dy;
            if (d2 <= rad2) {
              nAll++;
              if (status[j] === MOVING) nMoving++;
              if (d2 < sep2) {
                // bodies cannot overlap: push apart (half each; the neighbour pushes back when it is processed)
                const d = Math.sqrt(d2);
                const mag = (sepM - d) * 0.5;
                if (d > 1e-6) { pushX -= (dx / d) * mag; pushY -= (dy / d) * mag; }
                else { const a = i * 2.399963; pushX += Math.cos(a) * mag; pushY += Math.sin(a) * mag; }
              }
            }
          }
        }
      if (sepM > 0 && (pushX !== 0 || pushY !== 0)) {
        const nx = px + pushX;
        const ny = py + pushY;
        const nc = cellOfPoint(grid, nx, ny);
        if (nc && epoch.walk[nc.row * cols + nc.col]) { x[i] = nx; y[i] = ny; cell[i] = nc.row * cols + nc.col; }
      }
      const dStat = Math.min(WEIDMANN.rhoMax, nAll / area);
      const ci = cell[i]!;
      if (dStat > peak[ci]!) peak[ci] = dStat;
      if (dStat > peakDensity) { peakDensity = dStat; peakCell = ci; }
      if (dStat > BSI.rhoCritical && critStamp[ci] !== step) { critStamp[ci] = step; crit[ci] = crit[ci]! + dt; }
      if (s !== MOVING) continue;

      let e = exitIdx[i]!;
      if (dynamic && agents[i]!.replans && e >= 0 && t >= nextThink[i]! && switches[i]! < ROUTE.maxSwitches) {
        nextThink[i] = t + ROUTE.thinkIntervalS;
        const ne = considerSwitch(i);
        if (ne !== e) { exitIdx[i] = ne; switches[i] = switches[i]! + 1; e = ne; }
      }
      // arrived at the exit's opening?
      if (ctx.exitCellFlag[e]![ci]) {
        status[i] = QUEUED;
        arrival[i] = t;
        queues[e]!.push(i);
        continue;
      }
      const inSmoke = hazards.fires.length > 0 && smokeDoseRate(hazards, ci, t) > 0;
      const speed = Math.max(SIM.minSpeedMS, weidmannSpeed(nMoving / area) * (free[i]! / WEIDMANN.v0) * (inSmoke ? FIRE.smokeSpeedFactor : 1));
      let remaining = speed * dt;
      const T = epoch.T[e]!;
      for (let iter = 0; iter < 4 && remaining > 1e-9; iter++) {
        const c = cell[i]!;
        if (ctx.exitCellFlag[e]![c]) break;
        const r = (c / cols) | 0;
        const col = c - r * cols;
        let bestN = -1;
        let bestT = Number.isFinite(T[c]!) ? T[c]! : Infinity;
        let found = false;
        for (let k = 0; k < 8; k++) {
          const rr = r + NB_DR[k]!;
          const cc = col + NB_DC[k]!;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const nb = rr * cols + cc;
          if (!epoch.walk[nb]) continue;
          if (NB_DR[k] !== 0 && NB_DC[k] !== 0) {
            // no corner cutting: both cardinal cells must be open
            if (!epoch.walk[r * cols + cc] || !epoch.walk[rr * cols + col]) continue;
          }
          const v = T[nb]!;
          if (v < bestT || (!found && Number.isFinite(v) && !Number.isFinite(T[c]!))) {
            bestT = v; bestN = nb; found = true;
          }
        }
        if (bestN < 0) {
          // local minimum that is not an exit, or fully boxed in: no path
          status[i] = STUCK;
          active--;
          break;
        }
        const tc = cellCentre(grid, bestN);
        const dx = tc.x - x[i]!;
        const dy = tc.y - y[i]!;
        const d = Math.hypot(dx, dy);
        if (d <= remaining) {
          x[i] = tc.x;
          y[i] = tc.y;
          cell[i] = bestN;
          remaining -= d;
        } else {
          x[i] = x[i]! + (dx / d) * remaining;
          y[i] = y[i]! + (dy / d) * remaining;
          remaining = 0;
          const nc = cellOfPoint(grid, x[i]!, y[i]!);
          if (nc) cell[i] = nc.row * cols + nc.col;
        }
        if (!grid.walk[cell[i]!]) wallViolations++;
      }
      if (status[i] === MOVING && ctx.exitCellFlag[e]![cell[i]!]) {
        status[i] = QUEUED;
        arrival[i] = t;
        queues[e]!.push(i);
      }
    }

    // ---- exits: FIFO service at 1/capacity seconds per person ----
    for (let e = 0; e < E; e++) {
      const q = queues[e]!;
      const service = 1 / ctx.capacity[e]!;
      while (qHead[e]! < q.length) {
        const a = q[qHead[e]!]!;
        if (status[a] !== QUEUED) { qHead[e] = qHead[e]! + 1; continue; }
        const start = Math.max(arrival[a]!, nextFree[e]!);
        const end = start + service;
        if (end > t) break;
        nextFree[e] = end;
        qHead[e] = qHead[e]! + 1;
        status[a] = OUT;
        active--;
        evacT[a] = end;
        evacuationTimes.push(end);
        lastCompletion = Math.max(lastCompletion, end);
        exitLoad[e] = exitLoad[e]! + 1;
        const wait = start - arrival[a]!;
        queueWaitSum[e] = queueWaitSum[e]! + wait;
        queueCount[e] = queueCount[e]! + 1;
        if (wait > queueMax[e]!) queueMax[e] = wait;
        const ci = agents[a]!.clusterIdx;
        clusterTimeSum[ci] = clusterTimeSum[ci]! + end;
        clusterTimeCount[ci] = clusterTimeCount[ci]! + 1;
        clusterExitCounts[ci]![e] = clusterExitCounts[ci]![e]! + 1;
      }
    }

    if (trace && step % traceEvery === 0) snapshot(t);
  }
  snapshot(step * dt);

  // People who could not get out stay where they are while the smoke keeps thickening; follow their exposure to the end (1 s steps).
  if (hazards.fires.length > 0) {
    const trapped: number[] = [];
    for (let i = 0; i < N; i++) if (status[i] === STUCK) trapped.push(i);
    for (let tt = step * dt; trapped.length > 0 && tt < SIM.maxTimeS; tt += 1) {
      for (let k = trapped.length - 1; k >= 0; k--) {
        const i = trapped[k]!;
        dose[i] = dose[i]! + smokeDoseRate(hazards, cell[i]!, tt);
        if (dose[i]! >= 1 || inHazard(hazards, x[i]!, y[i]!, cell[i]!, tt)) {
          status[i] = DEAD;
          casualties++;
          casualtyCells.push({ x: x[i]!, y: y[i]! });
          trapped.splice(k, 1);
        }
      }
    }
  }

  const evacuated = evacuationTimes.length;
  const exitLoads = new Map<string, number>();
  let loadSum = 0;
  ctx.exitIds.forEach((id, e) => { exitLoads.set(id, exitLoad[e]!); loadSum += exitLoad[e]!; });
  // Independent bookkeeping (counted from the final status of every agent), so conservation is a real check.
  let outCount = 0;
  let deadCount = 0;
  let stillIn = 0;
  for (let i = 0; i < N; i++) {
    if (status[i] === OUT) outCount++;
    else if (status[i] === DEAD) deadCount++;
    else stillIn++;
  }
  const conservationOk = outCount === evacuated && deadCount === casualties && loadSum === evacuated && outCount + deadCount + stillIn === N;
  return {
    evacuationTimes,
    casualties,
    remaining: stillIn,
    conservationOk,
    exitLoads,
    densityAccum: peak,
    peakDensity,
    peakDensityCell: { row: (peakCell / cols) | 0, col: peakCell % cols },
    lastCompletion,
    critSeconds: crit,
    casualtyCells,
    clusterTimeSum,
    clusterTimeCount,
    clusterExitCounts,
    queueWaitSum,
    queueCount,
    queueMax,
    wallViolations,
    trace,
  };
}

