# Group By Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Group by" dropdown (File/Class) to the sidebar that switches source nodes between file nodes and class nodes.

**Architecture:** When the user selects "Class", the element construction loop re-keys edges that have `scope_class` to point at synthetic class nodes instead of file nodes. File nodes whose edges are all rerouted are omitted. The graph is rebuilt from cached JSON data. No backend changes.

**Tech Stack:** Cytoscape.js, vanilla JS, HTML/CSS (all in `index.html`)

---

### Task 1: Add Group By dropdown to sidebar HTML

**Files:**
- Modify: `index.html:908-916` (between Hotspots section and SOURCES section)

- [ ] **Step 1: Add the dropdown HTML**

Insert a new sidebar section between the hotspots slider row and the SOURCES divider. Find this block:

```html
    </div>

    <div class="sidebar-divider"></div>

    <div class="sidebar-section">
      <div class="section-title">SOURCES</div>
```

Replace with:

```html
    </div>

    <div class="sidebar-divider"></div>

    <div class="sidebar-section">
      <div class="section-title">VIEW</div>
      <div class="filter-row">
        <div class="filter-info">
          <div class="filter-label">Group by</div>
          <div class="filter-desc">How source nodes are grouped</div>
        </div>
        <select id="group-by-select" class="group-by-select" onchange="onGroupByChange(this.value)">
          <option value="file">File</option>
          <option value="class">Class</option>
        </select>
      </div>
    </div>

    <div class="sidebar-divider"></div>

    <div class="sidebar-section">
      <div class="section-title">SOURCES</div>
```

- [ ] **Step 2: Add CSS for the dropdown**

Find the existing `.slider-value` CSS rule (around line 520) and add after it:

```css
.group-by-select {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  outline: none;
}

.group-by-select:hover {
  border-color: var(--text-tertiary);
}
```

- [ ] **Step 3: Verify the dropdown renders**

Open `index.html` in browser, load a JSON file. Confirm the "Group by" dropdown appears in the sidebar between the Hotspots section and the SOURCES section, with "File" selected by default.

---

### Task 2: Add groupBy state and extract buildElements function

**Files:**
- Modify: `index.html:954-964` (state declarations)
- Modify: `index.html:1202-1249` (element construction loop)

- [ ] **Step 1: Add groupBy state variable**

Find this block near line 954:

```javascript
let cy = null;
let graphData = null;
let sourceColorMap = {};
let filterState = {
```

Replace with:

```javascript
let cy = null;
let graphData = null;
let sourceColorMap = {};
let groupBy = 'file';
let filterState = {
```

- [ ] **Step 2: Extract element construction into buildElements()**

Find the element construction block (lines ~1202-1249) that starts with:

```javascript
  // Build Cytoscape elements
  const elements = [];

  // Build file source index lookup for edge coloring
  var fileSourceIndexMap = {};
  for (const node of data.nodes) {
    if (node.type === 'file') {
      fileSourceIndexMap[node.id] = Math.max(0, sourceLabels.indexOf(node.source));
    }
  }

  for (const node of data.nodes) {
    const el = { data: { id: node.id, ...node } };
    if (node.type === 'hook') {
      const totalConn = node.fire_count + node.listen_count;
      el.data.totalConn = totalConn;
      var baseSize = Math.max(15, Math.min(60, 10 + Math.sqrt(totalConn) * 5));
      el.data.nodeSize = node.overlap ? baseSize * 1.2 : baseSize;
      el.data.sourceIndex = node.sourceIndex !== undefined ? node.sourceIndex : -1;
      el.data.overlap = node.overlap || false;
    } else {
      el.data.nodeSize = Math.max(10, Math.min(30, 8 + Math.sqrt(node.hook_count) * 3));
      el.data.sourceIndex = Math.max(0, sourceLabels.indexOf(node.source));
    }

    elements.push(el);
  }

  for (let i = 0; i < data.edges.length; i++) {
    const edge = data.edges[i];
    elements.push({
      data: {
        id: `edge-${i}`,
        source: edge.source,
        target: edge.target,
        edgeType: edge.type,
        callback: edge.callback || '',
        callbackType: edge.callback_type || '',
        callbackClass: edge.callback_class || '',
        callbackMethod: edge.callback_method || '',
        scopeClass: edge.scope_class || '',
        scopeFunction: edge.scope_function || '',
        priority: edge.priority,
        line: edge.line,
        sourceIndex: fileSourceIndexMap[edge.source] !== undefined ? fileSourceIndexMap[edge.source] : 0,
      }
    });
  }
```

