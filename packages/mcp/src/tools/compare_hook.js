import { z } from 'zod';
import { paginate } from '../lib/paginate.js';
import { codebasedFirerResult, codebasedListenerResult } from '../lib/shape.js';

export const name = 'compare_hook';

export const CANDIDATE_CAP = 500;

export const description =
  'Pivot one or more hooks across codebases. Provide exactly one of `hook` (exact) or `substring` (case-insensitive contains). Returns matches[] with fires and listeners grouped across codebases, listeners sorted by priority ASC then codebase then file:line.';

export const inputSchema = {
  hook: z
    .string()
    .min(1)
    .optional()
    .describe('Exact hook name. Mutually exclusive with substring.'),
  substring: z
    .string()
    .min(1)
    .optional()
    .describe('Case-insensitive substring on hook names. Mutually exclusive with hook.'),
  codebases: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe('Restrict to this subset of codebase ids. Defaults to all.'),
  limit: z.number().int().min(1).max(500).default(20).optional(),
  offset: z.number().int().min(0).default(0).optional(),
};

function compareListeners(a, b) {
  const ap = a.priority ?? Number.POSITIVE_INFINITY;
  const bp = b.priority ?? Number.POSITIVE_INFINITY;
  if (ap !== bp) return ap - bp;
  if (a.codebase !== b.codebase) return a.codebase < b.codebase ? -1 : 1;
  const af = a.file ?? '';
  const bf = b.file ?? '';
  if (af !== bf) return af < bf ? -1 : 1;
  return (a.line ?? 0) - (b.line ?? 0);
}

function compareFirers(a, b) {
  if (a.codebase !== b.codebase) return a.codebase < b.codebase ? -1 : 1;
  const af = a.file ?? '';
  const bf = b.file ?? '';
  if (af !== bf) return af < bf ? -1 : 1;
  return (a.line ?? 0) - (b.line ?? 0);
}

export function handler(args, { registry, index }) {
  const { hook, substring, codebases, limit = 20, offset = 0 } = args;
  const hasHook = typeof hook === 'string' && hook.length > 0;
  const hasSub = typeof substring === 'string' && substring.length > 0;
  if (hasHook === hasSub) {
    throw new Error("compare_hook: provide exactly one of 'hook' or 'substring'");
  }

  const entries = codebases ? codebases.map((id) => registry.resolve(id)) : registry.list();
  const loaded = [];
  for (const entry of entries) {
    try {
      loaded.push({ entry, built: index.get(entry) });
    } catch {
      continue;
    }
  }

  let candidates;
  let capped = false;
  if (hasHook) {
    candidates = [hook];
  } else {
    const needle = substring.toLowerCase();
    const set = new Set();
    for (const { built } of loaded) {
      for (const hookName of built.hookByName.keys()) {
        if (hookName.toLowerCase().includes(needle)) set.add(hookName);
      }
    }
    candidates = [...set].sort();
    if (candidates.length > CANDIDATE_CAP) {
      capped = true;
      candidates = candidates.slice(0, CANDIDATE_CAP);
    }
  }

  const matches = [];
  for (const hookName of candidates) {
    const hook_type_by_codebase = {};
    const fires = [];
    const listeners = [];
    let present = false;
    for (const { entry, built } of loaded) {
      const node = built.hookByName.get(hookName);
      if (!node) continue;
      present = true;
      if (node.hook_type) hook_type_by_codebase[entry.id] = node.hook_type;
      const fireEdges = built.firesByHook.get(node.id) ?? [];
      for (const edge of fireEdges) {
        fires.push(codebasedFirerResult(edge, entry.id, built));
      }
      const listenEdges = built.listensByHook.get(node.id) ?? [];
      for (const edge of listenEdges) {
        listeners.push(codebasedListenerResult(edge, entry.id, built));
      }
    }
    if (!present) continue;
    listeners.sort(compareListeners);
    fires.sort(compareFirers);
    matches.push({
      hook: hookName,
      hook_type_by_codebase,
      fires,
      listeners,
    });
  }

  const page = paginate(matches, limit, offset);
  return {
    query: hasHook ? { hook } : { substring },
    total: page.total,
    has_more: page.has_more,
    capped,
    matches: page.results,
  };
}
