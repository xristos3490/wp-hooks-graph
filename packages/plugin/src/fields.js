import { dateI18n } from '@wordpress/date';
import { __ } from '@wordpress/i18n';
import { Badge } from '@wordpress/ui';

const stripTags = (html) => (typeof html === 'string' ? html.replace(/<[^>]*>/g, '').trim() : '');

const formatNumber = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }
  try {
    return value.toLocaleString();
  } catch {
    return String(value);
  }
};

const formatDate = (value) => {
  if (!value) return '';
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return '';
  return dateI18n('M j, Y g:i a', value);
};

const STATUS_LABELS = {
  parsed: __('Parsed', 'hooksgraph'),
  stale: __('Stale', 'hooksgraph'),
  needs_parsing: __('Needs parsing', 'hooksgraph'),
  scheduled: __('Scheduled', 'hooksgraph'),
};

// Map status → @wordpress/ui Badge intent. Valid intents are
// 'high' | 'medium' | 'low' | 'stable' | 'informational' | 'draft' | 'none'.
const STATUS_INTENTS = {
  parsed: 'stable',
  stale: 'medium',
  needs_parsing: 'draft',
  scheduled: 'informational',
};

export const fields = [
  {
    id: 'name',
    label: __('Plugin', 'hooksgraph'),
    enableGlobalSearch: true,
    enableSorting: true,
    getValue: ({ item }) => stripTags(item.name),
  },
  {
    id: 'version',
    label: __('Version', 'hooksgraph'),
    enableSorting: true,
  },
  {
    id: 'parse_status',
    label: __('Status', 'hooksgraph'),
    enableSorting: true,
    elements: Object.entries(STATUS_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
    getValue: ({ item }) => item.parse_status ?? '',
    render: ({ item }) => {
      const status = item.parse_status;
      if (!status) {
        return null;
      }
      return (
        <Badge intent={STATUS_INTENTS[status] ?? 'none'}>{STATUS_LABELS[status] ?? status}</Badge>
      );
    },
  },
  {
    id: 'parsed_at',
    label: __('Parsed at', 'hooksgraph'),
    enableSorting: true,
    getValue: ({ item }) => item.last_parsed_at ?? '',
    render: ({ item }) => formatDate(item.last_parsed_at) || '—',
  },
  {
    id: 'total_files',
    label: __('Files', 'hooksgraph'),
    enableSorting: true,
    getValue: ({ item }) => (typeof item.total_files === 'number' ? item.total_files : null),
    render: ({ item }) => formatNumber(item.total_files) || '—',
  },
  {
    id: 'total_hooks',
    label: __('Hooks', 'hooksgraph'),
    enableSorting: true,
    getValue: ({ item }) => (typeof item.total_hooks === 'number' ? item.total_hooks : null),
    render: ({ item }) => formatNumber(item.total_hooks) || '—',
  },
  {
    id: 'total_edges',
    label: __('Edges', 'hooksgraph'),
    enableSorting: true,
    getValue: ({ item }) => (typeof item.total_edges === 'number' ? item.total_edges : null),
    render: ({ item }) => formatNumber(item.total_edges) || '—',
  },
  {
    id: 'author',
    label: __('Author', 'hooksgraph'),
    enableGlobalSearch: true,
    enableSorting: true,
    getValue: ({ item }) => stripTags(item.author),
  },
  {
    id: 'description',
    label: __('Description', 'hooksgraph'),
    enableGlobalSearch: true,
    getValue: ({ item }) => stripTags(item.description?.raw ?? item.description ?? ''),
  },
  {
    id: 'requires_php',
    label: __('Requires PHP', 'hooksgraph'),
    enableSorting: true,
  },
];

export const defaultView = {
  type: 'table',
  titleField: 'name',
  descriptionField: 'description',
  fields: [
    'parse_status',
    'version',
    'parsed_at',
    'total_files',
    'total_hooks',
    'total_edges',
    'author',
    'requires_php',
  ],
  page: 1,
  perPage: 25,
  search: '',
  filters: [],
  sort: { field: 'name', direction: 'asc' },
};
