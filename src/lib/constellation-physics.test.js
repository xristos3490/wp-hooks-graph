import { describe, test, expect } from 'vitest';
import {
  DEFAULT_PARAMS,
  createPhysicsState,
  stepPhysics,
} from './constellation-physics.js';

function run(state, bodies, pointer, { steps, dt = 1 / 60, params = DEFAULT_PARAMS, t0 = 0 } = {}) {
  let t = t0;
  for (let i = 0; i < steps; i++) {
    stepPhysics(state, { bodies, pointer, dtSec: dt, tSec: t, params });
    t += dt;
  }
  return t;
}

const noNoise = Object.freeze({ ...DEFAULT_PARAMS, NOISE_AMP: 0 });

describe('createPhysicsState', () => {
  test('returns one entry per body with zero position and velocity', () => {
    const bodies = [0, 1, 2].map(() => ({ anchor: { x: 0, y: 0 } }));
    const state = createPhysicsState(bodies);
    expect(state).toHaveLength(3);
    for (const b of state) {
      expect(b.x).toBe(0);
      expect(b.y).toBe(0);
      expect(b.vx).toBe(0);
      expect(b.vy).toBe(0);
      expect(typeof b.phaseX).toBe('number');
      expect(typeof b.phaseY).toBe('number');
    }
  });

  test('phases differ between indices so noise is out of sync', () => {
    const bodies = [0, 1, 2, 3, 4, 5].map(() => ({ anchor: { x: 0, y: 0 } }));
    const state = createPhysicsState(bodies);
    const phaseXs = state.map((b) => b.phaseX);
    const phaseYs = state.map((b) => b.phaseY);
    expect(new Set(phaseXs).size).toBe(phaseXs.length);
    expect(new Set(phaseYs).size).toBe(phaseYs.length);
  });
});

