# Hook-Centric Detail Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the detail panel so hooks are always the primary object, using collapsible hook profile cards.

**Architecture:** Single file change to `index.html`. Replace the old CSS for the detail panel, replace the HTML skeleton, and rewrite `showDetail()` to produce hook cards. File/class clicks build hook cards from connected edges. All three click scenarios (hook, file, class) converge on the same `buildHookCard()` function.

**Tech Stack:** Vanilla JS, CSS, Cytoscape.js (existing)

**Spec:** `docs/superpowers/specs/2026-04-13-hook-centric-detail-panel-design.md`

---

### Task 1: Replace Detail Panel CSS

Replace the existing detail panel CSS block (lines 616–901 of `index.html`) with the new styles. Also update the panel width reference in the `font-feature-settings` block (line 83–90) and the `#detail` width.

**Files:**
- Modify: `index.html:83-90` (font-feature-settings selector list)
- Modify: `index.html:616-901` (full detail panel CSS block)

- [ ] **Step 1: Replace `#detail` container and scrollbar styles (lines 616–647)**

Replace:
```css
#detail {
  width: 420px;
  border-left: 1px solid var(--border);
  background: var(--bg-surface);
  font-size: 13px;
  font-family: var(--font-body);
  transform: translateX(100%);
  opacity: 0;
  transition: transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease;
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 10;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--bg-elevated) transparent;
}

#detail::-webkit-scrollbar { width: 6px; }
#detail::-webkit-scrollbar-track { background: transparent; }
#detail::-webkit-scrollbar-thumb {
  background: var(--bg-elevated);
  border-radius: 3px;
}
#detail::-webkit-scrollbar-thumb:hover { background: var(--text-tertiary); }

#detail.open {
  transform: translateX(0);
  opacity: 1;
}
```

With:
```css
#detail {
  width: 460px;
  border-left: 1px solid var(--border);
  background: var(--bg-surface);
  font-size: 13px;
  font-family: var(--font-body);
  transform: translateX(100%);
  opacity: 0;
  transition: transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease;
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 10;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--bg-elevated) transparent;
}

#detail::-webkit-scrollbar { width: 6px; }
#detail::-webkit-scrollbar-track { background: transparent; }
#detail::-webkit-scrollbar-thumb {
  background: var(--bg-elevated);
  border-radius: 3px;
}
#detail::-webkit-scrollbar-thumb:hover { background: var(--text-tertiary); }

#detail.open {
  transform: translateX(0);
  opacity: 1;
}
```

- [ ] **Step 2: Replace detail-header and old badge/subtitle/expression styles (lines 649–717)**

Replace the entire block from `#detail-header` through `#detail-expression:empty` with:

```css
/* ── Context header (file/class clicks) ── */
.detail-context-header {
  padding: 16px 24px 14px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--bg-surface);
  z-index: 1;
}

.detail-context-name {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.4;
  padding-right: 32px;
}

.detail-context-meta {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 4px;
  line-height: 1.4;
}

/* ── Close button ── */
#close-detail {
  position: absolute;
  top: 14px;
  right: 14px;
  background: var(--subtle-bg-mid);
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  transition: color var(--transition-fast), background var(--transition-fast);
  padding: 0;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

#close-detail:hover {
  color: var(--text-primary);
  background: var(--subtle-bg-strong);
}

/* ── Hook card stack ── */
.detail-cards {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```

- [ ] **Step 3: Replace old detail-stats, edge-item, and section styles (lines 719–901)**

Replace everything from `#close-detail` through `.truncation-note` (the old styles) with the new hook card styles:

