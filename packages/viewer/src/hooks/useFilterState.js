import { useReducer, useMemo, useCallback } from 'react';
import { applyFilterPipeline } from '../lib/filters.js';

const ACTIONS = {
  TOGGLE_HOOK_TYPE: 'TOGGLE_HOOK_TYPE',
  TOGGLE_BOOL_FILTER: 'TOGGLE_BOOL_FILTER',
  TOGGLE_FIRE_REPO: 'TOGGLE_FIRE_REPO',
  TOGGLE_LISTEN_REPO: 'TOGGLE_LISTEN_REPO',
  TOGGLE_HIGH_TRAFFIC: 'TOGGLE_HIGH_TRAFFIC',
  SET_HIGH_TRAFFIC_VALUE: 'SET_HIGH_TRAFFIC_VALUE',
  INIT_REPOS: 'INIT_REPOS',
  SET_DEFAULT_THRESHOLD: 'SET_DEFAULT_THRESHOLD',
};

function filterReducer(state, action) {
  switch (action.type) {
    case ACTIONS.TOGGLE_HOOK_TYPE:
      return {
        ...state,
        hookType: {
          ...state.hookType,
          [action.key]: !state.hookType[action.key],
        },
      };
    case ACTIONS.TOGGLE_BOOL_FILTER:
      return { ...state, [action.key]: !state[action.key] };
    case ACTIONS.TOGGLE_FIRE_REPO:
      return {
        ...state,
        fireRepos: { ...state.fireRepos, [action.label]: !state.fireRepos[action.label] },
      };
    case ACTIONS.TOGGLE_LISTEN_REPO:
      return {
        ...state,
        listenRepos: { ...state.listenRepos, [action.label]: !state.listenRepos[action.label] },
      };
    case ACTIONS.TOGGLE_HIGH_TRAFFIC:
      return {
        ...state,
        highTraffic: {
          ...state.highTraffic,
          enabled: !state.highTraffic.enabled,
        },
      };
    case ACTIONS.SET_HIGH_TRAFFIC_VALUE:
      return {
        ...state,
        highTraffic: { ...state.highTraffic, minConnections: action.value },
      };
    case ACTIONS.INIT_REPOS: {
      const fireRepos = {};
      const listenRepos = {};
      action.labels.forEach((l) => {
        fireRepos[l] = true;
        listenRepos[l] = true;
      });
      return { ...state, fireRepos, listenRepos };
    }
    case ACTIONS.SET_DEFAULT_THRESHOLD:
      return {
        ...state,
        highTraffic: { ...state.highTraffic, minConnections: action.value },
      };
    default:
      return state;
  }
}

const initialState = {
  hookType: { actions: true, filters: true },
  dynamic: false,
  overlapping: false,
  includeFireOnly: true,
  includeListenOnly: true,
  highTraffic: { enabled: false, minConnections: 10 },
  fireRepos: {},
  listenRepos: {},
};

export default function useFilterState(hookDataCache) {
  const [filterState, dispatch] = useReducer(filterReducer, initialState);

  const filterResult = useMemo(() => {
    if (!hookDataCache) return null;
    return applyFilterPipeline(
      hookDataCache.hooks,
      hookDataCache.edges,
      hookDataCache.fileNodes,
      filterState
    );
  }, [hookDataCache, filterState]);

  // Convenience dispatchers
  const toggleHookType = useCallback(
    (key) => dispatch({ type: ACTIONS.TOGGLE_HOOK_TYPE, key }),
    []
  );
  const toggleBoolFilter = useCallback(
    (key) => dispatch({ type: ACTIONS.TOGGLE_BOOL_FILTER, key }),
    []
  );
  const toggleFireRepo = useCallback(
    (label) => dispatch({ type: ACTIONS.TOGGLE_FIRE_REPO, label }),
    []
  );
  const toggleListenRepo = useCallback(
    (label) => dispatch({ type: ACTIONS.TOGGLE_LISTEN_REPO, label }),
    []
  );
  const toggleHighTraffic = useCallback(() => dispatch({ type: ACTIONS.TOGGLE_HIGH_TRAFFIC }), []);
  const setHighTrafficValue = useCallback(
    (value) => dispatch({ type: ACTIONS.SET_HIGH_TRAFFIC_VALUE, value: parseInt(value, 10) }),
    []
  );
  const initRepos = useCallback((labels) => dispatch({ type: ACTIONS.INIT_REPOS, labels }), []);
  const setDefaultThreshold = useCallback(
    (value) => dispatch({ type: ACTIONS.SET_DEFAULT_THRESHOLD, value }),
    []
  );

  return {
    filterState,
    filterResult,
    toggleHookType,
    toggleBoolFilter,
    toggleFireRepo,
    toggleListenRepo,
    toggleHighTraffic,
    setHighTrafficValue,
    initRepos,
    setDefaultThreshold,
  };
}

export { ACTIONS };
