import { __ } from '@wordpress/i18n';

// Core-data entity descriptor for the `hg_scan` CPT. Registered alongside
// the existing PLUGIN_ENTITY via `dispatch( coreStore ).addEntities()`.
// `kind: 'postType'` routes core-data through its built-in postType
// resolvers, so we get save / delete / pagination for free.
export const SCAN_ENTITY = {
  name: 'hg_scan',
  kind: 'postType',
  baseURL: '/wp/v2/hg-scans',
  baseURLParams: { context: 'view' },
  key: 'id',
  supportsPagination: true,
  label: __('Scan', 'hooksgraph'),
  plural: __('Scans', 'hooksgraph'),
};

// `_fields` shortlist for the scans list view. Trims the payload to the
// top-level fields exposed by `register_rest_field` on the CPT.
export const SCAN_LIST_FIELDS = [
  'id',
  'title',
  'status',
  'plugins',
  'progress',
  'started_at',
  'finished_at',
  'freshness',
  'result',
  'error',
].join(',');
