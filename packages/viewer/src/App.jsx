import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import GraphContext from './context/GraphContext';
import { SizingProvider } from './context/SizingContext';
import useGraphData from './hooks/useGraphData';
import useFilterState from './hooks/useFilterState';
import { generateRepoPalette } from './lib/color-palette';
import { LARGE_GRAPH_THRESHOLD } from './lib/constants';
import HomePage from './components/HomePage';
import Sidebar from './components/Sidebar';
import SigmaGraphCanvas from './components/SigmaGraphCanvas';
import SearchOverlay from './components/SearchOverlay';
import DetailPanel from './components/DetailPanel';
import Legend from './components/Legend';
import './styles/tokens.css';

export default function App() {
  const {
    data,
    isLoading,
    loadFile,
    loadDemo,
    clearData: clearGraphData,
    hasDemo,
  } = useGraphData();
  const [selectedNode, setSelectedNode] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupBy, setGroupBy] = useState('file');
  const [isComputing, setIsComputing] = useState(false);
  const [paletteHueOverrides, setPaletteHueOverrides] = useState({});
  const cyRef = useRef(null);
  const sigmaRef = useRef(null);

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
    const palettes = generateRepoPalette(labels, paletteHueOverrides);

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
  }, [data, paletteHueOverrides]);

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

  // Reset view state alongside graph data so a returning user gets a clean slate.
  const clearData = useCallback(() => {
    clearGraphData();
    setSelectedNode(null);
    setSearchQuery('');
    setIsComputing(false);
  }, [clearGraphData]);

  const contextValue = useMemo(
    () => ({
      data,
      cyRef,
      sigmaRef,
      sourceLabels,
      repoPalettes,
      paletteHueOverrides,
      setPaletteHueOverrides,
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
      clearData,
      isLoading,
      isComputing,
      setIsComputing,
      isBusy: isLoading || isComputing,
    }),
    [
      data,
      sourceLabels,
      repoPalettes,
      paletteHueOverrides,
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
      clearData,
      isLoading,
      isComputing,
    ]
  );

  // Show home page until a graph is loaded
  if (!data) {
    return (
      <HomePage
        onFileLoad={loadFile}
        isLoading={isLoading}
        onLoadDemo={loadDemo}
        hasDemo={hasDemo}
      />
    );
  }

  return (
    <GraphContext.Provider value={contextValue}>
      <SizingProvider>
        <div className="app-shell">
          <Sidebar />
          <div className="graph-area">
            <SearchOverlay />
            <SigmaGraphCanvas />
            <DetailPanel />
            <Legend />
          </div>
        </div>
      </SizingProvider>
    </GraphContext.Provider>
  );
}
