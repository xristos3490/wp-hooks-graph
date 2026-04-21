import fs from 'node:fs';

export class CodebaseLoadError extends Error {
  constructor(id, reason) {
    super(`failed to load codebase '${id}': ${reason}`);
    this.name = 'CodebaseLoadError';
    this.code = 'codebase_load_failed';
  }
}

function buildIndex(id, filePath, raw, mtime) {
  const nodes = new Map();
  const hookByName = new Map();
  const fileByPath = new Map();

  for (const node of raw.nodes ?? []) {
    nodes.set(node.id, node);
    if (node.type === 'hook' && typeof node.name === 'string') {
      hookByName.set(node.name, node);
    } else if (node.type === 'file' && typeof node.path === 'string') {
      fileByPath.set(node.path, node);
    }
  }

  const firesByHook = new Map();
  const listensByHook = new Map();
  const edgesByFile = new Map();
  const allEdges = [];

  for (const edge of raw.edges ?? []) {
    allEdges.push(edge);

    if (edge.type === 'fires') {
      const bucket = firesByHook.get(edge.target) ?? [];
      bucket.push(edge);
      firesByHook.set(edge.target, bucket);
    } else if (edge.type === 'listens') {
      const bucket = listensByHook.get(edge.target) ?? [];
      bucket.push(edge);
      listensByHook.set(edge.target, bucket);
    }

    const fileBucket = edgesByFile.get(edge.source) ?? [];
    fileBucket.push(edge);
    edgesByFile.set(edge.source, fileBucket);
  }

  return {
    id,
    path: filePath,
    mtime,
    meta: raw.metadata ?? {},
    nodes,
    hookByName,
    fileByPath,
    firesByHook,
    listensByHook,
    edgesByFile,
    allEdges,
  };
}

export function createIndex() {
  const cache = new Map();

  function get(entry) {
    const { id, path: filePath } = entry;
    let mtimeMs;
    try {
      mtimeMs = fs.statSync(filePath).mtimeMs;
    } catch (err) {
      throw new CodebaseLoadError(id, err.message);
    }

    const cached = cache.get(filePath);
    if (cached && cached.mtime === mtimeMs) {
      return cached;
    }

    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new CodebaseLoadError(id, err.message);
    }

    let raw;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new CodebaseLoadError(id, `invalid JSON: ${err.message}`);
    }

    const built = buildIndex(id, filePath, raw, mtimeMs);
    cache.set(filePath, built);
    return built;
  }

  function clear() {
    cache.clear();
  }

  return { get, clear };
}
