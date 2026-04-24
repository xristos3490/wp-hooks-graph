import { useEffect, useMemo, useRef } from 'react';
import { createBodyState, stepBody, DEFAULT_PARAMS } from '../lib/constellation-physics.js';

const POINTER_IDLE_MS = 2500;
const WRITE_EPSILON = 0.2;
const SETTLE_TAIL_FRAMES = 8;
const VIEWBOX_SIZE = 200;
const VIEWBOX_CENTER = VIEWBOX_SIZE / 2;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// Per-drifter per-node reactivity. Each node is a critically-damped spring
// anchored at its SVG position; pointer repulsion is computed in screen space
// and inverse-rotated into the constellation's local frame so CSS spin doesn't
// skew the push direction over long sessions. Bodies whose nodes are all at
// rest and whose bounding reach is outside the pointer are skipped entirely;
// when every body is in that state the RAF loop halts and resumes on the next
// pointer move.
export default function useConstellationPhysics(drifters, params = DEFAULT_PARAMS) {
  const rootRef = useRef(null);

  const bodyRefs = useMemo(() => drifters.map(() => ({ current: null })), [drifters]);
  const nodeRefs = useMemo(
    () => drifters.map((d) => d.nodes.map(() => ({ current: null }))),
    [drifters]
  );
  const edgeRefs = useMemo(
    () => drifters.map((d) => d.edges.map(() => ({ current: null }))),
    [drifters]
  );

  useEffect(() => {
    if (drifters.length === 0) return undefined;

    const N = drifters.length;

    const states = new Array(N);
    const anchorsLocal = new Array(N); // flat [lx0,ly0,lx1,ly1,...] relative to viewBox (0..200)
    const anchorsScreen = new Array(N); // flat [sx,sy,...] in screen px, rotated
    const localOffsets = new Array(N); // flat [olx,oly,...] last-written local offsets
    const lastWrittenCx = new Array(N);
    const lastWrittenCy = new Array(N);
    const spinOmega = new Float32Array(N); // rad/sec, signed for direction
    const bodyRects = new Array(N).fill(null);
    const bodyReachSq = new Float32Array(N); // squared screen-px radius — pointer beyond this can't affect any node
    const bodyScale = new Float32Array(N); // rect.width / VIEWBOX_SIZE
    const bodyInvScale = new Float32Array(N);

    for (let b = 0; b < N; b++) {
      const d = drifters[b];
      const n = d.nodes.length;
      states[b] = createBodyState(n);

      const al = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        al[i * 2] = d.nodes[i][0];
        al[i * 2 + 1] = d.nodes[i][1];
      }
      anchorsLocal[b] = al;
      anchorsScreen[b] = new Float32Array(n * 2);
      localOffsets[b] = new Float32Array(n * 2);
      lastWrittenCx[b] = new Float32Array(n).fill(Number.NaN);
      lastWrittenCy[b] = new Float32Array(n).fill(Number.NaN);

      const durSec = Number.isFinite(d.spinDurSec) && d.spinDurSec > 0 ? d.spinDurSec : 360;
      const dir = d.spinDir === -1 ? -1 : 1;
      spinOmega[b] = (2 * Math.PI * dir) / durSec;
    }

    const pointer = { x: 0, y: 0, active: false };
    let lastPointerMoveAt = -Infinity;
    let rafId = 0;
    let rafQueued = false;
    let idleFrames = 0;
    let running = false;
    let intersecting = true;
    let reducedMotion = false;
    let lastNow = 0;
    let animStart = 0;

    // Cache per-body bounding rect, scale factor, and the "pointer can't
    // possibly affect any node of this body" reach (max anchor distance from
    // center, scaled to screen, plus OUTER_R). Recomputed lazily on resize.
    const recomputeBodyRect = (b) => {
      const el = bodyRefs[b].current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      bodyRects[b] = rect;
      const scale = rect.width / VIEWBOX_SIZE;
      bodyScale[b] = scale;
      bodyInvScale[b] = scale > 0 ? 1 / scale : 0;
      const al = anchorsLocal[b];
      let maxDsq = 0;
      for (let i = 0; i < states[b].count; i++) {
        const dx = al[i * 2] - VIEWBOX_CENTER;
        const dy = al[i * 2 + 1] - VIEWBOX_CENTER;
        const dsq = dx * dx + dy * dy;
        if (dsq > maxDsq) maxDsq = dsq;
      }
      const reach = Math.sqrt(maxDsq) * scale + params.OUTER_R;
      bodyReachSq[b] = reach * reach;
    };

    const invalidateRects = () => {
      for (let b = 0; b < N; b++) bodyRects[b] = null;
    };

    const requestFrame = () => {
      if (!running || rafQueued || reducedMotion || !intersecting) return;
      if (document.visibilityState === 'hidden') return;
      rafQueued = true;
      rafId = requestAnimationFrame(frame);
    };

    const resetToAnchors = () => {
      for (let b = 0; b < N; b++) {
        const s = states[b];
        s.x.fill(0);
        s.y.fill(0);
        s.vx.fill(0);
        s.vy.fill(0);
        s.dirty = false;
        const al = anchorsLocal[b];
        const lo = localOffsets[b];
        const lwx = lastWrittenCx[b];
        const lwy = lastWrittenCy[b];
        lo.fill(0);
        const drifter = drifters[b];
        const nodes = nodeRefs[b];
        for (let i = 0; i < s.count; i++) {
          const cx = al[i * 2];
          const cy = al[i * 2 + 1];
          const el = nodes[i].current;
          if (el) {
            el.cx.baseVal.value = cx;
            el.cy.baseVal.value = cy;
          }
          lwx[i] = cx;
          lwy[i] = cy;
        }
        const edges = edgeRefs[b];
        for (let e = 0; e < drifter.edges.length; e++) {
          const [ai, bi] = drifter.edges[e];
          const line = edges[e].current;
          if (!line) continue;
          line.x1.baseVal.value = al[ai * 2];
          line.y1.baseVal.value = al[ai * 2 + 1];
          line.x2.baseVal.value = al[bi * 2];
          line.y2.baseVal.value = al[bi * 2 + 1];
        }
      }
    };

    const frame = (now) => {
      rafQueued = false;
      if (!running) return;

      const dtRaw = lastNow === 0 ? 1 / 60 : (now - lastNow) / 1000;
      lastNow = now;
      const dt = Math.min(dtRaw, 1 / 30);

      const pointerFresh = pointer.active && now - lastPointerMoveAt <= POINTER_IDLE_MS;
      const elapsedSec = (now - animStart) * 0.001;

      let anyWork = false;

      for (let b = 0; b < N; b++) {
        if (bodyRects[b] === null) recomputeBodyRect(b);
        const rect = bodyRects[b];
        if (!rect) continue;

        const state = states[b];
        const cxScreen = rect.left + rect.width / 2;
        const cyScreen = rect.top + rect.height / 2;

        // Squared-distance AABB reject: skip bodies where no node can feel force.
        let pointerForThisBody = null;
        if (pointerFresh) {
          const dxp = cxScreen - pointer.x;
          const dyp = cyScreen - pointer.y;
          if (dxp * dxp + dyp * dyp <= bodyReachSq[b]) {
            pointerForThisBody = pointer;
          }
        }
        if (!pointerForThisBody && !state.dirty) continue;

        anyWork = true;

        // Current spin angle (screen-relative to the CSS animation start).
        const spinPhase = elapsedSec * spinOmega[b];
        const cosT = Math.cos(spinPhase);
        const sinT = Math.sin(spinPhase);
        const scale = bodyScale[b];
        const invScale = bodyInvScale[b];

        // Rotate + scale anchors into screen space for this frame.
        const al = anchorsLocal[b];
        const asArr = anchorsScreen[b];
        for (let i = 0; i < state.count; i++) {
          const lx = al[i * 2] - VIEWBOX_CENTER;
          const ly = al[i * 2 + 1] - VIEWBOX_CENTER;
          asArr[i * 2] = cxScreen + (cosT * lx - sinT * ly) * scale;
          asArr[i * 2 + 1] = cyScreen + (sinT * lx + cosT * ly) * scale;
        }

        stepBody(state, {
          anchorsScreen: asArr,
          pointer: pointerForThisBody,
          dtSec: dt,
          params,
        });

        // Write node + connected edge attributes. Local offset = R^T * screen
        // offset / scale so the translate is undone by the spin group's rotation.
        const lo = localOffsets[b];
        let anyNodeChanged = false;
        const lwx = lastWrittenCx[b];
        const lwy = lastWrittenCy[b];
        const nodes = nodeRefs[b];
        for (let i = 0; i < state.count; i++) {
          const sx = state.x[i];
          const sy = state.y[i];
          const olx = (cosT * sx + sinT * sy) * invScale;
          const oly = (-sinT * sx + cosT * sy) * invScale;
          lo[i * 2] = olx;
          lo[i * 2 + 1] = oly;

          const cxVal = al[i * 2] + olx;
          const cyVal = al[i * 2 + 1] + oly;
          const el = nodes[i].current;
          if (!el) continue;

          if (
            !Number.isFinite(lwx[i]) ||
            Math.abs(cxVal - lwx[i]) >= WRITE_EPSILON ||
            Math.abs(cyVal - lwy[i]) >= WRITE_EPSILON
          ) {
            el.cx.baseVal.value = cxVal;
            el.cy.baseVal.value = cyVal;
            lwx[i] = cxVal;
            lwy[i] = cyVal;
            anyNodeChanged = true;
          }
        }

        if (anyNodeChanged) {
          const drifter = drifters[b];
          const edges = edgeRefs[b];
          for (let e = 0; e < drifter.edges.length; e++) {
            const [ai, bi] = drifter.edges[e];
            const line = edges[e].current;
            if (!line) continue;
            line.x1.baseVal.value = al[ai * 2] + lo[ai * 2];
            line.y1.baseVal.value = al[ai * 2 + 1] + lo[ai * 2 + 1];
            line.x2.baseVal.value = al[bi * 2] + lo[bi * 2];
            line.y2.baseVal.value = al[bi * 2 + 1] + lo[bi * 2 + 1];
          }
        }
      }

      if (anyWork) {
        idleFrames = 0;
        requestFrame();
      } else {
        idleFrames++;
        // A short tail keeps us alive across the pointer-idle timeout so we
        // see it lapse; after that, stop until the next input kicks us.
        if (idleFrames < SETTLE_TAIL_FRAMES || pointerFresh) {
          requestFrame();
        }
      }
    };

    const start = () => {
      if (running || reducedMotion || !intersecting) return;
      if (document.visibilityState === 'hidden') return;
      running = true;
      animStart = performance.now();
      lastNow = 0;
      idleFrames = 0;
      invalidateRects();
      requestFrame();
    };

    const stop = () => {
      if (!running) return;
      running = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      rafQueued = false;
    };

    const onPointerMove = (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
      lastPointerMoveAt = performance.now();
      requestFrame();
    };
    const onPointerLeave = () => {
      pointer.active = false;
      requestFrame(); // run a few frames to relax bodies back to anchors
    };

    let resizeRaf = 0;
    const onResize = () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        invalidateRects();
        requestFrame();
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };

    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    reducedMotion = mediaQuery.matches;
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
    if (rootRef.current) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) intersecting = entry.isIntersecting;
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
    mediaQuery.addEventListener('change', onReducedMotionChange);

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
      mediaQuery.removeEventListener('change', onReducedMotionChange);
      if (observer) observer.disconnect();
    };
  }, [drifters, bodyRefs, nodeRefs, edgeRefs, params]);

  return { rootRef, bodyRefs, nodeRefs, edgeRefs };
}
