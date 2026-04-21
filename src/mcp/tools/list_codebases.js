export const name = 'list_codebases';

export const description =
  'List all locally-parsed hooks graph codebases available to this server, with metadata from each JSON.';

export const inputSchema = {};

export function handler(_args, { registry, index }) {
  const entries = registry.list();
  const out = [];
  for (const entry of entries) {
    let built;
    try {
      built = index.get(entry);
    } catch {
      continue;
    }
    const meta = built.meta ?? {};
    if (!meta.source_labels && !meta.scanned_dirs && !meta.total_hooks) continue;
    out.push({
      id: entry.id,
      source_labels: meta.source_labels ?? [],
      scanned_dirs: meta.scanned_dirs ?? [],
      scan_date: meta.scan_date ?? null,
      total_files: meta.total_files ?? 0,
      total_hooks: meta.total_hooks ?? 0,
      dynamic_hooks: meta.dynamic_hooks ?? 0,
      path: entry.path,
    });
  }
  return out;
}
