import apiFetch from '@wordpress/api-fetch';
import { Notice, Spinner } from '@wordpress/components';
import { DataForm } from '@wordpress/dataviews';
import { useEffect, useMemo, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Button, Stack } from '@wordpress/ui';

const fields = [
  {
    id: 'allow_read_files',
    label: __('Allow reading PHP files', 'hooksgraph'),
    description: __(
      'When enabled, the AI Assistant may read PHP files from installed plugins (optionally scoped to a line range) to investigate hook conflicts that the graph data alone cannot resolve. Disabled by default.',
      'hooksgraph'
    ),
    type: 'boolean',
  },
];

const stackedField = (id) => ({
  id,
  layout: { type: 'regular', labelPosition: 'side' },
});

const form = {
  type: 'regular',
  labelPosition: 'top',
  fields: [stackedField('allow_read_files')],
};

const initialData = { allow_read_files: false };

export default function SettingsView() {
  const [data, setData] = useState(initialData);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    let active = true;
    apiFetch({ path: '/hooksgraph/v1/settings' })
      .then((response) => {
        if (!active) return;
        setData({ allow_read_files: Boolean(response?.allow_read_files) });
        setStatus('ready');
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.message || __('Failed to load settings.', 'hooksgraph'));
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, []);

  const handleChange = (edits) => {
    setData((prev) => ({ ...prev, ...edits }));
    setSavedAt(null);
  };

  const handleSave = () => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    apiFetch({
      path: '/hooksgraph/v1/settings',
      method: 'POST',
      data: { allow_read_files: Boolean(data.allow_read_files) },
    })
      .then((response) => {
        setData({ allow_read_files: Boolean(response?.allow_read_files) });
        setSavedAt(Date.now());
      })
      .catch((err) => {
        setError(err?.message || __('Failed to save settings.', 'hooksgraph'));
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const content = useMemo(() => {
    if (status === 'loading') {
      return (
        <Stack alignment="center" spacing={4}>
          <Spinner />
        </Stack>
      );
    }

    if (status === 'error') {
      return (
        <Notice status="error" isDismissible={false}>
          <strong>{__('Could not load settings', 'hooksgraph')}</strong> — {error}
        </Notice>
      );
    }

    return (
      <Stack direction="column" gap="lg">
        {error && (
          <Notice status="error" onRemove={() => setError(null)}>
            {error}
          </Notice>
        )}
        {savedAt && !error && (
          <Notice status="success" onRemove={() => setSavedAt(null)}>
            {__('Settings saved.', 'hooksgraph')}
          </Notice>
        )}
        <DataForm data={data} fields={fields} form={form} onChange={handleChange} />
        <Stack direction="row" justify="end">
          <Button
            variant="solid"
            tone="brand"
            onClick={handleSave}
            loading={isSaving}
            disabled={isSaving}
          >
            {__('Save settings', 'hooksgraph')}
          </Button>
        </Stack>
      </Stack>
    );
  }, [status, error, data, isSaving, savedAt]);

  return <div className="hooksgraph-settings">{content}</div>;
}
