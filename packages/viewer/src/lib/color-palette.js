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

export function generateRepoPalette(sourceLabels) {
  const n = sourceLabels.length;
  const palettes = {};
  const extras = Math.max(0, n - CURATED_HUES.length);
  for (let i = 0; i < n; i++) {
    let h;
    if (i < CURATED_HUES.length) {
      h = CURATED_HUES[i];
    } else {
      // Fan the remainder evenly, starting halfway between the last curated
      // hue and itself + 360° so we land in unused arcs of the wheel.
      const step = 360 / (extras + 1);
      h = (CURATED_HUES[CURATED_HUES.length - 1] + step * (i - CURATED_HUES.length + 1)) % 360;
    }
    palettes[sourceLabels[i]] = {
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
  return palettes;
}
