import { z } from 'zod';

export const name = 'hotspots';

export const description =
  'Return the hooks with the most activity in a codebase, sorted descending. Metric: total (fires + listens), fires, or listens.';

export const inputSchema = {
  codebase: z.string().min(1).describe('Codebase id (filename stem)'),
  metric: z.enum(['total', 'fires', 'listens']).default('total').optional(),
  limit: z.number().int().min(1).max(500).default(20).optional(),
};

export function handler({ codebase, metric = 'total', limit = 20 }, { registry, index }) {
  const entry = registry.resolve(codebase);
  const built = index.get(entry);
  const rows = [];
  for (const node of built.nodes.values()) {
    if (node.type !== 'hook') continue;
    const fires = node.fire_count ?? 0;
    const listens = node.listen_count ?? 0;
    rows.push({
      hook: node.name,
      hook_type: node.hook_type,
      fire_count: fires,
      listen_count: listens,
      total: fires + listens,
    });
  }
  const key = metric === 'fires' ? 'fire_count' : metric === 'listens' ? 'listen_count' : 'total';
  rows.sort((a, b) => {
    if (b[key] !== a[key]) return b[key] - a[key];
    return a.hook < b.hook ? -1 : a.hook > b.hook ? 1 : 0;
  });
  return rows.slice(0, limit);
}
