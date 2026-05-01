import { z } from 'zod';
import { paginate } from '../lib/paginate.js';
import { codebasedListenerResult } from '../lib/shape.js';

export const name = 'filter_priority_conflicts';

export const description =
  'Find filter hooks where listeners from 2+ codebases share the same priority. For filters, execution order affects the return value — earlier callbacks can overwrite or corrupt what later ones receive. Optionally narrow by `hook` (exact), `substring`, or `codebases`.';

export const inputSchema = {
  hook: z.string().min(1).optional().describe('Exact hook name.'),
  substring: z
    .string()
    .min(1)
    .optional()
    .describe('Case-insensitive substring filter on hook name.'),
  codebases: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe('Restrict to this subset of codebase ids. Defaults to all.'),
  min_codebases: z
    .number()
    .int()
    .min(2)
    .default(2)
    .optional()
    .describe('Minimum distinct codebases that must share a priority on the same hook. Default 2.'),
  limit: z.number().int().min(1).max(500).default(50).optional(),
  offset: z.number().int().min(0).default(0).optional(),
};

function comparePriorityGroupListener(a, b) {
  if (a.codebase !== b.codebase) return a.codebase < b.codebase ? -1 : 1;
  const af = a.file ?? '';
  const bf = b.file ?? '';
  if (af !== bf) return af < bf ? -1 : 1;
  return (a.line ?? 0) - (b.line ?? 0);
}

export function handler(args, { registry, index }) {
  const { hook, substring, codebases, min_codebases = 2, limit = 50, offset = 0 } = args;

  const hasHook = typeof hook === 'string' && hook.length > 0;
  const hasSub = typeof substring === 'string' && substring.length > 0;
  if (hasHook && hasSub) {
    throw new Error("filter_priority_conflicts: provide at most one of 'hook' or 'substring'");
  }
  const needle = hasSub ? substring.toLowerCase() : null;

  const entries = codebases ? codebases.map((id) => registry.resolve(id)) : registry.list();

  const loaded = [];
  for (const entry of entries) {
    try {
      loaded.push({ entry, built: index.get(entry) });
    } catch {
      continue;
    }
  }

  // hookName -> Map<priority, Map<codebaseId, listenerResult[]>>
  const byHook = new Map();
  // hookName -> { [codebaseId]: hook_type }
  const hookTypes = new Map();

  for (const { entry, built } of loaded) {
    for (const [hookName, node] of built.hookByName) {
      if (hasHook && hookName !== hook) continue;
      if (needle && !hookName.toLowerCase().includes(needle)) continue;

      if (node.hook_type === 'action') continue;

      const listenEdges = built.listensByHook.get(node.id) ?? [];
      if (listenEdges.length === 0) continue;

      let priorityMap = byHook.get(hookName);
      if (!priorityMap) {
        priorityMap = new Map();
        byHook.set(hookName, priorityMap);
      }

      if (node.hook_type) {
        const t = hookTypes.get(hookName) ?? {};
        t[entry.id] = node.hook_type;
        hookTypes.set(hookName, t);
      }

      for (const edge of listenEdges) {
        const priority = edge.priority ?? null;
        if (priority === null) continue;
        let cbMap = priorityMap.get(priority);
        if (!cbMap) {
          cbMap = new Map();
          priorityMap.set(priority, cbMap);
        }
        const bucket = cbMap.get(entry.id) ?? [];
        bucket.push(codebasedListenerResult(edge, entry.id, built));
        cbMap.set(entry.id, bucket);
      }
    }
  }

  const rows = [];
  for (const [hookName, priorityMap] of byHook) {
    const collisions = [];
    for (const [priority, cbMap] of priorityMap) {
      if (cbMap.size < min_codebases) continue;
      const listeners = [];
      for (const bucket of cbMap.values()) {
        for (const l of bucket) listeners.push(l);
      }
      listeners.sort(comparePriorityGroupListener);
      collisions.push({
        priority,
        codebases: [...cbMap.keys()].sort(),
        listener_count: listeners.length,
        listeners,
      });
    }
    if (collisions.length === 0) continue;
    collisions.sort((a, b) => a.priority - b.priority);
    rows.push({
      hook: hookName,
      hook_type_by_codebase: hookTypes.get(hookName) ?? {},
      collision_count: collisions.length,
      collisions,
    });
  }

  rows.sort((a, b) => {
    if (b.collision_count !== a.collision_count) return b.collision_count - a.collision_count;
    return a.hook < b.hook ? -1 : a.hook > b.hook ? 1 : 0;
  });

  const page = paginate(rows, limit, offset);
  return {
    query: {
      ...(hasHook ? { hook } : {}),
      ...(hasSub ? { substring } : {}),
      min_codebases,
    },
    total: page.total,
    has_more: page.has_more,
    results: page.results,
  };
}
