// Sigma-free re-export of the upstream shader anchor strings the dashed
// program string-patches. Lives in its own module so the smoke test can
// import the constants in a Node-only vitest env without pulling sigma's
// WebGL2RenderingContext side-effect chain through @sigma/edge-curve.
export const DASH_ANCHOR_MAIN = 'void main(void) {';
export const DASH_ANCHOR_HALFTHICKNESS = 'if (dist < halfThickness) {';
export const DASH_VARYING = 'varying vec2 v_cpA;';
