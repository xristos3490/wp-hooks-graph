/**
 * Per-repo palette generator.
 *
 * Uses OKLCH so colors are perceptually uniform across hues and share the
 * tonal position of WPDS's brand blue (`--wpds-color-fg-interactive-brand`,
 * #3858e9 ≈ oklch(54% 0.22 264°)). Each role (action, filter, file, edge
 * variants) is a fixed (L, C) anchor; only the hue rotates per repo, so the
 * palette feels visually consistent with the WP design system.
 *
 * We emit hex/rgba (not native `oklch()`) because Cytoscape's internal color
 * parser only understands hex/rgb/hsl.
 */

// Shared tonal anchors. L is percent, C is OKLCH chroma (typical 0–0.4).
const TONES = {
  action: { L: 54, C: 0.22 }, // matches WPDS brand blue — primary hook color
  filter: { L: 72, C: 0.13 }, // softer counterpart, echoes bg-surface-brand tone
  file: { L: 42, C: 0.08 }, // muted, lives near fg-content-neutral-weak
  fire: { L: 54, C: 0.2 }, // ~action, used for "fires" edges
  listen: { L: 65, C: 0.13 }, // ~filter, used for "listens" edges
};

// Start hue at 264° (WPDS brand blue) so a single-repo graph matches WP's
// accent color exactly. Additional repos fan out evenly around the wheel.
const BRAND_HUE = 264;

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
  for (let i = 0; i < n; i++) {
    const h = (BRAND_HUE + (360 / n) * i) % 360;
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
