import { describe, test, expect } from 'vitest';
import * as tool from '../src/tools/listeners_of.js';
import { makeCtx } from './helpers.js';

describe('listeners_of', () => {
  test('returns all listeners with full result shape', () => {
    const result = tool.handler({ hook: 'init', codebase: 'alpha' }, makeCtx());
    expect(result.total).toBe(3);
    expect(result.has_more).toBe(false);
    expect(result.results).toHaveLength(3);
    expect(result.results[0]).toEqual({
      file: 'plugin.php',
      line: 20,
      callback: 'alpha_setup',
      callback_type: 'function',
      priority: 10,
      scope_function: 'alpha_boot',
    });
  });

  test('paginates with limit and offset', () => {
    const ctx = makeCtx();
    const page1 = tool.handler({ hook: 'init', codebase: 'alpha', limit: 2, offset: 0 }, ctx);
    expect(page1.total).toBe(3);
    expect(page1.has_more).toBe(true);
    expect(page1.results).toHaveLength(2);

    const page2 = tool.handler({ hook: 'init', codebase: 'alpha', limit: 2, offset: 2 }, ctx);
    expect(page2.has_more).toBe(false);
    expect(page2.results).toHaveLength(1);

    const page3 = tool.handler({ hook: 'init', codebase: 'alpha', limit: 2, offset: 10 }, ctx);
    expect(page3).toEqual({ total: 3, has_more: false, results: [] });
  });

  test('returns empty structured result when hook absent', () => {
    const result = tool.handler({ hook: 'nonexistent', codebase: 'alpha' }, makeCtx());
    expect(result).toEqual({ total: 0, has_more: false, results: [] });
  });
});
