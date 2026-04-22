import { describe, test, expect } from 'vitest';
import {
  DEFAULT_PARAMS,
  createBodyState,
  stepBody,
} from './constellation-physics.js';

function anchorsOf(points) {
  const arr = new Float32Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    arr[i * 2] = points[i][0];
    arr[i * 2 + 1] = points[i][1];
  }
  return arr;
}

function run(state, anchorsScreen, pointer, { steps, dt = 1 / 60, params = DEFAULT_PARAMS } = {}) {
  for (let i = 0; i < steps; i++) {
    stepBody(state, { anchorsScreen, pointer, dtSec: dt, params });
  }
}

describe('createBodyState', () => {
  test('returns flat typed arrays sized to nodeCount', () => {
    const state = createBodyState(4);
    expect(state.count).toBe(4);
    expect(state.x).toBeInstanceOf(Float32Array);
    expect(state.y).toBeInstanceOf(Float32Array);
    expect(state.vx).toBeInstanceOf(Float32Array);
    expect(state.vy).toBeInstanceOf(Float32Array);
    expect(state.x.length).toBe(4);
    expect(state.dirty).toBe(false);
    for (let i = 0; i < 4; i++) {
      expect(state.x[i]).toBe(0);
      expect(state.y[i]).toBe(0);
      expect(state.vx[i]).toBe(0);
      expect(state.vy[i]).toBe(0);
    }
  });
});

describe('stepBody', () => {
  test('rest stability: no pointer, nodes stay at origin and dirty stays false', () => {
    const anchors = anchorsOf([[0, 0], [10, 0], [0, 10]]);
    const state = createBodyState(3);
    run(state, anchors, null, { steps: 500 });
    for (let i = 0; i < 3; i++) {
      expect(state.x[i]).toBeCloseTo(0, 10);
      expect(state.y[i]).toBeCloseTo(0, 10);
      expect(state.vx[i]).toBeCloseTo(0, 10);
      expect(state.vy[i]).toBeCloseTo(0, 10);
    }
    expect(state.dirty).toBe(false);
  });

  test('far pointer: distance beyond OUTER_R exerts no force', () => {
    const anchors = anchorsOf([[0, 0]]);
    const state = createBodyState(1);
    const pointer = { x: DEFAULT_PARAMS.OUTER_R + 50, y: 0 };
    run(state, anchors, pointer, { steps: 500 });
    expect(state.x[0]).toBeCloseTo(0, 10);
    expect(state.y[0]).toBeCloseTo(0, 10);
    expect(state.dirty).toBe(false);
  });

  test('near pointer: node converges to MAX_PUSH-bounded steady state', () => {
    const anchors = anchorsOf([[0, 0]]);
    const state = createBodyState(1);
    const pointer = { x: -30, y: 0 }; // inside INNER_R
    run(state, anchors, pointer, { steps: 240 });
    const speed = Math.hypot(state.vx[0], state.vy[0]);
    expect(speed).toBeLessThan(0.1);
    expect(state.x[0]).toBeGreaterThan(DEFAULT_PARAMS.MAX_PUSH * 0.9);
    expect(state.x[0]).toBeLessThanOrEqual(DEFAULT_PARAMS.MAX_PUSH + 0.5);
    expect(Math.abs(state.y[0])).toBeLessThan(0.001);
    expect(state.dirty).toBe(true);
  });

  test('MAX_PUSH cap: offset does not exceed cap even with saturated falloff', () => {
    const anchors = anchorsOf([[0, 0]]);
    const state = createBodyState(1);
    const pointer = { x: -20, y: 0 }; // deep inside INNER_R, falloff saturates at 1
    run(state, anchors, pointer, { steps: 1000 });
    const mag = Math.hypot(state.x[0], state.y[0]);
    expect(mag).toBeGreaterThan(DEFAULT_PARAMS.MAX_PUSH * 0.95);
    expect(mag).toBeLessThanOrEqual(DEFAULT_PARAMS.MAX_PUSH + 1e-6);
  });

  test('critically damped: offset approaches steady state monotonically', () => {
    const anchors = anchorsOf([[0, 0]]);
    const state = createBodyState(1);
    const pointer = { x: -30, y: 0 };
    const probe = createBodyState(1);
    run(probe, anchors, pointer, { steps: 1000 });
    const steady = Math.hypot(probe.x[0], probe.y[0]);

    let prev = 0;
    for (let i = 0; i < 300; i++) {
      stepBody(state, { anchorsScreen: anchors, pointer, dtSec: 1 / 60 });
      const mag = Math.hypot(state.x[0], state.y[0]);
      expect(mag).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(mag).toBeLessThanOrEqual(steady + 1e-6);
      prev = mag;
    }
  });

  test('dt clamp: oversized dt produces no more motion than the 1/30 budget', () => {
    const anchors = anchorsOf([[0, 0]]);
    const clamped = createBodyState(1);
    const huge = createBodyState(1);
    const pointer = { x: -30, y: 0 };
    stepBody(clamped, { anchorsScreen: anchors, pointer, dtSec: 1 / 30 });
    stepBody(huge,    { anchorsScreen: anchors, pointer, dtSec: 5 });
    expect(huge.x[0]).toBeCloseTo(clamped.x[0], 12);
    expect(huge.vx[0]).toBeCloseTo(clamped.vx[0], 12);
  });

  test('zero dt is a no-op', () => {
    const state = createBodyState(1);
    state.x[0] = 5;
    state.vx[0] = 2;
    stepBody(state, { anchorsScreen: anchorsOf([[0, 0]]), pointer: { x: -30, y: 0 }, dtSec: 0 });
    expect(state.x[0]).toBe(5);
    expect(state.vx[0]).toBe(2);
  });

  test('per-node independence: only nodes near the pointer move', () => {
    const anchors = anchorsOf([
      [0, 0],                          // near
      [DEFAULT_PARAMS.OUTER_R + 20, 0] // far
    ]);
    const state = createBodyState(2);
    const pointer = { x: -30, y: 0 };
    run(state, anchors, pointer, { steps: 240 });
    expect(state.x[0]).toBeGreaterThan(DEFAULT_PARAMS.MAX_PUSH * 0.9);
    expect(state.x[1]).toBeCloseTo(0, 6);
    expect(state.y[1]).toBeCloseTo(0, 6);
  });

  test('dirty flag clears once all nodes relax to anchor', () => {
    const anchors = anchorsOf([[0, 0]]);
    const state = createBodyState(1);
    const pointer = { x: -30, y: 0 };
    run(state, anchors, pointer, { steps: 120 });
    expect(state.dirty).toBe(true);
    // pointer leaves range; spring relaxes.
    run(state, anchors, null, { steps: 4000 });
    expect(state.dirty).toBe(false);
    expect(Math.abs(state.x[0])).toBeLessThan(0.06);
    expect(Math.abs(state.vx[0])).toBeLessThan(0.06);
  });

  test('deterministic: same inputs produce identical trajectories', () => {
    const anchors = anchorsOf([[10, -20], [300, 400]]);
    const a = createBodyState(2);
    const b = createBodyState(2);
    const pointer = { x: 50, y: -10 };
    run(a, anchors, pointer, { steps: 400 });
    run(b, anchors, pointer, { steps: 400 });
    for (let i = 0; i < 2; i++) {
      expect(a.x[i]).toBe(b.x[i]);
      expect(a.y[i]).toBe(b.y[i]);
      expect(a.vx[i]).toBe(b.vx[i]);
      expect(a.vy[i]).toBe(b.vy[i]);
    }
  });
});
