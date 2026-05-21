import { __ } from '@wordpress/i18n';

// Descriptor passed to `dispatch( coreStore ).addEntities()`. The `hooksgraph`
// kind is a plain namespace string in core-data — no extra registration is
// required beyond `addEntities`. Keeping every plugin-introduced entity under
// this kind keeps grep / rename / future-additions tidy.
export const PLUGIN_ENTITY = {
  name: 'plugin',
  kind: 'hooksgraph',
  baseURL: '/hooksgraph/v1/plugins',
  baseURLParams: { context: 'view' },
  key: 'id',
  supportsPagination: true,
  label: __('Plugin', 'hooksgraph'),
  plural: __('Plugins', 'hooksgraph'),
};

// `_fields` shortlist for the active-plugins list view. Trims the payload
// once we move to projection; left exported for callers that want to opt in.
export const PLUGIN_LIST_FIELDS = [
  'id',
  'name',
  'version',
  'author',
  'description',
  'requires_php',
  'parse_status',
  'last_parsed_at',
  'exclude',
  'total_files',
  'total_hooks',
  'total_edges',
  'dynamic_hooks',
].join(',');
