import { useRef, useEffect, useState, useCallback } from 'react';
import cytoscape from 'cytoscape';
import { useGraphContext } from '../context/GraphContext';
import { buildCytoscapeStyles, buildElements, buildLayoutOptions } from '../lib/cytoscape-setup';
import { BATCH_SIZE } from '../lib/constants';

function yieldToMain() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export default function GraphCanvas() {
  const containerRef = useRef(null);
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
    hookDataCache,
    setIsComputing,
  } = useGraphContext();

  const [progress, setProgress] = useState(null);
  const [graphReady, setGraphReady] = useState(false);
  const hoverTimerRef = useRef(null);
  const hookDataCacheRef = useRef(hookDataCache);
  hookDataCacheRef.current = hookDataCache;

  // Indices built once per Cytoscape instance; rebuilt when the init effect
  // tears down and re-mounts (e.g. on groupBy change). Used by applyFilters
  // to jump directly from an id to an element, skipping selector scans.
  const indexesRef = useRef(null);
  // Snapshot of visible ids from the previous applyFilters run. Diffed against
  // the current filterResult so each toggle touches only changed elements.
  const prevVisibleRef = useRef(null);

  // --- Initialize Cytoscape ---
  useEffect(() => {
    if (!containerRef.current || !data) return;

    setGraphReady(false);
    setIsComputing(true);
    const styles = buildCytoscapeStyles(sourceLabels, repoPalettes, isLargeGraph);
    const built = buildElements(data, sourceLabels, groupBy);
    const elements = [...built.nodes, ...built.edges];

    setProgress({
      label: 'Building graph\u2026',
      detail: `${data.nodes.length} nodes \u00b7 ${data.edges.length} edges`,
    });

    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      textureOnViewport: isLargeGraph,
      hideEdgesOnViewport: isLargeGraph,
      hideLabelsOnViewport: isLargeGraph,
      style: styles,
      layout: { name: 'preset' },
      minZoom: 0.05,
      maxZoom: 5,
      wheelSensitivity: 0.3,
    });

    cyRef.current = cy;
    let destroyed = false;

    // Batch-add elements
    (async () => {
      // Yield once so the initial overlay paints before heavy work begins.
      await yieldToMain();
      if (destroyed) return;

      const total = elements.length;
      for (let i = 0; i < total; i += BATCH_SIZE) {
        if (destroyed) return;
        const batch = elements.slice(i, Math.min(i + BATCH_SIZE, total));
        cy.add(batch);
        const done = Math.min(i + BATCH_SIZE, total);
        setProgress({
          label: 'Building graph\u2026',
          detail: `${Math.round((done / total) * 100)}% \u00b7 ${done.toLocaleString()} of ${total.toLocaleString()} elements`,
        });
        await yieldToMain();
      }

      if (destroyed) return;

      setProgress({
        label: 'Computing layout\u2026',
        detail: isLargeGraph ? 'This may take a moment.' : '',
      });
      await yieldToMain();

      if (destroyed) return;

      // Build id -> element indices once. Used by applyFilters for O(1) lookup
      // per changed id instead of re-scanning cy.nodes()/cy.edges() per apply.
      const nodeIndex = new Map();
      const edgeIndex = new Map();
      const edgeSource = new Map();
      cy.nodes().forEach((n) => nodeIndex.set(n.id(), n));
      cy.edges().forEach((e) => {
        const id = e.id();
        edgeIndex.set(id, e);
        edgeSource.set(id, e.data('source'));
      });
      indexesRef.current = { nodeIndex, edgeIndex, edgeSource };

      // Everything starts without the `.hidden` class after cy.add(); seed
      // prev-visible with all ids so the first diff correctly hides orphans
      // and anything outside the initial filter state.
      const initialHookIds = new Set();
      const initialFileClassIds = new Set();
      cy.nodes().forEach((n) => {
        const t = n.data('type');
        const id = n.id();
        if (t === 'hook') initialHookIds.add(id);
        else if (t === 'file' || t === 'class') initialFileClassIds.add(id);
      });
      prevVisibleRef.current = {
        hookIds: initialHookIds,
        edgeIds: new Set(edgeIndex.keys()),
        fileClassIds: initialFileClassIds,
      };

      const layoutOpts = buildLayoutOptions(isLargeGraph);
      layoutOpts.stop = () => {
        if (!destroyed) {
          setProgress(null);
          setGraphReady(true);
          setIsComputing(false);
        }
      };
      cy.layout(layoutOpts).run();
    })();

    // --- Event handlers ---

    cy.on('tap', 'node', (evt) => {
      selectNode(evt.target.id());
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        clearSelection();
      }
    });

    const hoverDelay = isLargeGraph ? 80 : 0;

    cy.on('mouseover', 'node', (evt) => {
      const searchInput = document.getElementById('graph-search');
      const searchActive = searchInput && searchInput.value.trim().length > 0;
      if (searchActive) return;

      if (hoverDelay) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = setTimeout(() => highlightNode(cy, evt.target), hoverDelay);
      } else {
        highlightNode(cy, evt.target);
      }
    });

    cy.on('mouseout', 'node', () => {
      clearTimeout(hoverTimerRef.current);
      const searchInput = document.getElementById('graph-search');
      const searchActive = searchInput && searchInput.value.trim().length > 0;
      if (searchActive) return;

      const sel = cy.nodes('.selected-node');
      if (sel.length) {
        highlightNode(cy, sel[0]);
        return;
      }
      clearHighlight(cy);
    });

    return () => {
      destroyed = true;
      cy.destroy();
      cyRef.current = null;
      indexesRef.current = null;
      prevVisibleRef.current = null;
      setIsComputing(false);
    };
  }, [data, sourceLabels, repoPalettes, isLargeGraph, groupBy]);

  // --- Apply filter results (only after graph is ready) ---
  useEffect(() => {
    const cy = cyRef.current;
    const indexes = indexesRef.current;
    const prev = prevVisibleRef.current;
    if (!cy || !filterResult || !graphReady || !indexes || !prev) return;

    applyFilters(cy, filterResult, indexes, prev);
  }, [filterResult, graphReady]);

  // --- Apply search highlighting ---
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !graphReady) return;
    const query = searchQuery.toLowerCase().trim();

    if (!query) {
      const sel = cy.nodes('.selected-node');
      if (sel.length) {
        highlightNode(cy, sel[0]);
      } else {
        clearHighlight(cy);
      }
      return;
    }

    const matched = cy.nodes().filter((n) => {
      if (n.hasClass('hidden')) return false;
      const d = n.data();
      return (d.name || d.path || '').toLowerCase().includes(query);
    });

    cy.batch(() => {
      cy.elements().removeClass('faded highlighted highlighted-edge');
      cy.elements().addClass('faded');
      if (matched.length > 0) {
        const neighborhood = matched.neighborhood().add(matched);
        neighborhood.removeClass('faded').addClass('highlighted');
        neighborhood.edges().addClass('highlighted-edge');
      }
    });
  }, [searchQuery, graphReady]);

  // --- Apply selected node highlighting ---
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !graphReady) return;

    cy.batch(() => {
      cy.elements().removeClass('selected-node');
    });

    if (!selectedNode) {
      if (searchQuery.trim()) return;
      clearHighlight(cy);
      return;
    }

    const node = cy.getElementById(selectedNode);
    if (!node || !node.length) return;

    const query = searchQuery.toLowerCase().trim();
    if (query) {
      const matched = cy.nodes().filter((n) => {
        if (n.hasClass('hidden')) return false;
        const d = n.data();
        return (d.name || d.path || '').toLowerCase().includes(query);
      });
      const searchNeighborhood = matched.neighborhood().add(matched);
      const selNeighborhood = node.neighborhood().add(node);
      const combined = searchNeighborhood.union(selNeighborhood);
      cy.batch(() => {
        cy.elements().removeClass('highlighted highlighted-edge').addClass('faded');
        combined.removeClass('faded').addClass('highlighted');
        combined.edges().addClass('highlighted-edge');
      });
    } else {
      highlightNode(cy, node);
    }

    cy.batch(() => {
      node.addClass('selected-node');
    });

    cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.5) }, { duration: 300 });
  }, [selectedNode, graphReady]);

  return (
    <>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
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
          {isLargeGraph && (
            <div
              style={{
                fontSize: 'var(--wpds-typography-font-size-sm)',
                fontStyle: 'italic',
                opacity: 0.7,
                maxWidth: '32rem',
                textAlign: 'center',
                padding: '0 var(--wpds-dimension-gap-lg)',
              }}
            >
              If the browser warns that this page is unresponsive, click <strong>Wait</strong>. It
              may prompt more than once while the layout finishes computing.
            </div>
          )}
        </div>
      )}
    </>
  );
}

