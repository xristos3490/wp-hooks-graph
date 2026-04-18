export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  const toHex = (v) => {
    const hex = Math.round((v + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

export function hslToRgba(h, s, l, a) {
  const hex = hslToHex(h, s, l);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function generateRepoPalette(sourceLabels) {
  const n = sourceLabels.length;
  const palettes = {};
  for (let i = 0; i < n; i++) {
    const hue = (360 / n) * i + 30;
    palettes[sourceLabels[i]] = {
      action:              hslToHex(hue, 70, 58),
      filter:              hslToHex(hue, 55, 72),
      file:                hslToHex(hue, 40, 42),
      fireEdge:            hslToHex(hue, 65, 55),
      listenEdge:          hslToHex(hue, 50, 65),
      fireEdgeAlpha:       hslToRgba(hue, 65, 55, 0.4),
      listenEdgeAlpha:     hslToRgba(hue, 50, 65, 0.3),
      fireEdgeHighlight:   hslToRgba(hue, 65, 55, 0.8),
      listenEdgeHighlight: hslToRgba(hue, 50, 65, 0.8),
      hue,
    };
  }
  return palettes;
}
