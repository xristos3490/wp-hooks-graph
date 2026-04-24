import { z } from 'zod';
import { paginate } from '../lib/paginate.js';
import { callbackSearchResult } from '../lib/shape.js';

export const name = 'search_callbacks';

export const description =
  'Case-insensitive substring search over listener callback names. With a codebase, searches that one. Without, searches every codebase.';

export const inputSchema = {
  substring: z.string().min(1).describe('Case-insensitive substring to match on callback names'),
  codebase: z
    .string()
    .optional()
    .describe('Codebase id (filename stem). Omit to search all codebases.'),
  limit: z.number().int().min(1).max(500).default(50).optional(),
  offset: z.number().int().min(0).default(0).optional(),
};

function matchesEdge(edge, needle) {
  if (edge.type !== 'listens') return false;
  const cb = typeof edge.callback === 'string' ? edge.callback : '';
  const cm = typeof edge.callback_method === 'string' ? edge.callback_method : '';
  return cb.toLowerCase().includes(needle) || cm.toLowerCase().includes(needle);
}

export function handler({ substring, codebase, limit = 50, offset = 0 }, { registry, index }) {
  const needle = substring.toLowerCase();

  const matches = [];
  const entries = codebase ? [registry.resolve(codebase)] : registry.list();

  for (const entry of entries) {
    let built;
    try {
      built = index.get(entry);
    } catch {
      if (codebase) throw new Error(`failed to load codebase '${entry.id}'`);
      continue;
    }
    for (const edge of built.allEdges) {
      if (matchesEdge(edge, needle)) {
        matches.push(callbackSearchResult(edge, entry.id, built));
      }
    }
  }

  const page = paginate(matches, limit, offset);
  return {
    total: page.total,
    has_more: page.has_more,
    results: page.results,
  };
}
