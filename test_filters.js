// test_filters.js — Node.js unit tests for filter pipeline
// Run: node test_filters.js

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

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertSetEqual(actual, expected, msg) {
  const a = [...actual].sort();
  const e = [...expected].sort();
  assert(JSON.stringify(a) === JSON.stringify(e), msg + ` — got [${a}], expected [${e}]`);
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${e.message}`);
  }
}

// --- Test data ---

const hooks = [
  { id: 'hook::init', hook_type: 'action', dynamic: false, sources: ['wp', 'plugin'], fire_count: 2, listen_count: 10 },
  { id: 'hook::the_content', hook_type: 'filter', dynamic: false, sources: ['wp'], fire_count: 1, listen_count: 5 },
  { id: 'hook::admin_init', hook_type: 'action', dynamic: false, sources: ['wp'], fire_count: 1, listen_count: 3 },
  { id: 'hook::dynamic_1', hook_type: 'action', dynamic: true, sources: ['plugin'], fire_count: 0, listen_count: 1 },
  { id: 'hook::the_title', hook_type: 'filter', dynamic: true, sources: ['wp', 'plugin'], fire_count: 1, listen_count: 2 },
];

// --- filterByHookType ---

test('filterByHookType: both enabled returns all', () => {
  const state = { hookType: { actions: true, filters: true } };
  const result = filterByHookType(hooks, state);
  assertSetEqual(result, new Set(hooks.map(h => h.id)), 'both enabled');
});

test('filterByHookType: only actions', () => {
  const state = { hookType: { actions: true, filters: false } };
  const result = filterByHookType(hooks, state);
  assertSetEqual(result, new Set(['hook::init', 'hook::admin_init', 'hook::dynamic_1']), 'only actions');
});

test('filterByHookType: only filters', () => {
  const state = { hookType: { actions: false, filters: true } };
  const result = filterByHookType(hooks, state);
  assertSetEqual(result, new Set(['hook::the_content', 'hook::the_title']), 'only filters');
});

test('filterByHookType: both disabled returns empty', () => {
  const state = { hookType: { actions: false, filters: false } };
  const result = filterByHookType(hooks, state);
  assertSetEqual(result, new Set(), 'both disabled');
});

// --- filterByDynamic ---

test('filterByDynamic: disabled returns all', () => {
  const state = { dynamic: false };
  const result = filterByDynamic(hooks, state);
  assertSetEqual(result, new Set(hooks.map(h => h.id)), 'disabled');
});

test('filterByDynamic: enabled returns only dynamic', () => {
  const state = { dynamic: true };
  const result = filterByDynamic(hooks, state);
  assertSetEqual(result, new Set(['hook::dynamic_1', 'hook::the_title']), 'enabled');
});

test('filterByDynamic: enabled with no dynamic hooks returns empty', () => {
  const noDynamic = hooks.filter(h => !h.dynamic);
  const state = { dynamic: true };
  const result = filterByDynamic(noDynamic, state);
  assertSetEqual(result, new Set(), 'no dynamic');
});

// --- filterByOverlapping ---

test('filterByOverlapping: disabled returns all', () => {
  const state = { overlapping: false };
  const result = filterByOverlapping(hooks, state);
  assertSetEqual(result, new Set(hooks.map(h => h.id)), 'disabled');
});

test('filterByOverlapping: enabled returns only multi-source', () => {
  const state = { overlapping: true };
  const result = filterByOverlapping(hooks, state);
  assertSetEqual(result, new Set(['hook::init', 'hook::the_title']), 'multi-source only');
});

test('filterByOverlapping: enabled with all single-source returns empty', () => {
  const singleSource = [
    { id: 'hook::a', sources: ['wp'], hook_type: 'action', dynamic: false, fire_count: 1, listen_count: 1 },
    { id: 'hook::b', sources: ['plugin'], hook_type: 'filter', dynamic: false, fire_count: 1, listen_count: 1 },
  ];
  const state = { overlapping: true };
  const result = filterByOverlapping(singleSource, state);
  assertSetEqual(result, new Set(), 'all single source');
});

// --- filterByHighTraffic ---

test('filterByHighTraffic: disabled returns all', () => {
  const state = { highTraffic: { enabled: false, minConnections: 10 } };
  const result = filterByHighTraffic(hooks, state);
  assertSetEqual(result, new Set(hooks.map(h => h.id)), 'disabled');
});

test('filterByHighTraffic: enabled with threshold 5', () => {
  const state = { highTraffic: { enabled: true, minConnections: 5 } };
  const result = filterByHighTraffic(hooks, state);
  // init: 2+10=12, the_content: 1+5=6, admin_init: 1+3=4, dynamic_1: 0+1=1, the_title: 1+2=3
  assertSetEqual(result, new Set(['hook::init', 'hook::the_content']), 'threshold 5');
});

test('filterByHighTraffic: enabled with threshold 1 returns all', () => {
  const state = { highTraffic: { enabled: true, minConnections: 1 } };
  const result = filterByHighTraffic(hooks, state);
  assertSetEqual(result, new Set(hooks.map(h => h.id)), 'threshold 1');
});

test('filterByHighTraffic: enabled with very high threshold returns empty', () => {
  const state = { highTraffic: { enabled: true, minConnections: 999 } };
  const result = filterByHighTraffic(hooks, state);
  assertSetEqual(result, new Set(), 'very high threshold');
});

// --- Edge/file test data ---

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

// --- intersectSets ---

test('intersectSets: single set returns itself', () => {
  const s = new Set(['a', 'b']);
  assertSetEqual(intersectSets([s]), s, 'single');
});

test('intersectSets: two overlapping sets', () => {
  const a = new Set(['a', 'b', 'c']);
  const b = new Set(['b', 'c', 'd']);
  assertSetEqual(intersectSets([a, b]), new Set(['b', 'c']), 'two sets');
});

test('intersectSets: three sets narrows result', () => {
  const a = new Set(['a', 'b', 'c']);
  const b = new Set(['b', 'c', 'd']);
  const c = new Set(['c', 'd', 'e']);
  assertSetEqual(intersectSets([a, b, c]), new Set(['c']), 'three sets');
});

test('intersectSets: disjoint sets return empty', () => {
  const a = new Set(['a']);
  const b = new Set(['b']);
  assertSetEqual(intersectSets([a, b]), new Set(), 'disjoint');
});

test('intersectSets: empty array returns empty set', () => {
  assertSetEqual(intersectSets([]), new Set(), 'empty input');
});

// --- filterEdgesByRepo ---

test('filterEdgesByRepo: all repos enabled keeps all edges to visible hooks', () => {
  const state = { repos: { wp: true, plugin: true } };
  const visibleHooks = new Set(['hook::init', 'hook::the_content', 'hook::dynamic_1', 'hook::admin_init', 'hook::the_title']);
  const result = filterEdgesByRepo(edges, fileNodes, visibleHooks, state);
  assert(result.length === 9, `expected 9 edges, got ${result.length}`);
});

test('filterEdgesByRepo: disabled repo hides its edges', () => {
  const state = { repos: { wp: true, plugin: false } };
  const visibleHooks = new Set(['hook::init', 'hook::the_content', 'hook::dynamic_1', 'hook::admin_init', 'hook::the_title']);
  const result = filterEdgesByRepo(edges, fileNodes, visibleHooks, state);
  // wp edges: settings->init, defaults->init, post->the_content, admin->admin_init, post->the_title = 5
  assert(result.length === 5, `expected 5 edges, got ${result.length}`);
  assert(result.every(e => e.source.startsWith('file::wp')), 'only wp edges');
});

test('filterEdgesByRepo: edges to invisible hooks are removed', () => {
  const state = { repos: { wp: true, plugin: true } };
  const visibleHooks = new Set(['hook::init']);
  const result = filterEdgesByRepo(edges, fileNodes, visibleHooks, state);
  assert(result.every(e => e.target === 'hook::init'), 'only init edges');
  assert(result.length === 3, `expected 3 edges, got ${result.length}`);
});

test('filterEdgesByRepo: all repos disabled returns empty', () => {
  const state = { repos: { wp: false, plugin: false } };
  const visibleHooks = new Set(['hook::init', 'hook::the_content']);
  const result = filterEdgesByRepo(edges, fileNodes, visibleHooks, state);
  assert(result.length === 0, 'all repos disabled');
});

// --- deriveFileVisibility ---

test('deriveFileVisibility: files with visible edges are visible', () => {
  const visibleEdges = [
    { source: 'file::wp::settings.php', target: 'hook::init' },
    { source: 'file::plugin::main.php', target: 'hook::init' },
  ];
  const result = deriveFileVisibility(visibleEdges);
  assertSetEqual(result, new Set(['file::wp::settings.php', 'file::plugin::main.php']), 'visible files');
});

test('deriveFileVisibility: files with no visible edges are hidden', () => {
  const result = deriveFileVisibility([]);
  assertSetEqual(result, new Set(), 'no edges');
});

// --- applyFilterPipeline (integration) ---

test('applyFilterPipeline: default state shows everything', () => {
  const state = {
    hookType: { actions: true, filters: true },
    dynamic: false,
    overlapping: false,
    highTraffic: { enabled: false, minConnections: 10 },
    repos: { wp: true, plugin: true },
  };
  const result = applyFilterPipeline(hooks, edges, fileNodes, state);
  assert(result.visibleHookIds.size === 5, `expected 5 hooks, got ${result.visibleHookIds.size}`);
  assert(result.visibleEdges.length === 9, `expected 9 edges, got ${result.visibleEdges.length}`);
  assert(result.visibleFileIds.size === 6, `expected 6 files, got ${result.visibleFileIds.size}`);
});

test('applyFilterPipeline: actions + overlapping AND logic', () => {
  const state = {
    hookType: { actions: true, filters: false },
    dynamic: false,
    overlapping: true,
    highTraffic: { enabled: false, minConnections: 10 },
    repos: { wp: true, plugin: true },
  };
  const result = applyFilterPipeline(hooks, edges, fileNodes, state);
  // actions: init, admin_init, dynamic_1. overlapping (sources>=2): init, the_title. Intersection: init only.
  assertSetEqual(result.visibleHookIds, new Set(['hook::init']), 'actions + overlapping');
});

test('applyFilterPipeline: disable a repo hides its exclusive hooks and files', () => {
  const state = {
    hookType: { actions: true, filters: true },
    dynamic: false,
    overlapping: false,
    highTraffic: { enabled: false, minConnections: 10 },
    repos: { wp: true, plugin: false },
  };
  const result = applyFilterPipeline(hooks, edges, fileNodes, state);
  // dynamic_1 only has plugin edges -> hidden. Other 4 hooks have wp edges -> visible.
  assert(result.visibleHookIds.size === 4, `expected 4 hooks, got ${result.visibleHookIds.size}`);
  assert(!result.visibleHookIds.has('hook::dynamic_1'), 'dynamic_1 hidden (plugin-only hook)');
  assert(result.visibleHookIds.has('hook::init'), 'init stays (shared hook)');
  assert(result.visibleEdges.every(e => e.source.startsWith('file::wp')), 'only wp edges');
  assert(!result.visibleFileIds.has('file::plugin::main.php'), 'plugin file hidden');
  assert(!result.visibleFileIds.has('file::plugin::extra.php'), 'plugin extra hidden');
});

test('applyFilterPipeline: high traffic + dynamic AND logic', () => {
  const state = {
    hookType: { actions: true, filters: true },
    dynamic: true,
    overlapping: false,
    highTraffic: { enabled: true, minConnections: 2 },
    repos: { wp: true, plugin: true },
  };
  const result = applyFilterPipeline(hooks, edges, fileNodes, state);
  // dynamic: dynamic_1 (0+1=1), the_title (1+2=3). highTraffic>=2: the_title only. Intersection: the_title.
  assertSetEqual(result.visibleHookIds, new Set(['hook::the_title']), 'dynamic + high traffic');
});

// --- Summary ---

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) process.exit(1);
