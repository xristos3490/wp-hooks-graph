// Builds a graphology Graph from the parser's JSON output and exposes a thin
// cy-style adapter so DetailPanel can keep its `cy.getElementById` /
// `cy.edges('[target="X"][edgeType="Y"]')` query syntax. The adapter is a
// historical-shape API, not a cytoscape dependency — it only implements the
// surface that DetailPanel.jsx and the selected-node effect in
// SigmaGraphCanvas.jsx call. Anything else returns empty collections.

import Graph from 'graphology';
import { OVERLAP_ACTION, OVERLAP_FILTER } from './constants.js';

/**
 * Build a graphology MultiDirectedGraph from the parser's JSON shape. Node
 * attributes are stored on the graphology node; the adapter exposes them as
 * `node.data()` for DetailPanel.
 */
export function buildSigmaGraph(data, sourceLabels, repoPalettes, mode) {
  const graph = new Graph({ multi: true, type: 'directed', allowSelfLoops: true });
  const sourceIndexMap = {};

  for (const node of data.nodes) {
    if (node.type === 'file') {
      sourceIndexMap[node.id] = Math.max(0, sourceLabels.indexOf(node.source));
    }
  }

  if (mode === 'class') {
    const classNodes = {};
    const fileEdgeCounts = {};
    const fileLookup = {};
    const remappedSources = new Array(data.edges.length);

    for (const node of data.nodes) {
      if (node.type === 'file') fileLookup[node.id] = node;
    }

    // Pass 1: classify edges to discover class nodes and remap file→class
    // source ids. No graph mutation here — graphology's addEdgeWithKey
    // requires both endpoints to exist, so edges have to wait until pass 3.
    for (let i = 0; i < data.edges.length; i++) {
      const edge = data.edges[i];
      const scopeClass = edge.scope_class;

      if (scopeClass) {
        const fileNode = fileLookup[edge.source];
        const source = fileNode ? fileNode.source : 'unknown';
        const classId = 'class::' + source + '::' + scopeClass;
        if (!classNodes[classId]) {
          sourceIndexMap[classId] = Math.max(0, sourceLabels.indexOf(source));
          classNodes[classId] = {
            id: classId,
            type: 'class',
            name: scopeClass,
            source,
            hook_count: 0,
            files: new Set(),
          };
        }
        classNodes[classId].hook_count++;
        if (fileNode) classNodes[classId].files.add(fileNode.path);
        remappedSources[i] = classId;
      } else {
        fileEdgeCounts[edge.source] = (fileEdgeCounts[edge.source] || 0) + 1;
        remappedSources[i] = edge.source;
      }
    }

    // Pass 2: add all nodes (class, file, hook).
    for (const cid in classNodes) {
      const cn = classNodes[cid];
      addNode(graph, {
        id: cn.id,
        type: 'class',
        name: cn.name,
        source: cn.source,
        hook_count: cn.hook_count,
        files: Array.from(cn.files).sort(),
        sourceIndex: sourceIndexMap[cn.id],
      }, repoPalettes, sourceLabels);
    }

    for (const node of data.nodes) {
      if (node.type === 'file' && fileEdgeCounts[node.id] > 0) {
        addNode(graph, {
          id: node.id,
          ...node,
          sourceIndex: Math.max(0, sourceLabels.indexOf(node.source)),
        }, repoPalettes, sourceLabels);
      } else if (node.type === 'hook') {
        addNode(graph, {
          id: node.id,
          ...node,
          sourceIndex: node.sourceIndex !== undefined ? node.sourceIndex : -1,
          overlap: node.overlap || false,
        }, repoPalettes, sourceLabels);
      }
    }

    // Pass 3: add edges now that endpoints exist.
    for (let i = 0; i < data.edges.length; i++) {
      addEdge(graph, data.edges[i], i, remappedSources[i], sourceIndexMap, repoPalettes, sourceLabels);
    }
  } else {
    for (const node of data.nodes) {
      const enriched =
        node.type === 'hook'
          ? {
              ...node,
              sourceIndex: node.sourceIndex !== undefined ? node.sourceIndex : -1,
              overlap: node.overlap || false,
            }
          : { ...node, sourceIndex: Math.max(0, sourceLabels.indexOf(node.source)) };
      addNode(graph, enriched, repoPalettes, sourceLabels);
    }
    for (let i = 0; i < data.edges.length; i++) {
      addEdge(graph, data.edges[i], i, data.edges[i].source, sourceIndexMap, repoPalettes, sourceLabels);
    }
  }

  // Random initial positions in unit square — ForceAtlas2 needs starting xy.
  graph.forEachNode((id, attrs) => {
    if (attrs.x === undefined) graph.setNodeAttribute(id, 'x', Math.random());
    if (attrs.y === undefined) graph.setNodeAttribute(id, 'y', Math.random());
  });

  return graph;
}

