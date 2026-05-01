import { Page } from '@wordpress/admin-ui';
import { __ } from '@wordpress/i18n';

import PluginsView from './plugins-view';

export default function App() {
	return (
		<Page
			title={ __( 'HooksGraph', 'hooksgraph' ) }
			subTitle={ __(
				'Active plugins on this site.',
				'hooksgraph'
			) }
			ariaLabel={ __( 'HooksGraph admin page', 'hooksgraph' ) }
		>
			<PluginsView />
		</Page>
	);
}
