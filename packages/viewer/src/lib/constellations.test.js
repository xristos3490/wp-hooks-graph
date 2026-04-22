import { describe, test, expect } from 'vitest';
import {
  makeRng,
  buildArchetype,
  buildCuratedScene,
  ARCHETYPE_NAMES,
} from './constellations.js';

const NODE_BOUNDS = {
  hub: [6, 10],
  tree: [7, 12],
  ring: [6, 10],
  lattice: [9, 16],
  chain: [5, 8],
  mesh: [8, 14],
};

describe('constellations', () => {
  test('exposes exactly the six archetype names from the spec', () => {
    expect(new Set(ARCHETYPE_NAMES)).toEqual(
      new Set(['hub', 'tree', 'ring', 'lattice', 'chain', 'mesh'])
    );
  });

  test('buildCuratedScene is deterministic across calls', () => {
    expect(buildCuratedScene()).toEqual(buildCuratedScene());
  });

  test('curated scene exposes drifters and orbits', () => {
    const scene = buildCuratedScene();
    expect(Array.isArray(scene.drifters)).toBe(true);
    expect(Array.isArray(scene.orbits)).toBe(true);
    expect(scene.drifters.length).toBeGreaterThan(0);
    for (const d of scene.drifters) {
      expect(ARCHETYPE_NAMES).toContain(d.archetype);
    }
  });
});

describe.each(ARCHETYPE_NAMES)('archetype %s', (name) => {
  test('respects node-count bounds across 60 seeds', () => {
    const [lo, hi] = NODE_BOUNDS[name];
    for (let seed = 0; seed < 60; seed++) {
      const rng = makeRng(seed);
      const { nodes } = buildArchetype(name, rng);
      expect(nodes.length).toBeGreaterThanOrEqual(lo);
      expect(nodes.length).toBeLessThanOrEqual(hi);
    }
  });

  test('every edge references a valid node index', () => {
    for (let seed = 0; seed < 60; seed++) {
      const rng = makeRng(seed);
      const { nodes, edges } = buildArchetype(name, rng);
      for (const [a, b] of edges) {
        expect(Number.isInteger(a)).toBe(true);
        expect(Number.isInteger(b)).toBe(true);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(nodes.length);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(nodes.length);
        expect(a).not.toBe(b);
      }
    }
  });

  test('node coordinates stay within a slightly padded viewBox', () => {
    // Extra jitter can push a coordinate a few units outside the nominal
    // 0–200 box; that's fine for the rendered SVG, just verify it doesn't
    // escape the padded range.
    for (let seed = 0; seed < 30; seed++) {
      const rng = makeRng(seed);
      const { nodes } = buildArchetype(name, rng);
      for (const [x, y] of nodes) {
        expect(x).toBeGreaterThanOrEqual(-10);
        expect(x).toBeLessThanOrEqual(210);
        expect(y).toBeGreaterThanOrEqual(-10);
        expect(y).toBeLessThanOrEqual(210);
      }
    }
  });
});