```css
/* ── Hook card ── */
.hook-card {
  background: var(--subtle-bg-faint);
  border-radius: 10px;
  overflow: hidden;
}

.hook-card-header {
  padding: 14px 16px;
  cursor: pointer;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  position: relative;
}

.hook-card.single .hook-card-header {
  padding: 20px 16px 14px;
  cursor: default;
}

.hook-card-header-content {
  flex: 1;
  min-width: 0;
}

.hook-card-name {
  font-family: var(--font-body);
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.35;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.hook-card-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--subtle-bg-mid);
  color: var(--text-secondary);
  margin-top: 6px;
  white-space: nowrap;
  flex-shrink: 0;
}

.hook-card-badge .badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.hook-card-expression {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--subtle-bg-mid);
  border: 1px solid var(--border);
  border-radius: 6px;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.5;
}

.hook-card-expression:empty { display: none; }

.hook-card-stats {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 6px;
  font-feature-settings: 'tnum' 1, 'kern' 1;
}

.hook-card-chevron {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: transform 200ms ease;
  margin-top: 4px;
}

.hook-card.expanded .hook-card-chevron {
  transform: rotate(90deg);
}

.hook-card.single .hook-card-chevron {
  display: none;
}

/* ── Card body (collapsible) ── */
.hook-card-body {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition: max-height 250ms ease, opacity 150ms ease;
}

.hook-card.expanded .hook-card-body,
.hook-card.single .hook-card-body {
  max-height: 4000px;
  opacity: 1;
}

.hook-card-body-inner {
  padding: 0 16px 16px;
}

/* ── Callback sections inside cards ── */
.hook-card-section-title {
  font-family: var(--font-body);
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
  margin-bottom: 10px;
  margin-top: 16px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}

.hook-card-section-title:first-child {
  margin-top: 0;
}

/* ── Callback items ── */
.hook-card .cb-item {
  padding: 10px;
  font-size: 12px;
  line-height: 1.5;
  font-family: var(--font-body);
  border-radius: 8px;
  transition: background var(--transition-fast);
  cursor: pointer;
  min-width: 0;
}

.hook-card .cb-item:hover {
  background: var(--subtle-bg);
}

.hook-card .cb-item + .cb-item {
  margin-top: 4px;
}

.hook-card .cb-item .cb-name {
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 12.5px;
  font-weight: 500;
  display: block;
  margin-bottom: 3px;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.45;
}

.hook-card .cb-item .cb-file {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  display: block;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.5;
}

.hook-card .cb-item .cb-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  min-width: 0;
}

.hook-card .cb-item .cb-meta > span {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--subtle-bg-mid);
  white-space: nowrap;
}

.hook-card .cb-item .cb-priority {
  color: var(--text-tertiary);
  font-size: 10px;
  font-family: var(--font-mono);
}

.hook-card .cb-item .cb-line {
  color: var(--text-tertiary);
  font-size: 10px;
  font-family: var(--font-mono);
}

.hook-card .cb-item .cb-scope {
  color: var(--text-secondary);
  font-size: 10px;
  font-family: var(--font-mono);
  font-style: italic;
  word-break: break-word;
  overflow-wrap: anywhere;
  white-space: normal;
}

.hook-card .cb-item .cb-doc {
  color: var(--text-tertiary);
  font-size: 11px;
  font-family: var(--font-body);
  font-style: italic;
  display: block;
  margin-top: 6px;
  padding: 6px 10px;
  background: var(--subtle-bg-mid);
  border-left: 2px solid var(--subtle-border);
  border-radius: 0 4px 4px 0;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.hook-card .truncation-note {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-tertiary);
  padding: 10px 0 4px;
  text-align: center;
  letter-spacing: 0.02em;
}
```

- [ ] **Step 4: Update font-feature-settings selector list (line 83–90)**

Replace the old selectors that referenced `#detail-type-badge`, `#detail-expression`, `#detail-body .edge-item` classes:

```css
.stat-number, .slider-value,
.hook-card-badge, .hook-card-expression,
.hook-card .cb-item .cb-file,
.hook-card .cb-item .cb-priority,
.hook-card .cb-item .cb-line,
.hook-card .cb-item .cb-scope {
  font-feature-settings: 'tnum' 1, 'kern' 1;
}
```

- [ ] **Step 5: Verify CSS compiles**

Run: `npm run serve`

Open in browser, load any JSON file. The detail panel won't work yet (JS is next) but the page should render without CSS errors. Check the left sidebar and graph still display correctly.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: replace detail panel CSS with hook-card styles"
```

---

### Task 2: Replace Detail Panel HTML Skeleton

Replace the static HTML inside `#detail` with the new structure. The old header/body split is replaced by a close button, an optional context header container, and a card stack container.

**Files:**
- Modify: `index.html:1141-1150` (detail panel HTML)

- [ ] **Step 1: Replace detail panel HTML**

