import { useEffect, useRef, useState } from 'react';
import {
  SIGMA_SIZING_DEFAULTS,
  SIGMA_SIZING_MIN,
  SIGMA_SIZING_MAX,
  SIGMA_VIEWPORT_SCALE_MIN,
  SIGMA_VIEWPORT_SCALE_MAX,
  SIGMA_EDGE_OPACITY_MIN,
  SIGMA_EDGE_OPACITY_MAX,
} from '../lib/constants';
import { hexToHue } from '../lib/color-palette';

// Lightweight in-canvas control panel for tuning sigma node sizing while
// you eyeball the graph. Lives next to the canvas (not in the sidebar) on
// purpose — once we settle on values, those become defaults in
// SIGMA_SIZING_DEFAULTS and this whole component goes away.
export default function SigmaSizingControls({
  sizing,
  onChange,
  sourceLabels = [],
  repoPalettes = {},
  setPaletteHueOverrides,
}) {
  const [open, setOpen] = useState(true);

  const set = (patch) => onChange({ ...sizing, ...patch });
  const reset = () => {
    onChange(SIGMA_SIZING_DEFAULTS);
    if (setPaletteHueOverrides) setPaletteHueOverrides({});
  };
  const logCurrent = () => {
    // eslint-disable-next-line no-console
    console.log('[sigma-sizing]', JSON.stringify(sizing, null, 2));
  };

  const onPickColor = (label, hex) => {
    if (!setPaletteHueOverrides) return;
    const h = hexToHue(hex);
    setPaletteHueOverrides((prev) => ({ ...prev, [label]: h }));
  };

  if (!open) {
    return (
      <button
        type="button"
        style={{ ...buttonStyle, ...togglePos }}
        onClick={() => setOpen(true)}
      >
        Sizing
      </button>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span>Sizing</span>
        <button type="button" style={closeStyle} onClick={() => setOpen(false)}>
          ×
        </button>
      </div>

      <div style={sectionLabelStyle}>Viewport (test)</div>
      <NumericSlider
        label="Viewport %"
        value={sizing.viewportScale}
        min={SIGMA_VIEWPORT_SCALE_MIN}
        max={SIGMA_VIEWPORT_SCALE_MAX}
        step={5}
        onChange={(v) => set({ viewportScale: v })}
      />
      <ColorRow
        label="Canvas bg"
        color={sizing.canvasBg}
        onCommit={(hex) => set({ canvasBg: hex })}
      />

      <div style={sectionLabelStyle}>Nodes</div>
      <Slider label="Hooks" value={sizing.hookScale} onChange={(v) => set({ hookScale: v })} />
      <Slider label="Files" value={sizing.fileScale} onChange={(v) => set({ fileScale: v })} />
      <Slider label="Classes" value={sizing.classScale} onChange={(v) => set({ classScale: v })} />
      <Slider label="Hub emphasis" value={sizing.hubEmphasis} onChange={(v) => set({ hubEmphasis: v })} />

      <Toggle
        label="Reveal on zoom"
        checked={sizing.zoomResponse}
        onChange={(v) => set({ zoomResponse: v })}
      />
      <Toggle
        label="Density compensation"
        checked={sizing.densityCompensation}
        onChange={(v) => set({ densityCompensation: v })}
      />

      <div style={sectionLabelStyle}>Edges</div>
      <NumericSlider
        label="Opacity %"
        value={sizing.edgeOpacity}
        min={SIGMA_EDGE_OPACITY_MIN}
        max={SIGMA_EDGE_OPACITY_MAX}
        step={5}
        onChange={(v) => set({ edgeOpacity: v })}
      />

      {sourceLabels.length > 0 && setPaletteHueOverrides && (
        <>
          <div style={sectionLabelStyle}>Source colors</div>
          {sourceLabels.map((label) => {
            const palette = repoPalettes[label];
            const swatch = palette ? palette.action : '#888888';
            return (
              <ColorRow
                key={label}
                label={label}
                color={swatch}
                onCommit={(hex) => onPickColor(label, hex)}
              />
            );
          })}
        </>
      )}

      <div style={footerStyle}>
        <button type="button" style={buttonStyle} onClick={reset}>
          Reset
        </button>
        <button type="button" style={buttonStyle} onClick={logCurrent}>
          Log values
        </button>
      </div>
    </div>
  );
}

function Slider({ label, value, onChange }) {
  return (
    <label style={rowStyle}>
      <div style={rowLabelStyle}>
        <span>{label}</span>
        <span style={valueStyle}>{value}%</span>
      </div>
      <input
        type="range"
        min={SIGMA_SIZING_MIN}
        max={SIGMA_SIZING_MAX}
        step={5}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        style={{ width: '100%' }}
      />
    </label>
  );
}

function NumericSlider({ label, value, min, max, step, onChange }) {
  return (
    <label style={rowStyle}>
      <div style={rowLabelStyle}>
        <span>{label}</span>
        <span style={valueStyle}>{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%' }}
      />
    </label>
  );
}

// React's synthetic onChange on <input type="color"> maps to the native
// `input` event, which fires continuously while the user drags in the picker
// — that would re-render the whole graph on every pixel. We attach a native
// `change` listener instead, which only fires when the picker dialog closes
// (i.e. on commit). defaultValue (not value) lets the input track its own
// state during the drag, and we sync from the upstream `color` prop via a
// ref-driven effect when it changes from outside.
function ColorRow({ label, color, onCommit }) {
  const inputRef = useRef(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handler = (e) => onCommit(e.target.value);
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, [onCommit]);

  useEffect(() => {
    if (inputRef.current && inputRef.current.value !== color) {
      inputRef.current.value = color;
    }
  }, [color]);

  return (
    <label style={colorRowStyle}>
      <span style={colorLabelStyle} title={label}>
        {label}
      </span>
      <input
        ref={inputRef}
        type="color"
        defaultValue={color}
        style={colorInputStyle}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label style={toggleRowStyle}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

const panelStyle = {
  position: 'absolute',
  top: 12,
  right: 12,
  zIndex: 10,
  width: 220,
  padding: 12,
  background: 'rgba(255, 255, 255, 0.95)',
  border: '1px solid #ddd',
  borderRadius: 8,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
  fontSize: 12,
  fontFamily: 'system-ui, sans-serif',
  color: '#1e1a24',
};

const togglePos = { position: 'absolute', top: 12, right: 12, zIndex: 10 };

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontWeight: 600,
  marginBottom: 8,
};

const closeStyle = {
  background: 'transparent',
  border: 'none',
  fontSize: 18,
  lineHeight: 1,
  cursor: 'pointer',
  padding: 0,
  color: '#666',
};

const rowStyle = { display: 'block', marginBottom: 8 };
const rowLabelStyle = { display: 'flex', justifyContent: 'space-between', marginBottom: 2 };
const valueStyle = { color: '#666', fontVariantNumeric: 'tabular-nums' };

const toggleRowStyle = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  marginBottom: 6,
  cursor: 'pointer',
};

const footerStyle = { display: 'flex', gap: 6, marginTop: 8 };

const sectionLabelStyle = {
  fontWeight: 600,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: '#666',
  marginTop: 10,
  marginBottom: 4,
};


const colorRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 4,
};

const colorLabelStyle = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 11,
};

const colorInputStyle = {
  width: 28,
  height: 20,
  padding: 0,
  border: '1px solid #ccc',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
};

const buttonStyle = {
  flex: 1,
  padding: '4px 8px',
  fontSize: 12,
  border: '1px solid #ccc',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
};