// --- Helpers (module-level, not exported) ---

// Diff-based filter application. Instead of scanning every node/edge on each
// toggle, we:
//   1. Look up the current visible ids (hooks, edges, file/class parents).
//   2. Compare against the previous-visible snapshot.
//   3. Apply `.hidden` only to the symmetric difference via O(1) id lookups.
// For a small filter diff (e.g. toggling one checkbox) this touches tens of
// elements instead of the full 10k+-element graph.
function applyFilters(cy, filterResult, indexes, prev) {
  const { nodeIndex, edgeIndex, edgeSource } = indexes;

  // Map visible edge indices (from the pure pipeline) to Cytoscape edge ids.
  // Edge ids are assigned by buildEdgeData() as `edge-${i}` where i is the
  // position in the original data.edges array — stable across groupBy modes.
  const currEdgeIds = new Set();
  filterResult.visibleEdgeIndices.forEach((i) => currEdgeIds.add('edge-' + i));

  // Parent nodes (files in file mode, files-or-classes in class mode) are
  // derived from the visible edges' source ids. This replaces the old
  // `connectedEdges().some(...)` scan which re-traversed the full edge list
  // for every parent node.
  const currFileClassIds = new Set();
  currEdgeIds.forEach((eid) => {
    const src = edgeSource.get(eid);
    if (src) currFileClassIds.add(src);
  });

  const currHookIds = filterResult.visibleHookIds;

  cy.batch(() => {
    diffApply(prev.hookIds, currHookIds, nodeIndex);
    diffApply(prev.edgeIds, currEdgeIds, edgeIndex);
    diffApply(prev.fileClassIds, currFileClassIds, nodeIndex);
  });

  prev.hookIds = currHookIds;
  prev.edgeIds = currEdgeIds;
  prev.fileClassIds = currFileClassIds;
}

function diffApply(prevSet, currSet, index) {
  prevSet.forEach((id) => {
    if (!currSet.has(id)) {
      const el = index.get(id);
      if (el) el.addClass('hidden');
    }
  });
  currSet.forEach((id) => {
    if (!prevSet.has(id)) {
      const el = index.get(id);
      if (el) el.removeClass('hidden');
    }
  });
}

function highlightNode(cy, node) {
  const neighborhood = node.neighborhood().add(node);
  cy.batch(() => {
    cy.elements().removeClass('highlighted highlighted-edge').addClass('faded');
    neighborhood.removeClass('faded').addClass('highlighted');
    neighborhood.edges().addClass('highlighted-edge');
  });
}

function clearHighlight(cy) {
  cy.batch(() => {
    cy.elements().removeClass('faded highlighted highlighted-edge selected-node');
  });
}
