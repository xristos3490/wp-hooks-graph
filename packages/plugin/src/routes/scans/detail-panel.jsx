import { Icon, chevronLeft } from '@wordpress/icons';
import { useEntityRecord } from '@wordpress/core-data';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import { useMemo, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';
import { Badge, Button, Stack, Text } from '@wordpress/ui';

const VERDICT_INTENTS = {
  critical: 'high',
  warning: 'medium',
  none: 'stable',
  error: 'high',
};

const VERDICT_LABELS = {
  critical: __('Critical', 'hooksgraph'),
  warning: __('Warning', 'hooksgraph'),
  none: __('None', 'hooksgraph'),
  error: __('Error', 'hooksgraph'),
};

const CONFIDENCE_INTENTS = {
  high: 'stable',
  medium: 'medium',
  low: 'draft',
};

// Severity rank — used to drive the default sort so critical findings surface
// first. DataViews's sort UI still works; this is just the initial order.
const SEVERITY_RANK = {
  critical: 0,
  warning: 1,
  error: 2,
  none: 3,
};

const findingFields = [
  {
    id: 'verdict',
    label: __('Verdict', 'hooksgraph'),
    elements: Object.entries(VERDICT_LABELS).map(([value, label]) => ({ value, label })),
    // Return a numeric severity rank so DataViews's built-in sort orders
    // critical > warning > error > none. The label badge still renders below.
    getValue: ({ item }) => SEVERITY_RANK[item.verdict] ?? 99,
    render: ({ item }) => {
      const v = item.verdict;
      if (!v) return '—';
      return <Badge intent={VERDICT_INTENTS[v] ?? 'none'}>{VERDICT_LABELS[v] ?? v}</Badge>;
    },
  },
  {
    id: 'hook',
    label: __('Hook', 'hooksgraph'),
    enableGlobalSearch: true,
    getValue: ({ item }) => item.hook ?? '',
    render: ({ item }) => (
      <Text>
        <code>{item.hook}</code>
        {typeof item.priority === 'number' ? ` @ ${item.priority}` : ''}
      </Text>
    ),
  },
  {
    id: 'confidence',
    label: __('Confidence', 'hooksgraph'),
    getValue: ({ item }) => item.confidence ?? '',
    render: ({ item }) => {
      const c = item.confidence;
      if (!c) return '—';
      return <Badge intent={CONFIDENCE_INTENTS[c] ?? 'none'}>{c}</Badge>;
    },
  },
  {
    id: 'listeners',
    label: __('Listeners', 'hooksgraph'),
    enableSorting: false,
    getValue: ({ item }) => {
      const pair = Array.isArray(item.pair) ? item.pair : [];
      return pair.map((l) => `${l.plugin}:${l.callback}`).join(' vs ');
    },
    render: ({ item }) => {
      const pair = Array.isArray(item.pair) ? item.pair : [];
      if (pair.length === 0) return '—';
      return (
        <Stack direction="column" gap="xs" align="flex-start">
          {pair.map((l, idx) => (
            <Text key={`${l.plugin}-${l.callback}-${idx}`}>
              <strong>{l.plugin}</strong> — <code>{l.callback}</code>
              {l.file ? ` (${l.file}${l.line ? `:${l.line}` : ''})` : ''}
              {l.return_origin ? ` · return: ${l.return_origin}` : ''}
            </Text>
          ))}
        </Stack>
      );
    },
  },
  {
    id: 'rationale',
    label: __('Rationale', 'hooksgraph'),
    enableSorting: false,
    getValue: ({ item }) => item.rationale ?? '',
    render: ({ item }) => (
      <div className="hooksgraph-scans__rationale-cell">
        {item.rationale || item.error || '—'}
      </div>
    ),
  },
];

const DEFAULT_FINDING_VIEW = {
  type: 'table',
  fields: ['hook', 'confidence', 'listeners', 'rationale'],
  titleField: 'verdict',
  page: 1,
  perPage: 100,
  search: '',
  filters: [],
  sort: { field: 'verdict', direction: 'asc' },
};

export default function ScanDetailView({ scanId, onBack }) {
  const [view, setView] = useState(DEFAULT_FINDING_VIEW);

  const { record, isResolving } = useEntityRecord('postType', 'hg_scan', scanId);

  const status = record?.status;

  const findings = useMemo(() => {
    const list = record?.result?.findings;
    return Array.isArray(list) ? list : [];
  }, [record]);

  const { data: rows, paginationInfo } = useMemo(
    () => filterSortAndPaginate(findings, view, findingFields),
    [findings, view]
  );

  const freshness = record?.freshness;
  const triageSkipped = Boolean(record?.result?.triage_skipped);
  const priorityConflicts = Array.isArray(record?.result?.priority_conflicts)
    ? record.result.priority_conflicts
    : [];

  const title = record?.title?.rendered || record?.title?.raw || __('Scan', 'hooksgraph');

  return (
    <div className="hooksgraph-scans__detail">
      <DataViews
        data={rows}
        fields={findingFields}
        view={view}
        onChangeView={setView}
        paginationInfo={paginationInfo}
        defaultLayouts={{ table: {} }}
        getItemId={(item) => item.id ?? `${item.hook}#${item.priority}`}
        actions={[]}
        isLoading={isResolving && !record}
      >
        <Stack
          className="hooksgraph-scans__view-actions"
          direction="row"
          justify="space-between"
          align="center"
          gap="sm"
        >
          <Stack direction="row" align="center" gap="xs">
            <Button variant="minimal" onClick={onBack} icon={<Icon icon={chevronLeft} />}>
              {__('Back to scans', 'hooksgraph')}
            </Button>
            <Text weight="600">{title}</Text>
          </Stack>
          <Stack direction="row" align="center" gap="xs">
            <DataViews.Search />
            <DataViews.FiltersToggle />
            <DataViews.ViewConfig />
          </Stack>
        </Stack>
        <Stack
          className="hooksgraph-scans__detail-meta"
          direction="column"
          gap="md"
        >
          {freshness && freshness !== 'fresh' && (
            <Notice
              status={freshness === 'missing' ? 'error' : 'warning'}
              isDismissible={false}
            >
              <strong>
                {freshness === 'missing'
                  ? __('One or more scanned plugins are no longer available', 'hooksgraph')
                  : __('Re-run scan', 'hooksgraph')}
              </strong>
              <p>
                {freshness === 'missing'
                  ? __(
                      'A plugin in this scan is no longer active or has no parsed data. The findings may no longer apply.',
                      'hooksgraph'
                    )
                  : __(
                      'One or more plugins have changed since this scan ran. Re-run to refresh the findings.',
                      'hooksgraph'
                    )}
              </p>
            </Notice>
          )}
          {record?.error && (
            <Notice status="error" isDismissible={false}>
              <strong>{__('Scan failed', 'hooksgraph')}</strong>
              <p>{record.error}</p>
            </Notice>
          )}
          {triageSkipped && (
            <Notice status="info" isDismissible={false}>
              <strong>{__('AI triage skipped', 'hooksgraph')}</strong>
              <p>
                {__(
                  'File reading is disabled in Settings, so no verdicts or rationales were generated. The list below shows only the priority-conflict pairs detected from the parsed graph.',
                  'hooksgraph'
                )}
              </p>
            </Notice>
          )}
          <Stack direction="row" gap="sm" wrap>
            <Badge intent="informational">
              {sprintf(
                /* translators: %s: scan status. */
                __('Status: %s', 'hooksgraph'),
                status ?? '—'
              )}
            </Badge>
            {record?.progress && (
              <Badge intent="none">
                {sprintf(
                  /* translators: 1: completed, 2: total. */
                  __('Progress: %1$d/%2$d', 'hooksgraph'),
                  record.progress.completed_pairs ?? 0,
                  record.progress.total_pairs ?? 0
                )}
              </Badge>
            )}
            {priorityConflicts.length > 0 && (
              <Badge intent="none">
                {sprintf(
                  /* translators: %d: number of conflict groups. */
                  __('Conflict groups: %d', 'hooksgraph'),
                  priorityConflicts.length
                )}
              </Badge>
            )}
          </Stack>
        </Stack>
        <DataViews.FiltersToggled className="dataviews-filters__container" />
        <DataViews.Layout />
        <DataViews.Footer />
      </DataViews>
    </div>
  );
}
