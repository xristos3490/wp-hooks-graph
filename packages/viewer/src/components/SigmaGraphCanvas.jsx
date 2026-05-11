import { useRef, useEffect, useState } from 'react';
import Sigma from 'sigma';
import {
  sdfCircle,
  sdfSquare,
  pathCurved,
  extremityArrow,
} from 'sigma/rendering';
import { useGraphContext } from '../context/GraphContext';
import { useSizing } from '../context/SizingContext';
import {
  buildSigmaGraph,
  buildCyAdapter,
  computeNodeSize,
  computeDensityFactor,
  recolorGraph,
} from '../lib/sigma-setup';
import { applyLayout } from '../lib/sigma-layouts';
import { SIGMA_SIZE_PCT } from '../lib/constants';
import SigmaSizingControls from './SigmaSizingControls';

// rAF callbacks fire BEFORE paint, so a single rAF doesn't let the browser
// commit the loader to screen before the next chunk of work runs. Double rAF
// resolves in the frame *after* paint, guaranteeing the spinner is visible
// before we kick off buildSigmaGraph/applyLayout.
function yieldToMain() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

export default function SigmaGraphCanvas() {
  const containerRef = useRef(null);
  const sigmaRef = useRef(null);
  const graphRef = useRef(null);
  const {
    data,
    cyRef,
    sigmaRef: sharedSigmaRef,
    sourceLabels,
    repoPalettes,
    setPaletteHueOverrides,
    isLargeGraph,
    filterResult,
    selectedNode,
    selectNode,
    clearSelection,
    searchQuery,
    groupBy,
    setIsComputing,
  } = useGraphContext();

  // Sizing/theme state lives in SizingContext so the floating panel here and
  // future sidebar widgets share one source of truth. The reducer still reads
  // via a local sigmaRef on every frame so changes apply without rebuilding
  // sigma — that mirror is a tearing-free read concern, not state ownership.
  const { sizing, setSizing } = useSizing();
  const sizingRef = useRef(sizing);
  sizingRef.current = sizing;

  // Latest palette/source-labels mirrored into refs so the init effect can
  // read them without listing them as deps — a hue tweak alone must not tear
  // down sigma + relayout. The recolor effect below handles palette updates
  // post-init by mutating the existing graphology graph in place.
  const repoPalettesRef = useRef(repoPalettes);
  repoPalettesRef.current = repoPalettes;
  const sourceLabelsRef = useRef(sourceLabels);
  sourceLabelsRef.current = sourceLabels;

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

  // Sets of node/edge ids that currently have non-default state in sigma.
  // Used to clear stale state when neighborhoods shrink.
  const statedNodesRef = useRef({ nodes: new Set(), edges: new Set() });

  // Latest camera ratio, kept in a ref so the node reducer can suppress
  // labels when zoomed out without forcing a React re-render on every pan.
  const cameraRatioRef = useRef(1);

  // Live vmin of the rendering container, in screen pixels. Used by the
  // node + edge reducers to convert SIGMA_SIZE_PCT values to pixels each
  // frame. Updated on init and on every ResizeObserver tick. The Viewport %
  // slider applies as a multiplier when read; we keep the raw vmin here.
  const vminRef = useRef(0);
  const resizeObserverRef = useRef(null);
  // Closure that pushes a fresh labelRenderedSizeThreshold to sigma using
  // the current vmin + viewport scale. Defined inside the init effect; the
  // sizing effect calls it whenever viewportScale (or the threshold itself)
  // changes.
  const labelThresholdRef = useRef(null);

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

      const graph = buildSigmaGraph(
        data,
        sourceLabelsRef.current,
        repoPalettesRef.current,
        groupBy
      );
      graphRef.current = graph;

      setProgress({
        label: 'Computing layout…',
        detail: isLargeGraph ? 'This may take a moment.' : '',
      });
      await yieldToMain();
      if (destroyed) return;

      applyLayout(graph, 'communities', { isLargeGraph, spread });

      if (destroyed) return;

      // Seed vmin from the container before sigma reads it. The
      // ResizeObserver below keeps it current.
      const initRect = containerRef.current.getBoundingClientRect();
      vminRef.current = Math.min(initRect.width, initRect.height) || 1000;

      const sigma = new Sigma(graph, containerRef.current, {
        renderEdgeLabels: true,
        defaultNodeColor: '#999',
        defaultEdgeColor: '#aaa',
        edgeLabelColor: { color: '#6b6378' },
        edgeLabelSize: 11,
        labelColor: { color: '#4a4258' },
        labelDensity: isLargeGraph ? 0.07 : 1,
        labelGridCellSize: isLargeGraph ? 200 : 60,
        labelRenderedSizeThreshold:
          ((isLargeGraph ? SIGMA_SIZE_PCT.labelThresholdLarge : SIGMA_SIZE_PCT.labelThreshold) /
            100) *
          (vminRef.current || 1000),
        enableEdgeEvents: false,
        minCameraRatio: 0.05,
        maxCameraRatio: 20,
        zoomingRatio: 1.4,
        mouseZoomDuration: 80,
        doubleClickZoomingRatio: 1.7,
        doubleClickZoomingDuration: 80,

        primitives: {
          // Named depth layers replace v3 numeric zIndex. Order = back-to-front.
          depthLayers: ['edges', 'nodes', 'focusedEdges', 'focusedNodes', 'topNodes'],
          nodes: {
            shapes: [sdfCircle(), sdfSquare()],
          },
          edges: {
            paths: [pathCurved()],
            extremities: [extremityArrow()],
          },
        },

        styles: {
          nodes: [
            {
              shape: (attrs) => (attrs.nodeType === 'hook' ? 'circle' : 'square'),
              color: { attribute: 'color' },
              depth: 'nodes',
            },
            {
              when: (attrs) => attrs.hidden === true,
              then: { visibility: 'hidden' },
            },
            {
              whenState: 'isFaded',
              then: {
                color: () => fadeBgColor(sizingRef.current.canvasBg),
                labelVisibility: 'hidden',
              },
            },
            {
              whenState: 'isFocused',
              then: { depth: 'focusedNodes' },
            },
            {
              whenState: 'forceLabel',
              then: { labelVisibility: 'visible' },
            },
            {
              whenState: 'isSelected',
              then: {
                color: { attribute: 'baseColor' },
                labelVisibility: 'visible',
                depth: 'topNodes',
              },
            },
          ],
          edges: [
            {
              path: 'curved',
              head: 'arrow',
              color: (attrs) =>
                fadeColor(attrs.color, sizingRef.current.edgeOpacity, sizingRef.current.canvasBg),
              depth: 'edges',
              labelVisibility: 'hidden',
            },
            {
              when: (attrs) => attrs.hidden === true,
              then: { visibility: 'hidden' },
            },
            {
              whenState: 'isFaded',
              then: { color: () => fadeBgColor(sizingRef.current.canvasBg) },
            },
            {
              whenState: 'isFocusedEdge',
              then: {
                color: (attrs) =>
                  fadeColor(
                    attrs.baseColor || attrs.color,
                    sizingRef.current.edgeOpacity,
                    sizingRef.current.canvasBg
                  ),
                depth: 'focusedEdges',
                labelVisibility: 'visible',
              },
            },
            {
              whenState: 'touchesSelected',
              then: {
                color: { attribute: 'baseColor' },
                depth: 'focusedEdges',
              },
            },
          ],
        },

        // v4 keeps reducers as an escape hatch. We still need per-frame size
        // (camera ratio + viewport scale + density) and zoom-driven label
        // suppression. The reducer returns *only* the dynamic bits; everything
        // else flows through styles + state above.
        nodeReducer: (node, attrs) => {
          const effectiveVmin = vminRef.current * (sizingRef.current.viewportScale / 100);
          const size = computeNodeSize(
            attrs,
            sizingRef.current,
            cameraRatioRef.current,
            densityRef.current,
            effectiveVmin
          );
          const isZoomedOut = cameraRatioRef.current > ZOOMED_OUT_LABEL_CUTOFF;
          return {
            size,
            ...(highlightStateRef.current.selectedNodeId === node ? { size: size * 1.4 } : null),
            ...(isZoomedOut ? { labelVisibility: 'hidden' } : null),
          };
        },
        edgeReducer: (edge, attrs) => {
          const edgeVmin = vminRef.current * (sizingRef.current.viewportScale / 100);
          const h = highlightStateRef.current;
          const anyActive = h.searchNeighborhood || h.selectedNeighborhood || h.hoveredNeighborhood;
          const baseSize = (SIGMA_SIZE_PCT.edgeSize / 100) * (edgeVmin || 1000);
          if (!anyActive) return { size: baseSize };
          const src = graph.source(edge);
          const tgt = graph.target(edge);
          const inFocus =
            (h.searchNeighborhood && h.searchNeighborhood.has(src) && h.searchNeighborhood.has(tgt)) ||
            (h.selectedNeighborhood && h.selectedNeighborhood.has(src) && h.selectedNeighborhood.has(tgt)) ||
            (h.hoveredNeighborhood && h.hoveredNeighborhood.has(src) && h.hoveredNeighborhood.has(tgt));
          if (inFocus) return { size: (FOCUSED_EDGE_SIZE_PCT / 100) * (edgeVmin || 1000) };
          return { size: baseSize };
        },
      });

      sigmaRef.current = sigma;
      if (sharedSigmaRef) sharedSigmaRef.current = sigma;
      cyRef.current = buildCyAdapter(graph);
      // DEBUG: expose for browser console inspection during the spike.
      if (typeof window !== 'undefined') {
        window.__sigma = sigma;
        window.__graph = graph;
      }

      // Track container vmin so the responsive sizing pipeline updates when
      // the user resizes the window (or the layout shifts the canvas). We
      // push a fresh labelRenderedSizeThreshold via setSetting on every tick
      // — sigma reads it each frame, so this is enough.
      const updateLabelThreshold = () => {
        const effectiveVmin = vminRef.current * (sizingRef.current.viewportScale / 100);
        const pct = isLargeGraph
          ? SIGMA_SIZE_PCT.labelThresholdLarge
          : SIGMA_SIZE_PCT.labelThreshold;
        sigma.setSetting('labelRenderedSizeThreshold', (pct / 100) * (effectiveVmin || 1000));
      };
      labelThresholdRef.current = updateLabelThreshold;
      updateLabelThreshold();
      const ro = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (!rect) return;
        vminRef.current = Math.min(rect.width, rect.height) || vminRef.current;
        updateLabelThreshold();
        sigma.refresh();
      });
      ro.observe(containerRef.current);
      resizeObserverRef.current = ro;

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
        applyHighlightState(sigma, graph, highlightStateRef.current, statedNodesRef);
        sigma.refresh();
      });
      sigma.on('leaveNode', () => {
        highlightStateRef.current = {
          ...highlightStateRef.current,
          hoveredNode: null,
          hoveredNeighborhood: null,
        };
        applyHighlightState(sigma, graph, highlightStateRef.current, statedNodesRef);
        sigma.refresh();
      });

      // Seed prev-visible with everything for the diff loop.
      const initialHookIds = new Set();
      const initialFileClassIds = new Set();
      const initialEdgeIds = new Set();
      graph.forEachNode((id, attrs) => {
        if (attrs.nodeType === 'hook') initialHookIds.add(id);
        else if (attrs.nodeType === 'file' || attrs.nodeType === 'class')
          initialFileClassIds.add(id);
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
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      labelThresholdRef.current = null;
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
      if (sharedSigmaRef) sharedSigmaRef.current = null;
      graphRef.current = null;
      cyRef.current = null;
      prevVisibleRef.current = null;
      statedNodesRef.current = { nodes: new Set(), edges: new Set() };
      setIsComputing(false);
    };
  }, [data, sourceLabels, isLargeGraph, groupBy]);

  // --- Sizing effect ---
  // Sliders/toggles in the Sidebar mutate `sizing` in context; the reducer
  // already reads via sizingRef on every frame, so we just need to nudge
  // sigma to re-render once per change. The label threshold lives in a
  // sigma setting (not a reducer attribute), so push it through here too —
  // viewportScale changes the effective vmin and therefore the threshold.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma || !graphReady) return;
    if (labelThresholdRef.current) labelThresholdRef.current();
    sigma.refresh();
  }, [sizing, densityFactor, graphReady]);

  // --- Recolor effect ---
  // Hue tweaks from the picker change `repoPalettes` identity but don't
  // affect topology or layout. Mutate node/edge color attributes in place
  // and refresh, instead of rebuilding the graph + rerunning Louvain/FA2.
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph || !graphReady) return;
    recolorGraph(graph, repoPalettes, sourceLabels);
    sigma.refresh();
  }, [repoPalettes, sourceLabels, graphReady]);

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

    applyHighlightState(sigma, graph, highlightStateRef.current, statedNodesRef);
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
      applyHighlightState(sigma, graph, highlightStateRef.current, statedNodesRef);
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
    applyHighlightState(sigma, graph, highlightStateRef.current, statedNodesRef);
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
      applyHighlightState(sigma, graph, highlightStateRef.current, statedNodesRef);
      sigma.refresh();
      return;
    }
    const nb = new Set([selectedNode, ...graph.neighbors(selectedNode)]);
    highlightStateRef.current = {
      ...highlightStateRef.current,
      selectedNodeId: selectedNode,
      selectedNeighborhood: nb,
    };
    applyHighlightState(sigma, graph, highlightStateRef.current, statedNodesRef);
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
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', background: sizing.canvasBg }}
      />
      {graphReady && (
        <SigmaSizingControls
          sizing={sizing}
          onChange={setSizing}
          sourceLabels={sourceLabels}
          repoPalettes={repoPalettes}
          setPaletteHueOverrides={setPaletteHueOverrides}
        />
      )}
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

