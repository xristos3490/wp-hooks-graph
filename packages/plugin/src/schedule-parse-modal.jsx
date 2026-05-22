import { DataForm } from '@wordpress/dataviews';
import { useMemo, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';
import { Button, Stack, Text } from '@wordpress/ui';

const stripTags = (html) => (typeof html === 'string' ? html.replace(/<[^>]*>/g, '').trim() : '');

const formatTimestamp = (iso) => {
  if (!iso) return __('Never', 'hooksgraph');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const splitPatterns = (raw) =>
  String(raw ?? '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

const fields = [
  {
    id: 'last_parsed_at',
    label: __('Last parsed', 'hooksgraph'),
    type: 'text',
    readOnly: true,
    render: ({ item }) => <Text>{item.last_parsed_at}</Text>,
  },
  {
    id: 'plugin_version',
    label: __('Plugin version', 'hooksgraph'),
    type: 'text',
    readOnly: true,
    render: ({ item }) => <Text>{item.plugin_version || '—'}</Text>,
  },
  {
    id: 'exclude',
    label: __('Exclude folders & files', 'hooksgraph'),
    description: __(
      'One pattern per line, or comma-separated. Plain names match anywhere in the path or basename (e.g. "tests"); patterns with "/" match only as exact sub-paths (e.g. "packages/e2e-tests").',
      'hooksgraph'
    ),
    type: 'text',
    Edit: 'textarea',
    placeholder: 'tests\nvendor\nnode_modules',
  },
];

const stackedField = (id) => ({
  id,
  layout: { type: 'regular', labelPosition: 'top' },
});

const form = {
  type: 'regular',
  labelPosition: 'top',
  fields: [stackedField('last_parsed_at'), stackedField('plugin_version'), stackedField('exclude')],
};

export default function ScheduleParseModal({ plugin, isSubmitting, error, onSubmit, onClose }) {
  const initialExclude = useMemo(() => (plugin?.exclude ?? []).join('\n'), [plugin]);

  const [data, setData] = useState(() => ({
    last_parsed_at: formatTimestamp(plugin?.last_parsed_at),
    plugin_version: plugin?.version ?? '',
    exclude: initialExclude,
  }));

  const handleChange = (edits) => setData((prev) => ({ ...prev, ...edits }));

  const handleSubmit = () => {
    if (isSubmitting) return;
    onSubmit(splitPatterns(data.exclude));
  };

  return (
    <Stack direction="column" gap="lg">
      <Text variant="muted">
        {stripTags(plugin?.name ?? '')}
      </Text>
      <DataForm data={data} fields={fields} form={form} onChange={handleChange} />
      {error && (
        <Notice status="error" isDismissible={false}>
          {error}
        </Notice>
      )}
      <Stack direction="row" justify="end" gap="sm">
        <Button variant="minimal" tone="neutral" onClick={onClose} disabled={isSubmitting}>
          {__('Cancel', 'hooksgraph')}
        </Button>
        <Button
          variant="solid"
          tone="brand"
          onClick={handleSubmit}
          loading={isSubmitting}
          disabled={isSubmitting}
        >
          {__('Schedule parse', 'hooksgraph')}
        </Button>
      </Stack>
    </Stack>
  );
}
