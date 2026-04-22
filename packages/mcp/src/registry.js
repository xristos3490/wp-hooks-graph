import fs from 'node:fs';
import path from 'node:path';

export class UnknownCodebaseError extends Error {
  constructor(id, available) {
    const list = available.length ? available.join(', ') : '(none)';
    super(`unknown codebase '${id}'. Available: ${list}`);
    this.name = 'UnknownCodebaseError';
    this.code = 'unknown_codebase';
    this.available = available;
  }
}

export class MissingStorageError extends Error {
  constructor(dir) {
    super(`storage directory not found: ${dir}`);
    this.name = 'MissingStorageError';
    this.code = 'missing_storage';
  }
}

export function createRegistry({ storageDir }) {
  const resolvedDir = path.resolve(storageDir);

  function list() {
    let entries;
    try {
      entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') throw new MissingStorageError(resolvedDir);
      throw err;
    }
    const out = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -'.json'.length);
      const filePath = path.join(resolvedDir, entry.name);
      let mtimeMs;
      try {
        mtimeMs = fs.statSync(filePath).mtimeMs;
      } catch {
        continue;
      }
      out.push({ id, path: filePath, mtime: mtimeMs });
    }
    out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
  }

  function resolve(id) {
    const entries = list();
    const match = entries.find((e) => e.id === id);
    if (!match) {
      throw new UnknownCodebaseError(id, entries.map((e) => e.id));
    }
    return match;
  }

  return { list, resolve, storageDir: resolvedDir };
}
