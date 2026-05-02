import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import GraphContext from './context/GraphContext';
import useGraphData from './hooks/useGraphData';
import useFilterState from './hooks/useFilterState';
import { generateRepoPalette } from './lib/color-palette';
import { LARGE_GRAPH_THRESHOLD } from './lib/constants';
import HomePage from './components/HomePage';
import Sidebar from './components/Sidebar';
import GraphCanvas from './components/GraphCanvas';
import SigmaGraphCanvas from './components/SigmaGraphCanvas';
import SearchOverlay from './components/SearchOverlay';
import DetailPanel from './components/DetailPanel';
import Legend from './components/Legend';
import './styles/tokens.css';

export default function App() {
  const { data, isLoading, loadFile } = useGraphData();
  const [selectedNode, setSelectedNode] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupBy, setGroupBy] = useState('file');
  const [isComputing, setIsComputing] = useState(false);
  const cyRef = useRef(null);

  // Derive source labels + palettes from data
  const {
    sourceLabels,
    repoPalettes,
    hookDataCache,
    isLargeGraph,
    defaultThreshold,
    maxConnections,
  } = useMemo(() => {
    if (!data)
      return {
        sourceLabels: [],
        repoPalettes: {},
        hookDataCache: null,
        isLargeGraph: false,
        defaultThreshold: 10,
        maxConnections: 100,
      };

    const meta = data.metadata;
    const labels =
      meta.source_labels ||
      (meta.scanned_dirs || []).map((d) => d.split('/').filter(Boolean).pop());
    const palettes = generateRepoPalette(labels);

    const hookNodes = data.nodes.filter((n) => n.type === 'hook');
    const fileNodes = data.nodes.filter((n) => n.type === 'file');
    const connections = hookNodes.map((n) => n.fire_count + n.listen_count).sort((a, b) => b - a);
    const threshold = connections[Math.floor(connections.length * 0.1)] || 5;
    const maxConn = connections[0] || 100;

    const totalElements = data.nodes.length + data.edges.length;

    return {
      sourceLabels: labels,
      repoPalettes: palettes,
      hookDataCache: { hooks: hookNodes, edges: data.edges, fileNodes },
      isLargeGraph: totalElements > LARGE_GRAPH_THRESHOLD,
      defaultThreshold: threshold,
      maxConnections: maxConn,
    };
  }, [data]);

  const {
    filterState,
    filterResult,
    toggleHookType,
    toggleBoolFilter,
    toggleFireRepo,
    toggleListenRepo,
    toggleHighTraffic,
    setHighTrafficValue,
    initRepos,
    setDefaultThreshold,
  } = useFilterState(hookDataCache);

  // Initialize repos when data arrives
  useEffect(() => {
    if (sourceLabels.length > 0) {
      initRepos(sourceLabels);
      setDefaultThreshold(defaultThreshold);
    }
  }, [sourceLabels, defaultThreshold, initRepos, setDefaultThreshold]);

  const selectNode = useCallback((id) => setSelectedNode(id), []);
  const clearSelection = useCallback(() => setSelectedNode(null), []);

  const contextValue = useMemo(
    () => ({
      data,
      cyRef,
      sourceLabels,
      repoPalettes,
      hookDataCache,
      isLargeGraph,
      defaultThreshold,
      maxConnections,
      filterState,
      filterResult,
      toggleHookType,
      toggleBoolFilter,
      toggleFireRepo,
      toggleListenRepo,
      toggleHighTraffic,
      setHighTrafficValue,
      selectedNode,
      selectNode,
      clearSelection,
      searchQuery,
      setSearchQuery,
      groupBy,
      setGroupBy,
      loadFile,
      isLoading,
      isComputing,
      setIsComputing,
      isBusy: isLoading || isComputing,
    }),
    [
      data,
      sourceLabels,
      repoPalettes,
      hookDataCache,
      isLargeGraph,
      defaultThreshold,
      maxConnections,
      filterState,
      filterResult,
      toggleHookType,
      toggleBoolFilter,
      toggleFireRepo,
      toggleListenRepo,
      toggleHighTraffic,
      setHighTrafficValue,
      selectedNode,
      selectNode,
      clearSelection,
      searchQuery,
      groupBy,
      loadFile,
      isLoading,
      isComputing,
    ]
  );

  // Show home page until a graph is loaded
  if (!data) {
    return <HomePage onFileLoad={loadFile} isLoading={isLoading} />;
  }

  // Renderer toggle — ?renderer=sigma swaps the WebGL spike in. Persisted to
  // sessionStorage so the floating toggle button can flip without a reload
  // logic change. Default = cytoscape.
  const renderer = getRenderer();
  const Canvas = renderer === 'sigma' ? SigmaGraphCanvas : GraphCanvas;

  return (
    <GraphContext.Provider value={contextValue}>
      <div className="app-shell">
        <Sidebar />
        <div className="graph-area">
          <SearchOverlay />
          <Canvas key={renderer} />
          <DetailPanel />
          <Legend />
          <RendererToggle current={renderer} />
        </div>
      </div>
    </GraphContext.Provider>
  );
}

function getRenderer() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('renderer');
  if (fromUrl === 'sigma' || fromUrl === 'cytoscape') return fromUrl;
  return 'cytoscape';
}

function RendererToggle({ current }) {
  function flip() {
    const next = current === 'sigma' ? 'cytoscape' : 'sigma';
    const url = new URL(window.location.href);
    url.searchParams.set('renderer', next);
    window.location.href = url.toString();
  }
  return (
    <button
      type="button"
      onClick={flip}
      style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        zIndex: 40,
        padding: '6px 10px',
        fontSize: 11,
        fontFamily: 'var(--wpds-typography-font-family-mono, monospace)',
        background: 'rgba(255,255,255,0.92)',
        border: '1px solid #d0d0d0',
        borderRadius: 6,
        cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
      }}
      title="Toggle graph renderer"
    >
      renderer: <strong>{current}</strong> · click to swap
    </button>
  );
}
