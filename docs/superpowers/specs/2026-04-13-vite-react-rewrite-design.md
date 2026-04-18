# Vite + React Rewrite on WordPress Design System

**Date:** 2026-04-13
**Status:** Approved

## Overview

Rewrite the self-contained `index.html` viewer into a Vite-powered React application built on the WordPress design system. The goal is a foundation for growth — clean component architecture, proper state management, and WordPress-native UI — while maintaining feature parity with the current viewer.

## Approach

Big bang rewrite. Replace `index.html` with a new `src/` directory. The current file is ~2400 lines in a single file with no UI-layer tests to preserve. `filters.js` (the only tested module) is kept as-is and imported directly.

## Design-System Priority Stack

All component and styling decisions follow this order:

1. `@wordpress/theme` for design tokens
2. `@wordpress/ui` for confirmed primitives
3. `@wordpress/components` for mature production components not yet in `@wordpress/ui`
4. Custom components only when no WordPress package covers the need

**Implementation note:** The executor should invoke the `wordpress-react-ui` skill before writing any component code, to ensure all choices follow the three-orchestrator pattern (theme, UI, layout) and the package priority stack.

## Project Structure

```
wp-hooks-graph/
├── index.html                → Vite entry point (minimal, mounts #root)
├── vite.config.js            → React plugin, JSON-serving plugin, port 8080
├── package.json              → Updated with React, WP packages, Vite deps
├── src/
│   ├── main.jsx              → ReactDOM.createRoot, renders <App />
│   ├── App.jsx               → Top-level: loading state → app shell
│   ├── components/
│   │   ├── LoadingScreen.jsx
│   │   ├── Sidebar.jsx
│   │   ├── GraphCanvas.jsx
│   │   ├── SearchOverlay.jsx
│   │   ├── DetailPanel.jsx
│   │   └── Legend.jsx
│   ├── hooks/
│   │   ├── useGraphData.js
│   │   └── useFilterState.js
│   ├── context/
│   │   └── GraphContext.js
│   ├── lib/
│   │   ├── cytoscape-setup.js  → Cytoscape init, styles, layout logic
│   │   ├── color-palette.js    → hslToHex, generateRepoPalette, etc.
│   │   └── constants.js        → OVERLAP_ACTION, THEME_COLORS, etc.
│   └── styles/
│       ├── tokens.css          → Custom graph tokens (extends WP theme)
│       └── components/         → Per-component CSS as needed
├── filters.js                → Kept in place, imported from src/
├── test_filters.js           → Unchanged, still works
├── index.legacy.html         → Old index.html, preserved but retired
├── serve.py                  → Updated to serve dist/ for production
├── (Python files unchanged)
```

## Data Flow & State Management

### Data Loading — `useGraphData`

- Auto-fetches `/api/hooks.json` on mount
- Exposes `loadFile(file)` for the upload path
- Large files (>1MB) parsed in a Web Worker (same as current)
- Returns `{ data, isLoading, error }`

### Filter State — `useFilterState`

- `useReducer` with actions: `TOGGLE_HOOK_TYPE`, `TOGGLE_BOOL_FILTER`, `TOGGLE_REPO`, `TOGGLE_HIGH_TRAFFIC`, `SET_HIGH_TRAFFIC_VALUE`
- Calls `applyFilterPipeline()` from `filters.js` inside a `useMemo`
- Returns `{ filterState, dispatch, filterResult }`
- `filterResult` is `{ visibleHookIds, visibleEdges, visibleFileIds }`

### Graph Context — `GraphContext`

Provides to all components:
- Cytoscape instance ref (set by `GraphCanvas` after init)
- `graphData` from the loader
- `filterResult` from the filter hook
- `selectedNode` state (drives detail panel)
- `searchQuery` state (drives highlighting)
- Functions: `selectNode(id)`, `clearSelection()`, `setSearchQuery(q)`

### Data Flow Diagram

```
JSON → useGraphData → App state
                        ↓
                    useFilterState (calls filters.js)
                        ↓
                    GraphContext (provides everything)
                        ↓
          ┌─────────────┼──────────────┐
       Sidebar     GraphCanvas    DetailPanel
    (dispatches    (reads filter   (reads
     filter         result,        selectedNode)
     actions)       applies to cy)
```

Components never touch `cy` directly except `GraphCanvas`. Other components interact through context functions that `GraphCanvas` listens to via effects.

## Component Responsibilities

### `App.jsx`
- Owns `useGraphData` and `useFilterState`
- Wraps everything in `GraphContext.Provider`
- Conditionally renders `LoadingScreen` or app shell
- App shell is a flex row: `Sidebar | GraphArea`

### `LoadingScreen.jsx`
- `EmptyState` from `@wordpress/ui` (Root, Icon, Title, Description, Actions)
- `Button` from `@wordpress/components` wrapping a hidden file input
- Calls `loadFile()` from context on file selection

### `Sidebar.jsx`
- `Panel` with `PanelBody` sections from `@wordpress/components`
- Hero section: app title, subtitle, stats grid using `Box`/`Stack` from `@wordpress/ui`
- Filters: `ToggleControl` for each boolean filter, `RangeControl` for hotspot threshold
- Sources: repo toggles with colored dots, each a `ToggleControl`
- All dispatches go through `useFilterState` dispatch

### `GraphCanvas.jsx`
- Renders container div, owns `cyRef` via `useRef`
- `useEffect` initializes Cytoscape on mount, stores instance in context
- `useEffect` watches `filterResult` — applies visibility via `cy.batch()`
- `useEffect` watches `searchQuery` — applies highlight/fade classes
- Handles tap/hover events, calls `selectNode()` / `clearSelection()`
- Manages layout computation and progress overlay internally
- Owns all imperative Cytoscape logic — nothing leaks out

