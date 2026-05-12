import { dispatch } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';

import { PLUGIN_ENTITY } from '../routes/active-plugins/entity';

// `addEntities` is idempotent in core-data, but the guard keeps the call out
// of every HMR reload and makes the side effect explicit at the call site.
let registered = false;

export function registerEntities() {
  if (registered) {
    return;
  }
  registered = true;
  dispatch(coreStore).addEntities([PLUGIN_ENTITY]);
}
