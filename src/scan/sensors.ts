import { useCallback, useEffect, useRef, useState } from 'react';
import { headingDeg, HOLD_STILL_THRESHOLD, motionVariance } from './geometry';

export interface Orientation {
  beta: number;
  gamma: number;
  alpha: number;
  heading: number;
  /** true once at least one event with real values arrived */
  live: boolean;
  /** the compass is absolute (iOS webkitCompassHeading or Chrome's deviceorientationabsolute) */
  absolute: boolean;
}

export type MotionState = 'idle' | 'needs-gesture' | 'granted' | 'denied' | 'unavailable';

type IOSPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * Orientation + stillness. Only the latest reading is kept in a ref (it changes ~60 times a second and must not re-render
 * the camera view); `stillVariance` and `live` are sampled into state at 4 Hz.
 */
export function useSensors() {
  const orient = useRef<Orientation>({ beta: 90, gamma: 0, alpha: 0, heading: 0, live: false, absolute: false });
  const accel = useRef<number[]>([]);
  const [motion, setMotion] = useState<MotionState>('idle');
  const [snapshot, setSnapshot] = useState({ live: false, still: true, absolute: false });
  const attached = useRef(false);

  const attach = useCallback(() => {
    if (attached.current) return;
    attached.current = true;
    const onOrient = (e: DeviceOrientationEvent, abs: boolean) => {
      if (e.beta === null || e.alpha === null) return;
      const compass = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      const isAbs = abs || e.absolute === true || typeof compass === 'number';
      // a relative event must not overwrite an absolute heading once we have one
      if (!isAbs && orient.current.absolute) {
        orient.current = { ...orient.current, beta: e.beta, gamma: e.gamma ?? 0 };
        return;
      }
      orient.current = {
        beta: e.beta,
        gamma: e.gamma ?? 0,
        alpha: e.alpha,
        heading: headingDeg(e.alpha, compass),
        live: true,
        absolute: isAbs,
      };
    };
    window.addEventListener('deviceorientationabsolute', (e) => onOrient(e as DeviceOrientationEvent, true));
    window.addEventListener('deviceorientation', (e) => onOrient(e, false));
    window.addEventListener('devicemotion', (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x === null || a.y === null || a.z === null) return;
      accel.current.push(Math.hypot(a.x, a.y, a.z));
      if (accel.current.length > 20) accel.current.shift();
    });
  }, []);

  /** Must be called from a user gesture on iOS 13+. */
  const requestMotion = useCallback(async () => {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      setMotion('unavailable');
      return false;
    }
    const ctor = DeviceOrientationEvent as unknown as IOSPermission;
    try {
      if (typeof ctor.requestPermission === 'function') {
        const r = await ctor.requestPermission();
        if (r !== 'granted') {
          setMotion('denied');
          return false;
        }
        const dm = DeviceMotionEvent as unknown as IOSPermission;
        if (typeof dm.requestPermission === 'function') await dm.requestPermission().catch(() => undefined);
      }
      attach();
      setMotion('granted');
      return true;
    } catch {
      setMotion('denied');
      return false;
    }
  }, [attach]);

  // Non-iOS browsers need no permission: start listening at once. iOS waits for a tap.
  useEffect(() => {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      setMotion('unavailable');
      return;
    }
    const ctor = DeviceOrientationEvent as unknown as IOSPermission;
    if (typeof ctor.requestPermission === 'function') setMotion('needs-gesture');
    else {
      attach();
      setMotion('granted');
    }
  }, [attach]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSnapshot({
        live: orient.current.live,
        absolute: orient.current.absolute,
        still: motionVariance(accel.current) <= HOLD_STILL_THRESHOLD,
      });
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  return { orient, motion, requestMotion, ...snapshot };
}
