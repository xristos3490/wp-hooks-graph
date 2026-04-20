import { describe, test, expect } from 'vitest';
import {
  filterByHookType,
  filterByDynamic,
  filterByOverlapping,
  filterByHighTraffic,
  intersectSets,
  filterEdgesByRepo,
  deriveFileVisibility,
  applyFilterPipeline,
} from './filters.js';

const hooks = [
  { id: 'hook::init', hook_type: 'action', dynamic: false, sources: ['wp', 'plugin'], fire_count: 2, listen_count: 10 },
  { id: 'hook::the_content', hook_type: 'filter', dynamic: false, sources: ['wp'], fire_count: 1, listen_count: 5 },
  { id: 'hook::admin_init', hook_type: 'action', dynamic: false, sources: ['wp'], fire_count: 1, listen_count: 3 },
  { id: 'hook::dynamic_1', hook_type: 'action', dynamic: true, sources: ['plugin'], fire_count: 0, listen_count: 1 },
  { id: 'hook::the_title', hook_type: 'filter', dynamic: true, sources: ['wp', 'plugin'], fire_count: 1, listen_count: 2 },
];

const edges = [
  { source: 'file::wp::settings.php', target: 'hook::init', type: 'fires', line: 100 },
  { source: 'file::wp::defaults.php', target: 'hook::init', type: 'listens', line: 50 },
  { source: 'file::plugin::main.php', target: 'hook::init', type: 'listens', line: 10 },
  { source: 'file::wp::post.php', target: 'hook::the_content', type: 'fires', line: 200 },
  { source: 'file::plugin::main.php', target: 'hook::the_content', type: 'listens', line: 30 },
  { source: 'file::plugin::extra.php', target: 'hook::dynamic_1', type: 'listens', line: 5 },
  { source: 'file::wp::admin.php', target: 'hook::admin_init', type: 'fires', line: 300 },
  { source: 'file::wp::post.php', target: 'hook::the_title', type: 'fires', line: 400 },
  { source: 'file::plugin::main.php', target: 'hook::the_title', type: 'listens', line: 40 },
];

const fileNodes = [
  { id: 'file::wp::settings.php', type: 'file', source: 'wp' },
  { id: 'file::wp::defaults.php', type: 'file', source: 'wp' },
  { id: 'file::wp::post.php', type: 'file', source: 'wp' },
  { id: 'file::wp::admin.php', type: 'file', source: 'wp' },
  { id: 'file::plugin::main.php', type: 'file', source: 'plugin' },
  { id: 'file::plugin::extra.php', type: 'file', source: 'plugin' },
];

describe('filterByHookType', () => {
  test('both enabled returns all', () => {
    const state = { hookType: { actions: true, filters: true } };
    expect(filterByHookType(hooks, state)).toEqual(new Set(hooks.map(h => h.id)));
  });

  test('only actions', () => {
    const state = { hookType: { actions: true, filters: false } };
    expect(filterByHookType(hooks, state)).toEqual(new Set(['hook::init', 'hook::admin_init', 'hook::dynamic_1']));
  });

  test('only filters', () => {
    const state = { hookType: { actions: false, filters: true } };
    expect(filterByHookType(hooks, state)).toEqual(new Set(['hook::the_content', 'hook::the_title']));
  });

  test('both disabled returns empty', () => {
    const state = { hookType: { actions: false, filters: false } };
    expect(filterByHookType(hooks, state)).toEqual(new Set());
  });
});

describe('filterByDynamic', () => {
  test('disabled returns all', () => {
    expect(filterByDynamic(hooks, { dynamic: false })).toEqual(new Set(hooks.map(h => h.id)));
  });

  test('enabled returns only dynamic', () => {
    expect(filterByDynamic(hooks, { dynamic: true })).toEqual(new Set(['hook::dynamic_1', 'hook::the_title']));
  });

  test('enabled with no dynamic hooks returns empty', () => {
    const noDynamic = hooks.filter(h => !h.dynamic);
    expect(filterByDynamic(noDynamic, { dynamic: true })).toEqual(new Set());
  });
});

describe('filterByOverlapping', () => {
  test('disabled returns all', () => {
    expect(filterByOverlapping(hooks, { overlapping: false })).toEqual(new Set(hooks.map(h => h.id)));
  });

  test('enabled returns only multi-source', () => {
    expect(filterByOverlapping(hooks, { overlapping: true })).toEqual(new Set(['hook::init', 'hook::the_title']));
  });

  test('enabled with all single-source returns empty', () => {
    const singleSource = [
      { id: 'hook::a', sources: ['wp'], hook_type: 'action', dynamic: false, fire_count: 1, listen_count: 1 },
      { id: 'hook::b', sources: ['plugin'], hook_type: 'filter', dynamic: false, fire_count: 1, listen_count: 1 },
    ];
    expect(filterByOverlapping(singleSource, { overlapping: true })).toEqual(new Set());
  });
});

