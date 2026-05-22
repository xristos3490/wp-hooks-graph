import apiFetch from '@wordpress/api-fetch';
import { useCallback, useMemo, useState } from '@wordpress/element';
import { __, sprintf, _n } from '@wordpress/i18n';
import { Button, Stack, Text } from '@wordpress/ui';

import ScheduleParseModal from '../../schedule-parse-modal';

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

    // Fire POST /parse-plugin for every (plugin, exclude) pair sequentially.
    // `wp_schedule_single_event` does a non-atomic read-modify-write on the
    // `cron` option, so parallel POSTs lose-update — keep this serial.
    const submitSchedule = async (jobs) => {
      for (const { id, exclude } of jobs) {
        try {
          await apiFetch({
            path: PARSE_PATH,
            method: 'POST',
            data: { plugin: id, exclude: exclude ?? [] },
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`HooksGraph: schedule failed for ${id}`, err);
        }
      }
      refreshList();
    };

    const ScheduleRenderModal = ({ items, closeModal }) => {
      const [isSubmitting, setIsSubmitting] = useState(false);
      const [error, setError] = useState(null);

      if (items.length === 1) {
        const plugin = items[0];
        return (
          <ScheduleParseModal
            plugin={plugin}
            isSubmitting={isSubmitting}
            error={error}
            onClose={closeModal}
            onSubmit={async (exclude) => {
              if (isSubmitting) return;
              setIsSubmitting(true);
              setError(null);
              try {
                await submitSchedule([{ id: plugin.id, exclude }]);
                closeModal?.();
              } catch (err) {
                setError(err?.message ?? __('Failed to schedule parse.', 'hooksgraph'));
              } finally {
                setIsSubmitting(false);
              }
            }}
          />
        );
      }

      // Bulk: re-use each row's stored exclude patterns. Editing per-row in
      // one modal doesn't fit; the single-row modal exists for tweaking.
      return (
        <Stack direction="row" align="center" justify="space-between" gap="md">
          <Text>
            {sprintf(
              /* translators: %d: number of plugins selected. */
              _n(
                'Schedule parse for %d plugin using its stored exclude patterns?',
                'Schedule parse for %d plugins using their stored exclude patterns?',
                items.length,
                'hooksgraph'
              ),
              items.length
            )}
          </Text>
          <Stack direction="row" align="center" gap="sm" style={{ flexShrink: 0 }}>
            <Button variant="outline" onClick={closeModal} disabled={isSubmitting}>
              {__('Cancel', 'hooksgraph')}
            </Button>
            <Button
              variant="solid"
              tone="brand"
              loading={isSubmitting}
              disabled={isSubmitting}
              onClick={async () => {
                setIsSubmitting(true);
                try {
                  await submitSchedule(items.map((i) => ({ id: i.id, exclude: i.exclude ?? [] })));
                  closeModal?.();
                } finally {
                  setIsSubmitting(false);
                }
              }}
            >
              {__('Schedule', 'hooksgraph')}
            </Button>
          </Stack>
        </Stack>
      );
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
        RenderModal: ScheduleRenderModal,
      },
      {
        id: 'reschedule-parse',
        label: __('Re-schedule parse', 'hooksgraph'),
        supportsBulk: true,
        isEligible: (item) => item.parse_status === 'parsed',
        RenderModal: ScheduleRenderModal,
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
