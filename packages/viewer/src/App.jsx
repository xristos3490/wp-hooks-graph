import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import GraphContext from './context/GraphContext';
import useGraphData from './hooks/useGraphData';
import useFilterState from './hooks/useFilterState';
import { generateRepoPalette } from './lib/color-palette';
import { LARGE_GRAPH_THRESHOLD } from './lib/constants';
import HomePage from './components/HomePage';
import Sidebar from './components/Sidebar';
import GraphCanvas from './components/GraphCanvas';
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

  return (
    <GraphContext.Provider value={contextValue}>
      <div className="app-shell">
        <Sidebar />
        <div className="graph-area">
          <SearchOverlay />
          <GraphCanvas />
          <DetailPanel />
          <Legend />
        </div>
      </div>
    </GraphContext.Provider>
  );
}
