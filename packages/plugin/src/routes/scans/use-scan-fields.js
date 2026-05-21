import { dateI18n } from '@wordpress/date';
import { useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Badge, Stack } from '@wordpress/ui';

const stripTags = (html) => (typeof html === 'string' ? html.replace(/<[^>]*>/g, '').trim() : '');

const formatDate = (value) => {
  if (!value) return '';
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return '';
  return dateI18n('M j, Y g:i a', value);
};

const STATUS_LABELS = {
  queued: __('Queued', 'hooksgraph'),
  finding_conflicts: __('Finding conflicts', 'hooksgraph'),
  triaging: __('Triaging', 'hooksgraph'),
  completed: __('Completed', 'hooksgraph'),
  failed: __('Failed', 'hooksgraph'),
};

// Valid @wordpress/ui Badge intents:
// 'high' | 'medium' | 'low' | 'stable' | 'informational' | 'draft' | 'none'.
const STATUS_INTENTS = {
  queued: 'draft',
  finding_conflicts: 'informational',
  triaging: 'informational',
  completed: 'stable',
  failed: 'high',
};

const STATUS_ELEMENTS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

const FRESHNESS_LABELS = {
  fresh: __('Fresh', 'hooksgraph'),
  stale: __('Stale', 'hooksgraph'),
  missing: __('Missing', 'hooksgraph'),
};

const FRESHNESS_INTENTS = {
  fresh: 'stable',
  stale: 'medium',
  missing: 'high',
};

const FRESHNESS_ELEMENTS = Object.entries(FRESHNESS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const getTitle = (item) => {
  const raw = item?.title?.rendered ?? item?.title?.raw ?? item?.title ?? '';
  return stripTags(typeof raw === 'string' ? raw : '');
};

export function useScanFields() {
  return useMemo(
    () => [
      {
        id: 'title',
        label: __('Title', 'hooksgraph'),
        enableGlobalSearch: true,
        enableSorting: true,
        getValue: ({ item }) => getTitle(item) || `#${item.id}`,
        render: ({ item }) => getTitle(item) || `#${item.id}`,
      },
      {
        id: 'status',
        label: __('Status', 'hooksgraph'),
        enableSorting: false,
        elements: STATUS_ELEMENTS,
        getValue: ({ item }) => item.status ?? '',
        render: ({ item }) => {
          const status = item.status;
          if (!status) {
            return null;
          }
          return (
            <Badge intent={STATUS_INTENTS[status] ?? 'none'}>
              {STATUS_LABELS[status] ?? status}
            </Badge>
          );
        },
      },
      {
        id: 'plugins',
        label: __('Plugins', 'hooksgraph'),
        enableGlobalSearch: true,
        getValue: ({ item }) => (Array.isArray(item.plugins) ? item.plugins.join(', ') : ''),
        render: ({ item }) => {
          const plugins = Array.isArray(item.plugins) ? item.plugins : [];
          if (plugins.length === 0) {
            return '—';
          }
          return (
            <Stack direction="column" gap="xs" align="flex-start">
              {plugins.map((p) => (
                <Badge key={p} intent="none">
                  {p}
                </Badge>
              ))}
            </Stack>
          );
        },
      },
      {
        id: 'progress',
        label: __('Progress', 'hooksgraph'),
        enableSorting: true,
        getValue: ({ item }) => {
          const p = item?.progress;
          const total = p?.total_pairs ?? 0;
          if (total <= 0) return 0;
          const done = (p?.completed_pairs ?? 0) + (p?.failed_pairs ?? 0);
          return Math.round((done / total) * 100);
        },
        render: ({ item }) => {
          const p = item?.progress;
          const total = p?.total_pairs ?? 0;
          if (total <= 0) {
            return item.status === 'completed' ? '100%' : '—';
          }
          const done = (p?.completed_pairs ?? 0) + (p?.failed_pairs ?? 0);
          const pct = Math.round((done / total) * 100);
          return `${pct}% (${done}/${total})`;
        },
      },
      {
        id: 'summary',
        label: __('Findings', 'hooksgraph'),
        enableSorting: false,
        getValue: ({ item }) => {
          const s = item?.result?.summary;
          if (!s) return '';
          return `${s.critical ?? 0}/${s.warning ?? 0}/${s.none ?? 0}/${s.error ?? 0}`;
        },
        render: ({ item }) => {
          const s = item?.result?.summary;
          if (!s) return '—';
          const critical = s.critical ?? 0;
          const warning = s.warning ?? 0;
          const none = s.none ?? 0;
          const errors = s.error ?? 0;
          return (
            <Stack direction="row" gap="xs" wrap>
              <Badge intent="high">
                {/* translators: %d count of critical findings. */}
                {`${critical} ${__('critical', 'hooksgraph')}`}
              </Badge>
              <Badge intent="medium">
                {`${warning} ${__('warning', 'hooksgraph')}`}
              </Badge>
              <Badge intent="stable">
                {`${none} ${__('none', 'hooksgraph')}`}
              </Badge>
              {errors > 0 && (
                <Badge intent="high">
                  {`${errors} ${__('error', 'hooksgraph')}`}
                </Badge>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'started_at',
        label: __('Started', 'hooksgraph'),
        enableSorting: true,
        getValue: ({ item }) => item.started_at ?? '',
        render: ({ item }) => formatDate(item.started_at) || '—',
      },
      {
        id: 'finished_at',
        label: __('Finished', 'hooksgraph'),
        enableSorting: true,
        getValue: ({ item }) => item.finished_at ?? '',
        render: ({ item }) => formatDate(item.finished_at) || '—',
      },
      {
        id: 'freshness',
        label: __('Freshness', 'hooksgraph'),
        enableSorting: false,
        elements: FRESHNESS_ELEMENTS,
        getValue: ({ item }) => item.freshness ?? '',
        render: ({ item }) => {
          const f = item.freshness;
          if (!f) return null;
          return (
            <Badge intent={FRESHNESS_INTENTS[f] ?? 'none'}>
              {FRESHNESS_LABELS[f] ?? f}
            </Badge>
          );
        },
      },
    ],
    []
  );
}
