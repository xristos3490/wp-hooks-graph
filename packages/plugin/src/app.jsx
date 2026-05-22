import { Page } from '@wordpress/admin-ui';
import { __ } from '@wordpress/i18n';

import ActivePluginsStage from './routes/active-plugins/stage';
import ScansStage from './routes/scans/stage';
import { useUrlState } from './router/use-url-state';

const ALLOWED_VIEWS = ['active-plugins', 'scans', 'assistant', 'settings'];

export default function App() {
  const { view, id, navigate } = useUrlState({
    defaultView: 'active-plugins',
    allowedViews: ALLOWED_VIEWS,
  });

  return (
    <Page
      className="hooksgraph-page"
      title={__('Hooks Graph', 'hooksgraph')}
      subTitle={__('Map the hooks. Spot the conflicts.', 'hooksgraph')}
      ariaLabel={__('HooksGraph admin page', 'hooksgraph')}
    >
      {view === 'scans' ? (
        <ScansStage view={view} selectedId={id} navigate={navigate} />
      ) : (
        <ActivePluginsStage view={view} selectedId={id} navigate={navigate} />
      )}
    </Page>
  );
}
