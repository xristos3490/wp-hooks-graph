/**
 * Per-repo palette generator.
 *
 * Uses OKLCH so colors are perceptually uniform across hues and share the
 * tonal position of WPDS's brand blue (`--wpds-color-fg-interactive-brand`,
 * #3858e9 ≈ oklch(54% 0.22 264°)). Each role (action, filter, file, edge
 * variants) is a fixed (L, C) anchor; only the hue rotates per repo, so the
 * palette feels visually consistent with the WP design system.
 *
 * We emit hex/rgba (not native `oklch()`) because Sigma's default WebGL color
 * programs only parse `#RRGGBB(AA)` — and to keep CSS-side tokens in the same
 * format. The hex variants are used on the WebGL side; rgba is fine for CSS.
 */

// Shared tonal anchors. L is percent, C is OKLCH chroma (typical 0–0.4).
const TONES = {
  action: { L: 54, C: 0.22 }, // matches WPDS brand blue — primary hook color
  filter: { L: 72, C: 0.13 }, // softer counterpart, echoes bg-surface-brand tone
  file: { L: 42, C: 0.08 }, // muted, lives near fg-content-neutral-weak
  fire: { L: 54, C: 0.2 }, // ~action, used for "fires" edges
  listen: { L: 65, C: 0.13 }, // ~filter, used for "listens" edges
};

// Curated hues for the first sources, then fan out evenly for any extras.
// 1st: 264° = WPDS brand blue (single-repo graphs match WP's accent exactly).
// 2nd: 293° = the #873EFF violet family.
// 3rd: 148° = a balanced green.
// Beyond that, additional sources fan around the wheel offset from the last
// curated hue so they don't collide with the curated set.
const CURATED_HUES = [264, 293, 148];

// Gamma-encode a linear-sRGB channel (0..1) to an 8-bit sRGB value.
function linearToSrgb(x) {
  const c = Math.max(0, Math.min(1, x));
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(v * 255);
}

// OKLCH → sRGB using Björn Ottosson's OKLab matrix. Returns [r, g, b] as 0–255.
function oklchToRgb(L, C, h) {
  const hRad = (h * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  const lP = L / 100;

  // OKLab → cube-root LMS
  const lC = lP + 0.3963377774 * a + 0.2158037573 * b;
  const mC = lP - 0.1055613458 * a - 0.0638541728 * b;
  const sC = lP - 0.0894841775 * a - 1.291485548 * b;

  const lL = lC ** 3;
  const mL = mC ** 3;
  const sL = sC ** 3;

  // LMS → linear sRGB
  const r = 4.0767416621 * lL - 3.3077115913 * mL + 0.2309699292 * sL;
  const g = -1.2684380046 * lL + 2.6097574011 * mL - 0.3413193965 * sL;
  const bl = -0.0041960863 * lL - 0.7034186147 * mL + 1.707614701 * sL;

  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(bl)];
}

const toHex = ({ L, C }, h) => {
  const [r, g, b] = oklchToRgb(L, C, h);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

const toRgba = ({ L, C }, h, a) => {
  const [r, g, b] = oklchToRgb(L, C, h);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

// sRGB → linear-sRGB inverse companding.
function srgbToLinear(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// sRGB (0..255) → OKLCH using Björn Ottosson's matrices. Returned hue is
// in degrees [0, 360). Used to extract a hue family from a user-picked hex
// so we can recompute all tonal variants from the same anchor table.
function rgbToOklch(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const lC = Math.cbrt(l);
  const mC = Math.cbrt(m);
  const sC = Math.cbrt(s);

  const a = 1.9779984951 * lC - 2.428592205 * mC + 0.4505937099 * sC;
  const bb = 0.0259040371 * lC + 0.7827717662 * mC - 0.808675766 * sC;

  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return h;
}

export function hexToHue(hex) {
  const s = (hex || '').replace('#', '');
  if (s.length < 6) return 0;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  return rgbToOklch(r, g, b);
}

function paletteFromHue(h) {
  return {
    action: toHex(TONES.action, h),
    filter: toHex(TONES.filter, h),
    file: toHex(TONES.file, h),
    fireEdge: toHex(TONES.fire, h),
    listenEdge: toHex(TONES.listen, h),
    fireEdgeAlpha: toRgba(TONES.fire, h, 0.4),
    listenEdgeAlpha: toRgba(TONES.listen, h, 0.3),
    fireEdgeHighlight: toRgba(TONES.fire, h, 0.8),
    listenEdgeHighlight: toRgba(TONES.listen, h, 0.8),
  };
}

export function defaultHueFor(sourceLabels, index) {
  if (index < CURATED_HUES.length) return CURATED_HUES[index];
  const extras = Math.max(0, sourceLabels.length - CURATED_HUES.length);
  const step = 360 / (extras + 1);
  return (CURATED_HUES[CURATED_HUES.length - 1] + step * (index - CURATED_HUES.length + 1)) % 360;
}

export function generateRepoPalette(sourceLabels, hueOverrides = {}) {
  const palettes = {};
  for (let i = 0; i < sourceLabels.length; i++) {
    const label = sourceLabels[i];
    const h =
      hueOverrides[label] !== undefined ? hueOverrides[label] : defaultHueFor(sourceLabels, i);
    palettes[label] = paletteFromHue(h);
  }
  return palettes;
}
