export const THEME_COLORS = {
  nodeText: '#4a4258',
  highlightHookText: '#1e1a24',
  highlightTextBg: '#ffffff',
  highlightFileText: '#4a4258',
  selectedBorder: '#1e1a24',
  classBorder: '#5c5465',
  overlapText: '#1a1a2e',
};

export const OVERLAP_ACTION = '#a8eef0';
export const OVERLAP_FILTER = '#d4c8f0';

export const LARGE_GRAPH_THRESHOLD = 2000;
export const BATCH_SIZE = 500;
export const LISTEN_TRUNCATION_LIMIT = 50;

// Defaults for the sigma renderer's sizing controls. Scale fields are stored
// as integer percent (100 = 1.0×) so DataForm's integer Edit primitive can
// drive them — `computeNodeSize` divides by 100 at apply time.
export const SIGMA_SIZING_DEFAULTS = {
  hookScale: 35,
  fileScale: 35,
  classScale: 35,
  hubEmphasis: 90,
  zoomResponse: true,
  densityCompensation: true,
  // Simulated viewport size as % of real canvas vmin. 100 = use the real
  // canvas size; lower values shrink the effective vmin so the responsive
  // sizing pipeline behaves as if the canvas were smaller. Lets the user
  // verify small-screen behavior without resizing the browser.
  viewportScale: 70,
  // Default edge programs per direction. Sigma 3 ships 'arrow' and 'line';
  // 'curvedArrow' comes from @sigma/edge-curve and uses the per-edge
  // `curvature` attribute (positive for fires, negative for listens) to
  // bow the two directions opposite ways.
  fireEdgeType: 'curvedArrow',
  listenEdgeType: 'curvedArrow',
  // Focused-edge styling (search/selection/hover neighborhoods). The reducer
  // reads these every frame, so changes apply on the next sigma refresh.
  // Stored as % of vmin (0.15 = 0.15% of canvas vmin).
  focusedEdgeSize: 0.15,
  focusedFireEdgeType: 'curvedArrow',
  focusedListenEdgeType: 'curvedArrow',
  // Edge opacity as integer percent (0–100). Applied as an alpha-hex suffix
  // on the base edge color in the reducer; sigma's default WebGL programs
  // parse #RRGGBBAA, so this is just a string concat at apply time.
  edgeOpacity: 100,
};

export const SIGMA_SIZING_MIN = 25;
export const SIGMA_SIZING_MAX = 300;

export const SIGMA_VIEWPORT_SCALE_MIN = 25;
export const SIGMA_VIEWPORT_SCALE_MAX = 100;

export const SIGMA_FOCUSED_EDGE_TYPES = ['arrow', 'line', 'curvedArrow'];
// Focused-edge size bounds, in % of vmin. Calibrated so the visual range
// matches the previous 1–10 pixel range at a ~1000px canvas.
export const SIGMA_FOCUSED_EDGE_SIZE_MIN = 0.1;
export const SIGMA_FOCUSED_EDGE_SIZE_MAX = 1.0;

export const SIGMA_EDGE_OPACITY_MIN = 0;
export const SIGMA_EDGE_OPACITY_MAX = 100;

// All node/edge sizes in the sigma renderer are stored as % of vmin
// (= min(canvas.width, canvas.height)). The reducer converts to pixels
// at apply time so sigma always receives screen pixels. Calibrated against
// a ~1000px reference vmin (e.g. 28% / 100 * 1000 = 28px).
export const SIGMA_SIZE_PCT = {
  // Floor + sqrt(degree) coefficients per node type.
  hookFloor: 0.3,
  hookCoef: 0.3,
  hookCap: 2.8,
  fileFloor: 0.3,
  fileCoef: 0.25,
  fileCap: 2.4,
  // Hard floor applied after all multipliers — guarantees nodes stay
  // visible at extreme sizing/zoom combos.
  minSize: 0.3,
  // Label rendered-size threshold, in % of vmin. Below this size sigma
  // suppresses the node's label (unless forceLabel is set in the reducer).
  // Two values mirror the previous 4px / 8px split.
  labelThreshold: 0.4,
  labelThresholdLarge: 0.8,
  // Default (idle) edge size, in % of vmin.
  edgeSize: 0.1,
};
