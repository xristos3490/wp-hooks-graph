// filters.js — Pure filter pipeline functions for hooks graph
// No DOM or Cytoscape dependency. Testable with Node.js.

function filterByHookType(hooks, state) {
  var result = new Set();
  for (var i = 0; i < hooks.length; i++) {
    var hook = hooks[i];
    if (state.hookType.actions && hook.hook_type === 'action') result.add(hook.id);
    if (state.hookType.filters && hook.hook_type === 'filter') result.add(hook.id);
  }
  return result;
}

function filterByDynamic(hooks, state) {
  if (!state.dynamic) return new Set(hooks.map(function(h) { return h.id; }));
  var result = new Set();
  for (var i = 0; i < hooks.length; i++) {
    if (hooks[i].dynamic) result.add(hooks[i].id);
  }
  return result;
}

function filterByOverlapping(hooks, state) {
  if (!state.overlapping) return new Set(hooks.map(function(h) { return h.id; }));
  var result = new Set();
  for (var i = 0; i < hooks.length; i++) {
    if (hooks[i].sources.length >= 2) result.add(hooks[i].id);
  }
  return result;
}

function filterByHighTraffic(hooks, state) {
  if (!state.highTraffic.enabled) return new Set(hooks.map(function(h) { return h.id; }));
  var result = new Set();
  for (var i = 0; i < hooks.length; i++) {
    var hook = hooks[i];
    if ((hook.fire_count + hook.listen_count) >= state.highTraffic.minConnections) {
      result.add(hook.id);
    }
  }
  return result;
}

function intersectSets(sets) {
  if (sets.length === 0) return new Set();
  var result = new Set(sets[0]);
  for (var i = 1; i < sets.length; i++) {
    var next = sets[i];
    result = new Set([...result].filter(function(x) { return next.has(x); }));
  }
  return result;
}

function filterEdgesByRepo(edges, fileNodes, visibleHookIds, state) {
  var fileSourceMap = {};
  for (var i = 0; i < fileNodes.length; i++) {
    fileSourceMap[fileNodes[i].id] = fileNodes[i].source;
  }
  return edges.filter(function(e) {
    if (!visibleHookIds.has(e.target)) return false;
    var source = fileSourceMap[e.source];
    if (!source) return true;
    var map = e.type === 'fires' ? state.fireRepos : state.listenRepos;
    if (!map[source]) return false;
    return true;
  });
}

function deriveFileVisibility(visibleEdges) {
  var result = new Set();
  for (var i = 0; i < visibleEdges.length; i++) {
    result.add(visibleEdges[i].source);
  }
  return result;
}

function applyFilterPipeline(hooks, edges, fileNodes, state) {
  var hooksById = {};
  for (var h = 0; h < hooks.length; h++) hooksById[hooks[h].id] = hooks[h];

  var sets = [
    filterByHookType(hooks, state),
    filterByDynamic(hooks, state),
    filterByOverlapping(hooks, state),
    filterByHighTraffic(hooks, state),
  ];
  var visibleHookIds = intersectSets(sets);
  var visibleEdges = filterEdgesByRepo(edges, fileNodes, visibleHookIds, state);

  // Two-sided by default; raw orphans surface only when opted in.
  var hooksWithFire = new Set();
  var hooksWithListen = new Set();
  for (var i = 0; i < visibleEdges.length; i++) {
    var e = visibleEdges[i];
    if (e.type === 'fires') hooksWithFire.add(e.target);
    else if (e.type === 'listens') hooksWithListen.add(e.target);
  }
  visibleHookIds = new Set([...visibleHookIds].filter(function(id) {
    var hook = hooksById[id];
    var hasFire = hooksWithFire.has(id);
    var hasListen = hooksWithListen.has(id);
    if (hasFire && hasListen) return true;
    if (hasFire && hook.listen_count === 0 && state.includeFireOnly) return true;
    if (hasListen && hook.fire_count === 0 && state.includeListenOnly) return true;
    return false;
  }));
  visibleEdges = visibleEdges.filter(function(e) { return visibleHookIds.has(e.target); });

  var visibleFileIds = deriveFileVisibility(visibleEdges);
  return { visibleHookIds: visibleHookIds, visibleEdges: visibleEdges, visibleFileIds: visibleFileIds };
}

export {
  filterByHookType, filterByDynamic, filterByOverlapping, filterByHighTraffic,
  intersectSets, filterEdgesByRepo, deriveFileVisibility, applyFilterPipeline,
};
