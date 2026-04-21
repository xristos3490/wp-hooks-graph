# Unified Sources Card

**Status:** Approved, ready for implementation plan
**Date:** 2026-04-21
**Supersedes partially:** `2026-04-20-directional-source-filter-design.md` (the directional filter stays; the sidebar layout and the "Include one-sided" concept are reworked)

## Problem

After the directional source filter landed, the sidebar has three places that all influence whether a hook with one missing side survives:

1. `Fire sources` card — unchecking sources drops fire-edges.
2. `Listen sources` card — unchecking sources drops listen-edges.
3. `Include one-sided` toggle (in the Focus card) — flips the final AND/OR on surviving edges.

These three controls interact in non-obvious ways. A user trying to express *"show me hooks fired by X, ignore listeners"* has to uncheck every listen-source **and** enable "Include one-sided". The same toggle is also the only path to see genuine data orphans — hooks fired in the scan with no listener parsed anywhere, or vice versa. One control, two unrelated jobs.

## Goal

Disentangle the two jobs:

1. **"Which sources count"** — the directional per-repo toggles. Unchanged in semantics.
2. **"What to do with raw-data orphans"** — a property of the hook itself, not of the user's filter state.

Consolidate both into a single **Sources** card in the sidebar, using DataForm primitives only (zero custom CSS, no custom Edit components, no nested cards).

## Non-goals

- No parser, JSON schema, or CLI changes.
- No change to directional filter semantics — the part where unchecked sources drop their edges stays exactly as in the prior spec.
- No new UI primitives outside `@wordpress/dataviews` DataForm layouts (`card`, `row`, `regular`).
- No "mode" switcher or tri-state per-source control (rejected during brainstorming).

## Semantics

`state.includeOneSided` is removed. Two independent booleans replace it:

- `state.includeFireOnly` — show hooks whose raw data has ≥1 fire-edge and **zero** listen-edges.
- `state.includeListenOnly` — show hooks whose raw data has ≥1 listen-edge and **zero** fire-edges.

Both default to `true`.

A hook is visible iff **at least one** of:

1. **Two-sided:** has ≥1 surviving fire-edge AND ≥1 surviving listen-edge (after source filter).
2. **Fire-only orphan, opted in:** raw `listen_count === 0` AND has ≥1 surviving fire-edge AND `includeFireOnly`.
3. **Listen-only orphan, opted in:** raw `fire_count === 0` AND has ≥1 surviving listen-edge AND `includeListenOnly`.

**Key invariant:** "orphan" refers to raw scan data, not to filter-induced emptiness. A hook with `fire_count > 0` and `listen_count > 0` whose listen side is hidden entirely by source-filter choice is **not** an orphan, and does not get re-promoted by `includeFireOnly`. This is what keeps the two concepts non-interacting.

### Baseline comparison

With today's default (`includeOneSided: false`, all sources checked), only two-sided hooks are visible.
With the new default (`includeFireOnly: true`, `includeListenOnly: true`, all sources checked), two-sided hooks **plus** raw orphans are visible. Slightly more permissive, matching the user's "default all" intent.

## State model

`src/hooks/useFilterState.js`:

```js
// initialState
{
  hookType: { actions: true, filters: true },
  dynamic: false,
  overlapping: false,
  includeFireOnly: true,   // new, replaces includeOneSided
  includeListenOnly: true, // new, replaces includeOneSided
  highTraffic: { enabled: false, minConnections: 10 },
  fireRepos: {},
  listenRepos: {},
}
```

No new reducer actions — `TOGGLE_BOOL_FILTER` already handles arbitrary top-level boolean keys.

## Filter pipeline

`src/lib/filters.js` — `applyFilterPipeline` final step changes.

Build a `hooksById` lookup at the top of the function (so the final filter can read `fire_count` / `listen_count`). Then:

```js
visibleHookIds = new Set([...visibleHookIds].filter(function (id) {
  var hook = hooksById[id];
  var hasFire = hooksWithFire.has(id);
  var hasListen = hooksWithListen.has(id);
  if (hasFire && hasListen) return true;
  if (hasFire && hook.listen_count === 0 && state.includeFireOnly) return true;
  if (hasListen && hook.fire_count === 0 && state.includeListenOnly) return true;
  return false;
}));
visibleEdges = visibleEdges.filter(function (e) { return visibleHookIds.has(e.target); });
```

The pre-orphan steps (hook-type, dynamic, overlapping, high-traffic, directional edge filter) are untouched.