### `SearchOverlay.jsx`
- Positioned absolute over graph area
- `SearchControl` from `@wordpress/components`
- Theme toggle: icon-only `Button` with `Tooltip` from `@wordpress/ui`
- Group-by toggle: icon-only `Button` with `Tooltip` from `@wordpress/ui`

### `DetailPanel.jsx`
- Reads `selectedNode` from context
- Slide-in panel with current animation (280ms cubic-bezier)
- Renders hook/file/class views — feature parity with current behavior
- Edge items clickable, calls `selectNode()` to navigate
- Close button calls `clearSelection()`

### `Legend.jsx`
- Positioned absolute, bottom-center over graph area
- Reads source labels and color palette from context
- Colored dots + edge type indicators
- Shows/hides based on graph data loaded state

## WordPress Package Mapping

### From `@wordpress/ui`
| Current Element | WP Component |
|---|---|
| Loading screen | `EmptyState` |
| Type badge | `Badge` |
| Sidebar layout | `Box`, `Stack` |
| Stats grid | `Box`, `Stack` |
| Button tooltips | `Tooltip` |
| Detail panel scroll | `ScrollArea` |
| Detail panel cards (future) | `CollapsibleCard` |

### From `@wordpress/components`
| Current Element | WP Component |
|---|---|
| Upload button | `Button` |
| Toggle switches | `ToggleControl` |
| Hotspot slider | `RangeControl` |
| Search input | `SearchControl` |
| Icon buttons | `Button` (icon variant) |
| Progress spinner | `Spinner` |
| Sidebar sections | `Panel`, `PanelBody` |

### Custom (no WP equivalent)
| Element | Reason |
|---|---|
| GraphCanvas | Cytoscape container |
| Detail panel content | Domain-specific views |
| Legend | Domain-specific graph legend |
| Color palette generation | Graph-specific repo colors |
| Edge item rows | Domain-specific layout |

## Cytoscape Integration

Ref-based imperative wrapper inside `<GraphCanvas />`:

- Cytoscape instance created in `useEffect`, attached to a container div via ref
- Instance stored in context for read-only access (e.g., `DetailPanel` querying edges)
- All mutations (batch class changes, element add/remove, layout runs) happen inside `GraphCanvas` effects
- Performance adaptations preserved: `isLargeGraph` flag, batch element adding (500/batch with `yieldToMain`), texture-on-viewport, hide-edges-on-viewport for large graphs
- Cytoscape styles generated from repo palette + theme colors, same per-source-index selector pattern

## Theme Strategy

- WordPress tokens (`@wordpress/theme`) for UI chrome: sidebar, panels, controls, text
- Custom CSS properties in `tokens.css` for graph-specific needs:
  - `--graph-overlap-action`, `--graph-overlap-filter`
  - `--graph-dynamic-border`
  - Per-repo generated palette (hue-based, same `generateRepoPalette` logic)
  - Edge highlight/fade opacities
- Dark/light toggle: switches a CSS class on `<html>`, WP components respond to tokens, graph tokens swap via CSS custom property overrides
- Import `@wordpress/components/build-style/style.css` for base WP component styles

## Vite Configuration

- Plugin: `@vitejs/plugin-react`
- Custom plugin: `hooksJsonPlugin` — reads `--json <path>` from CLI, serves at `/api/hooks.json` via dev middleware (~15 lines)
- Dev server port: 8080, `strictPort: false` for auto-fallback
- Build output: `dist/`

### npm Scripts (additions)

```json
{
  "dev": "vite",
  "build:ui": "vite build",
  "preview": "vite preview"
}
```

Usage: `npm run dev -- --json storage/hooks.json` to serve data, or plain `npm run dev` for upload-only mode.

Existing scripts (`build`, `parse`, `test`, `test:*`, `serve`) unchanged. Python toolchain untouched.

### Dependencies

```
dependencies:
  react, react-dom
  @wordpress/ui, @wordpress/components, @wordpress/theme, @wordpress/icons
  cytoscape

devDependencies:
  vite, @vitejs/plugin-react
```

Cytoscape moves from vendored `cytoscape.min.js` to npm dependency.

## Dev & Production Workflow

**Development:**
1. Parse: `npm run parse -- ~/code/wordpress`
2. Dev server: `npm run dev -- --json storage/hooks.json`
3. Opens at `http://localhost:8080` with HMR
4. Or `npm run dev` and upload a file manually

**Production:**
1. `npm run build:ui` → `dist/`
2. `npm run serve -- --json storage/hooks.json` → serve.py serves `dist/` + JSON
3. `serve.py` updated: `_serve_dir` points at `dist/`

## Scope

### In scope
- Vite project scaffolding, config, dev workflow
- All components with feature parity to current `index.html`
- WordPress package integration following priority stack
- `filters.js` imported as-is, existing tests unchanged
- Cytoscape ref-based wrapper with all current behaviors
- Dark/light theme toggle (WP tokens for chrome, custom for graph)
- File/class group-by toggle with graph rebuild
- Detail panel with current hook/file/class views
- Legend with dynamic source colors
- Auto-load from `/api/hooks.json` + file upload
- `serve.py` updated to serve `dist/`
- Old `index.html` renamed to `index.legacy.html`

### Out of scope (future work)
- Hook-centric detail panel redesign (first feature on new foundation)
- TypeScript migration
- Component-level tests
- `@wordpress/dataviews` integration
- `@wordpress/data` stores
- Responsive/mobile layout
- URL params for bookmarkable state
- Any new features not in current viewer