Replace with:

```javascript
  // Build Cytoscape elements
  const elements = buildElements(data, sourceLabels, groupBy);
```

- [ ] **Step 3: Add buildElements() function**

Add this function before `_initGraphDeferred` (around line 1112):

```javascript
function buildElements(data, sourceLabels, mode) {
  const elements = [];

  // Build file source index lookup for edge coloring
  var sourceIndexMap = {};
  for (const node of data.nodes) {
    if (node.type === 'file') {
      sourceIndexMap[node.id] = Math.max(0, sourceLabels.indexOf(node.source));
    }
  }

  if (mode === 'class') {
    // --- Class mode: remap edges with scope_class to class nodes ---
    var classNodes = {};       // classId -> node data
    var fileEdgeCounts = {};   // fileId -> count of edges kept on file
    var fileTotalCounts = {};  // fileId -> total edges

    // Count total edges per file
    for (var i = 0; i < data.edges.length; i++) {
      var src = data.edges[i].source;
      fileTotalCounts[src] = (fileTotalCounts[src] || 0) + 1;
      fileEdgeCounts[src] = fileEdgeCounts[src] || 0;
    }

    // Determine which edges remap to class nodes
    for (var i = 0; i < data.edges.length; i++) {
      var edge = data.edges[i];
      var scopeClass = edge.scope_class;

      if (scopeClass) {
        // Find the source file's repo label
        var fileNode = data.nodes.find(n => n.id === edge.source);
        var source = fileNode ? fileNode.source : 'unknown';
        var classId = 'class::' + source + '::' + scopeClass;

        if (!classNodes[classId]) {
          var si = Math.max(0, sourceLabels.indexOf(source));
          sourceIndexMap[classId] = si;
          classNodes[classId] = {
            id: classId,
            type: 'class',
            name: scopeClass,
            source: source,
            hook_count: 0,
          };
        }
        classNodes[classId].hook_count++;

        elements.push({
          data: {
            id: 'edge-' + i,
            source: classId,
            target: edge.target,
            edgeType: edge.type,
            callback: edge.callback || '',
            callbackType: edge.callback_type || '',
            callbackClass: edge.callback_class || '',
            callbackMethod: edge.callback_method || '',
            scopeClass: edge.scope_class || '',
            scopeFunction: edge.scope_function || '',
            priority: edge.priority,
            line: edge.line,
            sourceIndex: sourceIndexMap[classId],
          }
        });
      } else {
        // No scope_class — keep original file as source
        fileEdgeCounts[edge.source] = (fileEdgeCounts[edge.source] || 0) + 1;
        elements.push({
          data: {
            id: 'edge-' + i,
            source: edge.source,
            target: edge.target,
            edgeType: edge.type,
            callback: edge.callback || '',
            callbackType: edge.callback_type || '',
            callbackClass: edge.callback_class || '',
            callbackMethod: edge.callback_method || '',
            scopeClass: edge.scope_class || '',
            scopeFunction: edge.scope_function || '',
            priority: edge.priority,
            line: edge.line,
            sourceIndex: sourceIndexMap[edge.source] !== undefined ? sourceIndexMap[edge.source] : 0,
          }
        });
      }
    }

    // Add class nodes
    for (var cid in classNodes) {
      var cn = classNodes[cid];
      elements.push({
        data: {
          id: cn.id,
          type: 'class',
          name: cn.name,
          source: cn.source,
          hook_count: cn.hook_count,
          nodeSize: Math.max(10, Math.min(30, 8 + Math.sqrt(cn.hook_count) * 3)),
          sourceIndex: sourceIndexMap[cn.id],
        }
      });
    }

    // Add file nodes only if they still have edges pointing to them
    for (const node of data.nodes) {
      if (node.type === 'file') {
        if (fileEdgeCounts[node.id] > 0) {
          elements.push({
            data: {
              id: node.id,
              ...node,
              nodeSize: Math.max(10, Math.min(30, 8 + Math.sqrt(node.hook_count) * 3)),
              sourceIndex: Math.max(0, sourceLabels.indexOf(node.source)),
            }
          });
        }
      }
    }

    // Add hook nodes
    for (const node of data.nodes) {
      if (node.type === 'hook') {
        const totalConn = node.fire_count + node.listen_count;
        var baseSize = Math.max(15, Math.min(60, 10 + Math.sqrt(totalConn) * 5));
        elements.push({
          data: {
            id: node.id,
            ...node,
            totalConn: totalConn,
            nodeSize: node.overlap ? baseSize * 1.2 : baseSize,
            sourceIndex: node.sourceIndex !== undefined ? node.sourceIndex : -1,
            overlap: node.overlap || false,
          }
        });
      }
    }

  } else {
    // --- File mode: original behavior ---
    for (const node of data.nodes) {
      const el = { data: { id: node.id, ...node } };
      if (node.type === 'hook') {
        const totalConn = node.fire_count + node.listen_count;
        el.data.totalConn = totalConn;
        var baseSize = Math.max(15, Math.min(60, 10 + Math.sqrt(totalConn) * 5));
        el.data.nodeSize = node.overlap ? baseSize * 1.2 : baseSize;
        el.data.sourceIndex = node.sourceIndex !== undefined ? node.sourceIndex : -1;
        el.data.overlap = node.overlap || false;
      } else {
        el.data.nodeSize = Math.max(10, Math.min(30, 8 + Math.sqrt(node.hook_count) * 3));
        el.data.sourceIndex = Math.max(0, sourceLabels.indexOf(node.source));
      }
      elements.push(el);
    }

    for (var i = 0; i < data.edges.length; i++) {
      var edge = data.edges[i];
      elements.push({
        data: {
          id: 'edge-' + i,
          source: edge.source,
          target: edge.target,
          edgeType: edge.type,
          callback: edge.callback || '',
          callbackType: edge.callback_type || '',
          callbackClass: edge.callback_class || '',
          callbackMethod: edge.callback_method || '',
          scopeClass: edge.scope_class || '',
          scopeFunction: edge.scope_function || '',
          priority: edge.priority,
          line: edge.line,
          sourceIndex: sourceIndexMap[edge.source] !== undefined ? sourceIndexMap[edge.source] : 0,
        }
      });
    }
  }

  return elements;
}
```