## Sidebar UI

`src/components/Sidebar.jsx` — replace the two existing `fire-sources` / `listen-sources` cards and remove `includeOneSided` from the `focus` card. Add a single `sources` card.

### Fields

Per source, two toggles (labels simplified — source name is carried by the enclosing row, not the toggle):

```js
sourceLabels.forEach((label) => {
  f.push({ id: `fire_repo__${label}`,   label: 'Fires',   type: 'boolean', Edit: 'toggle' });
  f.push({ id: `listen_repo__${label}`, label: 'Listens', type: 'boolean', Edit: 'toggle' });
});
```

Two new orphan toggles:

```js
{
  id: 'includeFireOnly',
  label: 'Include fire-only hooks',
  description: 'Hooks fired in the scan with no listener found anywhere',
  type: 'boolean',
  Edit: 'toggle',
},
{
  id: 'includeListenOnly',
  label: 'Include listen-only hooks',
  description: 'Hooks listened to with no fire location found anywhere',
  type: 'boolean',
  Edit: 'toggle',
},
```

Single summary field (replaces `fire_sources_summary` and `listen_sources_summary`):

```js
{
  id: 'sources_summary',
  type: 'text',
  label: '',
  readOnly: true,
  getValue: ({ item }) => {
    const f = sourceLabels.filter((l) => item[`fire_repo__${l}`] !== false).length;
    const n = sourceLabels.filter((l) => item[`listen_repo__${l}`] !== false).length;
    return `${f}/${sourceLabels.length} fires · ${n}/${sourceLabels.length} listens`;
  },
},
```

### Form

```js
{
  id: 'sources',
  label: 'Sources',
  description: 'Fire and listen sources per scanned repo',
  layout: { type: 'card', summary: 'sources_summary' },
  children: [
    ...sourceLabels.map((label) => ({
      id: `source-row__${label}`,
      label,
      layout: { type: 'row' },
      children: [`fire_repo__${label}`, `listen_repo__${label}`],
    })),
    'includeFireOnly',
    'includeListenOnly',
  ],
}
```

DataForm renders this as: outer CollapsibleCard → one labeled horizontal row per source (row label = source name, contents = two toggles side-by-side) → two stacked toggles for orphans.

### formData / handleChange

`formData` drops the `includeOneSided` entry and adds `includeFireOnly` and `includeListenOnly`. The two per-source loops stay as in the prior spec.

`handleChange` routes `includeFireOnly` and `includeListenOnly` through the existing `toggleBoolFilter` branch (same path that `includeOneSided` used).

### Removed from `focus` card

The `focus` card's `children` list drops `includeOneSided`. Result:

- With overlap metadata present or single-source: `['dynamic']`
- Multi-source without overlap metadata: `['dynamic', 'overlapping']`

## Testing

`src/lib/filters.test.js`:

- Replace every existing test that sets or asserts on `state.includeOneSided` with equivalent tests for `includeFireOnly` / `includeListenOnly`.
- Add: hook with `fire_count > 0` and `listen_count > 0`, every listen-source unchecked → **hidden** regardless of `includeFireOnly`. (Filter-induced emptiness is not an orphan.)
- Add: raw fire-orphan (`listen_count === 0`) with a surviving fire-edge → visible iff `includeFireOnly`.
- Add: raw listen-orphan (`fire_count === 0`) with a surviving listen-edge → visible iff `includeListenOnly`.
- Add: with both orphan toggles off and all sources checked, the visible set equals today's `includeOneSided: false` baseline.
- Add: with both orphan toggles on (new default) and all sources checked, the visible set equals that baseline plus raw orphans, and nothing else.

No new PHP tests needed — the change is viewer-only.

## Documentation

`README.md` — one line near the filter description: the Sources card holds per-repo fire/listen toggles and two opt-ins for raw fire-only / listen-only hooks. Remove any lingering mention of "Include one-sided".

`CLAUDE.md` — no change required.

## Layout caveat (deliberate)

True column-header matrix (`Fires | Listens` header row above a series of per-source rows) would require either a custom heading component or CSS grid. Both violate the "DataForm primitives only, zero custom CSS" constraint. The chosen realization — source name as row label, toggle labels "Fires" / "Listens" — encodes the same two-axis intent using only supported DataForm layouts (`card` + nested `row`). If a header-row is desired later, it can be added without changing state, fields, or filter semantics.
