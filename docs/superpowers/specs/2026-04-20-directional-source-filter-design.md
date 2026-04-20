# Directional Source Filter

**Status:** Approved, ready for implementation plan
**Date:** 2026-04-20

## Problem

The sidebar's Sources section has one toggle per scanned repo. It can hide every edge from a given source, but it cannot express the most interesting question the user wants to ask: *"show me hooks that are fired from one source and listened from another."*

The CLI flag `--skip-hook-names` exists as a noise-reduction workaround, but it operates on hook names and has to be re-run to change. It does not address the real need.

## Goal

Replace the symmetric per-source toggle with a directional filter: independently select which sources count as **Fire sources** and which count as **Listen sources**. A hook is visible only when at least one of its fire-edges comes from a checked fire-source *and* at least one of its listen-edges comes from a checked listen-source.

Remove `--skip-hook-names` as part of this change — it was a workaround for the missing directional filter and has no remaining reason to exist.

## Non-goals

- No changes to the parser, the JSON schema, or the graph builder (hooks, edges, file nodes, and `source` metadata all stay the same).
- No new UI primitives outside the WordPress design system. Everything is expressed as `DataForm` fields and cards, which render through `CollapsibleCard` + `ToggleControl`.
- No per-file or per-path granularity; selection is at the source (scanned-directory) level.
- No CLI equivalent — this is a runtime viewer filter.

## Semantics

A hook is visible iff **both**:
1. ≥ 1 fire-edge originates from a source checked in **Fire sources**, AND
2. ≥ 1 listen-edge originates from a source checked in **Listen sources**.

Corollaries:
- A hook with no listeners found in the scan is hidden regardless of Listen-source selection (no listen-edge can satisfy rule 2).
- A hook with no fire locations in the scan is hidden regardless of Fire-source selection.
- Unchecking every source in either list empties the graph.
- Default state (every source checked in both lists) produces the same visible set as today's "all sources checked" state — identical baseline behavior.

## State model

`useFilterState.js` — replace `state.repos: { [label]: bool }` with:

```js
fireRepos:   { [label]: bool }   // initialized to true for every source
listenRepos: { [label]: bool }   // initialized to true for every source
```

Reducer actions:
- `TOGGLE_FIRE_REPO   { label }`
- `TOGGLE_LISTEN_REPO { label }`
- `INIT_REPOS         { labels }` — seeds both maps to `true` for every label (one action, not two)

`TOGGLE_REPO` and `state.repos` are removed. `useFilterState` exposes `toggleFireRepo` / `toggleListenRepo` in place of `toggleRepo`. `initialState.repos` becomes `initialState.fireRepos = {}` and `initialState.listenRepos = {}`.

## Filter pipeline

`src/lib/filters.js` — `filterEdgesByRepo` routes each edge to the map matching its `edge_type`:

```js
function filterEdgesByRepo(edges, fileNodes, visibleHookIds, state) {
  var fileSourceMap = {};
  for (var i = 0; i < fileNodes.length; i++) {
    fileSourceMap[fileNodes[i].id] = fileNodes[i].source;
  }
  return edges.filter(function (e) {
    if (!visibleHookIds.has(e.target)) return false;
    var source = fileSourceMap[e.source];
    if (!source) return true;
    var map = e.edge_type === 'fires' ? state.fireRepos : state.listenRepos;
    if (!map[source]) return false;
    return true;
  });
}
```

`applyFilterPipeline` — after edge filtering, narrow hooks to those with **both** a surviving fire-edge *and* a surviving listen-edge, then drop orphaned edges:

```js
var hooksWithFire = new Set();
var hooksWithListen = new Set();
for (var i = 0; i < visibleEdges.length; i++) {
  var e = visibleEdges[i];
  if (e.edge_type === 'fires')   hooksWithFire.add(e.target);
  if (e.edge_type === 'listens') hooksWithListen.add(e.target);
}
visibleHookIds = new Set(
  [...visibleHookIds].filter(id => hooksWithFire.has(id) && hooksWithListen.has(id))
);
visibleEdges = visibleEdges.filter(e => visibleHookIds.has(e.target));
```

