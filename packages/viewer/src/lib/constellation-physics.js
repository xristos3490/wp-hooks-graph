// Framework-free physics for the homepage constellation field.
// Each constellation owns one "body" of N nodes; each node is a critically
// damped spring anchored at its SVG position and driven by pointer repulsion.
//
// State is flat Float32Array per body so the hot loop is cache-friendly and
// allocation-free. The step reports a `dirty` flag so the caller can skip
// DOM writes and even halt the RAF loop once every body has settled.

export const DEFAULT_PARAMS = Object.freeze({
  INNER_R: 64,
  OUTER_R: 240,
  MAX_PUSH: 28,
  STIFFNESS: 2 * Math.PI * 1.3,
});

const MIN_DT = 0;
const MAX_DT = 1 / 30;

// A node is "at rest" when position and velocity fall below these thresholds.
// Values are in screen pixels; well below the DOM write epsilon so the
// dirty/clean flip lines up with "nothing to render this frame".
const REST_POS_EPS = 0.05;
const REST_VEL_EPS = 0.05;

export function createBodyState(nodeCount) {
  return {
    count: nodeCount,
    x: new Float32Array(nodeCount),
    y: new Float32Array(nodeCount),
    vx: new Float32Array(nodeCount),
    vy: new Float32Array(nodeCount),
    dirty: false,
  };
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function falloff(dist, inner, outer) {
  if (dist <= inner) return 1;
  if (dist >= outer) return 0;
  return 1 - smoothstep(inner, outer, dist);
}

// Step one body's node physics. `anchorsScreen` is a flat Float32Array of
// [x0,y0, x1,y1, ...] anchor positions in screen pixels (already rotated for
// the body's current spin, if any). `pointer` is {x,y} in the same space, or
// null to relax toward the anchor. Returns the updated `state.dirty` flag.
export function stepBody(state, ctx) {
  const { anchorsScreen, pointer, params = DEFAULT_PARAMS } = ctx;
  const dt = Math.min(Math.max(ctx.dtSec, MIN_DT), MAX_DT);
  if (dt === 0) return state.dirty;

  const { INNER_R, OUTER_R, MAX_PUSH, STIFFNESS } = params;
  const omega = STIFFNESS;
  const omegaSq = omega * omega;
  const twoOmega = 2 * omega;
  const hasPointer = pointer !== null && pointer !== undefined;
  const px = hasPointer ? pointer.x : 0;
  const py = hasPointer ? pointer.y : 0;
  const outerSq = OUTER_R * OUTER_R;

  let stillDirty = false;

  for (let i = 0; i < state.count; i++) {
    let rx = 0;
    let ry = 0;
    if (hasPointer) {
      const ax = anchorsScreen[i * 2];
      const ay = anchorsScreen[i * 2 + 1];
      const dx = ax - px;
      const dy = ay - py;
      const distSq = dx * dx + dy * dy;
      if (distSq < outerSq) {
        const dist = Math.sqrt(distSq);
        const s = falloff(dist, INNER_R, OUTER_R);
        const inv = 1 / Math.max(dist, 1);
        rx = dx * inv * MAX_PUSH * s;
        ry = dy * inv * MAX_PUSH * s;
      }
    }

    const ax = omegaSq * (rx - state.x[i]) - twoOmega * state.vx[i];
    const ay = omegaSq * (ry - state.y[i]) - twoOmega * state.vy[i];

    state.vx[i] += ax * dt;
    state.vy[i] += ay * dt;
    state.x[i] += state.vx[i] * dt;
    state.y[i] += state.vy[i] * dt;

    if (
      Math.abs(state.x[i]) > REST_POS_EPS ||
      Math.abs(state.y[i]) > REST_POS_EPS ||
      Math.abs(state.vx[i]) > REST_VEL_EPS ||
      Math.abs(state.vy[i]) > REST_VEL_EPS
    ) {
      stillDirty = true;
    }
  }

  state.dirty = stillDirty;
  return stillDirty;
}
