// Layout / projection options for the SigmaJS spike. Each entry mutates
// `x`/`y` attributes on the graphology graph in place; the canvas calls
// sigma.refresh() afterwards.
//
// Force-directed is the only "real" graph layout; the rest are projections
// that emphasise a specific facet of the data — clusters per source, action
// vs filter, file→hook bipartite, etc. They're meant for inspection, not
// general-purpose graph reading.

import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { circular, random } from 'graphology-layout';
import noverlap from 'graphology-layout-noverlap';
import louvain from 'graphology-communities-louvain';

export function applyLayout(graph, mode, { isLargeGraph, spread = 1 } = {}) {
  switch (mode) {
    case 'random':
      random.assign(graph, { scale: 200 });
      return;
    case 'circular':
      circular.assign(graph, { scale: 100 });
      return;
    case 'force':
      runForce(graph, isLargeGraph, spread);
      return;
    case 'force-noverlap':
      runForce(graph, isLargeGraph, spread);
      // Margin scales with spread so the slider also widens label gaps.
      noverlap.assign(graph, {
        maxIterations: 500,
        settings: { margin: 4 * spread, ratio: 1, expansion: 1.1 },
      });
      return;
    case 'source-clusters':
      sourceClusters(graph);
      return;
    case 'hook-type-split':
      hookTypeSplit(graph);
      return;
    case 'bipartite':
      bipartite(graph);
      return;
    case 'communities':
      communitiesLayout(graph, spread);
      return;
    case 'directory':
      directoryLayout(graph, spread);
      return;
    default:
      runForce(graph, isLargeGraph, spread);
  }
}

// Expansion-tuned FA2:
//   - scalingRatio: dominant repulsion knob; higher = more spread
//   - gravity: pulls everything toward (0,0); near-zero lets the graph fan out
//   - outboundAttractionDistribution: distributes attraction by node degree,
//     so hub nodes get pushed outward instead of dragging the cluster inward
//   - linLogMode: log-scaled attraction; produces visually distinct clusters
//     instead of one dense blob
//   - barnesHutOptimize: required for big graphs but cheap on small ones
//
// `spread` is a multiplier (1 = default, 2 = noticeably more open, 4 = very
// sparse). It scales scalingRatio.
function runForce(graph, isLargeGraph, spread) {
  // Seed with random positions so successive layouts don't reuse stale state
  // from a previous projection (e.g. circular → force).
  random.assign(graph, { scale: 1 });
  const settings = forceAtlas2.inferSettings(graph);
  forceAtlas2.assign(graph, {
    iterations: isLargeGraph ? 200 : 400,
    settings: {
      ...settings,
      gravity: 0.1,
      scalingRatio: 50 * spread,
      outboundAttractionDistribution: true,
      linLogMode: true,
      adjustSizes: true,
      barnesHutOptimize: true,
      slowDown: 5,
      strongGravityMode: false,
    },
  });
}

// Group nodes by sourceIndex; lay each cluster out as a small force-directed
// patch then translate the patch to a slot on a master ring.
function sourceClusters(graph) {
  const buckets = new Map();
  graph.forEachNode((id, attrs) => {
    const key = attrs.sourceIndex ?? -1;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(id);
  });

  const ringCount = buckets.size;
  const ringRadius = ringCount > 1 ? 200 : 0;
  let i = 0;
  for (const ids of buckets.values()) {
    const angle = (2 * Math.PI * i) / ringCount;
    const cx = Math.cos(angle) * ringRadius;
    const cy = Math.sin(angle) * ringRadius;
    // Place nodes in this cluster on a small disk around (cx, cy). Use
    // sqrt-spread so the disk size scales with cluster size.
    const r = 20 + Math.sqrt(ids.length) * 5;
    ids.forEach((id, j) => {
      const a = (2 * Math.PI * j) / ids.length;
      // Jitter the radius slightly so concentric rings don't form.
      const rr = r * (0.6 + Math.random() * 0.4);
      graph.setNodeAttribute(id, 'x', cx + Math.cos(a) * rr);
      graph.setNodeAttribute(id, 'y', cy + Math.sin(a) * rr);
    });
    i++;
  }
}

