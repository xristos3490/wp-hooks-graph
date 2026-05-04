# Responsive sigma sizing

## Problem

The viewer's sigma renderer sizes everything in fixed pixels. Node radii (`Math.min(28, …)` for hooks, `Math.min(24, …)` for files), the `+3` floor, label thresholds (`labelRenderedSizeThreshold: isLargeGraph ? 8 : 4`), and edge widths (`size: 1`, `focusedEdgeSize: 1.5`) are all absolute screen pixels. On a small canvas the graph reads as oversized; on a large canvas it reads as tiny. The user has no way to verify either failure mode without resizing the browser.

## Goal

Replace fixed-pixel sizing with viewport-relative sizing so the graph scales naturally with the canvas, and add one knob in the dev controls to simulate smaller viewports without resizing the window.

## Non-goals

- Camera ratio thresholds (`ZOOMED_OUT_LABEL_CUTOFF: 1.5`, the `0.4` selected-zoom target). These are zoom thresholds, not size thresholds — different axis.
- Removing the `SigmaSizingControls` panel. Stays as the dev tuning surface.
- Reworking the per-type scale sliders (Hooks/Files/Classes %). Their semantics are unchanged — they multiply the (now-responsive) base curve.

## Design

### Unit

All size values become **% of vmin**, where `vmin = min(container.clientWidth, container.clientHeight)`. Sigma still consumes pixels, so the conversion `px = (percent / 100) * vmin` happens at the point where a value is handed to sigma — inside `computeNodeSize`, the edge reducer, and `sigma.setSetting('labelRenderedSizeThreshold', …)`.

### Calibration

Existing pixel values were tuned against a typical canvas around 1000px vmin. Converting at that reference:

| Existing (px) | New (% of vmin) | Where |
| --- | --- | --- |
| `Math.min(28, …)` hook size cap | `2.8%` | `nodeSizeFor`, `computeNodeSize` |
| `Math.min(24, …)` file/class size cap | `2.4%` | `nodeSizeFor`, `computeNodeSize` |
| `+3` floor / `Math.max(3, size)` | `0.3%` | both |
| `Math.sqrt(deg) * 3` hook multiplier | `Math.sqrt(deg) * 0.3%` | both |
| `Math.sqrt(deg) * 2.5` file multiplier | `Math.sqrt(deg) * 0.25%` | both |
| `labelRenderedSizeThreshold: 4 / 8` | `0.4% / 0.8%` (large) | `SigmaGraphCanvas` |
| edge `size: 1` | `0.1%` | `addEdge` (default) |
| `focusedEdgeSize: 1.5` | `0.15%` | edge reducer |

### Wiring

```
container resize / Viewport % slider change
        │
        ▼
   vmin recalculated
        │
   ┌────┴────────────────────┐
   ▼                         ▼
vminRef updated      sigma.setSetting(
   │                   'labelRenderedSizeThreshold',
   │                   threshold% * vmin / 100)
   ▼
node reducer reads vminRef
edge reducer reads vminRef
   │
   ▼
sigma.refresh()
```

- `vminRef` lives next to the existing `sizingRef` / `densityRef` in `SigmaGraphCanvas.jsx`, populated on init and on every `ResizeObserver` callback.
- `computeNodeSize(attrs, sizing, cameraRatio, density, vmin)` gets a new `vmin` parameter and returns pixels.
- The edge reducer multiplies the per-edge `size` percent by `vmin / 100`.
- `labelRenderedSizeThreshold` is recomputed and pushed via `sigma.setSetting()` whenever vmin changes (resize, Viewport % slider). Sigma consults this setting on every frame, so a single `setSetting()` is enough.
- `nodeSizeFor` (the init-time helper that seeds `size` / `baseSize` on the graphology node) keeps a reasonable default in pixels — it runs before the canvas exists. The reducer overrides per frame, so the seed value only shows in fallback paths.

### Controls panel

One new field in `SIGMA_SIZING_DEFAULTS`:

```js
viewportScale: 100, // 25–100, default 100
```

A new slider `Viewport %` is added at the top of the panel. The reducer reads `vminRef.current * (sizing.viewportScale / 100)` as its effective vmin, so dialing the slider down to 50 makes the system behave as if the canvas were half its real size — labels disappear, nodes shrink, exactly as on a smaller screen. With `viewportScale: 100` (the default), the system uses the real canvas size and the refactor is a no-op in steady state.

## Tests

No new unit tests. The viewer doesn't currently have render tests for sigma; visual verification (the user, in a browser) is how we'll confirm. The existing Vitest suite must still pass — the change shouldn't touch the parsing/filter code paths it covers.

## Risks

- **Init order:** the canvas mounts and reads `container.clientWidth/Height` synchronously — if the container hasn't laid out yet, vmin will be 0 and everything will collapse to the floor. Mitigated by reading vmin lazily in the reducer (which only runs after sigma renders, by which time layout is settled), and falling back to `vmin || 1000` defensively.
- **`nodeSizeFor` divergence:** the seed-time `nodeSizeFor` and the per-frame `computeNodeSize` must encode the same curve. Already true today; staying true requires keeping the constants in one place. We'll lift them to module-level `const`s so the two functions read identical values.
- **Density compensation:** `computeDensityFactor` currently produces a multiplier in [0.5, 1.5] anchored at ~1000 nodes. It's orthogonal to the unit change — multiplying a percent works the same as multiplying a pixel — so it stays as-is.
