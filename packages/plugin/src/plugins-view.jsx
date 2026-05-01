import apiFetch from '@wordpress/api-fetch';
import { Spinner } from '@wordpress/components';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import { useEffect, useMemo, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Notice, Stack } from '@wordpress/ui';

import { defaultView, fields } from './fields';

export default function PluginsView() {
	const [ plugins, setPlugins ] = useState( [] );
	const [ status, setStatus ] = useState( 'loading' );
	const [ error, setError ] = useState( null );
	const [ view, setView ] = useState( defaultView );

	useEffect( () => {
		let cancelled = false;

		apiFetch( { path: '/wp/v2/plugins?context=view&per_page=100' } )
			.then( ( response ) => {
				if ( cancelled ) return;
				const active = ( response ?? [] ).filter(
					( plugin ) => plugin.status === 'active'
				);
				setPlugins( active );
				setStatus( 'ready' );
			} )
			.catch( ( err ) => {
				if ( cancelled ) return;
				setError(
					err?.message ??
						__( 'Failed to load plugins.', 'hooksgraph' )
				);
				setStatus( 'error' );
			} );

		return () => {
			cancelled = true;
		};
	}, [] );

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
			} ) ),
		[ plugins ]
	);

	const { data: rows, paginationInfo } = useMemo(
		() => filterSortAndPaginate( data, view, fields ),
		[ data, view ]
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
			isLoading={ status !== 'ready' }
		/>
	);
}
