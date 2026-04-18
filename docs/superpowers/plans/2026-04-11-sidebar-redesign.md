# Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the sidebar in `index.html` from 5 fragmented sections into 3 clear groups with rewritten copy for non-expert users.

**Architecture:** Single-file change to `index.html`. Add one new CSS class (`.subgroup-title`), restructure the sidebar HTML to merge three filter sections into one, and rewrite all labels/descriptions. No JavaScript changes.

**Tech Stack:** HTML, CSS (inline in `index.html`)

---

## File Map

- Modify: `index.html` — CSS (add `.subgroup-title` class), HTML (restructure sidebar sections, rewrite copy)

No new files. No test changes (no logic changes).

---

### Task 1: Add `.subgroup-title` CSS class

**Files:**
- Modify: `index.html:140-148` (CSS, after `.section-title` rule)

- [ ] **Step 1: Add the `.subgroup-title` class after `.section-title`**

In `index.html`, find the `.section-title` CSS rule (around line 140) and add the new class immediately after it:

```css
.subgroup-title {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
  margin-bottom: 8px;
  margin-top: 16px;
}

.subgroup-title:first-child {
  margin-top: 0;
}
```

The `:first-child` rule ensures the first subgroup in a section doesn't get extra top margin.

- [ ] **Step 2: Verify CSS parses correctly**

