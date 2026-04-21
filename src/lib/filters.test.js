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
  // Raw fire-only orphan: listen_count === 0, fire edge from wp.
  { id: 'hook::admin_init', hook_type: 'action', dynamic: false, sources: ['wp'], fire_count: 1, listen_count: 0 },
  // Raw listen-only orphan: fire_count === 0, listen edge from plugin.
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

const allOn = { fireRepos: { wp: true, plugin: true }, listenRepos: { wp: true, plugin: true } };

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

  test('all sources enabled in both maps keeps all edges to visible hooks', () => {
    expect(filterEdgesByRepo(edges, fileNodes, allVisible, allOn)).toHaveLength(9);
  });

  test('fire-edge from a source unchecked in fireRepos is dropped', () => {
    const state = { fireRepos: { wp: true, plugin: false }, listenRepos: { wp: true, plugin: true } };
    const result = filterEdgesByRepo(edges, fileNodes, allVisible, state);
    // No fire-edge originates from plugin in the fixture, so nothing drops.
    // Confirm by inverse: unchecking wp in fireRepos drops wp fire-edges.
    const state2 = { fireRepos: { wp: false, plugin: true }, listenRepos: { wp: true, plugin: true } };
    const result2 = filterEdgesByRepo(edges, fileNodes, allVisible, state2);
    expect(result).toHaveLength(9);
    // Drops: wp fires to init, the_content, admin_init, the_title = 4 edges
    expect(result2).toHaveLength(5);
    expect(result2.every(e => e.type !== 'fires' || !e.source.startsWith('file::wp'))).toBe(true);
  });

  test('listen-edge from a source unchecked in listenRepos is dropped', () => {
    const state = { fireRepos: { wp: true, plugin: true }, listenRepos: { wp: true, plugin: false } };
    const result = filterEdgesByRepo(edges, fileNodes, allVisible, state);
    // Drops: plugin listens to init, the_content, dynamic_1, the_title = 4 edges
    expect(result).toHaveLength(5);
    expect(result.every(e => e.type !== 'listens' || !e.source.startsWith('file::plugin'))).toBe(true);
  });

  test('edge routing is based on its own edge type, not the other map', () => {
    // plugin unchecked in fireRepos only: plugin listen-edges still kept; no plugin fire-edge exists.
    const state = { fireRepos: { wp: true, plugin: false }, listenRepos: { wp: true, plugin: true } };
    const result = filterEdgesByRepo(edges, fileNodes, allVisible, state);
    const pluginListens = result.filter(e => e.type === 'listens' && e.source.startsWith('file::plugin'));
    expect(pluginListens).toHaveLength(4);
  });

  test('edges to invisible hooks are removed', () => {
    const result = filterEdgesByRepo(edges, fileNodes, new Set(['hook::init']), allOn);
    expect(result).toHaveLength(3);
    expect(result.every(e => e.target === 'hook::init')).toBe(true);
  });

  test('all sources disabled returns empty', () => {
    const state = { fireRepos: { wp: false, plugin: false }, listenRepos: { wp: false, plugin: false } };
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
  const baseState = {
    hookType: { actions: true, filters: true },
    dynamic: false,
    overlapping: false,
    highTraffic: { enabled: false, minConnections: 10 },
    ...allOn,
  };

  test('default state returns hooks with both fire and listen edges', () => {
    const result = applyFilterPipeline(hooks, edges, fileNodes, baseState);
    // hook::init, hook::the_content, hook::the_title have both fire and listen edges.
    // hook::admin_init (fire only) and hook::dynamic_1 (listen only) are hidden.
    expect(result.visibleHookIds).toEqual(
      new Set(['hook::init', 'hook::the_content', 'hook::the_title'])
    );
    expect(result.visibleEdges).toHaveLength(7);
    expect(result.visibleFileIds).toEqual(
      new Set([
        'file::wp::settings.php',
        'file::wp::defaults.php',
        'file::wp::post.php',
        'file::plugin::main.php',
      ])
    );
  });

  test('fire-only hook is hidden even with every toggle on', () => {
    const result = applyFilterPipeline(hooks, edges, fileNodes, baseState);
    expect(result.visibleHookIds.has('hook::admin_init')).toBe(false);
    expect(result.visibleHookIds.has('hook::dynamic_1')).toBe(false);
  });

  test('includeFireOnly shows raw fire-only orphans (listen_count === 0) only', () => {
    const state = { ...baseState, includeFireOnly: true };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    // admin_init is a raw fire-only orphan → added. dynamic_1 is a raw listen-only orphan → stays hidden.
    expect(result.visibleHookIds).toEqual(
      new Set(['hook::init', 'hook::the_content', 'hook::the_title', 'hook::admin_init'])
    );
  });

  test('includeListenOnly shows raw listen-only orphans (fire_count === 0) only', () => {
    const state = { ...baseState, includeListenOnly: true };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    // dynamic_1 is a raw listen-only orphan → added. admin_init stays hidden.
    expect(result.visibleHookIds).toEqual(
      new Set(['hook::init', 'hook::the_content', 'hook::the_title', 'hook::dynamic_1'])
    );
  });

  test('both orphan opt-ins enabled: visible set is two-sided baseline plus raw orphans', () => {
    const state = { ...baseState, includeFireOnly: true, includeListenOnly: true };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    expect(result.visibleHookIds).toEqual(
      new Set(['hook::init', 'hook::the_content', 'hook::the_title', 'hook::admin_init', 'hook::dynamic_1'])
    );
    expect(result.visibleEdges).toHaveLength(9);
  });

  test('both orphan opt-ins off (with all sources checked) equals two-sided baseline', () => {
    const state = { ...baseState, includeFireOnly: false, includeListenOnly: false };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    expect(result.visibleHookIds).toEqual(
      new Set(['hook::init', 'hook::the_content', 'hook::the_title'])
    );
  });

  test('orphan opt-ins still respect directional source filters', () => {
    // Unchecking plugin in listenRepos drops all plugin listen edges.
    // dynamic_1 (raw listen-only orphan) loses its only edge → still hidden even with includeListenOnly.
    // admin_init (raw fire-only orphan) keeps its wp fire edge → visible with includeFireOnly.
    const state = {
      ...baseState,
      includeFireOnly: true,
      includeListenOnly: true,
      listenRepos: { wp: true, plugin: false },
    };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    expect(result.visibleHookIds.has('hook::admin_init')).toBe(true);
    expect(result.visibleHookIds.has('hook::dynamic_1')).toBe(false);
  });

  test('filter-induced emptiness is not an orphan: two-sided hook stays hidden with includeFireOnly', () => {
    // hook::the_content has fire_count=1, listen_count=5 — raw two-sided.
    // Unchecking every listen source drops all its listen edges.
    // Key invariant: includeFireOnly must NOT re-promote it, because listen_count !== 0.
    const state = {
      ...baseState,
      includeFireOnly: true,
      includeListenOnly: true,
      listenRepos: { wp: false, plugin: false },
    };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    expect(result.visibleHookIds.has('hook::the_content')).toBe(false);
    expect(result.visibleHookIds.has('hook::init')).toBe(false);
    expect(result.visibleHookIds.has('hook::the_title')).toBe(false);
    // admin_init (raw fire-only orphan, fire edge from wp) survives and is opted in.
    expect(result.visibleHookIds.has('hook::admin_init')).toBe(true);
    // dynamic_1 lost its only edge (plugin listen) → hidden.
    expect(result.visibleHookIds.has('hook::dynamic_1')).toBe(false);
  });

  test('directional visibility: fire from A + listen from B is visible when both matching maps check A/B', () => {
    // hook::the_content: fires from wp, listens from plugin.
    // With fireRepos.wp=true, listenRepos.plugin=true → visible.
    const state = {
      ...baseState,
      fireRepos: { wp: true, plugin: true },
      listenRepos: { wp: true, plugin: true },
    };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    expect(result.visibleHookIds.has('hook::the_content')).toBe(true);
  });

  test('directional visibility: hook hidden when its fire-source is unchecked in fireRepos', () => {
    // hook::the_content fires only from wp. Unchecking wp in fireRepos drops that edge → no fire → hidden.
    const state = {
      ...baseState,
      fireRepos: { wp: false, plugin: true },
      listenRepos: { wp: true, plugin: true },
    };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    expect(result.visibleHookIds.has('hook::the_content')).toBe(false);
  });

  test('directional visibility: hook hidden when its listen-source is unchecked in listenRepos', () => {
    // hook::the_content listens only from plugin. Unchecking plugin in listenRepos drops that edge → no listen → hidden.
    const state = {
      ...baseState,
      fireRepos: { wp: true, plugin: true },
      listenRepos: { wp: true, plugin: false },
    };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    expect(result.visibleHookIds.has('hook::the_content')).toBe(false);
    // hook::init still has a wp listen and a wp fire → still visible.
    expect(result.visibleHookIds.has('hook::init')).toBe(true);
  });

  test('unchecking every source in fireRepos empties the graph', () => {
    const state = {
      ...baseState,
      fireRepos: { wp: false, plugin: false },
      listenRepos: { wp: true, plugin: true },
    };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    expect(result.visibleHookIds.size).toBe(0);
    expect(result.visibleEdges).toHaveLength(0);
    expect(result.visibleFileIds.size).toBe(0);
  });

  test('unchecking every source in listenRepos empties the graph', () => {
    const state = {
      ...baseState,
      fireRepos: { wp: true, plugin: true },
      listenRepos: { wp: false, plugin: false },
    };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    expect(result.visibleHookIds.size).toBe(0);
    expect(result.visibleEdges).toHaveLength(0);
    expect(result.visibleFileIds.size).toBe(0);
  });

  test('actions + overlapping AND logic', () => {
    const state = {
      ...baseState,
      hookType: { actions: true, filters: false },
      overlapping: true,
    };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    // hook::init is the only action that is overlapping AND has both fire and listen edges.
    expect(result.visibleHookIds).toEqual(new Set(['hook::init']));
  });

  test('high traffic + dynamic AND logic', () => {
    const state = {
      ...baseState,
      dynamic: true,
      highTraffic: { enabled: true, minConnections: 2 },
    };
    const result = applyFilterPipeline(hooks, edges, fileNodes, state);
    // hook::the_title is dynamic, fire+listen count >= 2, and has both fire and listen edges.
    expect(result.visibleHookIds).toEqual(new Set(['hook::the_title']));
  });
});
