import { Spinner } from '@wordpress/components';
import { store as coreStore, useEntityRecords } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import { useCallback, useMemo, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Button, Notice, Stack, Tabs } from '@wordpress/ui';

import ScanDetailView from './detail-panel';
import { SCAN_ENTITY } from './entity';
import NewScanModal from './new-scan-modal';
import { useScanActions } from './use-scan-actions';
import { useScanFields } from './use-scan-fields';
import { getDefaultView, viewToQuery } from './view-utils';

export default function ScansStage({ tab, setTab }) {
  const fields = useScanFields();
  const defaultView = useMemo(() => getDefaultView(), []);
  const [view, setView] = useState(defaultView);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [selectedScanId, setSelectedScanId] = useState(null);

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

  const onView = useCallback((item) => setSelectedScanId(item.id), []);
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
      <ScanDetailView scanId={selectedScanId} onBack={() => setSelectedScanId(null)} />
    );
  }

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
      >
        <Stack
          className="hooksgraph-scans__view-actions"
          direction="row"
          justify="space-between"
          align="center"
          gap="sm"
        >
          <Tabs.Root value={tab} onValueChange={setTab}>
            <Tabs.List variant="minimal">
              <Tabs.Tab value="dashboard">{__('Dashboard', 'hooksgraph')}</Tabs.Tab>
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
