import { __ } from '@wordpress/i18n';

const stripTags = ( html ) =>
	typeof html === 'string' ? html.replace( /<[^>]*>/g, '' ).trim() : '';

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
	fields: [ 'version', 'author', 'requires_php' ],
	page: 1,
	perPage: 25,
	search: '',
	filters: [],
	sort: { field: 'name', direction: 'asc' },
};
