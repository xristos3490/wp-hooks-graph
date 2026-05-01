import { describe, test, expect } from 'vitest';
import * as tool from '../src/tools/shared_hooks.js';
import { UnknownCodebaseError } from '../src/registry.js';
import { makeCtx } from './helpers.js';

describe('shared_hooks', () => {
  test('defaults return hooks present in 2+ codebases, sorted by source_count desc', () => {
    const result = tool.handler({}, makeCtx());
    expect(result.total).toBe(3);
    expect(result.has_more).toBe(false);
    const [first, second] = result.results;
    expect(first.hook).toBe('init');
    expect(first.sources).toEqual(['alpha', 'beta', 'gamma']);
    expect(first.hook_type).toBe('action');
    expect(first.hook_type_divergence).toBe(false);
    expect(first.total_fires).toBe(1);
    expect(first.total_listens).toBe(6);
    expect(second.hook).toBe('the_content');
    expect(second.sources).toEqual(['alpha', 'gamma']);
  });

  test('flags hook_type_divergence when sources disagree on action vs filter', () => {
    const result = tool.handler({}, makeCtx());
    const theContent = result.results.find((r) => r.hook === 'the_content');
    expect(theContent.hook_type_divergence).toBe(true);
  });

  test('substring filter applies case-insensitively to hook name', () => {
    const result = tool.handler({ substring: 'INIT' }, makeCtx());
    expect(result.results.map((r) => r.hook)).toEqual(['init']);
  });

  test('min_sources raises the threshold', () => {
    const result = tool.handler({ min_sources: 3 }, makeCtx());
    expect(result.results.map((r) => r.hook)).toEqual(['init']);
  });

  test('sort=total_activity orders by fires+listens desc', () => {
    const result = tool.handler({ sort: 'total_activity' }, makeCtx());
    expect(result.results[0].hook).toBe('init');
    expect(result.results[0].total_fires + result.results[0].total_listens).toBe(7);
  });

  test('codebases filter narrows the scan set', () => {
    const result = tool.handler({ codebases: ['alpha', 'gamma'] }, makeCtx());
    const hooks = result.results.map((r) => r.hook).sort();
    expect(hooks).toEqual(['init', 'the_content']);
    const init = result.results.find((r) => r.hook === 'init');
    expect(init.sources).toEqual(['alpha', 'gamma']);
  });

  test('pagination limits and reports total', () => {
    const ctx = makeCtx();
    const all = tool.handler({}, ctx);
    const limited = tool.handler({ limit: 1, offset: 0 }, ctx);
    expect(limited.total).toBe(all.total);
    expect(limited.results).toHaveLength(1);
    expect(limited.has_more).toBe(all.total > 1);
  });

  test('per_codebase entries are sorted by codebase id', () => {
    const result = tool.handler({}, makeCtx());
    const init = result.results.find((r) => r.hook === 'init');
    expect(init.per_codebase.map((p) => p.codebase)).toEqual(['alpha', 'beta', 'gamma']);
  });

  test('throws UnknownCodebaseError on bad codebase in filter', () => {
    expect(() => tool.handler({ codebases: ['alpha', 'nope'] }, makeCtx())).toThrow(
      UnknownCodebaseError
    );
  });
});
