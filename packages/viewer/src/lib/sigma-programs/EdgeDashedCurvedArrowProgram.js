// Extends @sigma/edge-curve@3.1.0 EdgeCurvedArrowProgram with a dashed
// fragment shader. Only FRAGMENT_SHADER_SOURCE is patched — vertex shader
// and all attribute/uniform plumbing inherited unchanged.
// Smoke test: ./EdgeDashedCurvedArrowProgram.test.js
import { EdgeCurvedArrowProgram } from '@sigma/edge-curve';
import {
  DASH_ANCHOR_MAIN,
  DASH_ANCHOR_HALFTHICKNESS,
} from './dashedShaderAnchors';

const DASH_INJECT_MAIN = `${DASH_ANCHOR_MAIN}
  // Screen-pixel distance from source along curve, used as dash phase.
  vec2 _closest = getDistanceVector(v_cpA - gl_FragCoord.xy, v_cpB - gl_FragCoord.xy, v_cpC - gl_FragCoord.xy) + gl_FragCoord.xy;
  float arcParam = length(_closest - v_cpA);
  const float DASH_PERIOD = 10.0;
  const float DASH_ON = 6.0;
`;

const DASH_GUARD = `
#ifndef PICKING_MODE
  // Discard fragments in dash "off" segments. Picking stays solid so
  // hover/select hit-tests work over the full curve.
  if (mod(arcParam, DASH_PERIOD) > DASH_ON) discard;
#endif
  ${DASH_ANCHOR_HALFTHICKNESS}`;

export class EdgeDashedCurvedArrowProgram extends EdgeCurvedArrowProgram {
  getDefinition() {
    const def = super.getDefinition();
    let src = def.FRAGMENT_SHADER_SOURCE;
    if (!src.includes(DASH_ANCHOR_MAIN) || !src.includes(DASH_ANCHOR_HALFTHICKNESS)) {
      throw new Error(
        'EdgeDashedCurvedArrowProgram: upstream shader anchors missing — sigma/edge-curve upgrade likely changed the shader.'
      );
    }
    src = src.replace(DASH_ANCHOR_MAIN, DASH_INJECT_MAIN).replace(DASH_ANCHOR_HALFTHICKNESS, DASH_GUARD);
    return { ...def, FRAGMENT_SHADER_SOURCE: src };
  }
}
