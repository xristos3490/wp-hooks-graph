# Constellation Physics — Design

**Date:** 2026-04-22
**Scope:** Homepage idle / file-drop background only (`src/components/HomePageBackground.jsx`, its CSS, and the constellation generator in `src/lib/constellations.js`). No changes outside the home screen.

## Goal

Replace today's CSS-only "ambient drift" on the homepage constellations with a lightweight, mouse-aware physics field. Constellations behave like rigid bodies in a magnetic field: the pointer repels nearby constellations, and each body settles back toward its anchor with a sense of mass. Ambient motion continues while the pointer is idle, but it is produced by the same physics loop — not a competing CSS animation.

Two success criteria:

1. **Clarity.** When the pointer moves, the scene's reaction is unambiguously caused by the pointer. No conflicting CSS drift muddies the read.
2. **Performance.** Main-thread frame cost stays well under 1 ms at idle and under a few tenths of a ms with the pointer active. No GC pressure, no layout thrash.

## Constraints

- Palette unchanged (black/white on dark surface, per the April 22 background spec).
- `prefers-reduced-motion: reduce` disables all motion — no rAF, no pointer listener, constellations render statically at anchors.
- No new dependencies.
- Animation budget: `transform` only for positional motion; existing CSS animations (`spin`, `edge-flow`, `node-pulse`) stay exactly as they are.
- Homepage constellation count stays as today (drifters only; travelers remain out of scope).

## Architecture

Three modules, separated by concern:

### `src/lib/constellation-physics.js` (new, pure)

Framework-free math. Unit-testable without DOM or React.

Exports:

- `createPhysicsState(bodies)` — returns an array of `{ x, y, vx, vy, phaseX, phaseY }` with zero initial position/velocity. `phaseX`/`phaseY` are deterministic from body index so neighbors' ambient drift is out of phase.
- `stepPhysics(state, { bodies, pointer, dtSec, tSec, params? })` — in-place integration step. Mutates `state`; returns nothing. `bodies` supplies static per-body info (anchor in pixels). `pointer` is `{ x, y } | null`. `params` is optional and defaults to `DEFAULT_PARAMS`; tests pass overrides to disable noise, tune stiffness, etc.
- Constants: `DEFAULT_PARAMS` — an object with `{ INNER_R, OUTER_R, MAX_PUSH, STIFFNESS, NOISE_AMP, NOISE_FREQ_X, NOISE_FREQ_Y }` exported as a frozen object.

### `src/hooks/useConstellationPhysics.js` (new, DOM-bound)

Owns lifecycle: rAF loop, listeners, observers, reduced-motion query. Takes the drifter list and returns `{ rootRef, bodyRefs }`. Each frame: read cached pointer → call `stepPhysics` → write `translate3d(x, y, 0)` on each `bodyRefs[i].current`.

### `src/components/HomePageBackground.jsx` (modified)

Wraps each `<Constellation>` in a new `.hp-constellation-body` div that carries the anchor-positioning styles. The inner `<Constellation>` loses all positional responsibility. Component attaches `rootRef` to its container and forwards `bodyRefs` to the wrappers.

### `src/lib/constellations.js` (modified, small)

`rollDrifterStyle()` stops emitting `--c-drift`, `--c-drift-x`, `--c-drift-y` (CSS drift is removed). Adds `anchorX`, `anchorY` to the drifter object (percent-of-viewport, as numbers) so the physics hook has a fallback if `getBoundingClientRect` isn't yet meaningful.

### `src/components/HomePageBackground.css` (modified)

Position rules (`left`, `top`, `width`, `aspect-ratio`, `margin-left/top`) migrate from `.hp-constellation` to `.hp-constellation-body`. `@keyframes hp-constellation-drift` and its usage are deleted. Reduced-motion rule extended to list `.hp-constellation-body`.

### Data flow

```
constellations.js (seed → drifters w/ anchorX%, anchorY%, nodes, edges, style)
        ↓
HomePageBackground renders; attaches rootRef + bodyRefs
        ↓
useConstellationPhysics(drifters) ─▶ rAF loop ─▶ stepPhysics(state, ctx) ─▶ bodyRef.style.transform
        ▲                                ▲
        └── pointer / resize listeners   └── visibility + intersection gate
```

