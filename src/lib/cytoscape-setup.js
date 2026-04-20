import { OVERLAP_ACTION, OVERLAP_FILTER, THEME_COLORS } from './constants.js';

/**
 * Build the Cytoscape stylesheet array.
 * Extracted from index.html _initGraphDeferred() lines 1622-1853.
 */
export function buildCytoscapeStyles(sourceLabels, repoPalettes, isLargeGraph) {
  const curveStyle = isLargeGraph ? 'straight' : 'bezier';
  const transitionDur = isLargeGraph ? '0ms' : '200ms';
  const edgeTransitionDur = isLargeGraph ? '0ms' : '150ms';
  const minZoomedFont = isLargeGraph ? 8 : 0;
  const tc = THEME_COLORS;

  return [
    // Base hook style
    {
      selector: 'node[type="hook"]',
      style: {
        'label': 'data(name)',
        'font-size': 9,
        'min-zoomed-font-size': minZoomedFont,
        'font-family': 'system-ui, -apple-system, Segoe UI, sans-serif',
        'color': tc.nodeText,
        'text-valign': 'bottom',
        'text-margin-y': 6,
        'width': 'data(nodeSize)',
        'height': 'data(nodeSize)',
        'shape': 'ellipse',
        'border-width': 0,
        'text-wrap': 'wrap',
        'text-max-width': 200,
        'transition-property': 'opacity',
        'transition-duration': transitionDur,
      },
    },
    // Per-repo action hook styles
    ...sourceLabels.map((label, i) => ({
      selector: `node[type="hook"][hook_type="action"][sourceIndex = ${i}]`,
      style: { 'background-color': repoPalettes[label].action },
    })),
    // Per-repo filter hook styles
    ...sourceLabels.map((label, i) => ({
      selector: `node[type="hook"][hook_type="filter"][sourceIndex = ${i}]`,
      style: { 'background-color': repoPalettes[label].filter },
    })),
    // Overlap hook styles (after per-repo to override)
    {
      selector: 'node[type="hook"][hook_type="action"][?overlap]',
      style: { 'background-color': OVERLAP_ACTION },
    },
    {
      selector: 'node[type="hook"][hook_type="filter"][?overlap]',
      style: { 'background-color': OVERLAP_FILTER },
    },
    // Dynamic hook border
    {
      selector: 'node[type="hook"][?dynamic]',
      style: {
        'border-width': 2,
        'border-color': '#e4b844', // matches --hg-color-dynamic
        'border-style': 'dashed',
        'border-opacity': 0.8,
      },
    },
    // Base file node style
    {
      selector: 'node[type="file"]',
      style: {
        'label': 'data(path)',
        'font-size': 7,
        'min-zoomed-font-size': minZoomedFont,
        'font-family': 'SF Mono, Cascadia Code, Menlo, Consolas, monospace',
        'color': tc.nodeText,
        'text-valign': 'bottom',
        'text-margin-y': 4,
        'width': 'data(nodeSize)',
        'height': 'data(nodeSize)',
        'shape': 'round-rectangle',
        'text-wrap': 'wrap',
        'text-max-width': 200,
        'opacity': 0.7,
        'transition-property': 'opacity',
        'transition-duration': transitionDur,
      },
    },
    // Per-repo file node styles
    ...sourceLabels.map((label, i) => ({
      selector: `node[type="file"][sourceIndex = ${i}]`,
      style: { 'background-color': repoPalettes[label].file },
    })),
    // Class node styles
    {
      selector: 'node[type="class"]',
      style: {
        'label': 'data(name)',
        'font-size': 7,
        'min-zoomed-font-size': minZoomedFont,
        'font-family': 'SF Mono, Cascadia Code, Menlo, Consolas, monospace',
        'color': tc.nodeText,
        'text-valign': 'bottom',
        'text-margin-y': 4,
        'width': 'data(nodeSize)',
        'height': 'data(nodeSize)',
        'shape': 'round-rectangle',
        'text-wrap': 'wrap',
        'text-max-width': 200,
        'opacity': 0.85,
        'border-width': 1.5,
        'border-color': tc.classBorder,
        'transition-property': 'opacity',
        'transition-duration': transitionDur,
      },
    },
    // Per-repo class node styles
    ...sourceLabels.map((label, i) => ({
      selector: `node[type="class"][sourceIndex = ${i}]`,
      style: { 'background-color': repoPalettes[label].file },
    })),
    // Edge styles — fires
    {
      selector: 'edge[edgeType="fires"]',
      style: {
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.7,
        'width': 1,
        'curve-style': curveStyle,
        'line-style': 'solid',
        'transition-property': 'opacity, line-color, width',
        'transition-duration': edgeTransitionDur,
      },
    },
    // Edge styles — listens
    {
      selector: 'edge[edgeType="listens"]',
      style: {
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.7,
        'width': 1,
        'curve-style': curveStyle,
        'line-style': 'dashed',
        'transition-property': 'opacity, line-color, width',
        'transition-duration': edgeTransitionDur,
      },
    },
    // Per-repo fires edge color
    ...sourceLabels.map((label, i) => ({
      selector: `edge[edgeType="fires"][sourceIndex = ${i}]`,
      style: {
        'line-color': repoPalettes[label].fireEdgeAlpha,
        'target-arrow-color': repoPalettes[label].fireEdgeAlpha,
      },
    })),
    // Per-repo listens edge color
    ...sourceLabels.map((label, i) => ({
      selector: `edge[edgeType="listens"][sourceIndex = ${i}]`,
      style: {
        'line-color': repoPalettes[label].listenEdgeAlpha,
        'target-arrow-color': repoPalettes[label].listenEdgeAlpha,
      },
    })),
    // Highlighted state
    { selector: '.highlighted', style: { 'opacity': 1, 'z-index': 10 } },
    {
      selector: 'node.highlighted[type="hook"]',
      style: {
        'color': tc.highlightHookText,
        'font-size': 10,
        'text-background-color': tc.highlightTextBg,
        'text-background-opacity': 0.92,
        'text-background-padding': '4px',
        'text-background-shape': 'roundrectangle',
      },
    },
    {
      selector: 'node.highlighted[type="file"]',
      style: { 'color': tc.highlightFileText, 'font-size': 8 },
    },
    // Faded state
    { selector: '.faded', style: { 'opacity': 0.1 } },
    // Highlighted edge
    { selector: 'edge.highlighted-edge', style: { 'width': 2.5, 'opacity': 1, 'z-index': 10 } },
    // Per-repo highlighted fires edge
    ...sourceLabels.map((label, i) => ({
      selector: `edge.highlighted-edge[edgeType="fires"][sourceIndex = ${i}]`,
      style: {
        'line-color': repoPalettes[label].fireEdgeHighlight,
        'target-arrow-color': repoPalettes[label].fireEdgeHighlight,
      },
    })),
    // Per-repo highlighted listens edge
    ...sourceLabels.map((label, i) => ({
      selector: `edge.highlighted-edge[edgeType="listens"][sourceIndex = ${i}]`,
      style: {
        'line-color': repoPalettes[label].listenEdgeHighlight,
        'target-arrow-color': repoPalettes[label].listenEdgeHighlight,
      },
    })),
    // Selected node ring
    {
      selector: 'node.selected-node',
      style: {
        'border-width': 3,
        'border-color': tc.selectedBorder,
        'border-opacity': 0.9,
        'border-style': 'solid',
        'opacity': 1,
        'z-index': 20,
      },
    },
    // Hidden
    { selector: '.hidden', style: { 'display': 'none' } },
  ];
}