This is the one behavioral change in the pipeline: today it accepts a hook with surviving edges of any kind; the new version requires one of each.

## Sidebar UI

`src/components/Sidebar.jsx` — the existing `sources` card is removed; two sibling cards take its place. No new component primitives.

**Fields** — per source, two toggle fields:

```js
sourceLabels.forEach((label) => {
  f.push({ id: `fire_repo__${label}`,   label, type: 'boolean', Edit: 'toggle' });
  f.push({ id: `listen_repo__${label}`, label, type: 'boolean', Edit: 'toggle' });
});
```

**Summary fields** — replace `sources_summary` with two:

```js
{ id: 'fire_sources_summary',   type: 'text', label: '', readOnly: true,
  getValue: ({ item }) => summarize(item, 'fire_repo__') },
{ id: 'listen_sources_summary', type: 'text', label: '', readOnly: true,
  getValue: ({ item }) => summarize(item, 'listen_repo__') },
```

Where `summarize(item, prefix)` returns `` `${active} of ${sourceLabels.length}` ``, counting labels where `item[prefix + label] !== false`.

**Cards** — replace the single `sources` card:

```js
{
  id: 'fire-sources',
  label: 'Fire sources',
  description: 'Where hooks are triggered',
  layout: { type: 'card', summary: 'fire_sources_summary' },
  children: sourceLabels.map((l) => `fire_repo__${l}`),
},
{
  id: 'listen-sources',
  label: 'Listen sources',
  description: 'Where hooks are handled',
  layout: { type: 'card', summary: 'listen_sources_summary' },
  children: sourceLabels.map((l) => `listen_repo__${l}`),
},
```

**`formData`** — replace the single `repo__` loop with two loops, one for each map. **`handleChange`** — route `fire_repo__` prefix to `toggleFireRepo` and `listen_repo__` prefix to `toggleListenRepo`; remove the `repo__` branch.

## Removal of `--skip-hook-names`

Clean removal — local tooling, no external callers, no deprecation shim.

**`hooks_graph.php`**
- Remove the `case '--skip-hook-names':` branch from the arg parser.
- Remove the `--skip-hook-names` lines from the help block and the example list.
- Remove the `$skip_hook_names` parsing loop.
- Remove the `if (!empty($skip_hook_names))` block that invokes `filter_graph_by_hook_names`.
- Delete the `filter_graph_by_hook_names()` function.
- Remove the `$meta['skip_hook_names'] = $skip_patterns;` metadata write.

**`tests/test_graph.php`**
- Delete the test that asserts on `$filtered['metadata']['skip_hook_names']`.
- Delete any other tests exercising `filter_graph_by_hook_names`.

**`README.md`**
- Remove the `--skip-hook-names` usage example and any explanatory prose.

`CLAUDE.md` does not mention `--skip-hook-names` and requires no change.

## Testing

**`src/lib/filters.test.js`** — update existing tests that reference `state.repos`; add:

- `filterEdgesByRepo` — a fire-edge from a source unchecked in `fireRepos` is dropped; a listen-edge from a source unchecked in `listenRepos` is dropped; an edge whose source is checked in one map but not the other is kept or dropped based on its `edge_type`, not based on both maps.
- `applyFilterPipeline` — a hook with `fire` from A and `listen` from B is visible when A is checked in `fireRepos` and B is checked in `listenRepos`; hidden when either side's relevant check is off.
- `applyFilterPipeline` — a hook with only fire-edges (no listeners found in scan) is hidden even with every toggle on.
- `applyFilterPipeline` — default state (every label `true` in both maps) produces the same visible set as today's "all repos checked" baseline.

**`tests/test_graph.php`** — the `skip_hook_names` test is removed as part of §5; no new PHP tests needed (the semantic change lives entirely in JS).

**Manual smoke check** — scan two repos (e.g., `wp-core` + a plugin) and verify:
- All-on state shows the same graph as today.
- Unchecking the plugin in Fire sources hides plugin-fired hooks while core-fired hooks remain.
- Unchecking core in Listen sources hides hooks listened only by core.
- Unchecking every source in either list empties the graph.
