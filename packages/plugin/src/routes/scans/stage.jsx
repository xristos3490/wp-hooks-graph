import { Spinner } from '@wordpress/components';
import { store as coreStore, useEntityRecords } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import { useCallback, useMemo, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Button, EmptyState, Notice, Stack, Tabs } from '@wordpress/ui';
import { search } from '@wordpress/icons';

import ScanDetailView from './detail-panel';
import { SCAN_ENTITY } from './entity';
import NewScanModal from './new-scan-modal';
import { useScanActions } from './use-scan-actions';
import { useScanFields } from './use-scan-fields';
import { getDefaultView, viewToQuery } from './view-utils';

export default function ScansStage({ view: routeView, selectedId, navigate }) {
  const fields = useScanFields();
  const defaultView = useMemo(() => getDefaultView(), []);
  const [view, setView] = useState(defaultView);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const selectedScanId = selectedId !== null ? Number(selectedId) : null;

  const query = useMemo(() => viewToQuery(view), [view]);

  const {
    records,
    isResolving,
    hasResolved,
  } = useEntityRecords(SCAN_ENTITY.kind, SCAN_ENTITY.name, query);

  const { invalidateResolution } = useDispatch(coreStore);
  const refreshList = useCallback(
    () => invalidateResolution('getEntityRecords', [SCAN_ENTITY.kind, SCAN_ENTITY.name, query]),
    [invalidateResolution, query]
  );

  const data = records ?? [];
  const { data: rows, paginationInfo } = useMemo(
    () => filterSortAndPaginate(data, view, fields),
    [data, view, fields]
  );

  const onView = useCallback(
    (item) => navigate({ view: 'scans', id: item.id }),
    [navigate]
  );
  const actions = useScanActions({ onView, refreshList });

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
        <Notice.Title>{__('Could not load scans', 'hooksgraph')}</Notice.Title>
        <Notice.Description>
          {__('The scans endpoint returned no data.', 'hooksgraph')}
        </Notice.Description>
      </Notice.Root>
    );
  }

  if (selectedScanId !== null) {
    return (
      <ScanDetailView
        scanId={selectedScanId}
        onBack={() => navigate({ view: 'scans', id: null })}
      />
    );
  }

  const emptyState = (
    <EmptyState.Root style={{ marginBlockStart: '120px' }}>
      <EmptyState.Icon icon={search} />
      <EmptyState.Title>{__('No scans yet', 'hooksgraph')}</EmptyState.Title>
      <EmptyState.Description>
        {__(
          'Run a scan to analyse hook relationships across your active plugins. Results appear here as soon as a scan completes.',
          'hooksgraph'
        )}
      </EmptyState.Description>
      <EmptyState.Actions>
        <Button variant="solid" tone="brand" onClick={() => setIsNewOpen(true)}>
          {__('New scan', 'hooksgraph')}
        </Button>
      </EmptyState.Actions>
    </EmptyState.Root>
  );

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
        isLoading={isResolving && !hasResolved}
        onClickItem={(item) => onView(item)}
        empty={emptyState}
      >
        <Stack
          className="hooksgraph-scans__view-actions"
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
          <Stack direction="row" align="center" gap="xs" style={{ flexShrink: 0 }}>
            <DataViews.Search />
            <DataViews.FiltersToggle />
            <DataViews.ViewConfig />
            <Button variant="solid" tone="brand" onClick={() => setIsNewOpen(true)}>
              {__('New scan', 'hooksgraph')}
            </Button>
          </Stack>
        </Stack>
        <DataViews.FiltersToggled className="dataviews-filters__container" />
        <DataViews.Layout />
        <DataViews.Footer />
      </DataViews>
      <NewScanModal
        open={isNewOpen}
        onOpenChange={setIsNewOpen}
        refreshList={refreshList}
      />
    </>
  );
}
