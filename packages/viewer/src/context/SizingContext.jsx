import { createContext, useContext, useMemo, useState } from 'react';
import { SIGMA_SIZING_DEFAULTS } from '../lib/constants';

// Dedicated provider for sigma sizing/theme state. Lives below GraphContext
// so a slider drag doesn't re-render the entire App subtree (filter state,
// derived palettes, etc.) — only consumers of useSizing() rerun. The canvas
// reducer still mirrors `sizing` into a local ref for tear-free per-frame
// reads; that's an orthogonal concern from where the state lives.
const SizingContext = createContext(null);

export function SizingProvider({ children }) {
  const [sizing, setSizing] = useState(SIGMA_SIZING_DEFAULTS);
  const value = useMemo(() => ({ sizing, setSizing }), [sizing]);
  return <SizingContext.Provider value={value}>{children}</SizingContext.Provider>;
}

export function useSizing() {
  const ctx = useContext(SizingContext);
  if (!ctx) throw new Error('useSizing must be used within SizingProvider');
  return ctx;
}
