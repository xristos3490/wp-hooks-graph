# Sidebar Redesign Spec

## Goal

Improve the sidebar in `index.html` to be easier to use and more professional for teammates and external users. Consolidate fragmented filter sections, rewrite jargon-heavy copy, and reduce cognitive load.

## Approach

Merge the current 5 sidebar sections into 3 logical groups. Rewrite all labels and descriptions for clarity. No functional changes to filtering logic.

## Current Structure (5 sections)

1. Hero — title, subtitle, 4-stat grid
2. Hook Types — Actions/Filters toggles
3. Behavior — Dynamic/Overlapping toggles
4. High Traffic — toggle + threshold slider
5. Repositories — per-repo visibility toggles

## New Structure (3 sections)

### Section 1: Header

No changes. Title ("Hooks Graph"), dynamic subtitle, and stats grid (FILES, HOOKS, DYNAMIC, OVERLAP) stay as-is.

### Section 2: Filters (unified)

One section titled **"FILTERS"** replaces Hook Types + Behavior + High Traffic. Contains three subgroups separated by spacing (no dividers):

**Subgroup: "Show by type"**

| Label | Description | Toggle default |
|-------|-------------|----------------|
| Actions | Hooks that fire callbacks (do_action) | ON |
| Filters | Hooks that transform values (apply_filters) | ON |

**Subgroup: "Focus"**

| Label | Description | Toggle default |
|-------|-------------|----------------|
| Dynamic only | Hook names built at runtime, like `{$post_type}_save` | OFF |
| Overlapping only | Hooks that appear in more than one repository | OFF |

- "Overlapping only" row is hidden when data was pre-filtered with `--overlap-only` (same behavior as today).

**Subgroup: "Hotspots"**

The hotspot toggle moves to a filter row with the label "Hotspots" and description "Only hooks with many connections". Below it, the min-connections slider (same as today's slider, disabled when toggle is off).

- Removes the separate "Enabled" label row — the toggle is on the "Hotspots" row itself.

### Section 3: Sources

Renamed from "REPOSITORIES" to **"SOURCES"**.

- Section description ("Toggle visibility per source") removed — the UI is self-explanatory.
- Per-source toggle rows with colored dots stay identical.

## Copy Changes

| Location | Current | New |
|----------|---------|-----|
| Section title | HOOK TYPES | *(merged into FILTERS)* |
| Section desc | Show or hide hooks by their type | *(removed)* |
| Filter desc | Fires callbacks | Hooks that fire callbacks (do_action) |
| Filter desc | Transforms values | Hooks that transform values (apply_filters) |
| Section title | BEHAVIOR | *(merged into FILTERS)* |
| Section desc | Filter by hook characteristics | *(removed)* |
| Filter label | Dynamic | Dynamic only |
| Filter desc | Runtime-constructed hook names | Hook names built at runtime, like `{$post_type}_save` |
| Filter label | Overlapping | Overlapping only |
| Filter desc | Hooks shared across multiple repositories | Hooks that appear in more than one repository |
| Section title | HIGH TRAFFIC | *(merged into FILTERS)* |
| Section desc | Surface hooks with many connections | *(removed)* |
| Filter label | Enabled | *(removed — toggle on Hotspots row)* |
| New filter label | — | Hotspots |
| New filter desc | — | Only hooks with many connections |
| Section title | REPOSITORIES | SOURCES |
| Section desc | Toggle visibility per source | *(removed)* |

## Visual Changes

- Dividers between Hook Types, Behavior, and High Traffic are removed.
- New `.subgroup-title` class: `font-size: 11px`, `font-weight: 500`, `color: var(--text-tertiary)`, `letter-spacing: 0.06em` (same as `.section-title`), but **no `text-transform: uppercase`** — rendered in sentence case (e.g. "Show by type"). `margin-bottom: 8px`.
- One divider remains between Filters and Sources.
- Spacing between subgroups (~16px margin-top) provides visual separation without dividers.

## Structural Changes to HTML

- Remove three `<div class="sidebar-divider">` elements (between Hook Types/Behavior, Behavior/High Traffic, High Traffic/Repositories).
- Wrap the three subgroups inside a single `<div class="sidebar-section">` with section title "FILTERS".
- Add a new CSS class `.subgroup-title` for subgroup headings (sentence case, same font-size as `.section-title` but no uppercase transform).
- Move the hotspot toggle from a standalone "Enabled" row into a standard `.filter-row` with label "Hotspots" and description "Only hooks with many connections".

## What Does NOT Change

- All JavaScript filter logic (`toggleHookType`, `toggleBoolFilter`, `toggleHighTraffic`, `onHighTrafficSlider`, `applyFilters`).
- Toggle IDs and their `onclick` handlers.
- Slider behavior (disabled when toggle is off).
- Stats grid content and layout.
- Detail panel, search, legend, graph rendering.
- Color scheme, typography, existing CSS variables.
