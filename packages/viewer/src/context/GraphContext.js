import { createContext, useContext } from 'react';

const GraphContext = createContext(null);

export function useGraphContext() {
  const ctx = useContext(GraphContext);
  if (!ctx) throw new Error('useGraphContext must be used within GraphContext.Provider');
  return ctx;
}

export default GraphContext;
