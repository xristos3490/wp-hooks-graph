import { useMemo, useCallback, useRef } from 'react';
import { DataForm } from '@wordpress/dataviews';
import { Button, Stack, Text } from '@wordpress/ui';
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
    toggleFireRepo,
    toggleListenRepo,
    toggleHighTraffic,
    setHighTrafficValue,
    loadFile,
  } = useGraphContext();

  const fileInputRef = useRef(null);

  const meta = data.metadata;
  const hookNodes = data.nodes.filter((n) => n.type === 'hook');
  const overlapCount = hookNodes.filter((n) => n.overlap).length;

  const repoCount = sourceLabels.length;
  const metadataLine = useMemo(() => {
    const repoPart = repoCount === 1 ? sourceLabels[0] : `${repoCount} repos`;
    const parts = [
      repoPart,
      `${meta.total_hooks.toLocaleString()} hooks`,
    ];
    if (meta.dynamic_hooks > 0) parts.push(`${meta.dynamic_hooks.toLocaleString()} dynamic`);
    if (overlapCount > 0) parts.push(`${overlapCount.toLocaleString()} overlap`);
    return parts.join(' · ');
  }, [repoCount, sourceLabels, meta.total_hooks, meta.dynamic_hooks, overlapCount]);

  // Flatten nested filterState into a single object for DataForm
  const formData = useMemo(() => {
    const flat = {
      actions: filterState.hookType.actions,
      filters: filterState.hookType.filters,
      dynamic: filterState.dynamic,
      overlapping: filterState.overlapping,
      includeFireOnly: filterState.includeFireOnly,
      includeListenOnly: filterState.includeListenOnly,
      hotspots: filterState.highTraffic.enabled,
      minConnections: filterState.highTraffic.minConnections,
    };
    sourceLabels.forEach((label) => {
      flat[`fire_repo__${label}`] = filterState.fireRepos[label] !== false;
      flat[`listen_repo__${label}`] = filterState.listenRepos[label] !== false;
    });
    return flat;
  }, [filterState, sourceLabels]);

  // Bridge DataForm onChange back to the existing reducer dispatches
  const handleChange = useCallback((changes) => {
    Object.entries(changes).forEach(([key, value]) => {
      if (key === 'actions' || key === 'filters') {
        toggleHookType(key);
      } else if (
        key === 'dynamic' ||
        key === 'overlapping' ||
        key === 'includeFireOnly' ||
        key === 'includeListenOnly'
      ) {
        toggleBoolFilter(key);
      } else if (key === 'hotspots') {
        toggleHighTraffic();
      } else if (key === 'minConnections') {
        setHighTrafficValue(value);
      } else if (key.startsWith('fire_repo__')) {
        toggleFireRepo(key.slice('fire_repo__'.length));
      } else if (key.startsWith('listen_repo__')) {
        toggleListenRepo(key.slice('listen_repo__'.length));
      }
    });
  }, [toggleHookType, toggleBoolFilter, toggleHighTraffic, setHighTrafficValue, toggleFireRepo, toggleListenRepo]);

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

      // Orphan opt-ins — raw-data one-sided hooks
      {
        id: 'includeFireOnly',
        label: 'Include fire-only hooks',
        description: 'Hooks fired in the scan with no listener found anywhere',
        type: 'boolean',
        Edit: 'toggle',
      },
      {
        id: 'includeListenOnly',
        label: 'Include listen-only hooks',
        description: 'Hooks listened to with no fire location found anywhere',
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
          const f = sourceLabels.filter((l) => item[`fire_repo__${l}`] !== false).length;
          const n = sourceLabels.filter((l) => item[`listen_repo__${l}`] !== false).length;
          return `${f}/${sourceLabels.length} fires · ${n}/${sourceLabels.length} listens`;
        },
      },
    ];

    sourceLabels.forEach((label) => {
      f.push({
        id: `fire_repo__${label}`,
        label: 'fires',
        description: `Hooks fired in ${label}`,
        type: 'boolean',
        Edit: 'toggle',
      });
      f.push({
        id: `listen_repo__${label}`,
        label: 'listens',
        description: `Hooks listened to in ${label}`,
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
        children: (meta.overlap_filter || sourceLabels.length <= 1)
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
        description: 'Fire and listen sources per scanned repo',
        layout: { type: 'card', summary: 'sources_summary' },
        children: [
          ...sourceLabels.map((label) => ({
            id: `source-row__${label}`,
            label,
            layout: { type: 'row' },
            children: [`fire_repo__${label}`, `listen_repo__${label}`],
          })),
          {
            id: 'sources-orphans',
            label: 'One-sided hooks',
            layout: { type: 'regular' },
            children: ['includeFireOnly', 'includeListenOnly'],
          },
        ],
      },
    ],
  }), [sourceLabels, meta.overlap_filter]);

  return (
    <aside className="sidebar">
      <header className="sidebar__header">
        <Stack gap="sm">
          <Logo />
          <Text variant="body-sm">{metadataLine}</Text>
        </Stack>
      </header>
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
