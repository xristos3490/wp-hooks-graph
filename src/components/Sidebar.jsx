import { useMemo, useCallback, useRef } from 'react';
import { DataForm } from '@wordpress/dataviews';
import { Button } from '@wordpress/ui';
import { useGraphContext } from '../context/GraphContext';
import Logo from './Logo';

export default function Sidebar() {
  const {
    data,
    sourceLabels,
    filterState,
    maxConnections,
    toggleHookType,
    toggleBoolFilter,
    toggleRepo,
    toggleHighTraffic,
    setHighTrafficValue,
    loadFile,
  } = useGraphContext();

  const fileInputRef = useRef(null);

  const meta = data.metadata;
  const hookNodes = data.nodes.filter((n) => n.type === 'hook');
  const overlapCount = hookNodes.filter((n) => n.overlap).length;

  const repoCount = sourceLabels.length;
  const subtitleText =
    repoCount === 1
      ? sourceLabels[0]
      : sourceLabels[0] + ' + ' + (repoCount - 1) + ' repo' + (repoCount > 2 ? 's' : '');

  // Flatten nested filterState into a single object for DataForm
  const formData = useMemo(() => {
    const flat = {
      actions: filterState.hookType.actions,
      filters: filterState.hookType.filters,
      dynamic: filterState.dynamic,
      overlapping: filterState.overlapping,
      hotspots: filterState.highTraffic.enabled,
      minConnections: filterState.highTraffic.minConnections,
    };
    sourceLabels.forEach((label) => {
      flat[`repo__${label}`] = filterState.repos[label] !== false;
    });
    return flat;
  }, [filterState, sourceLabels]);

  // Bridge DataForm onChange back to the existing reducer dispatches
  const handleChange = useCallback((changes) => {
    Object.entries(changes).forEach(([key, value]) => {
      if (key === 'actions' || key === 'filters') {
        toggleHookType(key);
      } else if (key === 'dynamic' || key === 'overlapping') {
        toggleBoolFilter(key);
      } else if (key === 'hotspots') {
        toggleHighTraffic();
      } else if (key === 'minConnections') {
        setHighTrafficValue(value);
      } else if (key.startsWith('repo__')) {
        toggleRepo(key.slice(6));
      }
    });
  }, [toggleHookType, toggleBoolFilter, toggleHighTraffic, setHighTrafficValue, toggleRepo]);

  // ---------------------------------------------------------------------------
  // Fields — atomic data: type, edit control, display formatting, validation
  // ---------------------------------------------------------------------------
  const fields = useMemo(() => {
    const f = [
      // Hook type toggles
      {
        id: 'actions',
        label: 'Actions',
        description: 'Hooks that trigger behavior at key points',
        type: 'boolean',
        Edit: 'toggle',
      },
      {
        id: 'filters',
        label: 'Filters',
        description: 'Hooks that transform data in transit',
        type: 'boolean',
        Edit: 'toggle',
      },

      // Focus toggles
      {
        id: 'dynamic',
        label: 'Dynamic',
        description: 'Names generated at runtime',
        type: 'boolean',
        Edit: 'toggle',
      },
      {
        id: 'overlapping',
        label: 'Overlapping',
        description: 'Found in more than one repo',
        type: 'boolean',
        Edit: 'toggle',
      },

      // Hotspot controls
      {
        id: 'hotspots',
        label: 'Hotspots',
        description: 'Surface the busiest hooks',
        type: 'boolean',
        Edit: 'toggle',
      },
      {
        id: 'minConnections',
        label: 'Threshold',
        description: 'Minimum connections to include',
        type: 'integer',
        Edit: 'integer',
        placeholder: `1–${maxConnections}`,
        isValid: { min: 1, max: maxConnections },
        isDisabled: ({ item }) => !item.hotspots,
      },

      // Summary fields — display-only, used by card headers
      {
        id: 'hook_types_summary',
        type: 'text',
        label: '',
        readOnly: true,
        getValue: ({ item }) => {
          if (item.actions && item.filters) return 'All';
          if (item.actions) return 'Actions only';
          if (item.filters) return 'Filters only';
          return 'None';
        },
      },
      {
        id: 'hotspots_summary',
        type: 'text',
        label: '',
        readOnly: true,
        getValue: ({ item }) =>
          item.hotspots ? `≥ ${item.minConnections} connections` : 'Off',
      },
      {
        id: 'sources_summary',
        type: 'text',
        label: '',
        readOnly: true,
        getValue: ({ item }) => {
          const active = sourceLabels.filter((l) => item[`repo__${l}`] !== false).length;
          return `${active} of ${sourceLabels.length}`;
        },
      },
    ];

    // One toggle per scanned repo
    sourceLabels.forEach((label) => {
      f.push({
        id: `repo__${label}`,
        label,
        type: 'boolean',
        Edit: 'toggle',
      });
    });

    return f;
  }, [meta.overlap_filter, maxConnections, sourceLabels]);

  // ---------------------------------------------------------------------------
  // Form — structural layout: card grouping, summaries, nested overrides
  // ---------------------------------------------------------------------------
  const form = useMemo(() => ({
    fields: [
      {
        id: 'hook-types',
        label: 'Hook Types',
        description: 'Actions, filters, or both',
        layout: { type: 'card', summary: 'hook_types_summary' },
        children: ['actions', 'filters'],
      },
      {
        id: 'focus',
        label: 'Focus',
        description: 'Narrow what\u2019s visible',
        layout: { type: 'card', isOpened: false },
        children: meta.overlap_filter
          ? ['dynamic']
          : ['dynamic', 'overlapping'],
      },
      {
        id: 'hotspots-group',
        label: 'Hotspots',
        description: 'Find the most connected hooks',
        layout: { type: 'card', isOpened: false, summary: 'hotspots_summary' },
        children: [
          'hotspots',
          {
            id: 'minConnections',
            layout: { type: 'regular', labelPosition: 'top' },
          },
        ],
      },
      {
        id: 'sources',
        label: 'Sources',
        description: 'Scanned repositories',
        layout: { type: 'card', summary: 'sources_summary' },
        children: sourceLabels.map((label) => `repo__${label}`),
      },
    ],
  }), [sourceLabels, meta.overlap_filter]);

  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <Logo />
        <p className="sidebar__subtitle">{subtitleText}</p>
        <div className="sidebar__stats">
          <StatCell number={meta.total_files} label="FILES" />
          <StatCell number={meta.total_hooks} label="HOOKS" />
          <StatCell number={meta.dynamic_hooks} label="DYNAMIC" />
          <StatCell number={overlapCount} label="OVERLAP" />
        </div>
      </div>
      <DataForm
        data={formData}
        fields={fields}
        form={form}
        onChange={handleChange}
      />
      <Button
        variant="minimal"
        tone="neutral"
        className="sidebar__load-btn"
        onClick={() => fileInputRef.current?.click()}
      >
        Load JSON file
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={(e) => { const f = e.target.files[0]; if (f) loadFile(f); }}
        style={{ display: 'none' }}
      />
    </aside>
  );
}

function StatCell({ number, label }) {
  return (
    <div className="stat-cell">
      <span className="stat-cell__value">{number.toLocaleString()}</span>
      <span className="stat-cell__label">{label}</span>
    </div>
  );
}
