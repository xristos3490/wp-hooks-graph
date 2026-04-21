import { describe, test, expect } from 'vitest';
import * as tool from '../../src/mcp/tools/search_callbacks.js';
import { makeCtx } from './helpers.js';

describe('search_callbacks', () => {
  test('case-insensitive match within a codebase', () => {
    const result = tool.handler({ substring: 'ALPHA_SAVE', codebase: 'alpha' }, makeCtx());
    expect(result.total).toBe(1);
    expect(result.results[0]).toMatchObject({
      codebase: 'alpha',
      hook: 'save_post_*',
      file: 'plugin.php',
      line: 70,
      callback: 'alpha_save',
      priority: 10,
    });
  });

  test('cross-codebase search includes codebase id on each hit, deterministic order', () => {
    // 't' appears in alpha_setup / alpha_filter_content / alpha_extras_hook and beta_boot.
    const result = tool.handler({ substring: 't' }, makeCtx());
    const labels = result.results.map((r) => r.codebase);
    const sorted = [...labels].sort();
    expect(labels).toEqual(sorted);
    expect(new Set(labels)).toEqual(new Set(['alpha', 'beta', 'gamma']));
  });

  test('matches callback_method when different from callback', () => {
    const result = tool.handler({ substring: 'loader::register', codebase: 'alpha' }, makeCtx());
    expect(result.total).toBe(1);
    expect(result.results[0].callback).toBe('Alpha\\Loader::register');
  });

  test('empty result for no match', () => {
    const result = tool.handler({ substring: 'xxxxx' }, makeCtx());
    expect(result).toEqual({ total: 0, has_more: false, results: [] });
  });

  test('pagination works across merged results', () => {
    const ctx = makeCtx();
    const all = tool.handler({ substring: 'alpha' }, ctx);
    const limited = tool.handler({ substring: 'alpha', limit: 1, offset: 0 }, ctx);
    expect(limited.total).toBe(all.total);
    expect(limited.results).toHaveLength(1);
    expect(limited.has_more).toBe(all.total > 1);
  });
});
