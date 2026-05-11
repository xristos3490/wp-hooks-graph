export function hookSummary(node) {
  return {
    id: node.id,
    type: node.type,
    hook_type: node.hook_type,
    name: node.name,
    fire_count: node.fire_count ?? 0,
    listen_count: node.listen_count ?? 0,
    dynamic: node.dynamic ?? false,
    sources: node.sources ?? [],
  };
}

export function filePathFromEdgeSource(edge, index) {
  const node = index.nodes.get(edge.source);
  if (node && typeof node.path === 'string') return node.path;
  const parts = edge.source.split('::');
  return parts.slice(2).join('::') || edge.source;
}

export function hookNameFromEdgeTarget(edge, index) {
  const node = index.nodes.get(edge.target);
  if (node && typeof node.name === 'string') return node.name;
  const prefix = 'hook::';
  return edge.target.startsWith(prefix) ? edge.target.slice(prefix.length) : edge.target;
}

const METADATA_FIELDS = ['effects', 'targets', 'called_apis', 'filter_behavior'];

function withMetadata(base, edge) {
  for (const key of METADATA_FIELDS) {
    if (edge[key] !== undefined) base[key] = edge[key];
  }
  return base;
}

export function listenerResult(edge, index) {
  return withMetadata(
    {
      file: filePathFromEdgeSource(edge, index),
      line: edge.line ?? null,
      callback: edge.callback ?? null,
      callback_type: edge.callback_type ?? null,
      priority: edge.priority ?? null,
      scope_function: edge.scope_function ?? null,
    },
    edge,
  );
}

export function firerResult(edge, index) {
  return withMetadata(
    {
      file: filePathFromEdgeSource(edge, index),
      line: edge.line ?? null,
      callback: null,
      callback_type: null,
      priority: null,
      scope_function: edge.scope_function ?? null,
    },
    edge,
  );
}

export function fileEdgeResult(edge, index) {
  const base = {
    hook: hookNameFromEdgeTarget(edge, index),
    edge_type: edge.type,
    line: edge.line ?? null,
  };
  if (edge.type === 'listens') {
    base.callback = edge.callback ?? null;
    base.priority = edge.priority ?? null;
    base.scope_function = edge.scope_function ?? null;
  }
  return withMetadata(base, edge);
}

export function codebasedListenerResult(edge, codebaseId, index) {
  return { codebase: codebaseId, ...listenerResult(edge, index) };
}

export function codebasedFirerResult(edge, codebaseId, index) {
  return { codebase: codebaseId, ...firerResult(edge, index) };
}

export function callbackSearchResult(edge, codebaseId, index) {
  return withMetadata(
    {
      codebase: codebaseId,
      hook: hookNameFromEdgeTarget(edge, index),
      file: filePathFromEdgeSource(edge, index),
      line: edge.line ?? null,
      callback: edge.callback ?? null,
      priority: edge.priority ?? null,
    },
    edge,
  );
}
