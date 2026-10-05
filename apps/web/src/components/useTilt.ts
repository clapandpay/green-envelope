// SPDX-License-Identifier: AGPL-3.0-or-later
// Tilt for the envelope: the pointer (or, on a phone, the gyroscope) leans the whole piece and
// slides its layers by depth. The hook only writes two CSS variables, --tx and --ty (-1..1), on
// the element; everything that moves is a CSS transform. A requestAnimationFrame loop eases the
// values and stops as soon as they settle, so a still envelope costs nothing.

import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';

interface OrientationPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

export function useTilt(ref: RefObject<SVGElement>, enabled: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let tx = 0;
    let ty = 0;
    let gx = 0;
    let gy = 0;
    let wantX = 0;
    let wantY = 0;
    let raf = 0;
    let gyro = false;

    const frame = () => {
      raf = 0;
      tx += (wantX - tx) * 0.14;
      ty += (wantY - ty) * 0.14;
      const settled = Math.abs(wantX - tx) < 0.002 && Math.abs(wantY - ty) < 0.002;
      if (settled) {
        tx = wantX;
        ty = wantY;
      }
      el.style.setProperty('--tx', tx.toFixed(3));
      el.style.setProperty('--ty', ty.toFixed(3));
      if (!settled) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const onPointer = (e: PointerEvent) => {
      if (gyro) return;
      const r = el.getBoundingClientRect();
      // normalised by roughly one envelope-width, so the lean is gentle far away and full close by
      const span = Math.max(r.width, 200);
      wantX = clamp((e.clientX - (r.left + r.width / 2)) / span);
      wantY = clamp((e.clientY - (r.top + r.height / 2)) / span);
      kick();
    };
    const onLeave = () => {
      wantX = 0;
      wantY = 0;
      kick();
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma === null || e.beta === null) return;
      if (!gyro) {
        gyro = true;
        // the phone starts held at about 45 degrees: that is neutral
        gx = e.gamma;
        gy = e.beta - 45;
      }
      wantX = clamp((e.gamma - gx) / 30);
      wantY = clamp((e.beta - 45 - gy) / 30);
      kick();
    };

    // iOS only hands out the gyroscope after a tap
    const ask = () => {
      const api = window.DeviceOrientationEvent as unknown as OrientationPermission | undefined;
      if (api?.requestPermission) {
        api
          .requestPermission()
          .then((r) => {
            if (r === 'granted') window.addEventListener('deviceorientation', onOrient, opts);
          })
          .catch(() => {});
      }
    };

    const opts = { passive: true } as const;
    window.addEventListener('pointermove', onPointer, opts);
    document.addEventListener('pointerleave', onLeave, opts);
    el.addEventListener('pointerdown', ask, { once: true, passive: true });
    if (
      'DeviceOrientationEvent' in window &&
      !('requestPermission' in window.DeviceOrientationEvent)
    ) {
      window.addEventListener('deviceorientation', onOrient, opts);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('deviceorientation', onOrient);
      el.removeEventListener('pointerdown', ask);
    };
  }, [ref, enabled]);
}