// Return sigma-space pixel radius (screen px). Degree → size on a sqrt curve
// with a low floor so leaves naturally fall under labelRenderedSizeThreshold
// at default zoom and only hubs auto-label. The wide dynamic range
// (≈3 → ≈28) creates a clear visual hierarchy on huge graphs.
function nodeSizeFor(node) {
  if (node.type === 'hook') {
    const deg = (node.fire_count || 0) + (node.listen_count || 0);
    const base = 3 + Math.sqrt(deg) * 3;
    return Math.min(28, node.overlap ? base * 1.2 : base);
  }
  const deg = node.hook_count || 0;
  return Math.min(24, 3 + Math.sqrt(deg) * 2.5);
}

// Live size used by the sigma node reducer. Reads raw signals stored on the
// graphology node (degree, overlap, nodeType) and applies the user-tunable
// sizing controls plus the camera-driven reveal-on-zoom boost. Kept pure so
// it can run inside the reducer on every frame without allocations.
//
// `sizing` fields are integer percent (100 = 1.0×); `density` is a precomputed
// multiplier from the canvas (1.0 when disabled).
export function computeNodeSize(attrs, sizing, cameraRatio, density) {
  const hubFactor = sizing.hubEmphasis / 100;
  let base;
  if (attrs.nodeType === 'hook') {
    const deg = (attrs.fire_count || 0) + (attrs.listen_count || 0);
    base = 3 + Math.sqrt(deg) * 3 * hubFactor;
    if (attrs.overlap) base *= 1.2;
    base = Math.min(28, base);
  } else {
    const deg = attrs.hook_count || 0;
    base = 3 + Math.sqrt(deg) * 2.5 * hubFactor;
    base = Math.min(24, base);
  }

  const typeScale =
    attrs.nodeType === 'hook'
      ? sizing.hookScale
      : attrs.nodeType === 'class'
        ? sizing.classScale
        : sizing.fileScale;

  let size = base * (typeScale / 100) * density;

  // Reveal-on-zoom: leaves grow as the camera zooms in (ratio < 1); already
  // prominent hubs barely move, so the visual hierarchy is preserved at any
  // zoom level. Attenuation is by current size, not raw degree, so hub
  // emphasis and per-type scaling participate naturally.
  if (sizing.zoomResponse && cameraRatio < 1) {
    const zoomFactor = Math.min(3, 1 / Math.max(cameraRatio, 0.05));
    const attenuation = Math.max(0, 1 - size / 30);
    size *= 1 + (zoomFactor - 1) * attenuation;
  }

  return Math.max(3, size);
}

// Density compensation: shrink (or grow) sizes inversely to node count so a
// 5k-node graph and a 200-node graph both read at default zoom. Returns a
// multiplier in [0.5, 1.5] anchored at ~1000 nodes = 1.0×.
export function computeDensityFactor(nodeCount, enabled) {
  if (!enabled || nodeCount <= 0) return 1;
  const factor = Math.sqrt(1000 / nodeCount);
  return Math.max(0.5, Math.min(1.5, factor));
}

function nodeColorFor(node, repoPalettes, sourceLabels) {
  if (node.type === 'hook') {
    if (node.overlap) {
      return node.hook_type === 'action' ? OVERLAP_ACTION : OVERLAP_FILTER;
    }
    const label = sourceLabels[node.sourceIndex] || sourceLabels[0];
    const palette = repoPalettes[label];
    if (!palette) return '#888';
    return node.hook_type === 'action' ? palette.action : palette.filter;
  }
  // file / class
  const label = node.source && repoPalettes[node.source] ? node.source : sourceLabels[node.sourceIndex] || sourceLabels[0];
  return (repoPalettes[label] && repoPalettes[label].file) || '#bbb';
}

function addNode(graph, node, repoPalettes, sourceLabels) {
  if (graph.hasNode(node.id)) return;
  const sigmaSize = Math.max(3, nodeSizeFor(node));
  const color = nodeColorFor(node, repoPalettes, sourceLabels);
  // Sigma uses `type` as the registered renderer program, so we cannot store
  // the app's hook/file/class type under that key. Stash it as `nodeType` and
  // surface it back via the cy-adapter's data() method below.
  const { type: appType, ...rest } = node;
  graph.addNode(node.id, {
    ...rest,
    nodeType: appType,
    // Hooks render as circles; files/classes render as squares. Both
    // programs are registered in SigmaGraphCanvas.
    type: appType === 'hook' ? 'circle' : 'square',
    size: sigmaSize,
    baseSize: sigmaSize,
    color,
    baseColor: color,
    label: appType === 'file' ? node.path : node.name,
    hidden: false,
  });
}

