import { z } from 'zod';
import { paginate } from '../lib/paginate.js';

export const name = 'shared_hooks';

export const description =
  'Enumerate hooks that appear in 2+ codebases. Optional substring filter on hook name. Returns per-codebase fire/listen counts and a hook_type_divergence flag when sources disagree on action vs filter.';

export const inputSchema = {
  codebases: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe('Restrict to this subset of codebase ids. Defaults to all.'),
  substring: z
    .string()
    .min(1)
    .optional()
    .describe('Case-insensitive substring filter on hook name.'),
  min_sources: z.number().int().min(2).default(2).optional(),
  sort: z.enum(['source_count', 'total_activity']).default('source_count').optional(),
  limit: z.number().int().min(1).max(500).default(50).optional(),
  offset: z.number().int().min(0).default(0).optional(),
};

export function handler(args, { registry, index }) {
  const {
    codebases,
    substring,
    min_sources = 2,
    sort = 'source_count',
    limit = 50,
    offset = 0,
  } = args;

  const entries = codebases
    ? codebases.map((id) => registry.resolve(id))
    : registry.list();
  const needle = typeof substring === 'string' ? substring.toLowerCase() : null;

  const table = new Map();
  for (const entry of entries) {
    let built;
    try {
      built = index.get(entry);
    } catch {
      continue;
    }
    for (const [hookName, node] of built.hookByName) {
      if (needle && !hookName.toLowerCase().includes(needle)) continue;
      let row = table.get(hookName);
      if (!row) {
        row = new Map();
        table.set(hookName, row);
      }
      row.set(entry.id, {
        fire_count: node.fire_count ?? 0,
        listen_count: node.listen_count ?? 0,
        hook_type: node.hook_type ?? null,
      });
    }
  }

  const rows = [];
  for (const [hookName, perCb] of table) {
    if (perCb.size < min_sources) continue;
    const per_codebase = [];
    let total_fires = 0;
    let total_listens = 0;
    const typeSet = new Set();
    let canonicalType = null;
    for (const [cb, stats] of perCb) {
      per_codebase.push({
        codebase: cb,
        fire_count: stats.fire_count,
        listen_count: stats.listen_count,
      });
      total_fires += stats.fire_count;
      total_listens += stats.listen_count;
      if (stats.hook_type) {
        typeSet.add(stats.hook_type);
        if (!canonicalType) canonicalType = stats.hook_type;
      }
    }
    per_codebase.sort((a, b) =>
      a.codebase < b.codebase ? -1 : a.codebase > b.codebase ? 1 : 0,
    );
    rows.push({
      hook: hookName,
      hook_type: canonicalType,
      hook_type_divergence: typeSet.size > 1,
      sources: per_codebase.map((p) => p.codebase),
      per_codebase,
      total_fires,
      total_listens,
    });
  }

  rows.sort((a, b) => {
    if (sort === 'total_activity') {
      const aTotal = a.total_fires + a.total_listens;
      const bTotal = b.total_fires + b.total_listens;
      if (bTotal !== aTotal) return bTotal - aTotal;
    } else {
      if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
    }
    return a.hook < b.hook ? -1 : a.hook > b.hook ? 1 : 0;
  });

  const page = paginate(rows, limit, offset);
  return {
    total: page.total,
    has_more: page.has_more,
    results: page.results,
  };
}