// Push the current highlight neighborhoods into sigma's v4 state system.
// `setNodeState` merges into the existing state — passing `null` is a no-op,
// so each call must send explicit `false` for every known flag to clear
// stale ones. NODE_CLEARED / EDGE_CLEARED define the canonical flag sets.
const NODE_CLEARED = { isFaded: false, isFocused: false, forceLabel: false, isSelected: false };
const EDGE_CLEARED = { isFaded: false, isFocusedEdge: false, touchesSelected: false };

function applyHighlightState(sigma, graph, h, statedRef) {
  const anyActive = !!(h.searchNeighborhood || h.selectedNeighborhood || h.hoveredNeighborhood);
  sigma.setGraphState({ hasActiveSubgraph: anyActive });

  const nextNodes = new Set();
  const setNode = (id, flags) => {
    if (!graph.hasNode(id)) return;
    sigma.setNodeState(id, { ...NODE_CLEARED, ...flags });
    nextNodes.add(id);
  };

  if (anyActive) {
    graph.forEachNode((id, attrs) => {
      if (attrs.hidden) return;
      const inSearch = h.searchNeighborhood && h.searchNeighborhood.has(id);
      const inSelected = h.selectedNeighborhood && h.selectedNeighborhood.has(id);
      const inHovered = h.hoveredNeighborhood && h.hoveredNeighborhood.has(id);
      const inAny = inSearch || inSelected || inHovered;
      if (!inAny) {
        setNode(id, { isFaded: true });
      } else {
        const forceLabel = inSelected || inHovered;
        setNode(id, { isFocused: true, forceLabel });
      }
    });
  }

  if (h.selectedNodeId) {
    setNode(h.selectedNodeId, { isSelected: true, isFocused: true, forceLabel: true });
  }

  const nextEdges = new Set();
  const setEdge = (id, flags) => {
    sigma.setEdgeState(id, { ...EDGE_CLEARED, ...flags });
    nextEdges.add(id);
  };
  if (anyActive) {
    graph.forEachEdge((id, _attrs, src, tgt) => {
      const inFocus =
        (h.searchNeighborhood && h.searchNeighborhood.has(src) && h.searchNeighborhood.has(tgt)) ||
        (h.selectedNeighborhood && h.selectedNeighborhood.has(src) && h.selectedNeighborhood.has(tgt)) ||
        (h.hoveredNeighborhood && h.hoveredNeighborhood.has(src) && h.hoveredNeighborhood.has(tgt));
      if (inFocus) {
        const touchesSel = h.selectedNodeId && (h.selectedNodeId === src || h.selectedNodeId === tgt);
        setEdge(id, { isFocusedEdge: true, touchesSelected: !!touchesSel });
      } else {
        setEdge(id, { isFaded: true });
      }
    });
  }

  statedRef.current.nodes.forEach((id) => {
    if (!nextNodes.has(id) && graph.hasNode(id)) sigma.setNodeState(id, NODE_CLEARED);
  });
  statedRef.current.edges.forEach((id) => {
    if (!nextEdges.has(id) && graph.hasEdge(id)) sigma.setEdgeState(id, EDGE_CLEARED);
  });
  statedRef.current = { nodes: nextNodes, edges: nextEdges };
}

