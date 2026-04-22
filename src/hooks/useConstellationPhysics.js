import { useEffect, useMemo, useRef } from 'react';
import {
  createPhysicsState,
  stepPhysics,
  DEFAULT_PARAMS,
} from '../lib/constellation-physics.js';

const POINTER_IDLE_MS = 2500;
const WRITE_EPSILON = 0.25;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function matchReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export default function useConstellationPhysics(drifters, params = DEFAULT_PARAMS) {
  const rootRef = useRef(null);
  // A stable array of refs sized to `drifters.length`. Index parity with
  // `drifters` lets the physics loop write transforms by body index.
  const bodyRefs = useMemo(
    () => drifters.map(() => ({ current: null })),
    // Length-based identity is enough: scenes are generated once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drifters.length]
  );

  useEffect(() => {
    if (drifters.length === 0) return undefined;

    const bodies = drifters.map((d) => ({
      anchor: { x: 0, y: 0 },
      anchorPct: { x: d.anchorX, y: d.anchorY },
    }));
    const state = createPhysicsState(bodies);
    const lastWrittenX = new Array(bodies.length).fill(Number.NaN);
    const lastWrittenY = new Array(bodies.length).fill(Number.NaN);

    const pointer = { x: 0, y: 0, active: false };
    let lastPointerMoveAt = -Infinity;
    let rafId = 0;
    let t0 = 0;
    let lastNow = 0;
    let running = false;
    let intersecting = true;
    let reducedMotion = matchReducedMotion();

    const readAnchors = () => {
      for (let i = 0; i < bodies.length; i++) {
        const el = bodyRefs[i].current;
        if (el) {
          const rect = el.getBoundingClientRect();
          bodies[i].anchor.x = rect.left + rect.width / 2;
          bodies[i].anchor.y = rect.top + rect.height / 2;
        } else if (typeof window !== 'undefined') {
          bodies[i].anchor.x = (bodies[i].anchorPct.x / 100) * window.innerWidth;
          bodies[i].anchor.y = (bodies[i].anchorPct.y / 100) * window.innerHeight;
        }
      }
    };

    const writeTransforms = () => {
      for (let i = 0; i < state.length; i++) {
        const el = bodyRefs[i].current;
        if (!el) continue;
        const bx = state[i].x;
        const by = state[i].y;
        if (
          !Number.isFinite(lastWrittenX[i]) ||
          Math.abs(bx - lastWrittenX[i]) >= WRITE_EPSILON ||
          Math.abs(by - lastWrittenY[i]) >= WRITE_EPSILON
        ) {
          el.style.transform = `translate3d(${bx.toFixed(2)}px, ${by.toFixed(2)}px, 0)`;
          lastWrittenX[i] = bx;
          lastWrittenY[i] = by;
        }
      }
    };

    const frame = (now) => {
      if (!running) return;
      const dt = Math.min((now - lastNow) / 1000, 1 / 30);
      lastNow = now;
      const t = (now - t0) / 1000;
      const activePointer =
        pointer.active && now - lastPointerMoveAt <= POINTER_IDLE_MS
          ? { x: pointer.x, y: pointer.y }
          : null;
      stepPhysics(state, { bodies, pointer: activePointer, dtSec: dt, tSec: t, params });
      writeTransforms();
      rafId = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running || reducedMotion || !intersecting) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      readAnchors();
      running = true;
      t0 = performance.now();
      lastNow = t0;
      rafId = requestAnimationFrame(frame);
    };

    const stop = () => {
      if (!running) return;
      running = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    const resetToAnchors = () => {
      for (let i = 0; i < state.length; i++) {
        state[i].x = 0;
        state[i].y = 0;
        state[i].vx = 0;
        state[i].vy = 0;
        const el = bodyRefs[i].current;
        if (el) {
          el.style.transform = 'translate3d(0, 0, 0)';
          lastWrittenX[i] = 0;
          lastWrittenY[i] = 0;
        }
      }
    };

    const onPointerMove = (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
      lastPointerMoveAt = performance.now();
    };
    const onPointerLeave = () => {
      pointer.active = false;
    };

    let resizeRaf = 0;
    const onResize = () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        readAnchors();
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        start();
      } else {
        stop();
      }
    };

    const mediaQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(REDUCED_MOTION_QUERY)
        : null;
    const onReducedMotionChange = (e) => {
      reducedMotion = e.matches;
      if (reducedMotion) {
        stop();
        resetToAnchors();
      } else {
        start();
      }
    };

    let observer = null;
    if (typeof IntersectionObserver !== 'undefined' && rootRef.current) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            intersecting = entry.isIntersecting;
          }
          if (intersecting) start();
          else stop();
        },
        { rootMargin: '10%' }
      );
      observer.observe(rootRef.current);
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('resize', onResize, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (mediaQuery) {
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', onReducedMotionChange);
      } else if (mediaQuery.addListener) {
        mediaQuery.addListener(onReducedMotionChange);
      }
    }

    if (reducedMotion) {
      resetToAnchors();
    } else {
      start();
    }

    return () => {
      stop();
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      window.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (mediaQuery) {
        if (mediaQuery.removeEventListener) {
          mediaQuery.removeEventListener('change', onReducedMotionChange);
        } else if (mediaQuery.removeListener) {
          mediaQuery.removeListener(onReducedMotionChange);
        }
      }
      if (observer) observer.disconnect();
    };
  }, [drifters, bodyRefs, params]);

  return { rootRef, bodyRefs };
}
