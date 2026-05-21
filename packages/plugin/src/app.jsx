import { Page } from '@wordpress/admin-ui';
import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

import ActivePluginsStage from './routes/active-plugins/stage';
import ScansStage from './routes/scans/stage';

export default function App() {
  const [tab, setTab] = useState('dashboard');

  return (
    <Page
      className="hooksgraph-page"
      title={__('Hooks Graph', 'hooksgraph')}
      subTitle={__('Active plugins on this site.', 'hooksgraph')}
      ariaLabel={__('HooksGraph admin page', 'hooksgraph')}
    >
      {tab === 'scans' ? (
        <ScansStage tab={tab} setTab={setTab} />
      ) : (
        <ActivePluginsStage tab={tab} setTab={setTab} />
      )}
    </Page>
  );
}