describe('stepPhysics', () => {
  test('rest stability: no pointer, no noise, body stays at origin', () => {
    const bodies = [{ anchor: { x: 0, y: 0 } }];
    const state = createPhysicsState(bodies);
    run(state, bodies, null, { steps: 1000, params: noNoise });
    expect(state[0].x).toBeCloseTo(0, 10);
    expect(state[0].y).toBeCloseTo(0, 10);
    expect(state[0].vx).toBeCloseTo(0, 10);
    expect(state[0].vy).toBeCloseTo(0, 10);
  });

  test('far pointer: distance beyond OUTER_R exerts no force', () => {
    const bodies = [{ anchor: { x: 0, y: 0 } }];
    const state = createPhysicsState(bodies);
    const pointer = { x: DEFAULT_PARAMS.OUTER_R + 50, y: 0 };
    run(state, bodies, pointer, { steps: 500, params: noNoise });
    expect(state[0].x).toBeCloseTo(0, 10);
    expect(state[0].y).toBeCloseTo(0, 10);
  });

  test('near pointer: body converges to a non-zero steady state with settled velocity', () => {
    const bodies = [{ anchor: { x: 0, y: 0 } }];
    const state = createPhysicsState(bodies);
    // Pointer 50px to the left of anchor, inside INNER_R.
    const pointer = { x: -50, y: 0 };
    run(state, bodies, pointer, { steps: 120, params: noNoise }); // 2 simulated seconds at 60Hz
    const speed = Math.hypot(state[0].vx, state[0].vy);
    expect(speed).toBeLessThan(0.1);
    expect(state[0].x).toBeGreaterThan(DEFAULT_PARAMS.MAX_PUSH * 0.9);
    expect(state[0].x).toBeLessThanOrEqual(DEFAULT_PARAMS.MAX_PUSH + 0.5);
    expect(Math.abs(state[0].y)).toBeLessThan(0.001);
  });

  test('critically damped: offset magnitude approaches steady state monotonically', () => {
    const bodies = [{ anchor: { x: 0, y: 0 } }];
    const state = createPhysicsState(bodies);
    const pointer = { x: -50, y: 0 };
    // Find the steady-state magnitude first by running long.
    const probe = createPhysicsState(bodies);
    run(probe, bodies, pointer, { steps: 1000, params: noNoise });
    const steady = Math.hypot(probe[0].x, probe[0].y);

    let prev = 0;
    for (let i = 0; i < 300; i++) {
      stepPhysics(state, { bodies, pointer, dtSec: 1 / 60, tSec: i / 60, params: noNoise });
      const mag = Math.hypot(state[0].x, state[0].y);
      // Monotonic non-decreasing toward steady state, never exceeding it (plus tiny tolerance).
      expect(mag).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(mag).toBeLessThanOrEqual(steady + 1e-6);
      prev = mag;
    }
  });

  test('MAX_PUSH cap: steady-state offset approaches but does not exceed cap', () => {
    const bodies = [{ anchor: { x: 0, y: 0 } }];
    const state = createPhysicsState(bodies);
    // Pointer 80px along -x is well inside INNER_R (96), so falloff saturates at 1.
    const pointer = { x: -80, y: 0 };
    run(state, bodies, pointer, { steps: 1000, params: noNoise });
    const mag = Math.hypot(state[0].x, state[0].y);
    expect(mag).toBeGreaterThan(DEFAULT_PARAMS.MAX_PUSH * 0.95);
    expect(mag).toBeLessThanOrEqual(DEFAULT_PARAMS.MAX_PUSH + 1e-6);
  });

  test('dt clamp: oversized dt cannot displace beyond the 1/30 budget', () => {
    const bodies = [{ anchor: { x: 0, y: 0 } }];
    const clamped = createPhysicsState(bodies);
    const huge = createPhysicsState(bodies);
    const pointer = { x: -50, y: 0 };
    // Single step: dt=1/30 vs dt=5. Huge dt must not produce more motion.
    stepPhysics(clamped, { bodies, pointer, dtSec: 1 / 30, tSec: 0, params: noNoise });
    stepPhysics(huge,    { bodies, pointer, dtSec: 5,      tSec: 0, params: noNoise });
    expect(huge[0].x).toBeCloseTo(clamped[0].x, 12);
    expect(huge[0].vx).toBeCloseTo(clamped[0].vx, 12);
  });

  test('noise bounds: with no pointer, position stays within noise amplitude and varies', () => {
    const bodies = [{ anchor: { x: 0, y: 0 } }];
    const state = createPhysicsState(bodies);
    // Warm up so the spring catches up with the slowly-varying noise target.
    run(state, bodies, null, { steps: 600 });
    const samples = [];
    let tCurrent = 600 / 60;
    for (let i = 0; i < 10000; i++) {
      stepPhysics(state, { bodies, pointer: null, dtSec: 1 / 60, tSec: tCurrent });
      tCurrent += 1 / 60;
      samples.push(state[0].x);
      expect(Math.abs(state[0].x)).toBeLessThanOrEqual(DEFAULT_PARAMS.NOISE_AMP + 1);
      expect(Math.abs(state[0].y)).toBeLessThanOrEqual(DEFAULT_PARAMS.NOISE_AMP + 1);
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
    expect(variance).toBeGreaterThan(0.5);
  });

  test('deterministic: same inputs produce identical trajectories', () => {
    const bodies = [{ anchor: { x: 10, y: -20 } }, { anchor: { x: 300, y: 400 } }];
    const s1 = createPhysicsState(bodies);
    const s2 = createPhysicsState(bodies);
    const pointer = { x: 50, y: -10 };
    run(s1, bodies, pointer, { steps: 400 });
    run(s2, bodies, pointer, { steps: 400 });
    expect(s1).toEqual(s2);
  });

  test('zero dt is a no-op', () => {
    const bodies = [{ anchor: { x: 0, y: 0 } }];
    const state = createPhysicsState(bodies);
    state[0].x = 5;
    state[0].vx = 2;
    stepPhysics(state, { bodies, pointer: { x: -50, y: 0 }, dtSec: 0, tSec: 0 });
    expect(state[0].x).toBe(5);
    expect(state[0].vx).toBe(2);
  });
});
