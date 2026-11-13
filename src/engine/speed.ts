import { WEIDMANN } from '../constants';

/**
 * Weidmann (1993) fundamental diagram: walking speed (m/s) at local density rho (persons/m²).
 * Clamped at 0 for rho >= rhoMax (the closed form goes negative beyond jam density).
 */
export function weidmannSpeed(rho: number): number {
  if (rho <= 0) return WEIDMANN.v0;
  const { v0, rhoMax, gamma } = WEIDMANN;
  return Math.max(0, v0 * (1 - Math.exp(-gamma * (1 / rho - 1 / rhoMax))));
}
