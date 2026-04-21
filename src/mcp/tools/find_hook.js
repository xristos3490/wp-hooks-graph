import { z } from 'zod';
import { hookSummary } from '../lib/shape.js';

export const name = 'find_hook';

export const description =
  'Look up a hook by exact name. With a codebase, returns a single hook or null. Without codebase, searches every codebase and returns an array.';

export const inputSchema = {
  name: z.string().min(1).describe('Exact hook name'),
  codebase: z
    .string()
    .optional()
    .describe('Codebase id (filename stem). Omit to search all codebases.'),
};

export function handler({ name: hookName, codebase }, { registry, index }) {
  if (codebase) {
    const entry = registry.resolve(codebase);
    const built = index.get(entry);
    const node = built.hookByName.get(hookName);
    return node ? hookSummary(node) : null;
  }

  const entries = registry.list();
  const out = [];
  for (const entry of entries) {
    let built;
    try {
      built = index.get(entry);
    } catch {
      continue;
    }
    const node = built.hookByName.get(hookName);
    if (node) {
      out.push({ codebase: entry.id, ...hookSummary(node) });
    }
  }
  return out;
}
