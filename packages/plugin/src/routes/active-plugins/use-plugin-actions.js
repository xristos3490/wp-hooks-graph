import apiFetch from '@wordpress/api-fetch';
import { useCallback, useMemo } from '@wordpress/element';
import { __, sprintf, _n } from '@wordpress/i18n';
import { Button, Stack, Text } from '@wordpress/ui';

const PARSE_PATH = '/hooksgraph/v1/parse-plugin';
const DOWNLOAD_PATH = '/hooksgraph/v1/parse-download';
const DELETE_PATH = '/hooksgraph/v1/parse-data';

const DOWNLOADABLE_STATUSES = new Set(['parsed', 'stale']);

const filenameFromContentDisposition = (header) => {
  if (!header) return null;
  const match = header.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    // Malformed percent-encoding — fall back to the raw match so the caller
    // can still surface *something* rather than throwing mid-download.
    return match[1];
  }
};

const triggerBrowserDownload = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export function usePluginActions({ refreshList }) {
  const downloadParse = useCallback(async (item) => {
    const path = `${DOWNLOAD_PATH}?plugin=${encodeURIComponent(item.id)}`;
    const response = await apiFetch({ path, parse: false });
    const blob = await response.blob();
    const fallback = `${item.id.split('/').pop()}-${item.version || 'unversioned'}.json`;
    const filename =
      filenameFromContentDisposition(response.headers.get('Content-Disposition')) ?? fallback;
    triggerBrowserDownload(blob, filename);
  }, []);

  // Sequential DELETE for every selected row. Like the schedule action, this
  // is serialized: deleting parsed data unschedules pending cron events, and
  // wp-cron's event storage races on parallel writes the same way the
  // `cron` option does.
  const runDelete = useCallback(
    async (items, closeModal) => {
      for (const item of items) {
        try {
          await apiFetch({
            path: `${DELETE_PATH}?plugin=${encodeURIComponent(item.id)}`,
            method: 'DELETE',
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`HooksGraph: delete failed for ${item.id}`, err);
        }
      }
      closeModal?.();
      refreshList();
    },
    [refreshList]
  );

  return useMemo(() => {
    const runDownload = async (items) => {
      const item = items[0];
      if (!item) return;
      try {
        await downloadParse(item);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('HooksGraph: download failed', err);
      }
    };

    // One action, one behavior: fire POST /parse-plugin for every selected
    // row using its stored exclude patterns. Works identically for a single
    // row (primary button click → items=[row]) and a bulk toolbar invocation
    // (items=[a,b,c]) — no items.length branching, no modal mid-flow.
    //
    // Requests are serialized intentionally: `wp_schedule_single_event()`
    // does a non-atomic read-modify-write on the single `cron` option, so
    // parallel POSTs would lose-update and only the last writer's event
    // would survive. One-at-a-time keeps the cron table consistent.
    const runSchedule = async (items) => {
      if (items.length === 0) return;
      for (const item of items) {
        try {
          await apiFetch({
            path: PARSE_PATH,
            method: 'POST',
            data: { plugin: item.id, exclude: item.exclude ?? [] },
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`HooksGraph: schedule failed for ${item.id}`, err);
        }
      }
      refreshList();
    };

    return [
      {
        id: 'download-parse-primary',
        label: __('Download', 'hooksgraph'),
        isPrimary: true,
        supportsBulk: false,
        isEligible: (item) => item.parse_status === 'parsed',
        callback: runDownload,
      },
      {
        id: 'schedule-parse',
        label: __('Schedule parse', 'hooksgraph'),
        isPrimary: true,
        supportsBulk: true,
        isEligible: (item) => item.parse_status !== 'scheduled' && item.parse_status !== 'parsed',
        callback: runSchedule,
      },
      {
        id: 'reschedule-parse',
        label: __('Re-schedule parse', 'hooksgraph'),
        supportsBulk: true,
        isEligible: (item) => item.parse_status === 'parsed',
        callback: runSchedule,
      },
      {
        id: 'download-parse',
        label: __('Download', 'hooksgraph'),
        supportsBulk: false,
        isEligible: (item) =>
          DOWNLOADABLE_STATUSES.has(item.parse_status) && item.parse_status !== 'parsed',
        callback: runDownload,
      },
      {
        id: 'delete-parse-data',
        label: __('Delete', 'hooksgraph'),
        isDestructive: true,
        supportsBulk: true,
        // Eligible whenever there's something to wipe: an on-disk file, a
        // pending cron event, or a stored failure record.
        isEligible: (item) =>
          item.parse_status === 'parsed' ||
          item.parse_status === 'stale' ||
          item.parse_status === 'scheduled' ||
          item.parse_status === 'failed',
        RenderModal: ({ items, closeModal }) => (
          <Stack direction="row" align="center" justify="space-between" gap="md">
            <Text>
              {sprintf(
                /* translators: %d: number of plugins selected. */
                _n(
                  'Delete parsed data for %d plugin? This removes the on-disk JSON, the codebase metadata option, and unschedules any pending parse. The plugin itself is not affected.',
                  'Delete parsed data for %d plugins? This removes their on-disk JSON, codebase metadata options, and unschedules any pending parses. The plugins themselves are not affected.',
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
    ];
  }, [downloadParse, refreshList, runDelete]);
}
