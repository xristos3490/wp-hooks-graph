import { useRef, useEffect, useState, useCallback } from 'react';
import cytoscape from 'cytoscape';
import { useGraphContext } from '../context/GraphContext';
import {
  buildCytoscapeStyles,
  buildElements,
  buildLayoutOptions,
} from '../lib/cytoscape-setup';
import { BATCH_SIZE } from '../lib/constants';

function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
  } = useGraphContext();

  const [progress, setProgress] = useState(null);
  const [graphReady, setGraphReady] = useState(false);
  const [showSlowWarning, setShowSlowWarning] = useState(false);
  const hoverTimerRef = useRef(null);
  const hookDataCacheRef = useRef(hookDataCache);
  hookDataCacheRef.current = hookDataCache;

  // --- Initialize Cytoscape ---
  useEffect(() => {
    if (!containerRef.current || !data) return;

    setGraphReady(false);
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

      setProgress({ label: 'Computing layout\u2026', detail: isLargeGraph ? 'This may take a moment for large graphs' : '' });
      await yieldToMain();

      if (destroyed) return;

      const layoutOpts = buildLayoutOptions(isLargeGraph);
      layoutOpts.stop = () => {
        if (!destroyed) {
          setProgress(null);
          setGraphReady(true);
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
    };
  }, [data, sourceLabels, repoPalettes, isLargeGraph, groupBy]);

  // --- Show an unresponsive-page hint if "Building graph" lingers ---
  const progressLabel = progress?.label ?? null;
  useEffect(() => {
    if (progressLabel !== 'Building graph…') {
      setShowSlowWarning(false);
      return;
    }
    const timer = setTimeout(() => setShowSlowWarning(true), 4000);
    return () => clearTimeout(timer);
  }, [progressLabel]);

  // --- Apply filter results (only after graph is ready) ---
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !filterResult || !graphReady) return;

    applyFilters(cy, filterResult);
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
      return ((d.name || d.path || '').toLowerCase()).includes(query);
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
        return ((d.name || d.path || '').toLowerCase()).includes(query);
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

    cy.animate(
      { center: { eles: node }, zoom: Math.max(cy.zoom(), 1.5) },
      { duration: 300 }
    );
  }, [selectedNode, graphReady]);

  return (
    <>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {progress && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 20,
          gap: 'var(--wpds-dimension-gap-lg)',
          background: 'var(--wpds-color-bg-surface-neutral-weak)',
        }}>
          <div className="hg-spinner" />
          <div style={{
            fontSize: 'var(--wpds-typography-font-size-lg)',
            fontWeight: 'var(--wpds-typography-font-weight-medium)',
          }}>
            {progress.label}
          </div>
          {progress.detail && (
            <div style={{ fontSize: 'var(--wpds-typography-font-size-sm)' }}>
              {progress.detail}
            </div>
          )}
          {showSlowWarning && (
            <div style={{
              fontSize: 'var(--wpds-typography-font-size-sm)',
              fontStyle: 'italic',
              opacity: 0.7,
              maxWidth: '32rem',
              textAlign: 'center',
              padding: '0 var(--wpds-dimension-gap-lg)',
            }}>
              Large imports can make the browser flag this page as unresponsive (to be improved). If that happens, click <strong>Wait</strong> a few times — the graph just needs a moment to finish.
            </div>
          )}
        </div>
      )}
    </>
  );
}

// --- Helpers (module-level, not exported) ---

function applyFilters(cy, filterResult) {
  cy.batch(() => {
    cy.elements().removeClass('hidden');

    // Hide non-visible hooks and their edges
    cy.nodes('[type="hook"]').forEach((node) => {
      if (!filterResult.visibleHookIds.has(node.data('id'))) {
        node.addClass('hidden');
        node.connectedEdges().addClass('hidden');
      }
    });

    // Hide edges not in the visible set.
    // visibleEdges uses raw file-based source IDs, but in class mode Cytoscape
    // edge sources are class IDs (class::repo::Name). Use target+line as
    // fallback key so class-mode edges aren't incorrectly hidden.
    const visibleEdgeKeys = new Set(
      filterResult.visibleEdges.map((ve) => ve.source + '|' + ve.target + '|' + ve.line)
    );
    const visibleTargetLineKeys = new Set(
      filterResult.visibleEdges.map((ve) => ve.target + '|' + ve.line)
    );
    cy.edges().forEach((edge) => {
      if (edge.hasClass('hidden')) return;
      const ed = edge.data();
      if (!visibleEdgeKeys.has(ed.source + '|' + ed.target + '|' + ed.line)) {
        if (!visibleTargetLineKeys.has(ed.target + '|' + ed.line)) {
          edge.addClass('hidden');
        }
      }
    });

    // Hide file/class nodes that have no visible connected edges
    cy.nodes('[type="file"], [type="class"]').forEach((node) => {
      const hasVisibleEdge = node.connectedEdges().some((e) => !e.hasClass('hidden'));
      if (!hasVisibleEdge) {
        node.addClass('hidden');
      }
    });
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
