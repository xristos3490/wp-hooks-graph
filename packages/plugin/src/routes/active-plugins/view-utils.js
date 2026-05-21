// View defaults + REST-query translation for the active-plugins list.
//
// Single source of truth for: (a) what columns/sort/page-size the user gets
// on first paint, and (b) how the current `view` maps onto query params on
// the wire. Keeping both here means a future swap to server-side filtering
// is a one-line change in the stage — no logic moves out of this file.

import { PLUGIN_LIST_FIELDS } from './entity';

export const DEFAULT_VIEW = {
  type: 'table',
  titleField: 'name',
  descriptionField: 'description',
  fields: [
    'parse_status',
    'version',
    'parsed_at',
    'total_files',
    'total_hooks',
    'total_edges',
    'author',
    'requires_php',
  ],
  page: 1,
  perPage: 25,
  search: '',
  filters: [],
  sort: { field: 'name', direction: 'asc' },
};

export function getDefaultView(/* tab */) {
  // Tabs don't override the view yet; the signature is in place for the
  // "Needs parsing" / "Failed" tabs the plan calls out as a future step.
  return DEFAULT_VIEW;
}

// UI field id → REST `orderby` value. Sort field ids in the View match REST
// columns 1:1 today except for `parsed_at` (UI) → `last_parsed_at` (API).
const SORT_FIELD_MAP = {
  parsed_at: 'last_parsed_at',
};

// Translate a DataViews `view` into REST query params. Phase 1 fetches a
// generous page and lets DataViews' `filterSortAndPaginate` slice it; Phase 2
// switches to server-side paging by tightening these defaults — no callers
// outside the stage need to change.
export function viewToQuery(view /* , tab */) {
  const sortField = view?.sort?.field;
  const orderby = sortField ? SORT_FIELD_MAP[sortField] ?? sortField : 'name';
  const order = view?.sort?.direction === 'desc' ? 'desc' : 'asc';

  return {
    per_page: 100,
    page: 1,
    search: view?.search ?? '',
    orderby,
    order,
    _fields: PLUGIN_LIST_FIELDS,
  };
}
