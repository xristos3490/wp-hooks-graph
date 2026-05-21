import { createRoot } from '@wordpress/element';

import App from './app';
import { registerEntities } from './data/register-entities';
import './style.scss';

const MOUNT_ID = 'hooksgraph-admin-root';

// Register the `hooksgraph:plugin` entity before any `useEntityRecords` runs.
// Side-effecting import would also work; the explicit call makes the dep
// visible in the mount sequence.
registerEntities();

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById(MOUNT_ID);
  if (!container) {
    return;
  }

  createRoot(container).render(<App />);
});
