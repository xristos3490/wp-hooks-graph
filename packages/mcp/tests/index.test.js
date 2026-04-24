import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIndex, CodebaseLoadError } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures');

describe('index.get', () => {
  test('builds indexes for a codebase', () => {
    const idx = createIndex();
    const entry = {
      id: 'alpha',
      path: path.join(fixtureDir, 'alpha.json'),
      mtime: fs.statSync(path.join(fixtureDir, 'alpha.json')).mtimeMs,
    };
    const built = idx.get(entry);

    expect(built.id).toBe('alpha');
    expect(built.meta.source_labels).toEqual(['alpha']);
    expect(built.nodes.size).toBe(8);

    expect(built.hookByName.has('init')).toBe(true);
    expect(built.hookByName.get('init').hook_type).toBe('action');
    expect(built.hookByName.has('the_content')).toBe(true);

    expect(built.fileByPath.get('core.php').id).toBe('file::alpha::core.php');

    expect(built.listensByHook.get('hook::init')).toHaveLength(3);
    expect(built.firesByHook.get('hook::init')).toHaveLength(1);
    expect(built.firesByHook.get('hook::the_content')).toHaveLength(1);

    expect(built.edgesByFile.get('file::alpha::plugin.php')).toHaveLength(5);

    expect(built.allEdges.length).toBeGreaterThan(0);
  });

  test('returns cached index when mtime unchanged', () => {
    const idx = createIndex();
    const entry = {
      id: 'alpha',
      path: path.join(fixtureDir, 'alpha.json'),
      mtime: fs.statSync(path.join(fixtureDir, 'alpha.json')).mtimeMs,
    };
    const a = idx.get(entry);
    const b = idx.get(entry);
    expect(a).toBe(b);
  });

  test('rebuilds when mtime changes', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-mcp-index-'));
    try {
      const file = path.join(tmp, 'x.json');
      fs.writeFileSync(
        file,
        JSON.stringify({
          metadata: { source_labels: ['v1'] },
          nodes: [{ id: 'hook::a', type: 'hook', name: 'a', hook_type: 'action' }],
          edges: [],
        }),
      );
      const idx = createIndex();
      const first = idx.get({ id: 'x', path: file });
      expect(first.hookByName.has('a')).toBe(true);
      expect(first.hookByName.has('b')).toBe(false);

      const later = Date.now() / 1000 + 10;
      fs.writeFileSync(
        file,
        JSON.stringify({
          metadata: { source_labels: ['v2'] },
          nodes: [{ id: 'hook::b', type: 'hook', name: 'b', hook_type: 'filter' }],
          edges: [],
        }),
      );
      fs.utimesSync(file, later, later);

      const second = idx.get({ id: 'x', path: file });
      expect(second).not.toBe(first);
      expect(second.hookByName.has('b')).toBe(true);
      expect(second.hookByName.has('a')).toBe(false);
      expect(second.meta.source_labels).toEqual(['v2']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('throws CodebaseLoadError when file missing', () => {
    const idx = createIndex();
    expect(() => idx.get({ id: 'missing', path: '/nonexistent/path.json' })).toThrow(CodebaseLoadError);
  });

  test('throws CodebaseLoadError on invalid JSON', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-mcp-index-'));
    try {
      const file = path.join(tmp, 'bad.json');
      fs.writeFileSync(file, '{ not json');
      const idx = createIndex();
      expect(() => idx.get({ id: 'bad', path: file })).toThrow(/invalid JSON/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
