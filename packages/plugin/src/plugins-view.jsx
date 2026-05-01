import apiFetch from '@wordpress/api-fetch';
import { Spinner } from '@wordpress/components';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import { useCallback, useEffect, useMemo, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Notice, Stack } from '@wordpress/ui';

import { defaultView, fields } from './fields';

const PLUGINS_PATH = '/wp/v2/plugins?context=view&per_page=100';
const PARSE_PATH = '/hooksgraph/v1/parse-plugin';

export default function PluginsView() {
	const [ plugins, setPlugins ] = useState( [] );
	const [ status, setStatus ] = useState( 'loading' );
	const [ error, setError ] = useState( null );
	const [ view, setView ] = useState( defaultView );

	const loadPlugins = useCallback( ( { silent = false } = {} ) => {
		if ( ! silent ) {
			setStatus( 'loading' );
		}
		return apiFetch( { path: PLUGINS_PATH } )
			.then( ( response ) => {
				const active = ( response ?? [] ).filter(
					( plugin ) => plugin.status === 'active'
				);
				setPlugins( active );
				setStatus( 'ready' );
			} )
			.catch( ( err ) => {
				setError(
					err?.message ??
						__( 'Failed to load plugins.', 'hooksgraph' )
				);
				setStatus( 'error' );
			} );
	}, [] );

	useEffect( () => {
		loadPlugins();
	}, [ loadPlugins ] );

	const data = useMemo(
		() =>
			plugins.map( ( plugin ) => ( {
				id: plugin.plugin,
				name: plugin.name,
				version: plugin.version,
				author: plugin.author,
				description: plugin.description,
				requires_php: plugin.requires_php,
				abspath: plugin.abspath,
				parse_status: plugin.parse_status,
			} ) ),
		[ plugins ]
	);

	const { data: rows, paginationInfo } = useMemo(
		() => filterSortAndPaginate( data, view, fields ),
		[ data, view ]
	);

	const actions = useMemo(
		() => [
			{
				id: 'schedule-parse',
				label: __( 'Schedule parse', 'hooksgraph' ),
				isPrimary: true,
				supportsBulk: false,
				isEligible: ( item ) => item.parse_status !== 'scheduled',
				callback: async ( items ) => {
					const item = items[ 0 ];
					if ( ! item ) return;
					try {
						await apiFetch( {
							path: PARSE_PATH,
							method: 'POST',
							data: { plugin: item.id },
						} );
						loadPlugins( { silent: true } );
					} catch ( err ) {
						// eslint-disable-next-line no-console
						console.error(
							'[hooksgraph] schedule failed',
							err
						);
					}
				},
			},
		],
		[ loadPlugins ]
	);

	if ( status === 'loading' ) {
		return (
			<Stack alignment="center" spacing={ 4 }>
				<Spinner />
			</Stack>
		);
	}

	if ( status === 'error' ) {
		return (
			<Notice.Root variant="error">
				<Notice.Title>
					{ __( 'Could not load plugins', 'hooksgraph' ) }
				</Notice.Title>
				<Notice.Description>{ error }</Notice.Description>
			</Notice.Root>
		);
	}

	return (
		<DataViews
			data={ rows }
			fields={ fields }
			view={ view }
			onChangeView={ setView }
			paginationInfo={ paginationInfo }
			defaultLayouts={ { table: {} } }
			getItemId={ ( item ) => item.id }
			actions={ actions }
			isLoading={ status !== 'ready' }
		/>
	);
}
