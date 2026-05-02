// Layout / projection options for the SigmaJS spike. Each entry mutates
// `x`/`y` attributes on the graphology graph in place; the canvas calls
// sigma.refresh() afterwards.
//
// Force-directed is the only "real" graph layout; the rest are projections
// that emphasise a specific facet of the data — clusters per source, action
// vs filter, file→hook bipartite, etc. They're meant for inspection, not
// general-purpose graph reading.

import forceAtlas2 from 'graphology-layout-forceatlas2';
import { circular, random } from 'graphology-layout';
import noverlap from 'graphology-layout-noverlap';

export const LAYOUT_OPTIONS = [
  { id: 'force', label: 'Force-directed (FA2)' },
  { id: 'force-noverlap', label: 'Force-directed + no-overlap' },
  { id: 'circular', label: 'Circular' },
  { id: 'source-clusters', label: 'Source clusters (radial)' },
  { id: 'hook-type-split', label: 'Hook type split (actions / filters)' },
  { id: 'bipartite', label: 'Bipartite (files ↔ hooks)' },
  { id: 'random', label: 'Random' },
];

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