Replace:
```html
    <div id="detail">
      <div id="detail-header">
        <button id="close-detail" onclick="closeDetail()">&times;</button>
        <div id="detail-type-badge"></div>
        <h3 id="detail-title"></h3>
        <div id="detail-subtitle"></div>
        <div id="detail-expression"></div>
      </div>
      <div id="detail-body"></div>
    </div>
```

With:
```html
    <div id="detail">
      <button id="close-detail" onclick="closeDetail()">&times;</button>
      <div id="detail-context" class="detail-context-header" style="display:none;"></div>
      <div id="detail-cards" class="detail-cards"></div>
    </div>
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat: replace detail panel HTML with hook-card containers"
```

---

### Task 3: Write `buildHookCardHtml()` Helper Function

This is the core rendering function. Given a hook node's data and the cytoscape instance, it returns the HTML string for one hook card. Used by all three click paths.

**Files:**
- Modify: `index.html` — add new function before `showDetail()` (around line 2019)

- [ ] **Step 1: Add `buildHookCardHtml(hookData, hookId, isSingle)` function**

Insert before `function showDetail(node)`:

```javascript
function buildHookCardHtml(hookData, hookId, isSingle) {
  const d = hookData;
  const cardClass = isSingle ? 'hook-card single' : 'hook-card';
  const badgeDotColor = d.hook_type === 'action' ? 'var(--overlap-action)' : 'var(--overlap-filter)';
  const badgeText = escHtml(d.hook_type) + (d.dynamic ? ' \u00b7 dynamic' : '');
  const expression = (d.dynamic && d.raw_expression) ? d.raw_expression : '';
  const totalConn = d.fire_count + d.listen_count;
  const statsText = `${d.fire_count} fires \u00b7 ${d.listen_count} listens \u00b7 ${totalConn} total`;

  // Chevron SVG for collapsible cards
  const chevronSvg = isSingle ? '' :
    '<svg class="hook-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

  let html = `<div class="${cardClass}" data-hook-id="${escHtml(hookId)}">`;
  html += '<div class="hook-card-header">';
  html += '<div class="hook-card-header-content">';
  html += `<div class="hook-card-name">${escHtml(d.name)}</div>`;
  html += `<div class="hook-card-badge"><span class="badge-dot" style="background:${badgeDotColor}"></span>${badgeText}</div>`;
  if (expression) {
    html += `<div class="hook-card-expression">${escHtml(expression)}</div>`;
  }
  html += `<div class="hook-card-stats">${statsText}</div>`;
  html += '</div>'; // header-content
  html += chevronSvg;
  html += '</div>'; // header

  // Card body (callback sections)
  html += '<div class="hook-card-body"><div class="hook-card-body-inner">';

  // Fired by
  const fireEdges = cy.edges(`[target="${hookId}"][edgeType="fires"]`);
  if (fireEdges.length > 0) {
    html += `<div class="hook-card-section-title">Fired by (${fireEdges.length})</div>`;
    fireEdges.forEach(e => {
      const src = e.source().data();
      const ed = e.data();
      const scope = scopeLabel(ed);
      html += `<div class="cb-item" data-node-id="${escHtml(src.id)}">`;
      html += `<span class="cb-file">${escHtml(src.path || src.name)}</span>`;
      if (src.type === 'class' && src.files && src.files.length) {
        html += `<span class="cb-file" style="opacity:0.6">${escHtml(src.files.join(', '))}</span>`;
      }
      html += `<span class="cb-meta">${scope ? `<span class="cb-scope">${scope}</span>` : ''}<span class="cb-line">line ${ed.line}</span></span>`;
      if (ed.docComment) html += `<span class="cb-doc">${escHtml(ed.docComment)}</span>`;
      html += '</div>';
    });
  }

  // Listened by
  const listenEdges = cy.edges(`[target="${hookId}"][edgeType="listens"]`);
  if (listenEdges.length > 0) {
    html += `<div class="hook-card-section-title">Listened by (${listenEdges.length})</div>`;
    const sorted = listenEdges.toArray().sort((a, b) => (a.data().priority || 10) - (b.data().priority || 10));
    const shown = sorted.slice(0, 50);
    shown.forEach(e => {
      const src = e.source().data();
      const ed = e.data();
      const scope = scopeLabel(ed);
      html += `<div class="cb-item" data-node-id="${escHtml(src.id)}">`;
      if (ed.callback) html += `<span class="cb-name">${escHtml(ed.callback)}</span>`;
      html += `<span class="cb-file">${escHtml(src.path || src.name)}</span>`;
      if (src.type === 'class' && src.files && src.files.length) {
        html += `<span class="cb-file" style="opacity:0.6">${escHtml(src.files.join(', '))}</span>`;
      }
      html += `<span class="cb-meta">${scope ? `<span class="cb-scope">${scope}</span>` : ''}<span class="cb-priority">pri ${ed.priority || 10}</span><span class="cb-line">line ${ed.line}</span></span>`;
      if (ed.docComment) html += `<span class="cb-doc">${escHtml(ed.docComment)}</span>`;
      html += '</div>';
    });
    if (sorted.length > 50) {
      html += `<div class="truncation-note">\u2026 showing 50 of ${sorted.length}</div>`;
    }
  }

  html += '</div></div>'; // body-inner, body
  html += '</div>'; // hook-card
  return html;
}
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat: add buildHookCardHtml() helper for hook profile cards"
```

