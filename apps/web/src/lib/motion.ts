// SPDX-License-Identifier: AGPL-3.0-or-later
// Motion helpers. Everything here stands still under prefers-reduced-motion.
import { useEffect, useState } from 'preact/hooks';

/** True when the person asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Where a count-up stands at `progress` (0 to 1): ease-out, exact at the end. Pure. */
export function countUpValue(target: bigint, progress: number): bigint {
  if (progress >= 1) return target;
  if (progress <= 0) return 0n;
  const eased = 1 - (1 - progress) ** 3;
  return (target * BigInt(Math.round(eased * 1000))) / 1000n;
}

/** Counts from zero to `target` once. Returns `target` at once when `enabled` is false. */
export function useCountUp(target: bigint, enabled: boolean, durationMs = 900): bigint {
  const animate = enabled && !prefersReducedMotion();
  const [value, setValue] = useState(animate ? 0n : target);
  useEffect(() => {
    if (!animate) {
      setValue(target);
      return;
    }
    let frame = 0;
    let start: number | null = null;
    const step = (time: number) => {
      start ??= time;
      const progress = (time - start) / durationMs;
      setValue(countUpValue(target, progress));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, animate, durationMs]);
  return animate ? value : target;
}
