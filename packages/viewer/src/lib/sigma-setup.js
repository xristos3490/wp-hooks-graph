// SigmaJS / graphology spike — builds a graphology Graph from the same
// `data` shape consumed by buildElements() in cytoscape-setup.js, and exposes
// a thin cy-compatible adapter so DetailPanel can keep using cy.getElementById
// and cy.edges('[target="X"][edgeType="Y"]') without changes.
//
// This is intentionally narrow: the adapter only implements the surface that
// DetailPanel.jsx and the selected-node effect in SigmaGraphCanvas.jsx call.
// Anything else returns empty collections.

import Graph from 'graphology';
import { OVERLAP_ACTION, OVERLAP_FILTER } from './constants.js';

/**
 * Build a graphology MultiDirectedGraph from the same data shape used by
 * buildElements() in cytoscape-setup.js. Node attributes are stored on the
 * graphology node; the adapter exposes them as `node.data()` for DetailPanel.
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

    for (const node of data.nodes) {
      if (node.type === 'file') fileLookup[node.id] = node;
    }

    for (let i = 0; i < data.edges.length; i++) {
      const edge = data.edges[i];
      const scopeClass = edge.scope_class;
      let sourceId;

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
        sourceId = classId;
      } else {
        fileEdgeCounts[edge.source] = (fileEdgeCounts[edge.source] || 0) + 1;
        sourceId = edge.source;
      }
      addEdge(graph, edge, i, sourceId, sourceIndexMap, repoPalettes, sourceLabels);
    }

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

function nodeSizeFor(node) {
  if (node.type === 'hook') {
    const totalConn = (node.fire_count || 0) + (node.listen_count || 0);
    const baseSize = Math.max(15, Math.min(60, 10 + Math.sqrt(totalConn) * 5));
    return node.overlap ? baseSize * 1.2 : baseSize;
  }
  return Math.max(12, Math.min(50, 10 + Math.sqrt(node.hook_count || 0) * 5));
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
  const size = nodeSizeFor(node);
  const color = nodeColorFor(node, repoPalettes, sourceLabels);
  // Sigma uses `type` as the registered renderer program, so we cannot store
  // the app's hook/file/class type under that key. Stash it as `nodeType` and
  // surface it back via the cy-adapter's data() method below.
  const { type: appType, ...rest } = node;
  // Sigma node `size` is screen-space pixels (radius). Cytoscape's nodeSize is
  // a diameter in graph-px. Halve, then floor at 4px so small nodes remain
  // visible. Without this floor (we previously divided by 6), 15px hooks
  // collapsed to 2.5px circles which were sub-pixel after camera scaling.
  const sigmaSize = Math.max(4, size / 3);
  graph.addNode(node.id, {
    ...rest,
    nodeType: appType,
    type: 'circle', // default registered sigma program
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
    type: isFires ? 'arrow' : 'line', // listens rendered as plain line (sigma has no dashed by default)
    hidden: false,
  });
}

/**
 * Cy-compatible adapter exposed via cyRef.current so DetailPanel.jsx works
 * unchanged. Implements only the surface DetailPanel touches:
 *   cy.getElementById(id) → { length, data() }
 *   cy.edges('[target|source="X"][edgeType="Y"]') → { length, toArray() }
 *   each edge → { data(), source(), target() }
 *   each node-like → { data() }
 *
 * NOTE: spike-grade. If we adopt sigma we should refactor DetailPanel to read
 * from raw data via context instead of going through this shim.
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