---

### Task 4: Rewrite `showDetail()` for Hook Nodes

Replace the hook-node branch of `showDetail()` to use the new card-based layout.

**Files:**
- Modify: `index.html` — rewrite `showDetail()` function (starts around line 2019)

- [ ] **Step 1: Rewrite `showDetail()` completely**

Replace the entire `function showDetail(node) { ... }` (through the closing `}` that includes the edge-item click listeners on line ~2229) with:

```javascript
function showDetail(node) {
  const d = node.data();
  const panel = document.getElementById('detail');
  const contextEl = document.getElementById('detail-context');
  const cardsEl = document.getElementById('detail-cards');

  // Highlight selected node
  highlightWithSearch(node);
  cy.batch(() => {
    cy.elements().removeClass('selected-node');
    node.addClass('selected-node');
  });

  panel.classList.add('open');
  panel.scrollTop = 0;

  // Reset
  contextEl.style.display = 'none';
  contextEl.innerHTML = '';
  cardsEl.innerHTML = '';

  if (d.type === 'hook') {
    // Single hook card, fully expanded
    cardsEl.innerHTML = buildHookCardHtml(d, d.id, true);

  } else if (d.type === 'file') {
    // Context header
    const sourceLabel = d.source || '';
    const connectedHookIds = getConnectedHookIds(d.id);
    contextEl.innerHTML = `<div class="detail-context-name">${escHtml(d.path)}</div>`
      + `<div class="detail-context-meta">${escHtml(sourceLabel)}${sourceLabel ? ' \u00b7 ' : ''}Involved in ${connectedHookIds.length} hook${connectedHookIds.length !== 1 ? 's' : ''}</div>`;
    contextEl.style.display = '';

    // Hook cards (collapsed)
    let html = '';
    connectedHookIds.forEach(hookId => {
      const hookNode = cy.getElementById(hookId);
      if (hookNode && hookNode.length) {
        html += buildHookCardHtml(hookNode.data(), hookId, false);
      }
    });
    cardsEl.innerHTML = html;

  } else if (d.type === 'class') {
    // Context header
    const sourceLabel = d.source || '';
    const filesStr = (d.files && d.files.length) ? d.files.join(', ') : '';
    const connectedHookIds = getConnectedHookIds(d.id);
    contextEl.innerHTML = `<div class="detail-context-name">${escHtml(d.name)}</div>`
      + (filesStr ? `<div class="detail-context-meta">${escHtml(filesStr)}</div>` : '')
      + `<div class="detail-context-meta">${escHtml(sourceLabel)}${sourceLabel ? ' \u00b7 ' : ''}Involved in ${connectedHookIds.length} hook${connectedHookIds.length !== 1 ? 's' : ''}</div>`;
    contextEl.style.display = '';

    // Hook cards (collapsed)
    let html = '';
    connectedHookIds.forEach(hookId => {
      const hookNode = cy.getElementById(hookId);
      if (hookNode && hookNode.length) {
        html += buildHookCardHtml(hookNode.data(), hookId, false);
      }
    });
    cardsEl.innerHTML = html;
  }

  // Wire up card header click for expand/collapse
  cardsEl.querySelectorAll('.hook-card:not(.single) .hook-card-header').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.hook-card').classList.toggle('expanded');
    });
  });

  // Wire up callback item click-through navigation
  cardsEl.querySelectorAll('.cb-item[data-node-id]').forEach(item => {
    item.addEventListener('click', (evt) => {
      evt.stopPropagation();
      const targetId = item.getAttribute('data-node-id');
      const targetNode = cy.getElementById(targetId);
      if (targetNode && targetNode.length) {
        cy.animate({ center: { eles: targetNode }, zoom: Math.max(cy.zoom(), 1.5) }, { duration: 300 });
        showDetail(targetNode);
      }
    });
  });
}
```

