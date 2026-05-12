import { Page } from '@wordpress/admin-ui';
import { __ } from '@wordpress/i18n';

import AiCodebasesPanel from './ai-codebases-panel';
import ActivePluginsStage from './routes/active-plugins/stage';

export default function App() {
  return (
    <Page
      className="hooksgraph-page"
      title={__('HooksGraph', 'hooksgraph')}
      subTitle={__('Active plugins on this site.', 'hooksgraph')}
      ariaLabel={__('HooksGraph admin page', 'hooksgraph')}
    >
      <AiCodebasesPanel />
      <ActivePluginsStage />
    </Page>
  );
}