// Three columns: actions left, filters right, files/classes between.
function hookTypeSplit(graph) {
  const cols = { action: -100, filter: 100, fileclass: 0 };
  const groups = { action: [], filter: [], fileclass: [] };
  graph.forEachNode((id, attrs) => {
    if (attrs.nodeType === 'hook') {
      groups[attrs.hook_type === 'action' ? 'action' : 'filter'].push(id);
    } else {
      groups.fileclass.push(id);
    }
  });
  for (const [key, ids] of Object.entries(groups)) {
    const x = cols[key];
    // Stack vertically; spread to total height ~200 regardless of count.
    const total = ids.length;
    const stride = total > 0 ? 200 / total : 0;
    ids.forEach((id, j) => {
      graph.setNodeAttribute(id, 'x', x + (Math.random() - 0.5) * 30);
      graph.setNodeAttribute(id, 'y', -100 + j * stride);
    });
  }
}

// File/class nodes on an outer ring, hook nodes on an inner ring. Edges
// then radiate naturally between them.
function bipartite(graph) {
  const inner = [];
  const outer = [];
  graph.forEachNode((id, attrs) => {
    if (attrs.nodeType === 'hook') inner.push(id);
    else outer.push(id);
  });
  placeOnRing(graph, inner, 60);
  placeOnRing(graph, outer, 140);
}

function placeOnRing(graph, ids, radius) {
  const n = ids.length;
  if (n === 0) return;
  ids.forEach((id, i) => {
    const a = (2 * Math.PI * i) / n;
    graph.setNodeAttribute(id, 'x', Math.cos(a) * radius);
    graph.setNodeAttribute(id, 'y', Math.sin(a) * radius);
  });
}

