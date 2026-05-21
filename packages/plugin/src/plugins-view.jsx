import apiFetch from '@wordpress/api-fetch';
import { Notice, Spinner } from '@wordpress/components';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import { useCallback, useEffect, useMemo, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Stack, Tabs } from '@wordpress/ui';

import AiChatView from './ai-chat-view';
import { defaultView, fields } from './fields';
import ScheduleParseModal from './schedule-parse-modal';
import SettingsView from './settings-view';

const PLUGINS_PATH = '/wp/v2/plugins?context=view&per_page=100';
const STATUS_PATH = '/hooksgraph/v1/parse-status';
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

const emptyStatus = {
  status: null,
  last_parsed_at: null,
  exclude: [],
  total_files: null,
  total_hooks: null,
  total_edges: null,
  dynamic_hooks: null,
};

export default function PluginsView() {
  const [plugins, setPlugins] = useState([]);
  const [statusMap, setStatusMap] = useState({});
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [view, setView] = useState(defaultView);

  const [scheduleTarget, setScheduleTarget] = useState(null);
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);
  const [scheduleError, setScheduleError] = useState(null);

  const [tab, setTab] = useState('dashboard');

  const loadAll = useCallback(({ silent = false } = {}) => {
    if (!silent) {
      setStatus('loading');
    }
    return Promise.all([apiFetch({ path: PLUGINS_PATH }), apiFetch({ path: STATUS_PATH })])
      .then(([pluginsResponse, statusResponse]) => {
        const active = (pluginsResponse ?? []).filter((plugin) => plugin.status === 'active');
        setPlugins(active);
        setStatusMap(statusResponse ?? {});
        setStatus('ready');
      })
      .catch((err) => {
        setError(err?.message ?? __('Failed to load plugins.', 'hooksgraph'));
        setStatus('error');
      });
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const data = useMemo(
    () =>
      plugins.map((plugin) => {
        const entry = statusMap[plugin.plugin] ?? emptyStatus;
        return {
          id: plugin.plugin,
          name: plugin.name,
          version: plugin.version,
          author: plugin.author,
          description: plugin.description,
          requires_php: plugin.requires_php,
          parse_status: entry.status,
          last_parsed_at: entry.last_parsed_at,
          exclude: entry.exclude ?? [],
          total_files: typeof entry.total_files === 'number' ? entry.total_files : null,
          total_hooks: typeof entry.total_hooks === 'number' ? entry.total_hooks : null,
          total_edges: typeof entry.total_edges === 'number' ? entry.total_edges : null,
          dynamic_hooks: typeof entry.dynamic_hooks === 'number' ? entry.dynamic_hooks : null,
        };
      }),
    [plugins, statusMap]
  );

  const { data: rows, paginationInfo } = useMemo(
    () => filterSortAndPaginate(data, view, fields),
    [data, view]
  );

  const closeSchedule = useCallback(() => {
    setScheduleTarget(null);
    setScheduleError(null);
    setScheduleSubmitting(false);
  }, []);

  const submitSchedule = useCallback(
    async (exclude) => {
      if (!scheduleTarget) return;
      setScheduleSubmitting(true);
      setScheduleError(null);
      try {
        await apiFetch({
          path: PARSE_PATH,
          method: 'POST',
          data: { plugin: scheduleTarget.id, exclude },
        });
        closeSchedule();
        loadAll({ silent: true });
      } catch (err) {
        setScheduleError(
          err?.message ?? __('Could not schedule the parse. Please try again.', 'hooksgraph')
        );
        setScheduleSubmitting(false);
      }
    },
    [scheduleTarget, closeSchedule, loadAll]
  );

  const downloadParse = useCallback(async (item) => {
    const path = `${DOWNLOAD_PATH}?plugin=${encodeURIComponent(item.id)}`;
    const response = await apiFetch({ path, parse: false });
    const blob = await response.blob();
    const fallback = `${item.id.split('/').pop()}-${item.version || 'unversioned'}.json`;
    const filename =
      filenameFromContentDisposition(response.headers.get('Content-Disposition')) ?? fallback;
    triggerBrowserDownload(blob, filename);
  }, []);

  const actions = useMemo(() => {
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
        setScheduleError(null);
        setScheduleTarget(items[0]);
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
      loadAll({ silent: true });
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
  }, [downloadParse, loadAll]);

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
        <strong>{__('Could not load plugins', 'hooksgraph')}</strong> — {error}
      </Notice>
    );
  }

  const isActivePlugins = tab === 'active-plugins';
  const isAssistant = tab === 'assistant';
  const isSettings = tab === 'settings';

  return (
    <>
      <DataViews
        data={rows}
        fields={fields}
        view={view}
        onChangeView={setView}
        paginationInfo={paginationInfo}
        defaultLayouts={{ table: {} }}
        getItemId={(item) => item.id}
        actions={actions}
        isLoading={status !== 'ready'}
      >
        <Stack
          className="hooksgraph-plugins__view-actions"
          direction="row"
          justify="space-between"
          align="center"
          gap="sm"
        >
          <Tabs.Root value={tab} onValueChange={setTab}>
            <Tabs.List variant="minimal">
              <Tabs.Tab value="dashboard">{__('Dashboard', 'hooksgraph')}</Tabs.Tab>
              <Tabs.Tab value="active-plugins">{__('Active plugins', 'hooksgraph')}</Tabs.Tab>
              <Tabs.Tab value="assistant">{__('AI Assistant', 'hooksgraph')}</Tabs.Tab>
              <Tabs.Tab value="settings">{__('Settings', 'hooksgraph')}</Tabs.Tab>
            </Tabs.List>
          </Tabs.Root>
          {isActivePlugins && (
            <Stack direction="row" align="center" gap="xs" style={{ flexShrink: 0 }}>
              <DataViews.Search />
              <DataViews.FiltersToggle />
              <DataViews.ViewConfig />
            </Stack>
          )}
        </Stack>
        {isActivePlugins && (
          <>
            <DataViews.FiltersToggled className="dataviews-filters__container" />
            <DataViews.Layout />
            <DataViews.Footer />
          </>
        )}
        {isAssistant && <AiChatView />}
        {isSettings && <SettingsView />}
        {!isActivePlugins && !isAssistant && !isSettings && (
          <h1 className="hooksgraph-plugins__dashboard">{__('Dashboard', 'hooksgraph')}</h1>
        )}
      </DataViews>
      {scheduleTarget && (
        <ScheduleParseModal
          plugin={scheduleTarget}
          isSubmitting={scheduleSubmitting}
          error={scheduleError}
          onSubmit={submitSchedule}
          onClose={closeSchedule}
        />
      )}
    </>
  );
}