describe('filterByHighTraffic', () => {
  test('disabled returns all', () => {
    const state = { highTraffic: { enabled: false, minConnections: 10 } };
    expect(filterByHighTraffic(hooks, state)).toEqual(new Set(hooks.map(h => h.id)));
  });

  test('enabled with threshold 5', () => {
    const state = { highTraffic: { enabled: true, minConnections: 5 } };
    expect(filterByHighTraffic(hooks, state)).toEqual(new Set(['hook::init', 'hook::the_content']));
  });

  test('enabled with threshold 1 returns all', () => {
    const state = { highTraffic: { enabled: true, minConnections: 1 } };
    expect(filterByHighTraffic(hooks, state)).toEqual(new Set(hooks.map(h => h.id)));
  });

  test('enabled with very high threshold returns empty', () => {
    const state = { highTraffic: { enabled: true, minConnections: 999 } };
    expect(filterByHighTraffic(hooks, state)).toEqual(new Set());
  });
});

describe('intersectSets', () => {
  test('single set returns itself', () => {
    expect(intersectSets([new Set(['a', 'b'])])).toEqual(new Set(['a', 'b']));
  });

  test('two overlapping sets', () => {
    expect(intersectSets([new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd'])])).toEqual(new Set(['b', 'c']));
  });

  test('three sets narrows result', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['b', 'c', 'd']);
    const c = new Set(['c', 'd', 'e']);
    expect(intersectSets([a, b, c])).toEqual(new Set(['c']));
  });

  test('disjoint sets return empty', () => {
    expect(intersectSets([new Set(['a']), new Set(['b'])])).toEqual(new Set());
  });

  test('empty array returns empty set', () => {
    expect(intersectSets([])).toEqual(new Set());
  });
});

describe('filterEdgesByRepo', () => {
  const allVisible = new Set(['hook::init', 'hook::the_content', 'hook::dynamic_1', 'hook::admin_init', 'hook::the_title']);

  test('all repos enabled keeps all edges to visible hooks', () => {
    const state = { repos: { wp: true, plugin: true } };
    expect(filterEdgesByRepo(edges, fileNodes, allVisible, state)).toHaveLength(9);
  });

  test('disabled repo hides its edges', () => {
    const state = { repos: { wp: true, plugin: false } };
    const result = filterEdgesByRepo(edges, fileNodes, allVisible, state);
    expect(result).toHaveLength(5);
    expect(result.every(e => e.source.startsWith('file::wp'))).toBe(true);
  });

  test('edges to invisible hooks are removed', () => {
    const state = { repos: { wp: true, plugin: true } };
    const result = filterEdgesByRepo(edges, fileNodes, new Set(['hook::init']), state);
    expect(result).toHaveLength(3);
    expect(result.every(e => e.target === 'hook::init')).toBe(true);
  });

  test('all repos disabled returns empty', () => {
    const state = { repos: { wp: false, plugin: false } };
    expect(filterEdgesByRepo(edges, fileNodes, allVisible, state)).toHaveLength(0);
  });
});

describe('deriveFileVisibility', () => {
  test('files with visible edges are visible', () => {
    const visibleEdges = [
      { source: 'file::wp::settings.php', target: 'hook::init' },
      { source: 'file::plugin::main.php', target: 'hook::init' },
    ];
    expect(deriveFileVisibility(visibleEdges)).toEqual(
      new Set(['file::wp::settings.php', 'file::plugin::main.php'])
    );
  });

  test('files with no visible edges are hidden', () => {
    expect(deriveFileVisibility([])).toEqual(new Set());
  });
});

describe('applyFilterPipeline', () => {
  test('default state shows everything', () => {
    const state = {
      hookType: { actions: true, filters: true },
      dynamic: false,
      overlapping: false,
      highTraffic: { enabled: false, minConnections: 10 },
      repos: { wp: true, plugin: true },
    };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    expect(result.visibleHookIds.size).toBe(5);
    expect(result.visibleEdges).toHaveLength(9);
    expect(result.visibleFileIds.size).toBe(6);
  });

  test('actions + overlapping AND logic', () => {
    const state = {
      hookType: { actions: true, filters: false },
      dynamic: false,
      overlapping: true,
      highTraffic: { enabled: false, minConnections: 10 },
      repos: { wp: true, plugin: true },
    };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    expect(result.visibleHookIds).toEqual(new Set(['hook::init']));
  });

  test('disable a repo hides its exclusive hooks and files', () => {
    const state = {
      hookType: { actions: true, filters: true },
      dynamic: false,
      overlapping: false,
      highTraffic: { enabled: false, minConnections: 10 },
      repos: { wp: true, plugin: false },
    };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    expect(result.visibleHookIds.size).toBe(4);
    expect(result.visibleHookIds.has('hook::dynamic_1')).toBe(false);
    expect(result.visibleHookIds.has('hook::init')).toBe(true);
    expect(result.visibleEdges.every(e => e.source.startsWith('file::wp'))).toBe(true);
    expect(result.visibleFileIds.has('file::plugin::main.php')).toBe(false);
    expect(result.visibleFileIds.has('file::plugin::extra.php')).toBe(false);
  });

  test('high traffic + dynamic AND logic', () => {
    const state = {
      hookType: { actions: true, filters: true },
      dynamic: true,
      overlapping: false,
      highTraffic: { enabled: true, minConnections: 2 },
      repos: { wp: true, plugin: true },
    };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    expect(result.visibleHookIds).toEqual(new Set(['hook::the_title']));
  });
});