- [ ] **Step 4: Verify file mode still works**

Open `index.html`, load JSON. Graph should render identically to before.

---

### Task 3: Add onGroupByChange and rebuildGraph functions

**Files:**
- Modify: `index.html` (add functions near the filter toggle functions, around line 1780)

- [ ] **Step 1: Store sourceLabels globally**

Currently `sourceLabels` is a local variable inside `_initGraphDeferred`. We need it available for rebuilds. Find this line inside `_initGraphDeferred`:

```javascript
  const sourceLabels = meta.source_labels ||
    (meta.scanned_dirs || []).map(d => d.split('/').filter(Boolean).pop());
```

Change `const sourceLabels` to assign to a module-level variable. Add this declaration near the other `let` declarations (around line 954):

```javascript
let cachedSourceLabels = [];
```

Then change the existing line inside `_initGraphDeferred` to:

```javascript
  cachedSourceLabels = meta.source_labels ||
    (meta.scanned_dirs || []).map(d => d.split('/').filter(Boolean).pop());
  const sourceLabels = cachedSourceLabels;
```

- [ ] **Step 2: Store raw data globally for rebuilds**

Add another module-level variable near line 954:

```javascript
let cachedData = null;
```

Inside `_initGraphDeferred`, right after the `hookDataCache` assignment (line ~1142), add:

```javascript
  cachedData = data;
```

- [ ] **Step 3: Add onGroupByChange and rebuildGraph functions**

Add these two functions right before the `// --- Filters ---` comment (around line 1778):

```javascript
function onGroupByChange(value) {
  groupBy = value;
  rebuildGraph();
}

async function rebuildGraph() {
  if (!cy || !cachedData) return;

  var elements = buildElements(cachedData, cachedSourceLabels, groupBy);

  cy.elements().remove();

  var BATCH_SIZE = 500;
  for (var i = 0; i < elements.length; i += BATCH_SIZE) {
    var batch = elements.slice(i, Math.min(i + BATCH_SIZE, elements.length));
    cy.add(batch);
    await yieldToMain();
  }

  applyFilters();

  var layoutOpts = isLargeGraph
    ? { name: 'cose', animate: true, animationDuration: 200, nodeRepulsion: function() { return 8000; }, idealEdgeLength: function() { return 80; }, numIter: 200, randomize: true }
    : { name: 'cose', animate: true, animationDuration: 500, nodeRepulsion: function() { return 8000; }, idealEdgeLength: function() { return 80; } };

  cy.layout(layoutOpts).run();
}
```

