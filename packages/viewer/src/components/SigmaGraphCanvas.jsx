import { useRef, useEffect, useState } from 'react';
import Sigma from 'sigma';
import { useGraphContext } from '../context/GraphContext';
import { buildSigmaGraph, buildCyAdapter } from '../lib/sigma-setup';
import { applyLayout, LAYOUT_OPTIONS } from '../lib/sigma-layouts';

function yieldToMain() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export default function SigmaGraphCanvas() {
  const containerRef = useRef(null);
  const sigmaRef = useRef(null);
  const graphRef = useRef(null);
  const {
    data,
    cyRef,
    sourceLabels,
    repoPalettes,
    isLargeGraph,
    filterResult,
    selectedNode,
    selectNode,
    clearSelection,
    searchQuery,
    groupBy,
    setIsComputing,
  } = useGraphContext();

  const [progress, setProgress] = useState(null);
  const [graphReady, setGraphReady] = useState(false);
  const [layoutMode, setLayoutMode] = useState('force-noverlap');
  const [spread, setSpread] = useState(2);

  // Highlight state — mutated by hover/selection/search and read by reducers.
  const highlightStateRef = useRef({
    hoveredNode: null,
    selectedNodeId: null,
    matchedNodes: null, // Set | null
    neighborhoods: null, // Set | null
  });

  // Snapshot of previously visible ids; mirrors GraphCanvas's diff approach.
  const prevVisibleRef = useRef(null);

  // --- Init effect ---
  useEffect(() => {
    if (!containerRef.current || !data) return;
    setGraphReady(false);
    setIsComputing(true);
    setProgress({
      label: 'Building graph…',
      detail: `${data.nodes.length} nodes · ${data.edges.length} edges`,
    });

    let destroyed = false;

    (async () => {
      await yieldToMain();
      if (destroyed) return;

      const graph = buildSigmaGraph(data, sourceLabels, repoPalettes, groupBy);
      graphRef.current = graph;

      setProgress({ label: 'Computing layout…', detail: isLargeGraph ? 'This may take a moment.' : '' });
      await yieldToMain();
      if (destroyed) return;

      applyLayout(graph, layoutMode, { isLargeGraph, spread });

      if (destroyed) return;

      const sigma = new Sigma(graph, containerRef.current, {
        renderEdgeLabels: false,
        defaultNodeColor: '#999',
        defaultEdgeColor: '#aaa',
        labelColor: { color: '#4a4258' },
        labelDensity: isLargeGraph ? 0.07 : 1,
        labelGridCellSize: isLargeGraph ? 200 : 60,
        labelRenderedSizeThreshold: isLargeGraph ? 8 : 4,
        enableEdgeEvents: false,
        minCameraRatio: 0.05,
        maxCameraRatio: 20,
        nodeReducer: (node, attrs) => {
          const h = highlightStateRef.current;
          const r = { ...attrs };
          if (attrs.hidden) {
            r.hidden = true;
            return r;
          }
          const hasHl = h.neighborhoods || h.matchedNodes;
          const inHl =
            (h.neighborhoods && h.neighborhoods.has(node)) ||
            (h.matchedNodes && h.matchedNodes.has(node));
          if (hasHl && !inHl) {
            r.color = FADE_COLOR;
            r.label = '';
          }
          if (h.selectedNodeId === node) {
            r.color = attrs.baseColor || attrs.color;
            r.size = (attrs.baseSize || attrs.size) * 1.4;
          }
          return r;
        },
        edgeReducer: (edge, attrs) => {
          const h = highlightStateRef.current;
          const r = { ...attrs };
          if (attrs.hidden) {
            r.hidden = true;
            return r;
          }
          if (h.neighborhoods) {
            const src = graph.source(edge);
            const tgt = graph.target(edge);
            if (h.neighborhoods.has(src) && h.neighborhoods.has(tgt)) {
              r.size = 2.5;
              r.color = attrs.baseColor || attrs.color;
            } else {
              r.color = FADE_COLOR;
            }
          }
          return r;
        },
      });

      sigmaRef.current = sigma;
      cyRef.current = buildCyAdapter(graph);
      // DEBUG: expose for browser console inspection during the spike.
      if (typeof window !== 'undefined') {
        window.__sigma = sigma;
        window.__graph = graph;
      }

      sigma.on('clickNode', ({ node }) => selectNode(node));
      sigma.on('clickStage', () => clearSelection());

      sigma.on('enterNode', ({ node }) => {
        const searchInput = document.getElementById('graph-search');
        if (searchInput && searchInput.value.trim().length > 0) return;
        const neighborhood = new Set([node, ...graph.neighbors(node)]);
        highlightStateRef.current = {
          ...highlightStateRef.current,
          hoveredNode: node,
          neighborhoods: neighborhood,
        };
        sigma.refresh();
      });
      sigma.on('leaveNode', () => {
        const searchInput = document.getElementById('graph-search');
        if (searchInput && searchInput.value.trim().length > 0) return;
        const sel = highlightStateRef.current.selectedNodeId;
        if (sel && graph.hasNode(sel)) {
          const neighborhood = new Set([sel, ...graph.neighbors(sel)]);
          highlightStateRef.current = {
            ...highlightStateRef.current,
            hoveredNode: null,
            neighborhoods: neighborhood,
          };
        } else {
          highlightStateRef.current = {
            ...highlightStateRef.current,
            hoveredNode: null,
            neighborhoods: null,
          };
        }
        sigma.refresh();
      });

      // Seed prev-visible with everything for the diff loop.
      const initialHookIds = new Set();
      const initialFileClassIds = new Set();
      const initialEdgeIds = new Set();
      graph.forEachNode((id, attrs) => {
        if (attrs.nodeType === 'hook') initialHookIds.add(id);
        else if (attrs.nodeType === 'file' || attrs.nodeType === 'class') initialFileClassIds.add(id);
      });
      graph.forEachEdge((id) => initialEdgeIds.add(id));
      prevVisibleRef.current = {
        hookIds: initialHookIds,
        edgeIds: initialEdgeIds,
        fileClassIds: initialFileClassIds,
      };

      setProgress(null);
      setGraphReady(true);
      setIsComputing(false);
    })();

    return () => {
      destroyed = true;
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
      graphRef.current = null;
      cyRef.current = null;
      prevVisibleRef.current = null;
      setIsComputing(false);
    };
  }, [data, sourceLabels, repoPalettes, isLargeGraph, groupBy]);

  // --- Layout change effect — re-run the picked layout on the existing
  //     graphology graph without rebuilding sigma. ---
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph || !graphReady) return;
    setIsComputing(true);
    // Defer to next frame so the spinner can paint before layout blocks.
    const id = requestAnimationFrame(() => {
      applyLayout(graph, layoutMode, { isLargeGraph, spread });
      sigma.refresh();
      sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
      setIsComputing(false);
    });
    return () => cancelAnimationFrame(id);
  }, [layoutMode, spread]);

  // --- Filter effect ---
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    const prev = prevVisibleRef.current;
    if (!sigma || !graph || !filterResult || !graphReady || !prev) return;

    const currEdgeIds = new Set();
    filterResult.visibleEdgeIndices.forEach((i) => currEdgeIds.add('edge-' + i));

    const currFileClassIds = new Set();
    currEdgeIds.forEach((eid) => {
      if (graph.hasEdge(eid)) currFileClassIds.add(graph.source(eid));
    });

    const currHookIds = filterResult.visibleHookIds;

    diffApplyNode(graph, prev.hookIds, currHookIds);
    diffApplyNode(graph, prev.fileClassIds, currFileClassIds);
    diffApplyEdge(graph, prev.edgeIds, currEdgeIds);

    prev.hookIds = currHookIds;
    prev.edgeIds = currEdgeIds;
    prev.fileClassIds = currFileClassIds;

    sigma.refresh();
  }, [filterResult, graphReady]);

  // --- Search highlight effect ---
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph || !graphReady) return;
    const query = searchQuery.toLowerCase().trim();
    if (!query) {
      // fall back to selected-node highlight (handled by selected-node effect)
      const sel = highlightStateRef.current.selectedNodeId;
      if (sel && graph.hasNode(sel)) {
        const nb = new Set([sel, ...graph.neighbors(sel)]);
        highlightStateRef.current = { ...highlightStateRef.current, matchedNodes: null, neighborhoods: nb };
      } else {
        highlightStateRef.current = { ...highlightStateRef.current, matchedNodes: null, neighborhoods: null };
      }
      sigma.refresh();
      return;
    }
    const matched = new Set();
    graph.forEachNode((id, attrs) => {
      if (attrs.hidden) return;
      const hay = (attrs.name || attrs.path || '').toLowerCase();
      if (hay.includes(query)) matched.add(id);
    });
    const nb = new Set();
    matched.forEach((id) => {
      nb.add(id);
      graph.forEachNeighbor(id, (n) => nb.add(n));
    });
    highlightStateRef.current = {
      ...highlightStateRef.current,
      matchedNodes: matched,
      neighborhoods: nb,
    };
    sigma.refresh();
  }, [searchQuery, graphReady]);

  // --- Selected-node effect ---
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph || !graphReady) return;

    if (!selectedNode || !graph.hasNode(selectedNode)) {
      highlightStateRef.current = { ...highlightStateRef.current, selectedNodeId: null };
      sigma.refresh();
      return;
    }
    const nb = new Set([selectedNode, ...graph.neighbors(selectedNode)]);
    highlightStateRef.current = {
      ...highlightStateRef.current,
      selectedNodeId: selectedNode,
      neighborhoods: nb,
    };
    sigma.refresh();

    // Sigma's camera coords are normalized across the framed graph bbox,
    // not graph-space. getNodeDisplayData returns the node's position in
    // exactly that camera coordinate system, so we can animate the camera
    // straight to it.
    const display = sigma.getNodeDisplayData(selectedNode);
    if (display) {
      sigma.getCamera().animate({ x: display.x, y: display.y }, { duration: 300 });
    }
  }, [selectedNode, graphReady]);

  return (
    <>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: 220,
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          fontSize: 11,
          fontFamily: 'var(--wpds-typography-font-family-mono, monospace)',
          background: 'rgba(255,255,255,0.92)',
          border: '1px solid #d0d0d0',
          borderRadius: 6,
          boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        }}
      >
        <select
          value={layoutMode}
          onChange={(e) => setLayoutMode(e.target.value)}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
          title="Layout / projection"
        >
          {LAYOUT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {(layoutMode === 'force' || layoutMode === 'force-noverlap') && (
          <>
            <span style={{ opacity: 0.6 }}>spread</span>
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.5}
              value={spread}
              onChange={(e) => setSpread(parseFloat(e.target.value))}
              style={{ width: 80 }}
              title="Spread multiplier"
            />
            <span style={{ opacity: 0.6, minWidth: 24 }}>{spread}×</span>
          </>
        )}
      </div>
      {progress && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 20,
            gap: 'var(--wpds-dimension-gap-lg)',
            background: 'var(--wpds-color-bg-surface-neutral-weak)',
          }}
        >
          <div className="hg-spinner" />
          <div
            style={{
              fontSize: 'var(--wpds-typography-font-size-lg)',
              fontWeight: 'var(--wpds-typography-font-weight-medium)',
            }}
          >
            {progress.label}
          </div>
          {progress.detail && (
            <div style={{ fontSize: 'var(--wpds-typography-font-size-sm)' }}>{progress.detail}</div>
          )}
        </div>
      )}
    </>
  );
}

// Apply hidden-attribute diff for node ids.
function diffApplyNode(graph, prevSet, currSet) {
  prevSet.forEach((id) => {
    if (!currSet.has(id) && graph.hasNode(id)) graph.setNodeAttribute(id, 'hidden', true);
  });
  currSet.forEach((id) => {
    if (!prevSet.has(id) && graph.hasNode(id)) graph.setNodeAttribute(id, 'hidden', false);
  });
}

function diffApplyEdge(graph, prevSet, currSet) {
  prevSet.forEach((id) => {
    if (!currSet.has(id) && graph.hasEdge(id)) graph.setEdgeAttribute(id, 'hidden', true);
  });
  currSet.forEach((id) => {
    if (!prevSet.has(id) && graph.hasEdge(id)) graph.setEdgeAttribute(id, 'hidden', false);
  });
}

// Sigma's default WebGL programs parse colors as #RRGGBB / #RRGGBBAA only —
// rgba() strings break the color buffer and cause the entire canvas to fail
// to render. Use a hex grey for the faded state.
const FADE_COLOR = '#dcdcdc';
