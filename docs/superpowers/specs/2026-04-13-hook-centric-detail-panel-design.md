# Hook-Centric Detail Panel Redesign

**Date:** 2026-04-13
**Status:** Approved

## Overview

Redesign the right-side detail panel so that **hooks are always the primary object**, regardless of which node type the user clicks. The panel becomes a vertical stack of hook profile cards. Callbacks remain prominent within each card but are subordinate to the hook.

## Design Approach: Hook Profile Cards

### Entry Point Logic

Three click scenarios, one unified structure:

1. **Click a hook node** — Panel shows a single hook profile card, fully expanded. No context header.
2. **Click a file node** — Compact sticky context header (file path, source, hook count), then a stack of hook cards (collapsed by default, expandable).
3. **Click a class node** — Same as file. Context header shows class name, file paths, source label.

### Panel Container

- **Position:** Right-side, absolute, same as current.
- **Width:** 460px (up from 420px) — extra room for hook names at larger type.
- **Slide-in animation:** Same cubic-bezier as today (280ms).
- **Scroll:** Overflow-y auto, thin scrollbar styling preserved.

### Context Header (file/class clicks only)

Sticky at top. Intentionally understated — hooks below are the stars.

- **Entity name:** 13px, mono, weight 500, `--text-secondary`. File path or class name.
- **Source label:** 11px, `--text-tertiary`.
- **Summary line:** "Involved in N hooks" — 11px, `--text-tertiary`.
- Bottom border separator.
- Compact height: ~60–70px.
- **No stats grid.** Each hook card carries its own stats.

### Hook Card Anatomy

Each card is a self-contained hook profile.

#### Card Container
- Background: `--subtle-bg-faint`
- Border-radius: 10px
- Internal padding: 16px sides, 14px top/bottom
- 8px gap between cards in multi-hook views

#### Card Header
- **Hook name:** 18px, weight 600, body font, `--text-primary`. Dominant element.
- **Type badge:** Inline pill beside/below name. Mono, uppercase, colored dot (`--overlap-action` for actions, `--overlap-filter` for filters). Shows "dynamic" suffix when applicable.
- **Dynamic expression:** If present, subtle mono code block below name (same style as current `#detail-expression`).

#### Stats Row
- Horizontal text line: `3 fires · 8 listens · 11 total`
- Mono font, 11px, `--text-tertiary`
- No grid/boxes — just clean inline text. Metadata, not hero.

#### Callback Sections (expanded state)

Two groups with section divider labels ("Fired by", "Listened by"):

Each callback item:
- **Callback name:** mono, 12.5px, weight 500, `--text-primary`. First line, prominent. For "fired by" items with no callback name, file path takes this position.
- **File path:** mono, 11px, `--text-secondary`. Second line.
- **Metadata row:** Flex row of small pills — scope (`in ClassName::method`), priority (`pri 10`), line (`line 42`). Same pill treatment as current.
- **Doc comment:** If present, left-border block quote beneath. Same style as current.

### Collapsed/Expanded Interaction

#### Collapsed Card (multi-hook views)
- Line 1: Hook name (18px, bold) + type badge pill
- Line 2: `3 fires · 8 listens` in mono tertiary
- Right edge: chevron (`›`) indicating expandability
- Total height: ~56px

#### Expand/Collapse
- Click anywhere on card header to toggle
- Chevron rotates 90deg on expand (200ms ease CSS transition)
- Card body slides in via max-height transition (250ms ease) + opacity (150ms)
- **Multiple cards can be open simultaneously** — users compare hooks

#### Single-Hook View (clicked a hook node)
- No chevron, no collapse. Always fully expanded.
- Slightly more top padding (20px vs 16px) since it's the sole card.

### Data Scope Within Cards
When a file/class is clicked, each hook card shows the **full hook profile** — all fires and listens from all sources, not just the edges from the clicked file. The file/class click is an entry point; the hook card is a complete view. This means a hook card looks identical whether you reached it by clicking the hook directly or by clicking a file that references it.

### Click-Through Navigation
- Clicking a callback item navigates to that node on the graph and opens its detail (same as today).
- Clicking a collapsed card header expands the card (does not navigate).
- Inside an expanded card, clicking a file path navigates to that file node.

### Typography Scale

| Element | Size | Weight | Font | Color |
|---------|------|--------|------|-------|
| Hook name | 18px | 600 | body | `--text-primary` |
| Callback name | 12.5px | 500 | mono | `--text-primary` |
| Context header entity | 13px | 500 | mono | `--text-secondary` |
| File path | 11px | 400 | mono | `--text-secondary` |
| Stats line | 11px | 400 | mono | `--text-tertiary` |
| Section label | 10.5px | 500 | body, uppercase | `--text-tertiary` |
| Metadata pills | 10px | 400 | mono | `--text-tertiary` |
| Doc comment | 11px | 400 | body, italic | `--text-tertiary` |

### Spacing Philosophy
- 16px side padding inside cards, 14px top/bottom
- 10px padding inside callback items, 4px between items
- 8px gap between hook cards
- 24px side padding for the overall panel body

### Transitions
- Panel slide-in: 280ms cubic-bezier(0.16, 1, 0.3, 1)
- Card expand: max-height 250ms ease + opacity 150ms
- Chevron rotate: 200ms ease

### Colors
No new CSS variables. Uses existing design system tokens throughout. Type badge colored dots (`--overlap-action`, `--overlap-filter`) remain the only color accents.

## What Changes

### Removed
- Stats grid for file/class views (fires/listens grid at file level)
- The file/class detail view showing "Fires" and "Listens to" as flat lists of hook names — replaced by hook cards

### Preserved
- All edge data: callback name, file path, priority, line number, scope, doc comment
- Click-through navigation to nodes
- Truncation note for 50+ listeners
- Panel slide-in/out animation
- Close button
- Scrollbar styling
- Dark/light theme support via existing CSS variables

### Changed
- Panel width: 420px → 460px
- Hook name: 16px → 18px, typographically dominant
- File/class views restructured: hooks are primary objects, file/class is context
- Stats: grid → inline text line
- Multi-hook views: collapsed cards with expand/collapse
