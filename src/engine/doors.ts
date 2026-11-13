import { DOOR } from '../constants';

export class InvalidDoorError extends Error {
  readonly doorId: string;
  readonly widthM: number;
  constructor(widthM: number, doorId = 'unknown') {
    super(`Door ${doorId} is ${widthM.toFixed(2)} m wide; the minimum usable clear width is ${DOOR.minUsableWidthM} m.`);
    this.name = 'InvalidDoorError';
    this.doorId = doorId;
    this.widthM = widthM;
  }
}

/** Throughput (persons/s) of a door of clear width widthM, after the SFPE boundary layer on both sides. */
export function doorCapacity(widthM: number, specificFlow: number = DOOR.specificFlowDefault, doorId?: string): number {
  if (widthM < DOOR.minUsableWidthM) throw new InvalidDoorError(widthM, doorId);
  const wEff = widthM - 2 * DOOR.boundaryLayerPerSide;
  return wEff * specificFlow;
}

export interface QueueState {
  capacity: number; // persons/s
  accumulated: number; // fractional tokens carried
  nextAvailableAt: number; // time when next person can pass
}

/** FIFO single-server queue: arrivals (any order) are served one per 1/capacity seconds. */
export function processQueue(arrivals: number[], capacity: number): { completionTimes: number[]; lastCompletion: number } {
  const sorted = [...arrivals].sort((a, b) => a - b);
  let lastCompletion = 0;
  const completionTimes: number[] = [];
  for (const arrival of sorted) {
    const start = Math.max(arrival, lastCompletion);
    const end = start + 1 / capacity;
    completionTimes.push(end);
    lastCompletion = end;
  }
  return { completionTimes, lastCompletion };
}
