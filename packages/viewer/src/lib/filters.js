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
  if (!state.dynamic)
    return new Set(
      hooks.map(function (h) {
        return h.id;
      })
    );
  var result = new Set();
  for (var i = 0; i < hooks.length; i++) {
    if (hooks[i].dynamic) result.add(hooks[i].id);
  }
  return result;
}

function filterByOverlapping(hooks, state) {
  if (!state.overlapping)
    return new Set(
      hooks.map(function (h) {
        return h.id;
      })
    );
  var result = new Set();
  for (var i = 0; i < hooks.length; i++) {
    if (hooks[i].sources.length >= 2) result.add(hooks[i].id);
  }
  return result;
}

function filterByHighTraffic(hooks, state) {
  if (!state.highTraffic.enabled)
    return new Set(
      hooks.map(function (h) {
        return h.id;
      })
    );
  var result = new Set();
  for (var i = 0; i < hooks.length; i++) {
    var hook = hooks[i];
    if (hook.fire_count + hook.listen_count >= state.highTraffic.minConnections) {
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
    result = new Set(
      [...result].filter(function (x) {
        return next.has(x);
      })
    );
  }
  return result;
}

function filterEdgesByRepo(edges, fileNodes, visibleHookIds, state) {
  var fileSourceMap = {};
  for (var i = 0; i < fileNodes.length; i++) {
    fileSourceMap[fileNodes[i].id] = fileNodes[i].source;
  }
  return edges.filter(function (e) {
    if (!visibleHookIds.has(e.target)) return false;
    var source = fileSourceMap[e.source];
    if (!source) return true;
    var map = e.type === 'fires' ? state.fireRepos : state.listenRepos;
    if (!map[source]) return false;
    return true;
  });
}

// Same predicate as filterEdgesByRepo but yields the indices of visible edges
// in the original array. Used by consumers that need to look up Cytoscape
// elements by id (e.g. 'edge-${i}') without reconstructing composite keys.
function filterEdgeIndicesByRepo(edges, fileNodes, visibleHookIds, state) {
  var fileSourceMap = {};
  for (var i = 0; i < fileNodes.length; i++) {
    fileSourceMap[fileNodes[i].id] = fileNodes[i].source;
  }
  var indices = new Set();
  for (var j = 0; j < edges.length; j++) {
    var e = edges[j];
    if (!visibleHookIds.has(e.target)) continue;
    var source = fileSourceMap[e.source];
    if (source) {
      var map = e.type === 'fires' ? state.fireRepos : state.listenRepos;
      if (!map[source]) continue;
    }
    indices.add(j);
  }
  return indices;
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
  var visibleEdgeIndices = filterEdgeIndicesByRepo(edges, fileNodes, visibleHookIds, state);

  // Two-sided by default; raw orphans surface only when opted in.
  var hooksWithFire = new Set();
  var hooksWithListen = new Set();
  visibleEdgeIndices.forEach(function (i) {
    var e = edges[i];
    if (e.type === 'fires') hooksWithFire.add(e.target);
    else if (e.type === 'listens') hooksWithListen.add(e.target);
  });
  visibleHookIds = new Set(
    [...visibleHookIds].filter(function (id) {
      var hook = hooksById[id];
      var hasFire = hooksWithFire.has(id);
      var hasListen = hooksWithListen.has(id);
      if (hasFire && hasListen) return true;
      if (hasFire && hook.listen_count === 0 && state.includeFireOnly) return true;
      if (hasListen && hook.fire_count === 0 && state.includeListenOnly) return true;
      return false;
    })
  );

  // Drop edges whose target was pruned by the orphan rule above, and
  // materialise the parallel arrays consumers need.
  var visibleEdges = [];
  var finalEdgeIndices = new Set();
  var visibleFileIds = new Set();
  visibleEdgeIndices.forEach(function (i) {
    var e = edges[i];
    if (!visibleHookIds.has(e.target)) return;
    visibleEdges.push(e);
    finalEdgeIndices.add(i);
    visibleFileIds.add(e.source);
  });

  return {
    visibleHookIds: visibleHookIds,
    visibleEdges: visibleEdges,
    visibleEdgeIndices: finalEdgeIndices,
    visibleFileIds: visibleFileIds,
  };
}

export {
  filterByHookType,
  filterByDynamic,
  filterByOverlapping,
  filterByHighTraffic,
  intersectSets,
  filterEdgesByRepo,
  filterEdgeIndicesByRepo,
  deriveFileVisibility,
  applyFilterPipeline,
};