/**
 * Build a single edge data object.
 * Extracted from index.html _buildEdgeData().
 */
function buildEdgeData(edge, i, sourceId, sourceIndexMap) {
  return {
    data: {
      id: 'edge-' + i,
      source: sourceId,
      target: edge.target,
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
      sourceIndex: sourceIndexMap[sourceId] !== undefined ? sourceIndexMap[sourceId] : 0,
    },
  };
}

/**
 * Build Cytoscape elements from graph data.
 * Extracted from index.html buildElements() — supports both 'file' and 'class' modes.
 */
export function buildElements(data, sourceLabels, mode) {
  const nodes = [];
  const edges = [];

  // Build file source index lookup
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
        edges.push(buildEdgeData(edge, i, classId, sourceIndexMap));
      } else {
        fileEdgeCounts[edge.source] = (fileEdgeCounts[edge.source] || 0) + 1;
        edges.push(buildEdgeData(edge, i, edge.source, sourceIndexMap));
      }
    }

    // Add class nodes
    for (const cid in classNodes) {
      const cn = classNodes[cid];
      nodes.push({
        data: {
          id: cn.id,
          type: 'class',
          name: cn.name,
          source: cn.source,
          hook_count: cn.hook_count,
          files: Array.from(cn.files).sort(),
          nodeSize: Math.max(12, Math.min(50, 10 + Math.sqrt(cn.hook_count) * 5)),
          sourceIndex: sourceIndexMap[cn.id],
        },
      });
    }

    // Add file nodes only if they still have edges
    for (const node of data.nodes) {
      if (node.type === 'file' && fileEdgeCounts[node.id] > 0) {
        nodes.push({
          data: {
            id: node.id,
            ...node,
            nodeSize: Math.max(12, Math.min(50, 10 + Math.sqrt(node.hook_count) * 5)),
            sourceIndex: Math.max(0, sourceLabels.indexOf(node.source)),
          },
        });
      }
    }

    // Add hook nodes
    for (const node of data.nodes) {
      if (node.type === 'hook') {
        const totalConn = node.fire_count + node.listen_count;
        const baseSize = Math.max(15, Math.min(60, 10 + Math.sqrt(totalConn) * 5));
        nodes.push({
          data: {
            id: node.id,
            ...node,
            totalConn,
            nodeSize: node.overlap ? baseSize * 1.2 : baseSize,
            sourceIndex: node.sourceIndex !== undefined ? node.sourceIndex : -1,
            overlap: node.overlap || false,
          },
        });
      }
    }
  } else {
    // File mode — original behavior
    for (const node of data.nodes) {
      const el = { data: { id: node.id, ...node } };
      if (node.type === 'hook') {
        const totalConn = node.fire_count + node.listen_count;
        const baseSize = Math.max(15, Math.min(60, 10 + Math.sqrt(totalConn) * 5));
        el.data.totalConn = totalConn;
        el.data.nodeSize = node.overlap ? baseSize * 1.2 : baseSize;
        el.data.sourceIndex = node.sourceIndex !== undefined ? node.sourceIndex : -1;
        el.data.overlap = node.overlap || false;
      } else {
        el.data.nodeSize = Math.max(12, Math.min(50, 10 + Math.sqrt(node.hook_count) * 5));
        el.data.sourceIndex = Math.max(0, sourceLabels.indexOf(node.source));
      }
      nodes.push(el);
    }

    for (let i = 0; i < data.edges.length; i++) {
      edges.push(buildEdgeData(data.edges[i], i, data.edges[i].source, sourceIndexMap));
    }
  }

  return { nodes, edges };
}

/**
 * Build layout options for Cytoscape.
 * Extracted from index.html lines 1875-1881.
 */
export function buildLayoutOptions(isLargeGraph) {
  if (isLargeGraph) {
    return {
      name: 'cose',
      animate: true,
      animationDuration: 200,
      nodeRepulsion: () => 8000,
      idealEdgeLength: () => 80,
      numIter: 200,
      randomize: true,
    };
  }
  return {
    name: 'cose',
    animate: true,
    animationDuration: 500,
    nodeRepulsion: () => 8000,
    idealEdgeLength: () => 80,
  };
}
