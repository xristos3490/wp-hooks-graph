import { useMemo, useCallback, useRef } from 'react';
import { DataForm } from '@wordpress/dataviews';
import { Button, Stack, Text } from '@wordpress/ui';
import { useGraphContext } from '../context/GraphContext';
import Logo from './Logo';
import McpInstructionsDialog from './McpInstructionsDialog';
import GitHubLink from './GitHubLink';

function renderMetric({ item, field }) {
  return (
    <Text style={{ fontWeight: 'var(--wpds-typography-font-weight-medium)' }}>
      {field.getValue({ item })}
    </Text>
  );
}

const REPO_STATE_ELEMENTS = [
  { value: 'off', label: 'Off' },
  { value: 'fires', label: 'Fires' },
  { value: 'listens', label: 'Listens' },
  { value: 'both', label: 'Both' },
];

function encodeRepoState(fireOn, listenOn) {
  if (fireOn && listenOn) return 'both';
  if (fireOn) return 'fires';
  if (listenOn) return 'listens';
  return 'off';
}

function decodeRepoState(value) {
  return {
    fireOn: value === 'both' || value === 'fires',
    listenOn: value === 'both' || value === 'listens',
  };
}

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
    isBusy,
  } = useGraphContext();

  const fileInputRef = useRef(null);

  const meta = data.metadata;
  const hookNodes = data.nodes.filter((n) => n.type === 'hook');
  const overlapCount = hookNodes.filter((n) => n.overlap).length;
  const actionCount = hookNodes.filter((n) => n.hook_type === 'action').length;
  const filterCount = hookNodes.filter((n) => n.hook_type === 'filter').length;
  const fireEdgeCount = data.edges.filter((e) => e.type === 'fires').length;
  const listenEdgeCount = data.edges.filter((e) => e.type === 'listens').length;

  const scanDateFormatted = useMemo(() => {
    if (!meta.scan_date) return '—';
    const d = new Date(meta.scan_date);
    if (Number.isNaN(d.getTime())) return meta.scan_date;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [meta.scan_date]);

  const repoCount = sourceLabels.length;
  const metadataLine = useMemo(() => {
    const repoPart = repoCount === 1 ? sourceLabels[0] : `${repoCount} repos`;
    const parts = [repoPart, `${meta.total_hooks.toLocaleString()} hooks`];
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

      metric_files: (meta.total_files ?? 0).toLocaleString(),
      metric_hooks: meta.total_hooks.toLocaleString(),
      metric_actions: actionCount.toLocaleString(),
      metric_filters: filterCount.toLocaleString(),
      metric_dynamic: meta.dynamic_hooks.toLocaleString(),
      metric_overlap: overlapCount.toLocaleString(),
      metric_fires: fireEdgeCount.toLocaleString(),
      metric_listens: listenEdgeCount.toLocaleString(),
      metric_scan: scanDateFormatted,
    };
    sourceLabels.forEach((label) => {
      flat[`repo__${label}`] = encodeRepoState(
        filterState.fireRepos[label] !== false,
        filterState.listenRepos[label] !== false
      );
    });
    return flat;
  }, [
    filterState,
    sourceLabels,
    meta.total_files,
    meta.total_hooks,
    meta.dynamic_hooks,
    actionCount,
    filterCount,
    overlapCount,
    fireEdgeCount,
    listenEdgeCount,
    scanDateFormatted,
  ]);

  // Bridge DataForm onChange back to the existing reducer dispatches
  const handleChange = useCallback(
    (changes) => {
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
        } else if (key.startsWith('repo__')) {
          const label = key.slice('repo__'.length);
          const prev = decodeRepoState(formData[key]);
          const next = decodeRepoState(value);
          if (prev.fireOn !== next.fireOn) toggleFireRepo(label);
          if (prev.listenOn !== next.listenOn) toggleListenRepo(label);
        }
      });
    },
    [
      formData,
      toggleHookType,
      toggleBoolFilter,
      toggleHighTraffic,
      setHighTrafficValue,
      toggleFireRepo,
      toggleListenRepo,
    ]
  );

  // ---------------------------------------------------------------------------
  // Fields — atomic data: type, edit control, display formatting, validation
  // ---------------------------------------------------------------------------
  const fields = useMemo(() => {
    const f = [
      // Scan metrics — readOnly rows rendered via a custom Text render
      {
        id: 'metric_files',
        label: 'Files scanned',
        type: 'text',
        readOnly: true,
        render: renderMetric,
      },
      { id: 'metric_hooks', label: 'Hooks', type: 'text', readOnly: true, render: renderMetric },
      {
        id: 'metric_actions',
        label: 'Actions',
        type: 'text',
        readOnly: true,
        render: renderMetric,
      },
      {
        id: 'metric_filters',
        label: 'Filters',
        type: 'text',
        readOnly: true,
        render: renderMetric,
      },
      {
        id: 'metric_dynamic',
        label: 'Dynamic',
        type: 'text',
        readOnly: true,
        render: renderMetric,
      },
      {
        id: 'metric_overlap',
        label: 'Overlapping',
        type: 'text',
        readOnly: true,
        render: renderMetric,
      },
      {
        id: 'metric_fires',
        label: 'Fire calls',
        type: 'text',
        readOnly: true,
        render: renderMetric,
      },
      {
        id: 'metric_listens',
        label: 'Listeners',
        type: 'text',
        readOnly: true,
        render: renderMetric,
      },
      { id: 'metric_scan', label: 'Scanned', type: 'text', readOnly: true, render: renderMetric },

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
        id: 'metrics_summary',
        type: 'text',
        label: '',
        readOnly: true,
        getValue: ({ item }) => `${item.metric_files} files`,
      },
      {
        id: 'focus_summary',
        type: 'text',
        label: '',
        readOnly: true,
        getValue: ({ item }) => {
          const parts = [];
          if (item.dynamic) parts.push('Dynamic');
          if (!meta.overlap_filter && sourceLabels.length > 1 && item.overlapping) {
            parts.push('Overlapping');
          }
          return parts.length ? parts.join(' · ') : 'All';
        },
      },
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
        getValue: ({ item }) => (item.hotspots ? `≥ ${item.minConnections} connections` : 'Off'),
      },
      {
        id: 'sources_summary',
        type: 'text',
        label: '',
        readOnly: true,
        getValue: ({ item }) => {
          const f = sourceLabels.filter((l) => {
            const v = item[`repo__${l}`];
            return v === 'fires' || v === 'both';
          }).length;
          const n = sourceLabels.filter((l) => {
            const v = item[`repo__${l}`];
            return v === 'listens' || v === 'both';
          }).length;
          return `${f}/${sourceLabels.length} fires · ${n}/${sourceLabels.length} listens`;
        },
      },
    ];

    sourceLabels.forEach((label) => {
      f.push({
        id: `repo__${label}`,
        label,
        description: 'Show fires and/or listens from this repo',
        type: 'text',
        Edit: 'toggleGroup',
        elements: REPO_STATE_ELEMENTS,
      });
    });

    return f;
  }, [meta.overlap_filter, maxConnections, sourceLabels]);

  // ---------------------------------------------------------------------------
  // Form — structural layout: card grouping, summaries, nested overrides
  // ---------------------------------------------------------------------------
  const form = useMemo(() => {
    const summaryRow = (id) => ({ id, layout: { type: 'regular', labelPosition: 'top' } });
    const pairRow = (idA, idB) => ({
      id: `row__${idA}__${idB}`,
      layout: {
        type: 'row',
        styles: { [idA]: { flex: 1 }, [idB]: { flex: 1 } },
      },
      children: [summaryRow(idA), summaryRow(idB)],
    });
    const showOverlapRow = overlapCount > 0 && sourceLabels.length > 1;

    return {
      fields: [
        {
          id: 'metrics',
          label: 'Summary',
          layout: { type: 'card', isOpened: false, summary: 'metrics_summary' },
          children: [
            summaryRow('metric_files'),
            summaryRow('metric_scan'),
            pairRow('metric_hooks', 'metric_dynamic'),
            pairRow('metric_actions', 'metric_filters'),
            pairRow('metric_fires', 'metric_listens'),
            ...(showOverlapRow ? [summaryRow('metric_overlap')] : []),
          ],
        },
        {
          id: 'hook-types',
          label: 'Hook types',
          description: 'Actions, filters, or both',
          layout: { type: 'card', summary: 'hook_types_summary' },
          children: ['actions', 'filters'],
        },
        {
          id: 'focus',
          label: 'Focus',
          description: 'Narrow what\u2019s visible',
          layout: { type: 'card', isOpened: false, summary: 'focus_summary' },
          children:
            meta.overlap_filter || sourceLabels.length <= 1
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
            ...sourceLabels.map((label) => `repo__${label}`),
            {
              id: 'sources-orphans',
              label: 'One-sided hooks',
              layout: { type: 'regular' },
              children: ['includeFireOnly', 'includeListenOnly'],
            },
          ],
        },
      ],
    };
  }, [sourceLabels, meta.overlap_filter, overlapCount]);

  return (
    <aside className="sidebar">
      <header className="sidebar__header">
        <Stack direction="row" align="center" gap="sm">
          <Logo />
          <Text variant="body-sm">{metadataLine}</Text>
        </Stack>
      </header>
      <DataForm data={formData} fields={fields} form={form} onChange={handleChange} />
      <Button
        variant="minimal"
        tone="neutral"
        className="sidebar__load-btn"
        onClick={() => fileInputRef.current?.click()}
        disabled={isBusy}
      >
        Load JSON file
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={(e) => {
          const f = e.target.files[0];
          if (f) loadFile(f);
        }}
        style={{ display: 'none' }}
      />
      <McpInstructionsDialog disabled={isBusy} />
      <div className="sidebar__github">
        <GitHubLink />
      </div>
    </aside>
  );
}
