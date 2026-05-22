// View defaults + REST-query translation for the scans list. Mirrors
// `active-plugins/view-utils.js`. Scans default to newest-first by
// `started_at`, since freshness is the most useful axis to scan along.

import { SCAN_LIST_FIELDS } from './entity';

export const DEFAULT_VIEW = {
  type: 'table',
  titleField: 'title',
  fields: ['status', 'plugins', 'progress', 'summary', 'started_at', 'freshness'],
  page: 1,
  perPage: 25,
  search: '',
  filters: [],
  sort: { field: 'started_at', direction: 'desc' },
};

export function getDefaultView(/* tab */) {
  return DEFAULT_VIEW;
}

// UI field id → REST `orderby` value. Core `WP_REST_Posts_Controller`
// orderby vocab is limited; we fall back to `date` (post date) for fields
// it doesn't know about — close enough for our started_at proxy.
const SORT_FIELD_MAP = {
  started_at: 'date',
  finished_at: 'modified',
  title: 'title',
};

export function viewToQuery(view /* , tab */) {
  const sortField = view?.sort?.field;
  const orderby = sortField ? SORT_FIELD_MAP[sortField] ?? 'date' : 'date';
  const order = view?.sort?.direction === 'asc' ? 'asc' : 'desc';

  return {
    per_page: 100,
    page: 1,
    search: view?.search ?? '',
    orderby,
    order,
    _fields: SCAN_LIST_FIELDS,
  };
}
