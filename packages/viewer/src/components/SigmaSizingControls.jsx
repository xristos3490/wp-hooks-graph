import { useState } from 'react';
import {
  SIGMA_SIZING_DEFAULTS,
  SIGMA_SIZING_MIN,
  SIGMA_SIZING_MAX,
  SIGMA_FOCUSED_EDGE_TYPES,
  SIGMA_FOCUSED_EDGE_SIZE_MIN,
  SIGMA_FOCUSED_EDGE_SIZE_MAX,
} from '../lib/constants';

// Lightweight in-canvas control panel for tuning sigma node sizing while
// you eyeball the graph. Lives next to the canvas (not in the sidebar) on
// purpose — once we settle on values, those become defaults in
// SIGMA_SIZING_DEFAULTS and this whole component goes away.
export default function SigmaSizingControls({ sizing, onChange }) {
  const [open, setOpen] = useState(true);

  const set = (patch) => onChange({ ...sizing, ...patch });
  const reset = () => onChange(SIGMA_SIZING_DEFAULTS);
  const logCurrent = () => {
    // eslint-disable-next-line no-console
    console.log('[sigma-sizing]', JSON.stringify(sizing, null, 2));
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
      <Select
        label="Fires type"
        value={sizing.fireEdgeType}
        options={SIGMA_FOCUSED_EDGE_TYPES}
        onChange={(v) => set({ fireEdgeType: v })}
      />
      <Select
        label="Listens type"
        value={sizing.listenEdgeType}
        options={SIGMA_FOCUSED_EDGE_TYPES}
        onChange={(v) => set({ listenEdgeType: v })}
      />

      <div style={sectionLabelStyle}>Focused edges</div>
      <NumericSlider
        label="Width"
        value={sizing.focusedEdgeSize}
        min={SIGMA_FOCUSED_EDGE_SIZE_MIN}
        max={SIGMA_FOCUSED_EDGE_SIZE_MAX}
        step={0.5}
        onChange={(v) => set({ focusedEdgeSize: v })}
      />
      <Select
        label="Fires type"
        value={sizing.focusedFireEdgeType}
        options={SIGMA_FOCUSED_EDGE_TYPES}
        onChange={(v) => set({ focusedFireEdgeType: v })}
      />
      <Select
        label="Listens type"
        value={sizing.focusedListenEdgeType}
        options={SIGMA_FOCUSED_EDGE_TYPES}
        onChange={(v) => set({ focusedListenEdgeType: v })}
      />

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

function Select({ label, value, options, onChange }) {
  return (
    <label style={rowStyle}>
      <div style={rowLabelStyle}>
        <span>{label}</span>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
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

const selectStyle = {
  width: '100%',
  padding: '3px 6px',
  fontSize: 12,
  border: '1px solid #ccc',
  borderRadius: 4,
  background: '#fff',
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
