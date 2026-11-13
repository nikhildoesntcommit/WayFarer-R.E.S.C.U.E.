import { describe, expect, it } from 'vitest';
import { doorCapacity, InvalidDoorError, processQueue } from '../doors';

describe('door capacity', () => {
  it('rejects doors narrower than 0.40 m and names the door and width', () => {
    expect(() => doorCapacity(0.39, 1.3)).toThrow(InvalidDoorError);
    try {
      doorCapacity(0.39, 1.3, 'exit-A');
    } catch (e) {
      expect((e as InvalidDoorError).doorId).toBe('exit-A');
      expect((e as InvalidDoorError).widthM).toBe(0.39);
    }
  });
  it('applies the 0.15 m boundary layer on both sides', () => {
    expect(doorCapacity(0.4, 1.3)).toBeCloseTo(0.13, 6);
    expect(doorCapacity(1.2, 1.3)).toBeCloseTo(1.17, 6);
  });
});

describe('FIFO queue', () => {
  it('clears 50 people arriving together through a 1.2 m door in 50/1.17 s', () => {
    const cap = doorCapacity(1.2, 1.3);
    const { lastCompletion } = processQueue(new Array(50).fill(0), cap);
    expect(lastCompletion).toBeGreaterThan(42.74 * 0.995);
    expect(lastCompletion).toBeLessThan(42.74 * 1.005);
  });
  it('does not delay people who arrive after the queue has drained', () => {
    const { completionTimes } = processQueue([0, 100], 1);
    expect(completionTimes).toEqual([1, 101]);
  });
});
