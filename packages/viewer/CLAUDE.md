# HooksGraph Viewer (`packages/viewer/`)

Vite + React app that renders a parsed hooks graph via Sigma (WebGL) on top of a graphology `Graph`. `private: true` — never published. Consumed by:

- the `@hooksgraph/hooksgraph` CLI tarball (`scripts/build-cli.js` copies `dist/` into `packages/cli/dist/`),
- the `@hooksgraph/theme` classic theme (`scripts/build-theme.js` copies `dist/` into `packages/theme/assets/`),
- and direct static hosting of `dist/`.

## Layout

```
index.html              Vite entry HTML. Mounts on #root.
vite.config.js          Self-contained; base: './', outDir: 'dist'. Registers a tiny
                        `hooks-json` plugin that serves /hooks.json from the path bound by
                        $HOOKSGRAPH_JSON (Vite 8's CAC parser blocks unknown CLI flags,
                        so the legacy `--json <path>` argv read is kept as a fallback).
                        204 (not 404) when nothing is bound — the homepage probes it.
public/                 Static files copied verbatim into dist/ (favicon, og-image, …).
src/
  main.jsx                ReactDOM root. StrictMode.
  App.jsx                 Top-level component. Owns selection / search / filter / sidebar
                          state. Routes to <HomePage> until a graph is loaded.
  components/
    SigmaGraphCanvas.jsx    Owns the Sigma WebGL instance and the graphology Graph.
                            Registers the `@sigma/node-square` program for file/class
                            nodes. Populates cyRef with the cy-style adapter.
    DetailPanel.jsx         Reads selected-node detail through the cy-adapter
                            (`cy.getElementById`, `cy.edges('[target="X"]…')`). Refactor
                            candidate — could read raw data from GraphContext directly.
    Sidebar.jsx, SearchOverlay.jsx, Legend.jsx, HomePage.jsx, …
  lib/
    sigma-setup.js          buildSigmaGraph(data, …) → graphology Graph.
                            buildCyAdapter(graph) → the narrow cy-shape surface
                            DetailPanel still calls. `nodeSizeFor` returns sigma-space
                            sizes on a degree-driven sqrt curve (≈3 → ≈28).
    sigma-layouts.js        applyLayout(graph, mode, opts) — mutates x/y in place.
                            Only `communities` is wired up; other strategies
                            (`directory`, `force`, `force-noverlap`, `circular`,
                            `source-clusters`, `hook-type-split`, `bipartite`,
                            `random`) remain callable for future re-exposure.
    color-palette.js        Per-source palette + repo hue overrides. Sigma reads the
                            **hex** edge colors (`fireEdge` / `listenEdge`); the rgba
                            `*Alpha` / `*Highlight` variants are CSS-only.
    constants.js, contrast.js, filters.js, constellations.js, sigma-export.js
    sigma-programs/         Custom WebGL programs (only if added).
  hooks/
    useGraphData.js         resolveDataUrls() reads window.HOOKSGRAPH_JSON_URL /
                            HOOKSGRAPH_DEMO_URL. Demo is tri-state: key absent →
                            './demo.json'; explicit null → skip probe + button;
                            string → use as URL. Streams large payloads through a
                            Web Worker for JSON.parse.
    useFilterState.js       Hook-type / repo / high-traffic filter reducer.
  context/                  GraphContext (data + selection + filters) + SizingContext.
  styles/                   tokens.css + component CSS.
```

## Commands

Run from the monorepo root unless noted. The viewer is workspace-aware — `pnpm -F @hooksgraph/viewer …` is equivalent to `cd packages/viewer && pnpm …`.

