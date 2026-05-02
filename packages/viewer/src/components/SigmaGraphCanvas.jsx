import { useRef, useEffect, useState } from 'react';
import Sigma from 'sigma';
import { EdgeCurvedArrowProgram } from '@sigma/edge-curve';
import { NodeSquareProgram } from '@sigma/node-square';
import { useGraphContext } from '../context/GraphContext';
import { buildSigmaGraph, buildCyAdapter, computeNodeSize, computeDensityFactor } from '../lib/sigma-setup';
import { applyLayout } from '../lib/sigma-layouts';
import { SIGMA_SIZING_DEFAULTS } from '../lib/constants';
import SigmaSizingControls from './SigmaSizingControls';

// rAF callbacks fire BEFORE paint, so a single rAF doesn't let the browser
// commit the loader to screen before the next chunk of work runs. Double rAF
// resolves in the frame *after* paint, guaranteeing the spinner is visible
// before we kick off buildSigmaGraph/applyLayout.
function yieldToMain() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
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

  // Sizing controls — local to the canvas. The floating <SigmaSizingControls>
  // panel mutates this; the reducer reads via sizingRef on every frame so
  // changes apply without rebuilding the graph or layout.
  const [sizing, setSizing] = useState(SIGMA_SIZING_DEFAULTS);
  const sizingRef = useRef(sizing);
  sizingRef.current = sizing;

  // Density factor depends only on node count + the densityCompensation
  // toggle, so recompute when either changes (cheap; we still write through
  // a ref so the reducer can read it without a closure rebuild).
  const densityFactor = computeDensityFactor(
    data ? data.nodes.length : 0,
    sizing.densityCompensation
  );
  const densityRef = useRef(densityFactor);
  densityRef.current = densityFactor;

  const [progress, setProgress] = useState(null);
  const [graphReady, setGraphReady] = useState(false);

  // Tight spread — clusters render compact and close together so first-look
  // doesn't feel zoomed-out. Was previously a slider; now hardcoded.
  const spread = 0.3;

  // Highlight state — three independent slices so each interaction owns its
  // own neighborhood. Reducers union them; effects only touch their slice.
  // - matchedNodes: search matches (subset of searchNeighborhood; kept so the
  //   reducer can tell "search active" apart from "no search").
  // - searchNeighborhood: matches + their direct neighbors.
  // - selectedNeighborhood: selected node + its direct neighbors.
  // - hoveredNeighborhood: hovered node + its direct neighbors.
  const highlightStateRef = useRef({
    hoveredNode: null,
    selectedNodeId: null,
    matchedNodes: null,
    searchNeighborhood: null,
    selectedNeighborhood: null,
    hoveredNeighborhood: null,
  });

  // Snapshot of previously visible ids; mirrors GraphCanvas's diff approach.
  const prevVisibleRef = useRef(null);

  // Edges currently elevated to zIndex 1 because both endpoints are in the
  // active highlight neighborhood. Sigma sorts edges by graph-attribute
  // zIndex at index time (reducer zIndex is read but doesn't reorder), so we
  // mutate the graph itself and let refresh() re-index.
  const elevatedEdgesRef = useRef(new Set());

  // Latest camera ratio, kept in a ref so the node reducer can suppress
  // labels when zoomed out without forcing a React re-render on every pan.
  const cameraRatioRef = useRef(1);

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

      applyLayout(graph, 'communities', { isLargeGraph, spread });

      if (destroyed) return;

      const sigma = new Sigma(graph, containerRef.current, {
        renderEdgeLabels: true,
        defaultNodeColor: '#999',
        defaultEdgeColor: '#aaa',
        edgeLabelColor: { color: '#6b6378' },
        edgeLabelSize: 11,
        // Register edge-curve program alongside the stock 'arrow' so the
        // reducer can opt edges into curved rendering. Curvature direction is
        // read from each edge's `curvature` attribute (set in sigma-setup).
        edgeProgramClasses: {
          curvedArrow: EdgeCurvedArrowProgram,
        },
        nodeProgramClasses: {
          square: NodeSquareProgram,
        },
        labelColor: { color: '#4a4258' },
        labelDensity: isLargeGraph ? 0.07 : 1,
        labelGridCellSize: isLargeGraph ? 200 : 60,
        labelRenderedSizeThreshold: isLargeGraph ? 8 : 4,
        enableEdgeEvents: false,
        minCameraRatio: 0.05,
        maxCameraRatio: 20,
        // Stock sigma defaults are 1.7x per wheel tick / 2.2x per double-click,
        // which overshoots constantly on a trackpad and trips the >10% reveal-
        // on-zoom refresh on every notch. Finer steps + shorter animations
        // feel snappier and refresh less often (the throttle is relative).
        zoomingRatio: 1.4,
        mouseZoomDuration: 80,
        doubleClickZoomingRatio: 1.7,
        doubleClickZoomingDuration: 80,
        // Required for per-element `zIndex` from the reducers to take effect —
        // without it sigma renders in insertion order.
        zIndex: true,
        nodeReducer: (node, attrs) => {
          const h = highlightStateRef.current;
          const r = { ...attrs };
          // Live size: recomputed every frame from raw signals on the node so
          // the user-tunable sizing controls + camera-driven reveal-on-zoom
          // boost apply without rebuilding the graph.
          r.size = computeNodeSize(
            attrs,
            sizingRef.current,
            cameraRatioRef.current,
            densityRef.current
          );
          if (attrs.hidden) {
            r.hidden = true;
            return r;
          }
          const isZoomedOut = cameraRatioRef.current > ZOOMED_OUT_LABEL_CUTOFF;
          const inSearch = h.searchNeighborhood && h.searchNeighborhood.has(node);
          const inSelected = h.selectedNeighborhood && h.selectedNeighborhood.has(node);
          const inHovered = h.hoveredNeighborhood && h.hoveredNeighborhood.has(node);
          const anyActive =
            h.searchNeighborhood || h.selectedNeighborhood || h.hoveredNeighborhood;
          const inAny = inSearch || inSelected || inHovered;
          if (anyActive && !inAny) {
            r.color = FADE_COLOR;
            r.label = '';
            r.zIndex = 0;
          } else if (inAny) {
            // Selection and hover always force labels — user has explicitly
            // pointed at this neighborhood. Search-only nodes follow the
            // zoom-based cutoff so a wide match set doesn't blanket the
            // canvas with labels at low zoom.
            if (inSelected || inHovered) {
              r.forceLabel = true;
            } else if (isZoomedOut) {
              r.label = '';
            }
            r.zIndex = 1;
          } else if (isZoomedOut) {
            r.label = '';
          }
          if (h.selectedNodeId === node) {
            r.color = attrs.baseColor || attrs.color;
            r.size = r.size * 1.4;
            r.forceLabel = true;
            r.zIndex = 2;
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
          // Default per-direction program — overridden below if this edge is
          // inside an active highlight.
          r.type =
            attrs.edgeType === 'fires'
              ? sizingRef.current.fireEdgeType
              : sizingRef.current.listenEdgeType;
          // Labels are stored on the edge ("fires" / "listens") but only
          // surfaced when the edge is inside an active highlight; at idle
          // we'd flood the canvas otherwise.
          r.label = '';
          const anyActive =
            h.searchNeighborhood || h.selectedNeighborhood || h.hoveredNeighborhood;
          if (anyActive) {
            const src = graph.source(edge);
            const tgt = graph.target(edge);
            const inSearch =
              h.searchNeighborhood && h.searchNeighborhood.has(src) && h.searchNeighborhood.has(tgt);
            const inSelected =
              h.selectedNeighborhood &&
              h.selectedNeighborhood.has(src) &&
              h.selectedNeighborhood.has(tgt);
            const inHovered =
              h.hoveredNeighborhood &&
              h.hoveredNeighborhood.has(src) &&
              h.hoveredNeighborhood.has(tgt);
            if (inSearch || inSelected || inHovered) {
              r.size = sizingRef.current.focusedEdgeSize;
              r.type =
                attrs.edgeType === 'fires'
                  ? sizingRef.current.focusedFireEdgeType
                  : sizingRef.current.focusedListenEdgeType;
              r.color = attrs.baseColor || attrs.color;
              // Edge labels are noisy on broad search matches, so only
              // surface them on explicit pointer interactions (selection
              // or hover). Search keeps the highlight visuals unlabeled.
              if (inSelected || inHovered) {
                r.label = attrs.baseLabel || '';
                r.forceLabel = true;
              }
              r.zIndex = h.selectedNodeId === src || h.selectedNodeId === tgt ? 2 : 1;
            } else {
              r.color = FADE_COLOR;
              r.zIndex = 0;
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

      // Track camera zoom: `camera.updated` fires every pan/zoom frame. We
      // refresh on the label-cutoff crossing (binary state) and additionally
      // throttle a refresh while zoomed in past the reveal-on-zoom threshold
      // so node sizes recompute as the user zooms — sigma re-runs the
      // reducer on each refresh, which is what feeds the new size in.
      const camera = sigma.getCamera();
      cameraRatioRef.current = camera.ratio;
      let wasZoomedOut = camera.ratio > ZOOMED_OUT_LABEL_CUTOFF;
      let lastZoomRefresh = camera.ratio;
      camera.on('updated', (state) => {
        cameraRatioRef.current = state.ratio;
        const isZoomedOut = state.ratio > ZOOMED_OUT_LABEL_CUTOFF;
        if (isZoomedOut !== wasZoomedOut) {
          wasZoomedOut = isZoomedOut;
          sigma.refresh();
          lastZoomRefresh = state.ratio;
          return;
        }
        // While reveal-on-zoom is in play (ratio < 1), refresh whenever the
        // ratio changes by more than ~10% so the size curve tracks zoom
        // without burning a render on every micro-pan.
        if (state.ratio < 1 && Math.abs(state.ratio - lastZoomRefresh) / lastZoomRefresh > 0.1) {
          sigma.refresh();
          lastZoomRefresh = state.ratio;
        }
      });

      sigma.on('enterNode', ({ node }) => {
        const neighborhood = new Set([node, ...graph.neighbors(node)]);
        highlightStateRef.current = {
          ...highlightStateRef.current,
          hoveredNode: node,
          hoveredNeighborhood: neighborhood,
        };
        refreshElevation(graph, highlightStateRef.current, elevatedEdgesRef);
        sigma.refresh();
      });
      sigma.on('leaveNode', () => {
        highlightStateRef.current = {
          ...highlightStateRef.current,
          hoveredNode: null,
          hoveredNeighborhood: null,
        };
        refreshElevation(graph, highlightStateRef.current, elevatedEdgesRef);
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
      elevatedEdgesRef.current = new Set();
      setIsComputing(false);
    };
  }, [data, sourceLabels, repoPalettes, isLargeGraph, groupBy]);

  // --- Sizing effect ---
  // Sliders/toggles in the Sidebar mutate `sizing` in context; the reducer
  // already reads via sizingRef on every frame, so we just need to nudge
  // sigma to re-render once per change.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma || !graphReady) return;
    sigma.refresh();
  }, [sizing, densityFactor, graphReady]);

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
      highlightStateRef.current = {
        ...highlightStateRef.current,
        matchedNodes: null,
        searchNeighborhood: null,
      };
      refreshElevation(graph, highlightStateRef.current, elevatedEdgesRef);
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
      searchNeighborhood: nb,
    };
    refreshElevation(graph, highlightStateRef.current, elevatedEdgesRef);
    sigma.refresh();
  }, [searchQuery, graphReady]);

  // --- Selected-node effect ---
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph || !graphReady) return;

    if (!selectedNode || !graph.hasNode(selectedNode)) {
      highlightStateRef.current = {
        ...highlightStateRef.current,
        selectedNodeId: null,
        selectedNeighborhood: null,
      };
      refreshElevation(graph, highlightStateRef.current, elevatedEdgesRef);
      sigma.refresh();
      return;
    }
    const nb = new Set([selectedNode, ...graph.neighbors(selectedNode)]);
    highlightStateRef.current = {
      ...highlightStateRef.current,
      selectedNodeId: selectedNode,
      selectedNeighborhood: nb,
    };
    refreshElevation(graph, highlightStateRef.current, elevatedEdgesRef);
    sigma.refresh();

    // Sigma's camera coords are normalized across the framed graph bbox,
    // not graph-space. getNodeDisplayData returns the node's position in
    // exactly that camera coordinate system, so we can animate the camera
    // straight to it.
    const display = sigma.getNodeDisplayData(selectedNode);
    if (display) {
      const camera = sigma.getCamera();
      // Smaller ratio = more zoomed in. Only zoom in (Math.min) so users who
      // are already deeper than the focus target keep their zoom.
      const ratio = Math.min(camera.ratio, 0.4);
      camera.animate({ x: display.x, y: display.y, ratio }, { duration: 350 });
    }
  }, [selectedNode, graphReady]);

  return (
    <>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {graphReady && <SigmaSizingControls sizing={sizing} onChange={setSizing} />}
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

// Lift edges in any active highlight neighborhood above the rest by writing
// `zIndex: 1` directly on the graphology edge (sigma reads zIndex at index
// time, not from the reducer). Walks each neighborhood independently — an
// edge counts as elevated if both endpoints are in the same neighborhood.
function refreshElevation(graph, state, elevatedRef) {
  const next = new Set();
  collectInternalEdges(graph, state.searchNeighborhood, next);
  collectInternalEdges(graph, state.selectedNeighborhood, next);
  collectInternalEdges(graph, state.hoveredNeighborhood, next);
  const prev = elevatedRef.current;
  prev.forEach((eid) => {
    if (!next.has(eid) && graph.hasEdge(eid)) graph.setEdgeAttribute(eid, 'zIndex', 0);
  });
  next.forEach((eid) => {
    if (!prev.has(eid) && graph.hasEdge(eid)) graph.setEdgeAttribute(eid, 'zIndex', 1);
  });
  elevatedRef.current = next;
}

function collectInternalEdges(graph, neighborhood, out) {
  if (!neighborhood) return;
  neighborhood.forEach((nodeId) => {
    if (!graph.hasNode(nodeId)) return;
    graph.forEachEdge(nodeId, (eid, _attrs, src, tgt) => {
      if (neighborhood.has(src) && neighborhood.has(tgt)) out.add(eid);
    });
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

// Camera ratio above which all non-highlighted labels are suppressed. Sigma
// frames the graph at ratio ≈ 1.0; anything past 1.5 means the user has
// pulled the camera back beyond the natural fit, where label noise stops
// being readable anyway.
const ZOOMED_OUT_LABEL_CUTOFF = 1.5;
