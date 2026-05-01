import { __ } from '@wordpress/i18n';
import { Badge } from '@wordpress/ui';

const stripTags = ( html ) =>
	typeof html === 'string' ? html.replace( /<[^>]*>/g, '' ).trim() : '';

const STATUS_LABELS = {
	parsed: __( 'Parsed', 'hooksgraph' ),
	stale: __( 'Stale', 'hooksgraph' ),
	needs_parsing: __( 'Needs parsing', 'hooksgraph' ),
	scheduled: __( 'Scheduled', 'hooksgraph' ),
};

// Map status → @wordpress/ui Badge intent. Valid intents are
// 'high' | 'medium' | 'low' | 'stable' | 'informational' | 'draft' | 'none'.
const STATUS_INTENTS = {
	parsed: 'stable',
	stale: 'medium',
	needs_parsing: 'draft',
	scheduled: 'informational',
};

export const fields = [
	{
		id: 'name',
		label: __( 'Plugin', 'hooksgraph' ),
		enableGlobalSearch: true,
		enableSorting: true,
		getValue: ( { item } ) => stripTags( item.name ),
	},
	{
		id: 'version',
		label: __( 'Version', 'hooksgraph' ),
		enableSorting: true,
	},
	{
		id: 'parse_status',
		label: __( 'Parse status', 'hooksgraph' ),
		enableSorting: true,
		elements: Object.entries( STATUS_LABELS ).map( ( [ value, label ] ) => ( {
			value,
			label,
		} ) ),
		getValue: ( { item } ) => item.parse_status ?? '',
		render: ( { item } ) => {
			const status = item.parse_status;
			if ( ! status ) {
				return null;
			}
			return (
				<Badge intent={ STATUS_INTENTS[ status ] ?? 'none' }>
					{ STATUS_LABELS[ status ] ?? status }
				</Badge>
			);
		},
	},
	{
		id: 'author',
		label: __( 'Author', 'hooksgraph' ),
		enableGlobalSearch: true,
		enableSorting: true,
		getValue: ( { item } ) => stripTags( item.author ),
	},
	{
		id: 'description',
		label: __( 'Description', 'hooksgraph' ),
		enableGlobalSearch: true,
		getValue: ( { item } ) =>
			stripTags( item.description?.raw ?? item.description ?? '' ),
	},
	{
		id: 'requires_php',
		label: __( 'Requires PHP', 'hooksgraph' ),
		enableSorting: true,
	},
];

export const defaultView = {
	type: 'table',
	titleField: 'name',
	descriptionField: 'description',
	fields: [ 'version', 'parse_status', 'author', 'requires_php' ],
	page: 1,
	perPage: 25,
	search: '',
	filters: [],
	sort: { field: 'name', direction: 'asc' },
};