- [ ] **Step 4: Verify toggling to Class mode works**

Open `index.html`, load JSON with scope data. Switch dropdown to "Class". Graph should rebuild with class nodes replacing file nodes where `scope_class` exists.

---

### Task 4: Update applyFilters to handle class nodes

**Files:**
- Modify: `index.html:1832-1846` (the applyFilters batch block)

- [ ] **Step 1: Update the file visibility logic to also handle class nodes**

The current `applyFilters` function hides file nodes not in `visibleFileIds`. Class nodes need the same treatment — they should be visible if they have at least one visible edge. Find this block inside `applyFilters`:

```javascript
    cy.nodes('[type="file"]').forEach(function(node) {
      if (!result.visibleFileIds.has(node.data('id'))) {
        node.addClass('hidden');
      }
    });
```

Replace with:

```javascript
    cy.nodes('[type="file"], [type="class"]').forEach(function(node) {
      if (!result.visibleFileIds.has(node.data('id'))) {
        node.addClass('hidden');
      }
    });
```

- [ ] **Step 2: Update hookDataCache to include class nodes when in class mode**

The `hookDataCache.fileNodes` array is used by `deriveFileVisibility` in `filters.js` to determine which source nodes are visible. When in class mode, we need to include class nodes in this array. Find the `hookDataCache` assignment inside `_initGraphDeferred`:

```javascript
  hookDataCache = { hooks: hookNodes, edges: data.edges, fileNodes: fileNodesData };
```

This is set once during init. We need to update it during rebuild too. Inside `rebuildGraph()`, after `cy.add(batch)` loop and before `applyFilters()`, add:

```javascript
  // Update hookDataCache for filter pipeline
  if (groupBy === 'class') {
    // Collect class and remaining file source nodes from the elements we just built
    var sourceNodes = elements
      .filter(function(el) { return el.data.type === 'class' || el.data.type === 'file'; })
      .map(function(el) { return el.data; });
    // Remap edges to use new source IDs
    var remappedEdges = elements
      .filter(function(el) { return el.data.edgeType; })
      .map(function(el) { return { source: el.data.source, target: el.data.target, type: el.data.edgeType, line: el.data.line }; });
    hookDataCache = { hooks: hookDataCache.hooks, edges: remappedEdges, fileNodes: sourceNodes };
  } else {
    var fileNodesData = cachedData.nodes.filter(function(n) { return n.type === 'file'; });
    hookDataCache = { hooks: hookDataCache.hooks, edges: cachedData.edges, fileNodes: fileNodesData };
  }
```

- [ ] **Step 3: Verify filters work in class mode**

Load JSON, switch to Class mode. Toggle hook type filters, repo toggles, high traffic. Confirm class nodes and their edges hide/show correctly.

---

### Task 5: Update showDetail for class nodes

**Files:**
- Modify: `index.html:1687-1736` (the `showDetail` function, file node branch)

- [ ] **Step 1: Add class node handling to showDetail**

Find this line inside `showDetail`:

```javascript
  } else if (d.type === 'file') {
```

Add a class node handler **before** it:

```javascript
  } else if (d.type === 'class') {
    title.textContent = d.name;
    badgeEl.innerHTML = '<span class="badge-dot" style="background:var(--text-tertiary)"></span>class';
    badgeEl.style.display = '';
    subtitleEl.textContent = d.source;
    exprEl.textContent = '';

    const fires = cy.edges(`[source="${d.id}"][edgeType="fires"]`);
    const listens = cy.edges(`[source="${d.id}"][edgeType="listens"]`);

    let html = '';

    html += '<div class="detail-stats cols-2">';
    html += `<div class="detail-stat-cell"><div class="detail-stat-number">${fires.length}</div><div class="detail-stat-label">FIRES</div></div>`;
    html += `<div class="detail-stat-cell"><div class="detail-stat-number">${listens.length}</div><div class="detail-stat-label">LISTENS</div></div>`;
    html += '</div>';

    if (fires.length > 0) {
      html += '<div class="section"><div class="section-title">Fires (' + fires.length + ')</div>';
      fires.forEach(e => {
        const tgt = e.target().data();
        const ed = e.data();
        const scope = scopeLabel(ed);
        html += `<div class="edge-item" data-node-id="${escHtml(tgt.id)}">`;
        html += `<span class="callback-ref">${escHtml(tgt.name)}</span>`;
        html += `<span class="edge-meta">${scope ? `<span class="scope-ref">${scope}</span>` : ''}<span class="line-ref">line ${ed.line}</span></span>`;
        html += '</div>';
      });
      html += '</div>';
    }

    if (listens.length > 0) {
      html += '<div class="section"><div class="section-title">Listens to (' + listens.length + ')</div>';
      listens.forEach(e => {
        const tgt = e.target().data();
        const ed = e.data();
        const scope = scopeLabel(ed);
        html += `<div class="edge-item" data-node-id="${escHtml(tgt.id)}">`;
        if (ed.callback) html += `<span class="callback-ref">${escHtml(ed.callback)}</span>`;
        html += `<span class="file-ref">${escHtml(tgt.name)}</span>`;
        html += `<span class="edge-meta">${scope ? `<span class="scope-ref">${scope}</span>` : ''}<span class="priority">pri ${ed.priority || 10}</span><span class="line-ref">line ${ed.line}</span></span>`;
        html += '</div>';
      });
      html += '</div>';
    }

    body.innerHTML = html;

  } else if (d.type === 'file') {
```

- [ ] **Step 2: Verify class node detail panel**

Load JSON, switch to Class mode. Click a class node. Confirm: title shows class name, badge shows "class", subtitle shows source repo, fires/listens lists show correctly with scope annotations.

---

### Task 6: Update search to match class node names

**Files:**
- Modify: `index.html:1878-1879` (search filter)

- [ ] **Step 1: Update the search node filter**

Find the search filter inside `onSearch` (around line 1878):

```javascript
    const matched = cy.nodes().filter(node => {
      if (node.hasClass('hidden')) return false;
```

Read a few more lines to see the full match logic, then update it to also match `name` on class nodes (class nodes have a `name` field like hook nodes, so they should already match if the search checks `node.data('name')`). Verify the existing match logic — if it already checks `name`, class nodes will work automatically.

- [ ] **Step 2: Verify search works in class mode**

Load JSON, switch to Class mode. Search for a class name (e.g. "WC_Bookings"). Confirm the class node is highlighted.

---

### Task 7: Add Cytoscape styles for class nodes

**Files:**
- Modify: `index.html` (Cytoscape style definitions, around line 1260-1466)

- [ ] **Step 1: Add class node styles**

Class nodes should look like file nodes but be distinguishable. Find the file node style selector. There should be a selector for `node[type="file"]` or a general non-hook node style. Add a style for class nodes right after it. If there's no explicit file node style (they use the default), add after the hook node styles:

```javascript
      {
        selector: 'node[type="class"]',
        style: {
          'shape': 'round-rectangle',
          'label': 'data(name)',
          'width': 'data(nodeSize)',
          'height': 'data(nodeSize)',
          'font-size': '7px',
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'ellipsis',
          'text-max-width': '60px',
        }
      },
```

The background color should be derived from sourceIndex using the same palette as file nodes, which the existing repo-colored style selectors handle (they match by `sourceIndex`, not by `type`).

- [ ] **Step 2: Verify class nodes are styled distinctly**

Load JSON, switch to Class mode. Class nodes should appear as rounded rectangles with the class name label, colored by source repo.

---

### Task 8: Final verification

- [ ] **Step 1: Full end-to-end test**

1. Open `index.html` in browser
2. Load `storage/new_metrics_wc_bookings.json`
3. Default view: file nodes, no change from before
4. Switch to Class: file nodes replaced by class nodes where scope_class exists, remaining file nodes stay
5. Click a class node: detail panel shows class info
6. Toggle filters in class mode: hook type, dynamic, overlapping, high traffic, repo toggles all work
7. Search for a class name: class node highlighted
8. Switch back to File: original view restored
9. Repeat filter/search in file mode: everything still works
