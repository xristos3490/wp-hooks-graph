import { z } from 'zod';
import { paginate } from '../lib/paginate.js';
import { listenerResult } from '../lib/shape.js';

export const name = 'listeners_of';

export const description =
  'List every add_action/add_filter registration for a given hook in a codebase, with pagination.';

export const inputSchema = {
  hook: z.string().min(1).describe('Hook name'),
  codebase: z.string().min(1).describe('Codebase id (filename stem)'),
  limit: z.number().int().min(1).max(500).default(50).optional(),
  offset: z.number().int().min(0).default(0).optional(),
};

export function handler({ hook, codebase, limit = 50, offset = 0 }, { registry, index }) {
  const entry = registry.resolve(codebase);
  const built = index.get(entry);
  const node = built.hookByName.get(hook);
  if (!node) return { total: 0, has_more: false, results: [] };
  const edges = built.listensByHook.get(node.id) ?? [];
  const page = paginate(edges, limit, offset);
  return {
    total: page.total,
    has_more: page.has_more,
    results: page.results.map((e) => listenerResult(e, built)),
  };
}
