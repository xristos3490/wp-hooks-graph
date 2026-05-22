import { Notice, Spinner } from '@wordpress/components';
import { store as coreStore, useEntityRecords } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import { useCallback, useMemo, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Stack, Tabs } from '@wordpress/ui';

import AiChatView from '../../ai-chat-view';
import SettingsView from '../../settings-view';
import { PLUGIN_ENTITY } from './entity';
import { usePluginActions } from './use-plugin-actions';
import { usePluginFields } from './use-plugin-fields';
import { getDefaultView, viewToQuery } from './view-utils';

export default function ActivePluginsStage({ view: routeView, navigate }) {
  const fields = usePluginFields();
  const defaultView = useMemo(() => getDefaultView(routeView), [routeView]);
  const [view, setView] = useState(defaultView);

  // `routeView` is passed through for future use, but viewToQuery doesn't read it
  // yet — keep it out of the deps so switching tabs doesn't refetch.
  const query = useMemo(() => viewToQuery(view, routeView), [view]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const actions = usePluginActions({ refreshList });

  if (isResolving && !hasResolved) {
    return (
      <Stack alignment="center" spacing={4}>
        <Spinner />
      </Stack>
    );
  }

  if (hasResolved && !records) {
    return (
      <Notice status="error" isDismissible={false}>
        <strong>{__('Could not load plugins', 'hooksgraph')}</strong>
        <p>{__('The plugins endpoint returned no data.', 'hooksgraph')}</p>
      </Notice>
    );
  }

  const isActivePlugins = routeView === 'active-plugins';
  const isAssistant = routeView === 'assistant';
  const isSettings = routeView === 'settings';

  return (
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
        <Tabs.Root
          value={routeView}
          onValueChange={(next) => navigate({ view: next, id: null })}
        >
          <Tabs.List variant="minimal">
            <Tabs.Tab value="active-plugins">{__('Active plugins', 'hooksgraph')}</Tabs.Tab>
            <Tabs.Tab value="scans">{__('Scans', 'hooksgraph')}</Tabs.Tab>
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
    </DataViews>
  );
}