// ---------------------------------------------------------------------------
// Communities (Louvain) — detects bounded contexts and renders each as a
// visually separate island. Three stages:
//
//   1. Louvain partition → each node gets a `community` id.
//   2. For each community, build a *subgraph* containing only its members
//      and the internal edges, run FA2 on it. This produces an organic,
//      community-specific shape (a hub-and-spoke cluster looks like a
//      hub-and-spoke; a clique looks like a blob; a chain stays linear).
//   3. Build a super-graph with one node per community sized to that
//      cluster's bounding radius, lay it out with FA2 + a noverlap pass
//      so cluster bounding circles cannot overlap. Then translate each
//      member's local position by its community's super-position.
//
// The result: clusters visibly separate in space, edges within a cluster
// stay short, and inter-cluster edges become long bridges between islands.
// ---------------------------------------------------------------------------
function communitiesLayout(graph, spread) {
  louvain.assign(graph);

  const buckets = new Map();
  graph.forEachNode((id, attrs) => {
    const c = attrs.community;
    if (!buckets.has(c)) buckets.set(c, []);
    buckets.get(c).push(id);
  });

  // Stage 2 — per-community FA2 on internal subgraph.
  const localPositions = new Map(); // node id → {x, y} in subgraph space
  const communityRadius = new Map(); // community id → bounding radius

  for (const [c, ids] of buckets.entries()) {
    const sub = new Graph({ multi: false, type: 'directed' });
    const idSet = new Set(ids);
    for (const id of ids) {
      sub.addNode(id, { x: Math.random(), y: Math.random() });
    }
    graph.forEachEdge((eid, attrs, src, tgt) => {
      if (!idSet.has(src) || !idSet.has(tgt)) return;
      if (src === tgt) return; // simple subgraph rejects self-loops
      if (!sub.hasEdge(src, tgt)) sub.addEdge(src, tgt);
    });

    if (sub.order > 1) {
      const settings = forceAtlas2.inferSettings(sub);
      forceAtlas2.assign(sub, {
        iterations: 200,
        settings: {
          ...settings,
          gravity: 1,
          scalingRatio: 10,
          barnesHutOptimize: sub.order > 50,
        },
      });
    }

    // Normalize local positions: re-center on origin and scale so the
    // furthest member sits at exactly `targetRadius`. Bigger communities
    // get a slightly larger radius so they're visually distinct, but the
    // ratio is bounded so no single cluster dominates.
    // Cluster's bounding radius. Larger clusters get a bigger disk but with
    // sub-linear growth so a 200-node community doesn't dwarf a 5-node one.
    // Tuned generous-ish so internal structure is readable at first paint —
    // a 30-node cluster lands around r=37, a 5-node one around r=24.
    const targetRadius = 15 + Math.sqrt(ids.length) * 4;
    let cx = 0, cy = 0;
    sub.forEachNode((id, attrs) => { cx += attrs.x; cy += attrs.y; });
    cx /= sub.order;
    cy /= sub.order;
    let maxDist = 0;
    sub.forEachNode((id, attrs) => {
      const dx = attrs.x - cx;
      const dy = attrs.y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxDist) maxDist = d;
    });
    const scaleK = maxDist > 0 ? targetRadius / maxDist : 1;
    sub.forEachNode((id, attrs) => {
      localPositions.set(id, {
        x: (attrs.x - cx) * scaleK,
        y: (attrs.y - cy) * scaleK,
      });
    });
    communityRadius.set(c, targetRadius);
  }

  // Stage 3 — super-graph (one node per community). Size each super-node
  // to ~2× the cluster's actual radius so noverlap leaves a guaranteed
  // gap between clusters, scaled by spread.
  const superGraph = new Graph();
  for (const c of buckets.keys()) {
    superGraph.addNode(String(c), {
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: communityRadius.get(c) * 2 * spread,
    });
  }
  graph.forEachEdge((eid, attrs, src, tgt) => {
    const cs = String(graph.getNodeAttribute(src, 'community'));
    const ct = String(graph.getNodeAttribute(tgt, 'community'));
    if (cs === ct) return;
    const key = cs < ct ? cs + '|' + ct : ct + '|' + cs;
    if (!superGraph.hasEdge(key)) {
      superGraph.addEdgeWithKey(key, cs, ct, { weight: 1 });
    } else {
      superGraph.setEdgeAttribute(
        key,
        'weight',
        superGraph.getEdgeAttribute(key, 'weight') + 1
      );
    }
  });

  if (superGraph.order > 1) {
    const ss = forceAtlas2.inferSettings(superGraph);
    forceAtlas2.assign(superGraph, {
      iterations: 800,
      settings: {
        ...ss,
        gravity: 0.05,
        scalingRatio: 50 * spread,
        outboundAttractionDistribution: true,
        adjustSizes: true,
        barnesHutOptimize: false,
        slowDown: 3,
      },
    });
    // No-overlap pass with margin scaled to the cluster sizes — guarantees
    // a visible gap between every pair of community bounding circles.
    noverlap.assign(superGraph, {
      maxIterations: 1000,
      settings: { margin: 15 * spread, ratio: 1.0, expansion: 1.5 },
    });
  }

  for (const [c, ids] of buckets.entries()) {
    const center = superGraph.getNodeAttributes(String(c));
    for (const id of ids) {
      const local = localPositions.get(id);
      graph.setNodeAttribute(id, 'x', center.x + local.x);
      graph.setNodeAttribute(id, 'y', center.y + local.y);
    }
  }
}

