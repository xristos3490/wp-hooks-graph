import { store as coreStore, useEntityRecords } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { DataForm } from '@wordpress/dataviews';
import { useCallback, useMemo, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { Button, Dialog, Notice, Stack, Text } from '@wordpress/ui';

const defaultTitle = () =>
  `${__('Scan', 'hooksgraph')} — ${new Date().toISOString().slice(0, 10)}`;

const initialData = () => ({ plugins: [] });

// DataForm's built-in `Edit: 'select'` is single-value only; for a multi-pick
// with elements we ship a small custom Edit that renders one checkbox per
// option. Stays inside DataForm primitives (the memory note bars composing
// outside it, not inside a field's Edit).
function PluginsMultiEdit({ field, data, onChange }) {
  const value = Array.isArray(field.getValue({ item: data })) ? field.getValue({ item: data }) : [];
  const options = field.elements ?? [];

  const toggle = (val, checked) => {
    const next = checked ? [...value, val] : value.filter((v) => v !== val);
    onChange({ [field.id]: next });
  };

  if (options.length === 0) {
    return (
      <Text variant="muted">
        {__('No parsed plugins available.', 'hooksgraph')}
      </Text>
    );
  }

  return (
    <Stack direction="column" gap="xs">
      {options.map((opt) => (
        <label
          key={opt.value}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            checked={value.includes(opt.value)}
            onChange={(e) => toggle(opt.value, e.target.checked)}
          />
          <Text>{opt.label}</Text>
        </label>
      ))}
    </Stack>
  );
}

// DataForm is the only composition primitive in here, per the project's
// `feedback_dataform.md` memory note — no `@wordpress/ui` Card or
// `@wordpress/components` Panel composition wrapping the form.
export default function NewScanModal({ open, onOpenChange, refreshList }) {
  const [data, setData] = useState(initialData);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const { records: pluginRecords, isResolving } = useEntityRecords(
    'hooksgraph',
    'plugin',
    { _fields: 'id,name,parse_status', per_page: 100 }
  );

  // Eligible = the parsed JSON on disk is something the runner can actually
  // read. `stale` is intentionally included — the runner reads whatever the
  // active version's filename is and the freshness pill on the scan row will
  // flag it. Excluding stale would let the picker silently lose the most
  // common real-world case (plugin update between parse and scan).
  const pluginOptions = useMemo(() => {
    const list = Array.isArray(pluginRecords) ? pluginRecords : [];
    return list
      .filter((p) => p.parse_status === 'parsed' || p.parse_status === 'stale')
      .map((p) => ({ value: p.id, label: p.name ? `${p.name} (${p.id})` : p.id }));
  }, [pluginRecords]);

  const fields = useMemo(
    () => [
      {
        id: 'plugins',
        label: __('Plugins', 'hooksgraph'),
        elements: pluginOptions,
        Edit: PluginsMultiEdit,
        getValue: ({ item }) => item.plugins ?? [],
      },
    ],
    [pluginOptions]
  );

  const form = useMemo(
    () => ({
      type: 'regular',
      labelPosition: 'top',
      fields: ['plugins'],
    }),
    []
  );

  const { saveEntityRecord } = useDispatch(coreStore);

  const reset = useCallback(() => {
    setData(initialData());
    setError(null);
    setIsSaving(false);
  }, []);

  const handleOpenChange = useCallback(
    (next) => {
      if (!next) {
        reset();
      }
      onOpenChange?.(next);
    },
    [onOpenChange, reset]
  );

  const handleSubmit = useCallback(async () => {
    if (isSaving) return;
    const title = defaultTitle();
    const plugins = Array.isArray(data.plugins) ? data.plugins.filter(Boolean) : [];
    if (plugins.length < 2) {
      setError(
        sprintf(
          /* translators: %d: number of plugins currently picked. */
          __('Pick at least 2 plugins to scan (you picked %d).', 'hooksgraph'),
          plugins.length
        )
      );
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      await saveEntityRecord('postType', 'hg_scan', {
        title,
        status: 'publish',
        plugins,
      });
      refreshList?.();
      reset();
      onOpenChange?.(false);
    } catch (err) {
      setError(err?.message || __('Failed to create scan.', 'hooksgraph'));
    } finally {
      setIsSaving(false);
    }
  }, [data, isSaving, onOpenChange, refreshList, reset, saveEntityRecord]);

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Popup size="medium">
        <Dialog.Header>
          <Dialog.Title>{__('New scan', 'hooksgraph')}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Content>
          <Stack direction="column" gap="md">
            {error && (
              <Notice.Root variant="error">
                <Notice.Description>{error}</Notice.Description>
              </Notice.Root>
            )}
            <DataForm data={data} fields={fields} form={form} onChange={(edits) => setData((prev) => ({ ...prev, ...edits }))} />
            {!isResolving && pluginOptions.length === 0 && (
              <Notice.Root variant="warning">
                <Notice.Description>
                  {__(
                    'No parsed plugins are available. Parse at least one plugin first.',
                    'hooksgraph'
                  )}
                </Notice.Description>
              </Notice.Root>
            )}
          </Stack>
        </Dialog.Content>
        <Dialog.Footer>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {__('Cancel', 'hooksgraph')}
          </Button>
          <Button
            variant="solid"
            tone="brand"
            onClick={handleSubmit}
            loading={isSaving}
            disabled={isSaving}
          >
            {__('Start scan', 'hooksgraph')}
          </Button>
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