| Command                                                | Description                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:viewer`                         | Vite dev server (`pnpm -F @hooksgraph/viewer dev`). Port 8080 (strict: false).                |
| `HOOKSGRAPH_JSON=/abs/path/hooks.json pnpm dev:viewer` | Bind a specific parsed JSON to `/hooks.json` for this dev session. Legacy `--json` also works |
| `pnpm build:viewer`                                    | Production build → `packages/viewer/dist/`.                                                   |
| `pnpm -F @hooksgraph/viewer preview`                   | Serve the built bundle locally.                                                               |
| `pnpm test:js`                                         | Vitest — viewer + MCP suites (viewer tests live alongside source as `*.test.js`).             |

## Sigma renderer

One renderer, no toggle. The layout emphasises _bounded contexts_ — visually separated clusters per Louvain community, not one tight FA2 blob.

**Wiring.** `App.jsx` mounts `<SigmaGraphCanvas>` once a graph JSON is loaded. The canvas populates `cyRef` via `buildCyAdapter(graph)` so `DetailPanel.jsx` can keep its `cy.getElementById(...)` / `cy.edges('[target|source="X"][edgeType="…"]')` query syntax. The adapter only implements the surface DetailPanel touches.

**Layout.** Hardcoded to `communities` (Louvain) with `spread = 0.3` — no dropdown, no UI. The cluster layouts (`communities`, `directory`) are two-stage:

1. Bucket nodes into clusters (by directory prefix or Louvain community).
2. Run FA2 on each cluster's internal subgraph for an organic shape.
3. Normalize each cluster to a target radius (`15 + sqrt(n) * 4`) so the next stage has consistent geometry.
4. Build a super-graph with one node per cluster sized to that radius, run FA2 with `adjustSizes: true` and a `noverlap` pass — cluster bounding circles never touch.
5. Translate each member position by its cluster's super-position.

## Visual constraints (Sigma 3 defaults)

Sigma 3's stock WebGL programs only ship circle nodes, line + arrow edges, and **hex** color buffers. Consequences:

- Hook nodes render as circles; file/class nodes render as squares via `@sigma/node-square` (registered in `SigmaGraphCanvas.jsx`). The square program is 1:1 with a single radius, not a true text-width rectangle.
- Both fires and listens use the stock `arrow` program. Differentiation is by edge color from the palette (no built-in dashed style).
- No dashed border on `[?dynamic]` hooks. No 3px ring on the selected node — size bump only. No text-background pill behind highlighted hook labels.

These are fixable by registering more custom WebGL programs under `lib/sigma-programs/`.

## Gotchas

- **Node `type` ≠ semantic type.** Sigma uses the graphology node `type` attribute to select a rendering program (e.g. `'circle'`). The app's hook/file/class type is stored as `nodeType`, and surfaced back through the cy-adapter as `data().type`. Same for edges: `type: 'arrow' | 'line'` is the program, not the hook semantic.
- **Hex colors only.** Default WebGL programs only parse `#RRGGBB(AA)`. Passing `rgba(…)` strings silently zeroes the color buffer and the whole canvas goes blank. The palette exposes hex variants (`fireEdge`, `listenEdge`); the rgba `*Alpha` / `*Highlight` siblings are CSS-only.
- **Camera coords are camera-space, not graph-space.** `camera.animate({ x, y })` normalises across the framed graph bbox. To pan to a node, use `sigma.getNodeDisplayData(id)` — passing graph-space xy flies the camera off-screen.
- **Node `size` is screen pixels (radius).** `nodeSizeFor` returns sigma-space sizes directly on a degree-driven sqrt curve (≈3 → ≈28), with a 3px floor in `addNode`. Leaves intentionally fall under `labelRenderedSizeThreshold` at default zoom — the threshold is the hub/leaf importance filter, so **don't** reintroduce a flat minimum (was previously `Math.max(15, …)`) or the hierarchy collapses. The reducer in `SigmaGraphCanvas.jsx` sets `forceLabel: true` for hovered / searched / selected neighborhoods to bypass the throttle.
- **Cluster layouts mutate x/y in place.** The canvas runs `applyLayout` once at init and never again. If a layout switcher is re-introduced, rebuilding sigma is expensive and resets the camera — keep the in-place contract.
- **Demo tri-state.** `useGraphData.js` distinguishes "key absent" (default `./demo.json`) from "explicit `null`" (skip probe + button). The theme sets the global to `null` when no `demo.json` is bundled; the CLI/server flow leaves both globals undefined.
- **Vite 8 CLI args.** Unknown CLI flags are rejected before plugins run, so `--json <path>` to `vite dev` no longer works directly. Use `HOOKSGRAPH_JSON=…` env. The argv fallback in `vite.config.js` only fires when the env var is unset.
- **Dev server `/hooks.json` returns 204, not 404, when nothing is bound.** The viewer's homepage probes this endpoint at startup; a 404 would log a console error for the normal empty-state flow.
- **Callback metadata absence ≠ "no effects".** Listener edges carry static-analysis facts (`effects`, `targets`, `called_apis`, `filter_behavior`) from the parser, but only when the body was visible. Treat missing keys as "unknown", not "none" — see root `AGENTS.md` for the parser-side contract.

## Code style

- ES modules, React function components, hooks under `src/hooks/`.
- Pure-ish helpers under `src/lib/`. Sigma- / graphology-specific code stays there (`sigma-setup`, `sigma-layouts`).
- Vitest specs live next to source as `*.test.js` (e.g. `lib/filters.test.js`).

## Cross-links

- Root architecture + monorepo commands: `../../README.md`, `../../AGENTS.md`.
- CLI wrapper that hosts the built viewer: `../cli/`.
- WordPress theme that embeds the built viewer: `../theme/`.
