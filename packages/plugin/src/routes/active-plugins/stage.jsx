import apiFetch from '@wordpress/api-fetch';
import { Spinner } from '@wordpress/components';
import { store as coreStore, useEntityRecords } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import { useCallback, useMemo, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Notice, Stack, Tabs } from '@wordpress/ui';

import AiChatView from '../../ai-chat-view';
import ScheduleParseModal from '../../schedule-parse-modal';
import SettingsView from '../../settings-view';
import { PLUGIN_ENTITY } from './entity';
import { usePluginActions } from './use-plugin-actions';
import { usePluginFields } from './use-plugin-fields';
import { getDefaultView, viewToQuery } from './view-utils';

const PARSE_PATH = '/hooksgraph/v1/parse-plugin';

export default function ActivePluginsStage() {
  const [tab, setTab] = useState('dashboard');
  const fields = usePluginFields();
  const defaultView = useMemo(() => getDefaultView(tab), [tab]);
  const [view, setView] = useState(defaultView);

  const [scheduleTarget, setScheduleTarget] = useState(null);
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);
  const [scheduleError, setScheduleError] = useState(null);

  const query = useMemo(() => viewToQuery(view, tab), [view, tab]);

  const {
    records,
    isResolving,
    hasResolved,
  } = useEntityRecords(PLUGIN_ENTITY.kind, PLUGIN_ENTITY.name, query);

  const { invalidateResolution } = useDispatch(coreStore);
  const refreshList = useCallback(
    () => invalidateResolution('getEntityRecords', [PLUGIN_ENTITY.kind, PLUGIN_ENTITY.name, query]),
    [invalidateResolution, query]
  );

  // DataViews still owns local filter/sort/paginate during the migration —
  // the entity records are the source of truth and `viewToQuery` already
  // wires the request shape. Phase 2 swap: replace this with raw `records`
  // and let `paginationInfo` come from `X-WP-Total*` headers.
  const data = records ?? [];
  const { data: rows, paginationInfo } = useMemo(
    () => filterSortAndPaginate(data, view, fields),
    [data, view, fields]
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
        refreshList();
      } catch (err) {
        setScheduleError(
          err?.message ?? __('Could not schedule the parse. Please try again.', 'hooksgraph')
        );
        setScheduleSubmitting(false);
      }
    },
    [scheduleTarget, closeSchedule, refreshList]
  );

  const actions = usePluginActions({
    onScheduleSingle: (item) => {
      setScheduleError(null);
      setScheduleTarget(item);
    },
    refreshList,
  });

  if (isResolving && !hasResolved) {
    return (
      <Stack alignment="center" spacing={4}>
        <Spinner />
      </Stack>
    );
  }

  if (hasResolved && !records) {
    return (
      <Notice.Root variant="error">
        <Notice.Title>{__('Could not load plugins', 'hooksgraph')}</Notice.Title>
        <Notice.Description>
          {__('The plugins endpoint returned no data.', 'hooksgraph')}
        </Notice.Description>
      </Notice.Root>
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
        isLoading={isResolving}
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
