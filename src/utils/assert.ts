export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new AssertionError(message);
}

export function assertFinite(x: number, name: string): void {
  if (!Number.isFinite(x)) throw new AssertionError(`${name} must be finite, got ${x}`);
}
