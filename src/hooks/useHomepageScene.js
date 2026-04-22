import { useMemo } from 'react';
import { buildScene } from '../lib/constellations.js';

// Generate a stable scene for the current mount. A fresh seed means repeat
// visits to the idle home screen don't show the same layout.
export default function useHomepageScene({ drifterCount } = {}) {
  return useMemo(() => {
    const seed = Math.floor(Math.random() * 0x7fffffff);
    return buildScene({ seed, drifterCount });
  }, [drifterCount]);
}
