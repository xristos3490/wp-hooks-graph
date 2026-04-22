// Framework-free physics for the homepage constellation field.
// Each body is a critically-damped spring anchored at its layout position,
// driven by (a) a pointer-repulsion force and (b) a slow ambient sine.
//
// No DOM, no React, no allocations in the step — state is mutated in place.

export const DEFAULT_PARAMS = Object.freeze({
  INNER_R: 96,
  OUTER_R: 420,
  MAX_PUSH: 140,
  STIFFNESS: 2 * Math.PI * 1.1,
  NOISE_AMP: 8,
  NOISE_FREQ_X: 0.08,
  NOISE_FREQ_Y: 0.11,
});

const MIN_DT = 0;
const MAX_DT = 1 / 30;

// Golden-angle derived phases so neighbouring bodies' noise is incommensurate.
const PHASE_X_STEP = 2.399963229728653;
const PHASE_Y_STEP = 3.883222077450933;
const PHASE_Y_OFFSET = Math.PI / 3;

export function createPhysicsState(bodies) {
  const state = new Array(bodies.length);
  for (let i = 0; i < bodies.length; i++) {
    state[i] = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      phaseX: i * PHASE_X_STEP,
      phaseY: i * PHASE_Y_STEP + PHASE_Y_OFFSET,
    };
  }
  return state;
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

export function stepPhysics(state, ctx) {
  const { bodies, pointer, tSec, params = DEFAULT_PARAMS } = ctx;
  const dt = Math.min(Math.max(ctx.dtSec, MIN_DT), MAX_DT);
  if (dt === 0) return;

  const {
    INNER_R,
    OUTER_R,
    MAX_PUSH,
    STIFFNESS,
    NOISE_AMP,
    NOISE_FREQ_X,
    NOISE_FREQ_Y,
  } = params;

  const omega = STIFFNESS;
  const omegaSq = omega * omega;
  const twoOmega = 2 * omega;

  for (let i = 0; i < state.length; i++) {
    const body = state[i];
    const anchor = bodies[i].anchor;

    let rx = 0;
    let ry = 0;
    if (pointer !== null && pointer !== undefined) {
      const dx = anchor.x - pointer.x;
      const dy = anchor.y - pointer.y;
      const dist = Math.hypot(dx, dy);
      if (dist < OUTER_R) {
        const s = falloff(dist, INNER_R, OUTER_R);
        const inv = 1 / Math.max(dist, 1);
        const nx = dx * inv;
        const ny = dy * inv;
        rx = nx * MAX_PUSH * s;
        ry = ny * MAX_PUSH * s;
      }
    }

    const nox = NOISE_AMP * Math.sin(tSec * NOISE_FREQ_X + body.phaseX);
    const noy = NOISE_AMP * Math.sin(tSec * NOISE_FREQ_Y + body.phaseY);

    const tx = rx + nox;
    const ty = ry + noy;

    const ax = omegaSq * (tx - body.x) - twoOmega * body.vx;
    const ay = omegaSq * (ty - body.y) - twoOmega * body.vy;

    body.vx += ax * dt;
    body.vy += ay * dt;
    body.x += body.vx * dt;
    body.y += body.vy * dt;
  }
}
