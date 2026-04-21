import { describe, test, expect } from 'vitest';
import * as tool from '../../src/mcp/tools/find_hook.js';
import { UnknownCodebaseError } from '../../src/mcp/registry.js';
import { makeCtx } from './helpers.js';

describe('find_hook', () => {
  test('returns hook summary when codebase + name match', () => {
    const result = tool.handler({ name: 'init', codebase: 'alpha' }, makeCtx());
    expect(result).toMatchObject({
      id: 'hook::init',
      name: 'init',
      hook_type: 'action',
      fire_count: 1,
      listen_count: 3,
      dynamic: false,
      sources: ['alpha'],
    });
  });

  test('returns null when hook missing in given codebase', () => {
    const result = tool.handler({ name: 'no_such_hook', codebase: 'alpha' }, makeCtx());
    expect(result).toBeNull();
  });

  test('cross-codebase returns all matches with codebase field', () => {
    const result = tool.handler({ name: 'init' }, makeCtx());
    expect(Array.isArray(result)).toBe(true);
    expect(result.map((r) => r.codebase).sort()).toEqual(['alpha', 'beta']);
  });

  test('cross-codebase returns empty array when nothing matches', () => {
    const result = tool.handler({ name: 'no_such_hook' }, makeCtx());
    expect(result).toEqual([]);
  });

  test('throws UnknownCodebaseError on bad codebase', () => {
    expect(() => tool.handler({ name: 'init', codebase: 'nope' }, makeCtx())).toThrow(
      UnknownCodebaseError,
    );
  });
});
