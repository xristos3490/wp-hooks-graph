import { describe, test, expect } from 'vitest';
import * as tool from '../src/tools/firers_of.js';
import { makeCtx } from './helpers.js';

describe('firers_of', () => {
  test('returns fires edges with listener-shape keys (null callback etc.)', () => {
    const result = tool.handler({ hook: 'init', codebase: 'alpha' }, makeCtx());
    expect(result.total).toBe(1);
    expect(result.results[0]).toEqual({
      file: 'core.php',
      line: 10,
      callback: null,
      callback_type: null,
      priority: null,
      scope_function: 'bootstrap',
    });
  });

  test('empty result for hook with no fires', () => {
    const result = tool.handler({ hook: 'save_post_*', codebase: 'alpha' }, makeCtx());
    expect(result).toEqual({ total: 0, has_more: false, results: [] });
  });
});