## Physics model

### State per body

```
{ x, y, vx, vy, phaseX, phaseY }   // x, y = offset from anchor in px
```

### Per-frame step

Given cached pointer `p` (or `null`), anchor `a`, time `t` seconds since loop start, `dt` seconds since previous step:

```
// 1. Force-field target
if (p !== null) {
  dx = a.x − p.x; dy = a.y − p.y
  dist = √(dx² + dy²)
  // Falloff: 1 at dist ≤ INNER_R, 0 at dist ≥ OUTER_R, cubic smooth between.
  // Implemented as a reverse-edge smoothstep or as (1 − smoothstep(INNER_R, OUTER_R, dist)).
  s    = falloff(dist, INNER_R, OUTER_R)
  nx   = dx / max(dist, 1); ny = dy / max(dist, 1)
  rx   = nx * MAX_PUSH * s; ry = ny * MAX_PUSH * s
} else { rx = 0; ry = 0 }

// 2. Ambient noise (slow sine per body)
nox = NOISE_AMP * sin(t * NOISE_FREQ_X + phaseX)
noy = NOISE_AMP * sin(t * NOISE_FREQ_Y + phaseY)

// 3. Target offset
tx = rx + nox; ty = ry + noy

// 4. Critically-damped spring (semi-implicit Euler)
ω  = STIFFNESS                                  // rad/s
ax = ω*ω * (tx − x) − 2*ω*vx
ay = ω*ω * (ty − y) − 2*ω*vy
vx += ax * dt; vy += ay * dt
x  += vx * dt; y  += vy * dt
```

`stepPhysics` runs this for every body in one pass. DOM writes happen after the pass, in the hook.

### Parameters (initial tuning — all exported constants)

| Constant | Value | Why |
|---|---|---|
| `INNER_R` | `96px` | Distances below get full push. Roughly hero-element scale, so "near a constellation" reliably repels. |
| `OUTER_R` | `420px` | Beyond this, zero force. Keeps the field localized. |
| `MAX_PUSH` | `140px` | Hard cap on displacement from anchor. Prevents constellations shooting across the viewport. |
| `STIFFNESS` | `2π × 1.1 ≈ 6.9 rad/s` | Critically-damped settle ~0.6s — "has weight" without feeling sluggish. |
| `NOISE_AMP` | `8px` | Small enough that idle reads as near-still; avoids the "deadness" of removing CSS drift. |
| `NOISE_FREQ_X` | `0.08 rad/s` | ~78s period. |
| `NOISE_FREQ_Y` | `0.11 rad/s` | Incommensurate with X so noise never loops in sync. |

## Lifecycle

### Mount

1. Read `matchMedia('(prefers-reduced-motion: reduce)')`. If reduced: skip rAF and listeners, return refs only. Keep a `change` listener on the media query so toggling mid-session re-enters physics mode.
2. Build `physicsState` from `drifters` via `createPhysicsState`.
3. After first layout commit, for each `bodyRefs[i].current`, read `getBoundingClientRect()` and store `anchor = { x, y }` (viewport-pixel center) in the body's static data.
4. Attach listeners:
   - `pointermove` on `window` → update `pointer` ref + `lastPointerMoveAt`.
   - `pointerleave` on `document.documentElement` → set `pointer = null`.
   - `resize` on `window` (rAF-coalesced) → re-read anchors.
   - `visibilitychange` → pause/resume loop; re-read anchors on resume.
   - `IntersectionObserver` on `rootRef` → pause/resume; re-read anchors on re-enter.
5. Start rAF loop.

### Each frame

- Compute `dt = min((now − lastNow) / 1000, 1/30)` and `t = (now − t0) / 1000`.
- If `now − lastPointerMoveAt > 2500`ms, treat pointer as `null` this frame.
- Call `stepPhysics(state, { bodies, pointer, dtSec: dt, tSec: t })`.
- For each body, compare against per-body `lastWrittenX[i]` / `lastWrittenY[i]` arrays held inside the hook (not in physics state). If `|x − lastWrittenX[i]| ≥ 0.25` or `|y − lastWrittenY[i]| ≥ 0.25`, write `bodyRefs[i].current.style.transform = translate3d(x, y, 0)` and update the arrays.