function addEdge(graph, edge, i, sourceId, sourceIndexMap, repoPalettes, sourceLabels) {
  const id = 'edge-' + i;
  const sourceIndex = sourceIndexMap[sourceId] !== undefined ? sourceIndexMap[sourceId] : 0;
  const label = sourceLabels[sourceIndex] || sourceLabels[0];
  const palette = repoPalettes[label] || {};
  const isFires = edge.type === 'fires';
  // Use hex variants (not the rgba *Alpha keys) — sigma's default WebGL
  // programs only parse #RRGGBB(AA). Translucency is faked with a fixed
  // hex shade; highlight switches to the darker hex.
  const color = isFires ? palette.fireEdge : palette.listenEdge;
  graph.addEdgeWithKey(id, sourceId, edge.target, {
    edgeType: edge.type,
    callback: edge.callback || '',
    callbackType: edge.callback_type || '',
    callbackClass: edge.callback_class || '',
    callbackMethod: edge.callback_method || '',
    scopeClass: edge.scope_class || '',
    scopeFunction: edge.scope_function || '',
    docComment: edge.doc_comment || '',
    priority: edge.priority,
    line: edge.line,
    sourceIndex,
    size: 1,
    color: color || '#aaa',
    baseColor: color || '#aaa',
    type: 'arrow',
    // Curvature sign distinguishes fires (arc one way) from listens (arc the
    // other way) when the curvedArrow program is selected. Read by
    // @sigma/edge-curve. Magnitude kept modest so dense graphs don't get
    // tangled. The 'arrow' program ignores this attribute.
    curvature: isFires ? 0.25 : -0.25,
    // Stored on the edge but blanked out by the reducer at idle — only
    // surfaced when the edge is inside an active highlight neighborhood.
    label: edge.type,
    baseLabel: edge.type,
    hidden: false,
    // Seed at 0 so sigma's zIndex sort has an attribute to compare against
    // when applyEdgeElevation lifts highlighted edges to 1 in
    // SigmaGraphCanvas.
    zIndex: 0,
  });
}

/**
 * Cy-style adapter exposed via cyRef.current so DetailPanel can keep its
 * familiar query syntax. Implements only the surface DetailPanel touches:
 *   cy.getElementById(id) → { length, data() }
 *   cy.edges('[target|source="X"][edgeType="Y"]') → { length, toArray() }
 *   each edge → { data(), source(), target() }
 *   each node-like → { data() }
 *
 * Follow-up: refactor DetailPanel to read from raw data via context and drop
 * this shim — it's the last bit of cy-shaped indirection in the viewer.
 */
export function buildCyAdapter(graph) {
  const nodeData = (id) => {
    if (!graph.hasNode(id)) return null;
    const attrs = graph.getNodeAttributes(id);
    // Restore the app-level `type` (hook/file/class) that we renamed to
    // nodeType when storing on the graphology node — DetailPanel reads it.
    return { id, ...attrs, type: attrs.nodeType };
  };
  const nodeRef = (id) => ({ data: () => nodeData(id) });
  const edgeRef = (id) => {
    const attrs = graph.getEdgeAttributes(id);
    const src = graph.source(id);
    const tgt = graph.target(id);
    return {
      data: () => ({ id, source: src, target: tgt, ...attrs }),
      source: () => nodeRef(src),
      target: () => nodeRef(tgt),
    };
  };
  const collection = (arr) => ({
    length: arr.length,
    toArray: () => arr,
  });

  return {
    __sigma: true, // sentinel so other code can detect renderer if needed
    getElementById(id) {
      if (!graph.hasNode(id)) return { length: 0, data: () => null };
      return {
        length: 1,
        data: () => nodeData(id),
      };
    },
    edges(selector) {
      const m = selector && selector.match(/\[(target|source)="([^"]+)"\]\[edgeType="(fires|listens)"\]/);
      if (!m) return collection([]);
      const [, key, val, edgeType] = m;
      const matched = [];
      graph.forEachEdge((id, attrs, src, tgt) => {
        const matchEnd = key === 'target' ? tgt === val : src === val;
        if (matchEnd && attrs.edgeType === edgeType) matched.push(edgeRef(id));
      });
      return collection(matched);
    },
  };
}
