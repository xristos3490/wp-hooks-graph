import apiFetch from '@wordpress/api-fetch';
import { useCallback, useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

const PARSE_PATH = '/hooksgraph/v1/parse-plugin';
const DOWNLOAD_PATH = '/hooksgraph/v1/parse-download';

const DOWNLOADABLE_STATUSES = new Set(['parsed', 'stale']);

const filenameFromContentDisposition = (header) => {
  if (!header) return null;
  const match = header.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return match ? decodeURIComponent(match[1]) : null;
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

export function usePluginActions({ onScheduleSingle, refreshList }) {
  const downloadParse = useCallback(async (item) => {
    const path = `${DOWNLOAD_PATH}?plugin=${encodeURIComponent(item.id)}`;
    const response = await apiFetch({ path, parse: false });
    const blob = await response.blob();
    const fallback = `${item.id.split('/').pop()}-${item.version || 'unversioned'}.json`;
    const filename =
      filenameFromContentDisposition(response.headers.get('Content-Disposition')) ?? fallback;
    triggerBrowserDownload(blob, filename);
  }, []);

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

    const runSchedule = async (items) => {
      if (items.length === 0) return;
      if (items.length === 1) {
        onScheduleSingle(items[0]);
        return;
      }
      const results = await Promise.allSettled(
        items.map((item) =>
          apiFetch({
            path: PARSE_PATH,
            method: 'POST',
            data: { plugin: item.id, exclude: item.exclude },
          })
        )
      );
      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          // eslint-disable-next-line no-console
          console.error(`HooksGraph: schedule failed for ${items[i].id}`, result.reason);
        }
      });
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
    ];
  }, [downloadParse, onScheduleSingle, refreshList]);
}