### Unmount

Cancel rAF, disconnect observer, remove listeners, drop refs.

## Performance guardrails

- **`dt` clamp** to `1/30` so a hidden-tab resume can't integrate seconds of motion in one step.
- **Write-skip** when per-body delta since last write is sub-pixel. Loop still runs (noise is alive), but idle-settled bodies don't touch the DOM.
- **Pause gates**: `document.visibilityState !== 'visible'` and `IntersectionObserver` not intersecting both cancel the rAF. Resume re-reads anchors.
- **Single listeners**: one `pointermove`, one `resize`, one `visibilitychange`, one observer. Attached on mount, removed on unmount.
- **Pointer idle release** (2.5s without a `pointermove`): covers laptops where the mouse sits still — bodies spring home instead of hovering at their last repelled state.

### Expected cost

6 bodies × ~20 FP ops + 1 transform write = well under 0.1 ms per frame at idle, under 0.3 ms with the pointer active. No allocations in the loop — all state preallocated.

## Reduced motion

Physics hook is the switch: in reduced-motion mode, no rAF, no listeners, wrappers stay at their anchors. CSS reduced-motion rule is extended to include `.hp-constellation-body` for consistency with siblings.

## Testing

### Unit — new Vitest spec `src/lib/constellation-physics.test.js`

- **Rest stability.** `pointer: null`, `NOISE_AMP: 0` (via test override): a body starting at `(0, 0, 0, 0)` stays at `(0, 0)` across 1,000 steps at `dt = 1/60`.
- **Far pointer = no force.** Pointer at distance `> OUTER_R` from anchor → target offset is `(0, 0)`; body at rest stays at rest.
- **Near pointer converges.** Pointer held inside `INNER_R` → body position converges to a non-zero target and `|v|` decays below `0.1` within 2 simulated seconds.
- **No overshoot (critical damping).** Pointer held steady, body from rest → offset magnitude is monotonic toward the steady state (no frame exceeds the steady-state magnitude).
- **MAX_PUSH cap.** Pointer held just inside `INNER_R` along an axis (so the falloff saturates at `s = 1`) → steady-state `|offset|` approaches `MAX_PUSH` but never exceeds it by more than a small integration tolerance.
- **dt clamp.** Passing `dt = 5` cannot displace a body further than the `1/30` clamp would.
- **Noise bounds.** `pointer: null`, `NOISE_AMP > 0`, over 10,000 steps: `|x|` and `|y|` stay ≤ `NOISE_AMP + small margin`, and the trajectory has non-zero variance (not stuck at zero).
- **Determinism.** Same initial state + same inputs → same outputs across runs (guards against future accidental `Math.random()` inside the step).

### Manual / visual (run once during implementation, not CI)

- `npm run dev` + sweep the pointer across the idle homepage: field repels smoothly, release damps home, no visible pops.
- DevTools Performance: main-thread frame cost well under 1 ms at idle.
- OS reduced-motion on: constellations static at anchors; no rAF in the flame chart.

## Files touched

- `src/lib/constellation-physics.js` — new (pure physics + constants).
- `src/lib/constellation-physics.test.js` — new (Vitest).
- `src/hooks/useConstellationPhysics.js` — new (rAF loop, listeners, ref wiring).
- `src/lib/constellations.js` — drop `--c-drift-*` from `rollDrifterStyle`; add `anchorX`, `anchorY` (percent, numeric) to each drifter.
- `src/components/HomePageBackground.jsx` — wrap each `<Constellation>` in `.hp-constellation-body`; consume `useConstellationPhysics`.
- `src/components/HomePageBackground.css` — migrate position rules to `.hp-constellation-body`; delete `@keyframes hp-constellation-drift` and its usage; extend `prefers-reduced-motion` block.

## Out of scope

- Travelers (from the April 22 background-refresh spec, still unimplemented — left alone).
- Touch-specific tuning beyond the default `pointer*` events (touch works because `pointermove` fires during drags; no dedicated touch physics).
- Per-node distortion inside a constellation (rejected during brainstorm).
- Hero card, EmptyState, logo, drag-drop behaviour, parser, MCP, server.
