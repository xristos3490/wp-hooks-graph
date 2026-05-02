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
  hookScale: 65,
  fileScale: 65,
  classScale: 100,
  hubEmphasis: 100,
  zoomResponse: true,
  densityCompensation: true,
  // Default edge programs per direction. Sigma 3 ships 'arrow' and 'line';
  // 'curvedArrow' comes from @sigma/edge-curve and uses the per-edge
  // `curvature` attribute (positive for fires, negative for listens) to
  // bow the two directions opposite ways.
  fireEdgeType: 'curvedArrow',
  listenEdgeType: 'curvedArrow',
  // Focused-edge styling (search/selection/hover neighborhoods). The reducer
  // reads these every frame, so changes apply on the next sigma refresh.
  focusedEdgeSize: 1.5,
  focusedFireEdgeType: 'curvedArrow',
  focusedListenEdgeType: 'curvedArrow',
};

export const SIGMA_SIZING_MIN = 25;
export const SIGMA_SIZING_MAX = 300;

export const SIGMA_FOCUSED_EDGE_TYPES = ['arrow', 'line', 'curvedArrow'];
export const SIGMA_FOCUSED_EDGE_SIZE_MIN = 1;
export const SIGMA_FOCUSED_EDGE_SIZE_MAX = 10;
