// Pick foreground colors that stay legible on top of an arbitrary canvas
// background. Used by overlay controls (search bar IconButtons) so their
// glyphs don't disappear on dark canvases. Computes WCAG relative luminance
// and returns a near-black on light bg, near-white on dark bg, with a
// slightly muted hover variant on the same side of the gradient so hover
// state still reads as a state change.

function parseHex(hex) {
  if (typeof hex !== 'string' || hex.length !== 7 || hex[0] !== '#') return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

function relativeLuminance([r, g, b]) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastForegroundColors(bgHex) {
  const rgb = parseHex(bgHex);
  const isDark = rgb ? relativeLuminance(rgb) < 0.5 : false;
  if (isDark) {
    return {
      idle: '#f5f5f5',
      hover: '#ffffff',
      hoverBg: 'rgba(255, 255, 255, 0.14)',
    };
  }
  return {
    idle: '#1e1e1e',
    hover: '#000000',
    hoverBg: 'rgba(0, 0, 0, 0.08)',
  };
}
