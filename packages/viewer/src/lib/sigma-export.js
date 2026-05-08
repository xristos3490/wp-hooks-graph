// Export the current sigma scene as a high-resolution PNG.
//
// Sigma reads `window.devicePixelRatio` once during `resize()` and uses it to
// size every canvas (WebGL viewports + 2D contexts). To get a true high-res
// rasterization — sharp WebGL nodes/edges AND sharp text in the labels layer —
// we temporarily inflate DPR, force a resize + refresh, composite the layers
// onto an offscreen canvas, then restore. Just upscaling the on-screen
// canvases via drawImage would give blurry text and aliased edges instead.

const LAYER_ORDER = ['edges', 'nodes', 'edgeLabels', 'labels', 'hovers', 'hoverNodes'];

export async function exportSigmaToPng(
  sigma,
  { scale = 2, background = '#ffffff', filename } = {}
) {
  if (!sigma) throw new Error('exportSigmaToPng: sigma instance required');

  const originalDPR = window.devicePixelRatio;
  const targetDPR = originalDPR * scale;
  let restored = false;

  const setDPR = (value) => {
    Object.defineProperty(window, 'devicePixelRatio', {
      value,
      configurable: true,
      writable: true,
    });
  };

  const restore = () => {
    if (restored) return;
    restored = true;
    setDPR(originalDPR);
    sigma.resize(true);
    sigma.refresh();
  };

  try {
    setDPR(targetDPR);
    sigma.resize(true);

    // sigma.refresh() defaults to a SYNC render (schedule:false). After it
    // returns the WebGL framebuffers contain the rendered pixels — but only
    // until the next browser compositor cycle, since sigma creates its WebGL
    // contexts with preserveDrawingBuffer:false. We must therefore copy each
    // framebuffer onto a 2D canvas in the same JS task — no rAF wait — or the
    // export comes back blank.
    sigma.refresh();

    const canvases = sigma.getCanvases();
    const reference = canvases.nodes || canvases.edges || Object.values(canvases)[0];
    if (!reference) throw new Error('exportSigmaToPng: sigma has no canvases');

    const dest = document.createElement('canvas');
    dest.width = reference.width;
    dest.height = reference.height;
    const ctx = dest.getContext('2d');
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, dest.width, dest.height);
    }
    // Skip the `mouse` layer — it carries the cursor reticle and selection
    // box, neither of which belong in an exported image.
    for (const layer of LAYER_ORDER) {
      const c = canvases[layer];
      if (c) ctx.drawImage(c, 0, 0);
    }

    // Once the pixels are on the 2D destination canvas they're stable, so the
    // async toBlob is safe at this point.
    const blob = await new Promise((resolve, reject) => {
      dest.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png');
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `hooks-graph-${timestamp()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } finally {
    restore();
  }
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}
