# Homepage Background Refresh — Design

**Date:** 2026-04-22
**Scope:** The idle / file-drop home screen only (`src/components/HomePage.jsx` + its CSS in `src/styles/tokens.css`). No changes outside the home screen.

## Goal

Make the homepage background feel more modern and more visually rich — more graphs on screen, some drifting and some flying across the viewport — while keeping the palette strictly black & white (no brand colour) and preserving the clean-line aesthetic.

## Constraints

- Keep the current dark surface background colour (`--wpds-color-bg-surface-neutral-strong`). Do not switch to pure black.
- Foreground hero (EmptyState, logo, hint) stays unchanged in content and structure. Only its brand-tinted accents become neutral.
- Animation budget stays within today's envelope: `transform` and `opacity` only; `prefers-reduced-motion` still disables motion.
- Total concurrent constellations capped at 11.

## Architecture

The existing pieces stay:

- `.hp-field` layer for drifting constellations.
- `<Constellation>` component and its SVG rendering.
- CSS animation system: drift, spin, edge-flow, node-pulse.

What changes:

- **Data.** Replace the inline `CONSTELLATIONS` array with a generator module `src/lib/constellations.js` that emits a scene given a seed. `HomePage.jsx` stops owning constellation data.
- **New layer.** Add `.hp-travelers` above `.hp-field` for graphs that cross the viewport.
- **Styling.** Swap brand-colour references for white / off-white at varied opacities. Re-tone `.hp-mesh` as a neutral soft lift.

## Archetypes

Six named shape families. Each is a pure function `buildXxx(opts) → { nodes, edges }` in `src/lib/constellations.js`. Coordinates stay in the 200×200 viewBox so `<Constellation>` does not change.

| Archetype | Shape | Node count | Visual read |
|---|---|---|---|
| `hub` | 1 centre + N spokes | 6–10 | action with many listeners |
| `tree` | root → branches → leaves, 3 levels | 7–12 | hierarchy / taxonomy |
| `ring` | cycle of N nodes + a few chords | 6–10 | feedback loop |
| `lattice` | M×N grid with neighbour edges | 9–16 | dense mesh |
| `chain` | linear sequence + 1–2 bypasses | 5–8 | pipeline |
| `mesh` | N nodes, ~1.8·N random edges | 8–14 | generic dense graph |

Each builder is deterministic given a seed. Edge counts are bounded so no single archetype visually dominates.

## Scene composition

A scene is composed once per mount from a seeded PRNG. Counts are fixed (not "~") so the total matches the 11-instance cap exactly:

- **Drifters** — 8 instances, mixed archetypes, sizes `18rem–52rem`, opacity `0.25–0.7`. Positioned around the viewport edges so the hero stays legible.
- **Travelers** — 3 instances, smaller (`14rem–22rem`), opacity `0.35–0.55`, crossing the viewport continuously.

`buildScene({ seed })` returns `{ drifters, travelers }` with all positional + motion CSS variables pre-baked so `<Constellation>` stays presentation-only.

## Motion system

### Drifters

Keep today's behaviour unchanged in kind:

- local `translate3d` drift (per-instance amplitude and duration)
- slow `rotate` spin (per-instance direction and duration)
- edge-flow dash animation (signal pulse along each edge)
- node pulse (scale + opacity)

More variation in per-instance durations so the scene never beats in sync.

### Travelers (new)

A traveler enters from one viewport edge and exits the opposite edge on a slow linear path (45–90 s per crossing).

- At mount, the traveler picks: entry edge, entry offset, exit offset, archetype, depth band.
- Transform composes as `translate(path) × rotate(slow-spin)`:
  - path animation lives on the outer `.hp-traveler` wrapper,
  - the inner `.hp-constellation__spin` keeps its existing spin animation.
- Fades in during the first 8% of its path and out during the last 8% — never pops at the edges.
- On `animationend`, the component re-rolls all parameters and restarts. This produces the "constantly reshuffling" feel without manual choreography.

### Parallax

Three depth bands (`back` / `mid` / `front`), differentiated by opacity, scale, and drift speed. Smaller + dimmer + slower = further back. Drifters get a band at scene build time; travelers pick a band on each re-roll.

### Reduced motion

`@media (prefers-reduced-motion: reduce)` disables drift, spin, path, edge-flow, and node-pulse animations. Constellations render statically at their initial transforms. Existing rule extends to cover `.hp-traveler`.

## Palette

Black & white, dark background preserved.

- `.hp-field` and `.hp-travelers` colour → `#fff` (was `--wpds-color-fg-interactive-brand`). Nodes and edges inherit via `currentColor`.
- Depth expressed via per-instance wrapper `opacity` (0.25 back → 0.7 front). Edge opacity (`0.45`) and node opacity (`0.85`) stay as today.
- `.hp-mesh` radial gradients → white at ~6% alpha. Background colour itself unchanged.
- `.hp-hint code` — currently brand-tinted — becomes a neutral chip (subtle white-on-dark, low alpha background).
- Drag-active state:
  - the tinted background on drag is removed,
  - the dashed outline switches from `--wpds-color-stroke-focus-brand` to `rgba(255,255,255,0.7)`.

## Testing

New Vitest spec `src/lib/constellations.test.js` covers:

- Seeded output is deterministic for a given seed.
- Every archetype builder respects its documented node-count bounds.
- No edge references a missing node index, for every archetype, across a range of seeds.
- `buildScene({ seed })` returns the expected drifter + traveler counts and valid archetype names.

No new PHP tests (parser and graph untouched).

## Out of scope

Explicitly not changing:

- Hero card / logo / typography / EmptyState copy.
- File-drop behaviour or drag lifecycle.
- Parser, graph builder, server, MCP, or anything outside the home screen.

## Files touched

- `src/components/HomePage.jsx` — swap inline data for `buildScene`, add traveler layer.
- `src/lib/constellations.js` — new generator module.
- `src/lib/constellations.test.js` — new Vitest file.
- `src/styles/tokens.css` — palette swap, new `.hp-travelers` + `.hp-traveler` rules, extended reduced-motion rule.
