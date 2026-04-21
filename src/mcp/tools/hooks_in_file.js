import { z } from 'zod';
import { paginate } from '../lib/paginate.js';
import { fileEdgeResult } from '../lib/shape.js';

export const name = 'hooks_in_file';

export const description =
  'List every hook fire or listener registered in a specific file, with pagination. File path is the repo-relative path stored in the graph.';

export const inputSchema = {
  file_path: z.string().min(1).describe('Repo-relative file path as stored in the graph'),
  codebase: z.string().min(1).describe('Codebase id (filename stem)'),
  limit: z.number().int().min(1).max(500).default(50).optional(),
  offset: z.number().int().min(0).default(0).optional(),
};

export function handler(
  { file_path, codebase, limit = 50, offset = 0 },
  { registry, index },
) {
  const entry = registry.resolve(codebase);
  const built = index.get(entry);
  const fileNode = built.fileByPath.get(file_path);
  if (!fileNode) return { total: 0, has_more: false, results: [] };
  const edges = built.edgesByFile.get(fileNode.id) ?? [];
  const page = paginate(edges, limit, offset);
  return {
    total: page.total,
    has_more: page.has_more,
    results: page.results.map((e) => fileEdgeResult(e, built)),
  };
}