function diffApplyEdge(graph, prevSet, currSet) {
  prevSet.forEach((id) => {
    if (!currSet.has(id) && graph.hasEdge(id)) graph.setEdgeAttribute(id, 'hidden', true);
  });
  currSet.forEach((id) => {
    if (!prevSet.has(id) && graph.hasEdge(id)) graph.setEdgeAttribute(id, 'hidden', false);
  });
}

// Fallback fade target if the canvas bg can't be parsed (non-hex, e.g. user
// pastes an `rgb(...)` into a future input). Sigma's default WebGL programs
// parse colors as #RRGGBB / #RRGGBBAA only — rgba() strings break the color
// buffer and cause the entire canvas to fail to render.
const FALLBACK_FADE = '#dcdcdc';
const FALLBACK_FADE_RGB = [0xdc, 0xdc, 0xdc];

function parseHexRgb(hex) {
  if (typeof hex !== 'string' || hex.length !== 7 || hex[0] !== '#') return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

// Mix a #RRGGBB hex color toward the canvas bg by (1 - opacity/100) and
// return a fully opaque hex. We pre-mix in JS instead of relying on WebGL
// alpha blending against the canvas bg so the perceived hue stays stable as
// the slider drops — alpha blending in sRGB against a non-neutral surface
// otherwise pulls warm hues off-axis. Bails on any non-7-char-hex input so
// we never silently zero the color buffer.
function fadeColor(color, opacity, bgHex) {
  if (opacity >= 100) return color;
  if (typeof color !== 'string' || color.length !== 7 || color[0] !== '#') return color;
  const fadeRgb = parseHexRgb(bgHex) || FALLBACK_FADE_RGB;
  const t = Math.max(0, Math.min(1, opacity / 100));
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const mix = (c, f) => Math.round(t * c + (1 - t) * f);
  const hex = (n) => n.toString(16).padStart(2, '0');
  return '#' + hex(mix(r, fadeRgb[0])) + hex(mix(g, fadeRgb[1])) + hex(mix(b, fadeRgb[2]));
}

// De-emphasis color for nodes/edges outside an active highlight. We pull
// slightly off the canvas bg toward neutral grey so faded items don't
// disappear entirely on a pure-white or pure-black canvas. Falls back to
// the legacy grey if the bg isn't parseable.
function fadeBgColor(bgHex) {
  const rgb = parseHexRgb(bgHex);
  if (!rgb) return FALLBACK_FADE;
  const mix = (c) => Math.round(0.6 * c + 0.4 * 0x88);
  const hex = (n) => n.toString(16).padStart(2, '0');
  return '#' + hex(mix(rgb[0])) + hex(mix(rgb[1])) + hex(mix(rgb[2]));
}

// Focused-edge size, in % of vmin. Applied to edges inside an active
// highlight neighborhood (search/selection/hover).
const FOCUSED_EDGE_SIZE_PCT = 0.25;

// Camera ratio above which all non-highlighted labels are suppressed. Sigma
// frames the graph at ratio ≈ 1.0; anything past 1.5 means the user has
// pulled the camera back beyond the natural fit, where label noise stops
// being readable anyway.
const ZOOMED_OUT_LABEL_CUTOFF = 1.5;
