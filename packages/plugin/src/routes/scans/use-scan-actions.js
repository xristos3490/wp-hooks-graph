import apiFetch from '@wordpress/api-fetch';
import { useCallback, useMemo } from '@wordpress/element';
import { __, sprintf, _n } from '@wordpress/i18n';
import { Button, Stack, Text } from '@wordpress/ui';

const SCANS_PATH = '/wp/v2/hg-scans';

const buildRescanTitle = (item) => {
  const today = new Date().toISOString().slice(0, 10);
  if (Array.isArray(item.plugins) && item.plugins.length > 0) {
    return sprintf(
      /* translators: 1: plugin list, 2: ISO date. */
      __('Rescan — %1$s (%2$s)', 'hooksgraph'),
      item.plugins.join(', '),
      today
    );
  }
  return sprintf(
    /* translators: %s: ISO date. */
    __('Rescan — %s', 'hooksgraph'),
    today
  );
};

export function useScanActions({ onView, refreshList }) {
  const runDelete = useCallback(
    async (items, closeModal) => {
      for (const item of items) {
        try {
          await apiFetch({
            path: `${SCANS_PATH}/${item.id}?force=true`,
            method: 'DELETE',
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`HooksGraph: delete scan failed for ${item.id}`, err);
        }
      }
      closeModal?.();
      refreshList?.();
    },
    [refreshList]
  );

  const runRescan = useCallback(
    async (items) => {
      for (const item of items) {
        const plugins = Array.isArray(item.plugins) ? item.plugins : [];
        if (plugins.length === 0) continue;
        try {
          await apiFetch({
            path: SCANS_PATH,
            method: 'POST',
            data: {
              title: buildRescanTitle(item),
              status: 'publish',
              plugins,
            },
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`HooksGraph: rescan failed for ${item.id}`, err);
        }
      }
      refreshList?.();
    },
    [refreshList]
  );

  return useMemo(
    () => [
      {
        id: 'view-scan',
        label: __('View', 'hooksgraph'),
        isPrimary: true,
        supportsBulk: false,
        callback: (items) => {
          const item = items[0];
          if (!item) return;
          onView?.(item);
        },
      },
      {
        id: 'rescan',
        label: __('Re-run scan', 'hooksgraph'),
        supportsBulk: true,
        isEligible: (item) => Array.isArray(item.plugins) && item.plugins.length > 0,
        callback: runRescan,
      },
      {
        id: 'delete-scan',
        label: __('Delete', 'hooksgraph'),
        isDestructive: true,
        supportsBulk: true,
        RenderModal: ({ items, closeModal }) => (
          <Stack direction="row" align="center" justify="space-between" gap="md">
            <Text>
              {sprintf(
                /* translators: %d: number of scans selected. */
                _n(
                  'Delete %d scan? This permanently removes the scan record and all findings.',
                  'Delete %d scans? This permanently removes the scan records and all findings.',
                  items.length,
                  'hooksgraph'
                ),
                items.length
              )}
            </Text>
            <Stack direction="row" align="center" gap="sm" style={{ flexShrink: 0 }}>
              <Button variant="outline" onClick={closeModal}>
                {__('Cancel', 'hooksgraph')}
              </Button>
              <Button
                variant="solid"
                tone="brand"
                isDestructive
                onClick={() => runDelete(items, closeModal)}
              >
                {__('Delete', 'hooksgraph')}
              </Button>
            </Stack>
          </Stack>
        ),
      },
    ],
    [onView, runRescan, runDelete]
  );
}
