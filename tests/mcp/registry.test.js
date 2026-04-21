import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRegistry, UnknownCodebaseError, MissingStorageError } from '../../src/mcp/registry.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-mcp-registry-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function seed(name, content = '{}') {
  fs.writeFileSync(path.join(tmpDir, name), content);
}

describe('registry.list', () => {
  test('returns sorted *.json files with id (stem) and mtime', () => {
    seed('gutenberg.json');
    seed('woocommerce-bookings.json');
    seed('wp-includes.json');
    seed('README.md');

    const reg = createRegistry({ storageDir: tmpDir });
    const entries = reg.list();

    expect(entries.map((e) => e.id)).toEqual([
      'gutenberg',
      'woocommerce-bookings',
      'wp-includes',
    ]);
    for (const e of entries) {
      expect(e.path.startsWith(tmpDir)).toBe(true);
      expect(typeof e.mtime).toBe('number');
    }
  });

  test('returns empty array on empty dir', () => {
    const reg = createRegistry({ storageDir: tmpDir });
    expect(reg.list()).toEqual([]);
  });

  test('picks up files added between calls (rescans on every call)', () => {
    seed('one.json');
    const reg = createRegistry({ storageDir: tmpDir });
    expect(reg.list().map((e) => e.id)).toEqual(['one']);
    seed('two.json');
    expect(reg.list().map((e) => e.id)).toEqual(['one', 'two']);
  });

  test('throws MissingStorageError when storage dir does not exist', () => {
    const reg = createRegistry({ storageDir: path.join(tmpDir, 'nope') });
    expect(() => reg.list()).toThrow(MissingStorageError);
  });
});

describe('registry.resolve', () => {
  test('returns entry when id matches a file stem', () => {
    seed('gutenberg.json');
    const reg = createRegistry({ storageDir: tmpDir });
    const entry = reg.resolve('gutenberg');
    expect(entry.id).toBe('gutenberg');
    expect(entry.path).toBe(path.join(tmpDir, 'gutenberg.json'));
  });

  test('throws UnknownCodebaseError listing available ids', () => {
    seed('gutenberg.json');
    seed('woocommerce-bookings.json');
    const reg = createRegistry({ storageDir: tmpDir });
    try {
      reg.resolve('gutenburg');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownCodebaseError);
      expect(err.message).toContain("unknown codebase 'gutenburg'");
      expect(err.message).toContain('gutenberg');
      expect(err.message).toContain('woocommerce-bookings');
      expect(err.available).toEqual(['gutenberg', 'woocommerce-bookings']);
    }
  });

  test('unknown-codebase message handles empty storage', () => {
    const reg = createRegistry({ storageDir: tmpDir });
    try {
      reg.resolve('anything');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownCodebaseError);
      expect(err.message).toContain('(none)');
    }
  });
});
