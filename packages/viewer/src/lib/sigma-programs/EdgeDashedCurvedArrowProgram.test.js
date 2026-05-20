import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import {
  DASH_ANCHOR_MAIN,
  DASH_ANCHOR_HALFTHICKNESS,
  DASH_VARYING,
} from './dashedShaderAnchors.js';

// The cjs entry of @sigma/edge-curve is a thin NODE_ENV switch; the real
// shader source lives in the dev/prod siblings and in the esm bundle. Read
// the dev sibling, which always contains the unminified GLSL.
const require = createRequire(import.meta.url);
const upstreamEntry = require.resolve('@sigma/edge-curve');
const upstreamSrc = readFileSync(join(dirname(upstreamEntry), 'sigma-edge-curve.cjs.dev.js'), 'utf8');

describe('@sigma/edge-curve upstream shader contract', () => {
  it.each([
    ['main entry', DASH_ANCHOR_MAIN],
    ['halfThickness branch', DASH_ANCHOR_HALFTHICKNESS],
    ['v_cpA varying', DASH_VARYING],
  ])('still contains %s anchor', (_, anchor) => {
    expect(upstreamSrc).toContain(anchor);
  });
});
