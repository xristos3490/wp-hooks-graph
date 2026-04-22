import { useMemo } from 'react';
import { buildCuratedScene } from '../lib/constellations.js';

// The idle homepage is now a hand-composed piece of art rather than a random
// scatter — every visit shows the same deliberate arrangement. useMemo keeps
// the same object reference across renders so physics refs stay stable.
export default function useHomepageScene() {
  return useMemo(() => buildCuratedScene(), []);
}