Open `index.html` in a browser. The page should load without errors. The sidebar should still look the same (the new class isn't used in HTML yet).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Add .subgroup-title CSS class for sidebar filter subgroups"
```

---

### Task 2: Restructure sidebar HTML — merge filter sections

**Files:**
- Modify: `index.html:828-903` (sidebar HTML)

This is the core structural change. We replace the three separate sections (Hook Types, Behavior, High Traffic) and their dividers with a single Filters section containing three subgroups.

- [ ] **Step 1: Replace the Hook Types + Behavior + High Traffic sections**

Find this block in the HTML (lines 828–895):

```html
    <div class="sidebar-divider"></div>

    <div class="sidebar-section">
      <div class="section-title">HOOK TYPES</div>
      <div class="section-desc">Show or hide hooks by their type</div>
      <div class="filter-row">
        <div class="filter-info">
          <div class="filter-label">Actions</div>
          <div class="filter-desc">Fires callbacks</div>
        </div>
        <button class="toggle on" id="toggle-actions" onclick="toggleHookType('actions')">
          <span class="toggle-knob"></span>
        </button>
      </div>
      <div class="filter-row">
        <div class="filter-info">
          <div class="filter-label">Filters</div>
          <div class="filter-desc">Transforms values</div>
        </div>
        <button class="toggle on" id="toggle-filters" onclick="toggleHookType('filters')">
          <span class="toggle-knob"></span>
        </button>
      </div>
    </div>

    <div class="sidebar-divider"></div>

    <div class="sidebar-section">
      <div class="section-title">BEHAVIOR</div>
      <div class="section-desc">Filter by hook characteristics</div>
      <div class="filter-row">
        <div class="filter-info">
          <div class="filter-label">Dynamic</div>
          <div class="filter-desc">Runtime-constructed hook names</div>
        </div>
        <button class="toggle" id="toggle-dynamic" onclick="toggleBoolFilter('dynamic')">
          <span class="toggle-knob"></span>
        </button>
      </div>
      <div class="filter-row" id="filter-row-overlapping">
        <div class="filter-info">
          <div class="filter-label">Overlapping</div>
          <div class="filter-desc">Hooks shared across multiple repositories</div>
        </div>
        <button class="toggle" id="toggle-overlapping" onclick="toggleBoolFilter('overlapping')">
          <span class="toggle-knob"></span>
        </button>
      </div>
    </div>

    <div class="sidebar-divider"></div>

    <div class="sidebar-section">
      <div class="section-title">HIGH TRAFFIC</div>
      <div class="section-desc">Surface hooks with many connections</div>
      <div class="filter-row">
        <div class="filter-info">
          <div class="filter-label">Enabled</div>
        </div>
        <button class="toggle" id="toggle-high-traffic" onclick="toggleHighTraffic()">
          <span class="toggle-knob"></span>
        </button>
      </div>
      <div class="slider-row" id="slider-row">
        <input type="range" id="slider-high-traffic" class="slider" min="1" max="100" value="10" oninput="onHighTrafficSlider(this.value)" disabled>
        <span class="slider-value" id="high-traffic-value">10</span>
      </div>
    </div>

    <div class="sidebar-divider"></div>
```

Replace it with:

```html
    <div class="sidebar-divider"></div>

    <div class="sidebar-section">
      <div class="section-title">FILTERS</div>

      <div class="subgroup-title">Show by type</div>
      <div class="filter-row">
        <div class="filter-info">
          <div class="filter-label">Actions</div>
          <div class="filter-desc">Hooks that fire callbacks (do_action)</div>
        </div>
        <button class="toggle on" id="toggle-actions" onclick="toggleHookType('actions')">
          <span class="toggle-knob"></span>
        </button>
      </div>
      <div class="filter-row">
        <div class="filter-info">
          <div class="filter-label">Filters</div>
          <div class="filter-desc">Hooks that transform values (apply_filters)</div>
        </div>
        <button class="toggle on" id="toggle-filters" onclick="toggleHookType('filters')">
          <span class="toggle-knob"></span>
        </button>
      </div>

      <div class="subgroup-title">Focus</div>
      <div class="filter-row">
        <div class="filter-info">
          <div class="filter-label">Dynamic only</div>
          <div class="filter-desc">Hook names built at runtime, like {$post_type}_save</div>
        </div>
        <button class="toggle" id="toggle-dynamic" onclick="toggleBoolFilter('dynamic')">
          <span class="toggle-knob"></span>
        </button>
      </div>
      <div class="filter-row" id="filter-row-overlapping">
        <div class="filter-info">
          <div class="filter-label">Overlapping only</div>
          <div class="filter-desc">Hooks that appear in more than one repository</div>
        </div>
        <button class="toggle" id="toggle-overlapping" onclick="toggleBoolFilter('overlapping')">
          <span class="toggle-knob"></span>
        </button>
      </div>

      <div class="subgroup-title">Hotspots</div>
      <div class="filter-row">
        <div class="filter-info">
          <div class="filter-label">Hotspots</div>
          <div class="filter-desc">Only hooks with many connections</div>
        </div>
        <button class="toggle" id="toggle-high-traffic" onclick="toggleHighTraffic()">
          <span class="toggle-knob"></span>
        </button>
      </div>
      <div class="slider-row" id="slider-row">
        <input type="range" id="slider-high-traffic" class="slider" min="1" max="100" value="10" oninput="onHighTrafficSlider(this.value)" disabled>
        <span class="slider-value" id="high-traffic-value">10</span>
      </div>
    </div>

    <div class="sidebar-divider"></div>
```

Key changes:
- Three `<div class="sidebar-section">` blocks → one
- Three `<div class="sidebar-divider">` elements removed (only dividers before/after the unified Filters section remain)
- Section title is "FILTERS"
- Three `.subgroup-title` elements added: "Show by type", "Focus", "Hotspots"
- All `.section-desc` elements removed
- "Enabled" filter row removed — toggle moved to the "Hotspots" row
- All toggle IDs and onclick handlers preserved exactly

- [ ] **Step 2: Verify all toggle IDs are preserved**

Confirm these IDs exist in the new HTML:
- `toggle-actions`
- `toggle-filters`
- `toggle-dynamic`
- `toggle-overlapping`
- `filter-row-overlapping`
- `toggle-high-traffic`
- `slider-high-traffic`
- `high-traffic-value`
- `slider-row`

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Merge sidebar filter sections into unified Filters section"
```

---

### Task 3: Rename Repositories section to Sources

**Files:**
- Modify: `index.html` (sidebar HTML, Sources section — immediately after the Filters section)

- [ ] **Step 1: Update the Repositories section**

Find:

```html
    <div class="sidebar-section">
      <div class="section-title">REPOSITORIES</div>
      <div class="section-desc">Toggle visibility per source</div>
      <div id="repo-toggles"></div>
    </div>
```

Replace with:

```html
    <div class="sidebar-section">
      <div class="section-title">SOURCES</div>
      <div id="repo-toggles"></div>
    </div>
```

Changes: title "REPOSITORIES" → "SOURCES", section description removed.

- [ ] **Step 2: Verify in browser**

Open `index.html` in a browser and upload a hooks JSON file. Verify:
- Header section looks unchanged (title, subtitle, stats)
- Single "FILTERS" section with three subgroups ("Show by type", "Focus", "Hotspots")
- No dividers between subgroups, just spacing
- "SOURCES" section at bottom with repo toggles
- All toggles work: Actions, Filters, Dynamic only, Overlapping only, Hotspots
- Hotspot slider enables/disables when toggle is clicked
- Overlapping row hides when data has `overlap_filter` metadata

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Rename Repositories to Sources, remove redundant description"
```

---

### Task 4: Run existing tests to verify no regressions

**Files:**
- No file changes

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass. The sidebar changes are HTML/CSS only and don't affect any tested logic (parser, graph builder, filter pipeline).

- [ ] **Step 2: Manual verification checklist**

Open `index.html` in browser with a hooks JSON file and verify:
1. Stats grid shows correct numbers
2. Actions toggle hides/shows action hooks
3. Filters toggle hides/shows filter hooks
4. Dynamic only toggle isolates dynamic hooks
5. Overlapping only toggle isolates overlap hooks
6. Hotspots toggle + slider filters by connection count
7. Source toggles hide/show per-repo nodes and edges
8. Search still works
9. Detail panel still opens on node click
10. Legend still displays correctly
