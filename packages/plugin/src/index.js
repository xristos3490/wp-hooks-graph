import { createRoot } from '@wordpress/element';

import App from './app';
import './style.scss';

const MOUNT_ID = 'hooksgraph-admin-root';

document.addEventListener( 'DOMContentLoaded', () => {
	const container = document.getElementById( MOUNT_ID );
	if ( ! container ) {
		return;
	}

	createRoot( container ).render( <App /> );
} );