- [ ] **Step 2: Add `getConnectedHookIds()` helper**

Insert directly before `showDetail()`:

```javascript
function getConnectedHookIds(nodeId) {
  const hookIds = new Set();
  cy.edges(`[source="${nodeId}"]`).forEach(e => {
    const tgt = e.target().data();
    if (tgt.type === 'hook') hookIds.add(tgt.id);
  });
  return Array.from(hookIds);
}
```

- [ ] **Step 3: Verify `closeDetail()` still works**

The existing `closeDetail()` references `document.getElementById('detail')` and calls `classList.remove('open')`. It does NOT reference `detail-header`, `detail-body`, `detail-title`, or any of the old IDs. Verify this by reading the function. No changes needed.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: rewrite showDetail() with hook-centric card layout"
```

---

### Task 5: Manual Testing — Hook Node Click

Start the dev server and test clicking a hook node on the graph.

**Files:**
- No changes (testing only)

- [ ] **Step 1: Start dev server**

Run: `npm run serve`

- [ ] **Step 2: Load test data**

Open browser to `http://localhost:8080`. Load `src/sample-trace.json` (or any previously generated hooks JSON) via the file picker.

- [ ] **Step 3: Test hook node click**

Click any hook node (circle) on the graph. Verify:
- Panel slides in from right at 460px width
- Hook name is large (18px) and dominant
- Type badge shows with colored dot (cyan for action, purple for filter)
- Stats line shows `N fires · M listens · T total`
- "Fired by" section lists file paths with line numbers
- "Listened by" section lists callback names prominently, file paths, priority pills, line pills, scope when present
- Doc comments appear as indented block quotes
- Close button works
- Clicking a callback item navigates to that file node on the graph

- [ ] **Step 4: Test dynamic hook**

If sample data has dynamic hooks, click one. Verify the expression code block appears below the hook name.

---

### Task 6: Manual Testing — File and Class Node Clicks

Test the file/class click paths to verify context headers and collapsed cards.

**Files:**
- No changes (testing only)

- [ ] **Step 1: Test file node click**

Click any file node (rectangle) on the graph. Verify:
- Context header appears at top: file path in mono, source label, "Involved in N hooks"
- Hook cards appear below, all collapsed
- Each collapsed card shows: hook name (large), badge, stats, chevron on right
- Clicking a card header expands it (chevron rotates)
- Expanded card shows full callback list (same as hook-direct view)
- Multiple cards can be open simultaneously
- Clicking a callback item inside a card navigates to that node

- [ ] **Step 2: Test class node click (if class view is available)**

Toggle group-by to class view (the grid icon near search). Click a class node. Verify:
- Context header shows class name, file paths, source label, hook count
- Hook cards stack below, collapsed by default
- Expand/collapse works same as file view

- [ ] **Step 3: Test theme toggle**

Switch between dark and light themes. Verify all text colors, backgrounds, and borders look correct in both themes. The existing CSS variables handle this — just confirm nothing is hardcoded.

- [ ] **Step 4: Test edge cases**

- Click a hook with 0 fires and many listens: "Fired by" section should be absent
- Click a hook with many fires and 0 listens: "Listened by" section should be absent
- Click a file connected to only 1 hook: shows 1 collapsed card, "Involved in 1 hook" (singular)
- Rapidly click different nodes: panel content updates correctly each time

- [ ] **Step 5: Commit any fixes**

If any issues found during testing, fix and commit:
```bash
git add index.html
git commit -m "fix: polish hook-centric detail panel after manual testing"
```