// ---------------------------------------------------------------------------
// Cluster by directory — uses the file path's leading directory as the
// grouping key. Often the most semantically meaningful clustering for a WP
// codebase: includes/admin/*, includes/email/*, templates/*, etc. fall into
// natural groups that reflect the plugin's module structure.
//
// Hook nodes inherit the directory of their first connected file (any
// "fires" or "listens" edge — whichever resolves first). If none can be
// found the hook lands in a `__unassigned__` bucket.
// ---------------------------------------------------------------------------
function directoryLayout(graph, spread) {
  const buckets = new Map();
  const groupOf = new Map(); // node id -> directory key

  function resolveDir(attrs) {
    if (attrs.nodeType === 'file' && attrs.path) {
      const segs = String(attrs.path).split('/').filter(Boolean);
      // Use first 2 segments for finer-grained grouping (includes/admin
      // distinct from includes/email). Fallback to first only if shallow.
      return segs.slice(0, Math.min(2, segs.length)).join('/') || '__root__';
    }
    if (attrs.nodeType === 'class' && attrs.files && attrs.files[0]) {
      const segs = String(attrs.files[0]).split('/').filter(Boolean);
      return segs.slice(0, Math.min(2, segs.length)).join('/') || '__root__';
    }
    return null;
  }

  // Pass 1: assign directory groups to file/class nodes.
  graph.forEachNode((id, attrs) => {
    const g = resolveDir(attrs);
    if (g) {
      groupOf.set(id, g);
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g).push(id);
    }
  });

  // Pass 2: assign each hook to the directory of its first connected file.
  graph.forEachNode((id, attrs) => {
    if (groupOf.has(id)) return;
    if (attrs.nodeType !== 'hook') return;
    let g = null;
    graph.forEachNeighbor(id, (nid) => {
      if (g) return;
      if (groupOf.has(nid)) g = groupOf.get(nid);
    });
    if (!g) g = '__unassigned__';
    groupOf.set(id, g);
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g).push(id);
  });

  // Run FA2 inside each directory cluster (organic shape) and place the
  // clusters via FA2 + noverlap on a super-graph (no overlap between
  // bounding circles). Same staged approach as communitiesLayout.
  const localPositions = new Map();
  const groupRadius = new Map();
  for (const [g, ids] of buckets.entries()) {
    const sub = new Graph({ multi: false, type: 'directed' });
    const idSet = new Set(ids);
    for (const id of ids) sub.addNode(id, { x: Math.random(), y: Math.random() });
    graph.forEachEdge((eid, attrs, src, tgt) => {
      if (!idSet.has(src) || !idSet.has(tgt) || src === tgt) return;
      if (!sub.hasEdge(src, tgt)) sub.addEdge(src, tgt);
    });
    if (sub.order > 1) {
      const settings = forceAtlas2.inferSettings(sub);
      forceAtlas2.assign(sub, {
        iterations: 200,
        settings: { ...settings, gravity: 1, scalingRatio: 10 },
      });
    }
    // Normalize each cluster to a known target radius (same approach as
    // communitiesLayout) so super-graph noverlap can guarantee separation.
    // Cluster's bounding radius. Larger clusters get a bigger disk but with
    // sub-linear growth so a 200-node community doesn't dwarf a 5-node one.
    // Tuned generous-ish so internal structure is readable at first paint —
    // a 30-node cluster lands around r=37, a 5-node one around r=24.
    const targetRadius = 15 + Math.sqrt(ids.length) * 4;
    let cx = 0, cy = 0;
    sub.forEachNode((id, attrs) => { cx += attrs.x; cy += attrs.y; });
    cx /= sub.order;
    cy /= sub.order;
    let maxDist = 0;
    sub.forEachNode((id, attrs) => {
      const dx = attrs.x - cx;
      const dy = attrs.y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxDist) maxDist = d;
    });
    const scaleK = maxDist > 0 ? targetRadius / maxDist : 1;
    sub.forEachNode((id, attrs) => {
      localPositions.set(id, {
        x: (attrs.x - cx) * scaleK,
        y: (attrs.y - cy) * scaleK,
      });
    });
    groupRadius.set(g, targetRadius);
  }

  // Build a super-graph with cross-directory edges so related directories
  // (e.g. includes/admin ↔ includes/admin-importers) cluster nearby.
  const superGraph = new Graph();
  const groups = Array.from(buckets.keys()).sort();
  for (const g of groups) {
    superGraph.addNode(g, {
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: groupRadius.get(g) * 2 * spread,
    });
  }
  graph.forEachEdge((eid, attrs, src, tgt) => {
    const gs = groupOf.get(src);
    const gt = groupOf.get(tgt);
    if (!gs || !gt || gs === gt) return;
    const key = gs < gt ? gs + '|' + gt : gt + '|' + gs;
    if (!superGraph.hasEdge(key)) superGraph.addEdgeWithKey(key, gs, gt);
  });
  if (superGraph.order > 1) {
    const ss = forceAtlas2.inferSettings(superGraph);
    forceAtlas2.assign(superGraph, {
      iterations: 800,
      settings: {
        ...ss,
        gravity: 0.05,
        scalingRatio: 50 * spread,
        outboundAttractionDistribution: true,
        adjustSizes: true,
        slowDown: 3,
      },
    });
    noverlap.assign(superGraph, {
      maxIterations: 1000,
      settings: { margin: 15 * spread, ratio: 1.0, expansion: 1.5 },
    });
  }
  for (const [g, ids] of buckets.entries()) {
    const center = superGraph.getNodeAttributes(g);
    for (const id of ids) {
      const local = localPositions.get(id);
      graph.setNodeAttribute(id, 'x', center.x + local.x);
      graph.setNodeAttribute(id, 'y', center.y + local.y);
    }
  }
}
