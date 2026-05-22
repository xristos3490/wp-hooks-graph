import { useSyncExternalStore, useCallback, useMemo } from '@wordpress/element';

// Subscribe to popstate / pushState / replaceState so any route change in the
// app — back/forward, programmatic navigate, or external — drives a re-render.
// We monkey-patch the two history methods once at module load and dispatch a
// custom event the snapshot reads from. This is the standard pattern for
// `useSyncExternalStore` + History API.
const HISTORY_EVENT = 'hooksgraph:locationchange';

if (typeof window !== 'undefined' && !window.__hooksgraphHistoryPatched) {
  window.__hooksgraphHistoryPatched = true;
  const fire = () => window.dispatchEvent(new Event(HISTORY_EVENT));
  const { pushState, replaceState } = window.history;
  window.history.pushState = function (...args) {
    const result = pushState.apply(this, args);
    fire();
    return result;
  };
  window.history.replaceState = function (...args) {
    const result = replaceState.apply(this, args);
    fire();
    return result;
  };
  window.addEventListener('popstate', fire);
}

function subscribe(callback) {
  window.addEventListener(HISTORY_EVENT, callback);
  return () => window.removeEventListener(HISTORY_EVENT, callback);
}

function getSnapshot() {
  return typeof window !== 'undefined' ? window.location.search : '';
}

function getServerSnapshot() {
  return '';
}

function buildSearch(currentSearch, patch) {
  const params = new URLSearchParams(currentSearch);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  }
  return params;
}

/**
 * Tiny URL-state hook for the HooksGraph admin SPA.
 *
 * Reads `view` and `id` from `?...` on the WP admin page URL and exposes
 * `navigate(patch)` / `replace(patch)` to update them. The `page=hooksgraph`
 * query arg is preserved on every write because we patch the existing search
 * string rather than rebuilding it from scratch.
 *
 * @param {object} options
 * @param {string} options.defaultView - Fallback when `view` is missing or not in `allowedViews`.
 * @param {string[]} options.allowedViews - Allow-list for `view` values.
 */
export function useUrlState({ defaultView, allowedViews }) {
  const search = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const { view, id } = useMemo(() => {
    const params = new URLSearchParams(search);
    const rawView = params.get('view');
    const nextView = rawView && allowedViews.includes(rawView) ? rawView : defaultView;
    const rawId = params.get('id');
    return { view: nextView, id: rawId || null };
  }, [search, defaultView, allowedViews]);

  const write = useCallback((patch, { replace = false } = {}) => {
    const params = buildSearch(window.location.search, patch);
    const nextUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    if (replace) {
      window.history.replaceState(null, '', nextUrl);
    } else {
      window.history.pushState(null, '', nextUrl);
    }
  }, []);

  const navigate = useCallback((patch) => write(patch, { replace: false }), [write]);
  const replace = useCallback((patch) => write(patch, { replace: true }), [write]);

  return { view, id, navigate, replace };
}
