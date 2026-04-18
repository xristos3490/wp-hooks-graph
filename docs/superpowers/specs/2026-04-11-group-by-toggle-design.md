# Group By Toggle — Design Spec

## Context

The parser now extracts `scope_class` and `scope_function` per hook call. This data flows through to edges in the JSON output. The viewer currently shows file→hook relationships. This feature adds a toggle to switch source nodes from files to classes, giving a class-centric view of hook registration.

## Behavior

A "Group by" dropdown in the sidebar with two options: **File** (default, current behavior) and **Class**.

### File mode (default)
No change from current behavior. Source nodes are file nodes (`file::{source}::{path}`).

### Class mode
Source nodes are replaced based on edge `scope_class`:
- Edges with `scope_class` → source becomes a class node (`class::{source}::{className}`)
- Edges without `scope_class` → source stays as the original file node

One class node per source/repo (e.g. `WC_Bookings` in `woocommerce` and `WC_Bookings` in `wc-bookings` are separate nodes).

## Implementation

### Sidebar UI
A `<select>` dropdown labeled "Group by" placed in the sidebar filter area, above the hook type toggles. Options: `file`, `class`. Triggers full graph rebuild on change.

### Graph rebuild
When `groupBy` changes, call a new function `rebuildGraph()` that:
1. Clears all Cytoscape elements
2. Re-runs the element construction loop from `hookDataCache`
3. During element construction, checks `groupBy` state to determine source node type
4. Re-applies current filter state
5. Re-runs layout

### Element construction changes
The existing element construction loop (lines ~1200-1250) is extracted into a function `buildElements(data, groupBy)` that returns the elements array.

When `groupBy === 'class'`:
- Build a mapping: for each edge with `scope_class`, compute the class node ID (`class::{source}::{scope_class}`)
- Create class nodes on first encounter: `{ id, type: 'class', name: className, source, hook_count: 0 }`
- Increment `hook_count` for each edge routed to the class node
- Replace `edge.source` (file ID) with the class node ID
- Edges without `scope_class` keep their original file node as source
- File nodes that have ALL their edges rerouted to class nodes are omitted
- File nodes that retain at least one edge (no scope_class) are kept

### Class node appearance
- Same shape as file nodes (default rectangle)
- Labeled with the class name
- Sized by `hook_count` using the same scaling as file nodes
- Colored by `sourceIndex` using the same repo color palette

### Detail panel for class nodes
When a class node is clicked, `showDetail()` handles `type === 'class'`:
- Title: class name
- Badge: "class" with tertiary dot (similar to file badge)
- Subtitle: source repo name
- Stats: fires count, listens count
- Edge lists: same "Fires" and "Listens to" sections as file detail, showing hook names, callbacks, scope_function, priority, line numbers

### Filter integration
No changes to `filters.js`. The existing `deriveFileVisibility()` function works on node IDs from visible edges. Since class nodes replace file nodes as edge sources, they naturally become visible/hidden through the same mechanism. The pipeline key `source|target|line` for edge visibility still works because edge targets (hook nodes) don't change.

The `fileSourceIndexMap` construction needs to include class nodes so edges get the correct `sourceIndex` for coloring.

### State management
- Add `groupBy: 'file'` to the top-level state (not inside `filterState`, since it's a view mode, not a filter)
- Persist across filter changes — changing a filter should not reset the groupBy

## Files to modify

| File | Change |
|------|--------|
| `index.html` | Add dropdown UI, extract `buildElements()`, add class node construction, update `showDetail()` for class type, add `rebuildGraph()` |

No changes to `parser.py`, `graph.py`, `filters.js`, or test files. This is purely a viewer feature using data already present in the JSON.

## Verification
1. Load existing JSON with scope data (e.g. `storage/new_metrics_wc_bookings.json`)
2. Default view shows file nodes (unchanged)
3. Switch to Class → file nodes with scope_class are replaced by class nodes
4. File nodes without scope_class remain visible
5. Click a class node → detail panel shows class info with fires/listens
6. Filters still work in class mode (hook type, dynamic, overlapping, high traffic, repo toggles)
7. Search still works in class mode
8. Switch back to File → original view restored
