import { describe, test, expect } from 'vitest';
import * as tool from '../src/tools/filter_priority_conflicts.js';
import { UnknownCodebaseError } from '../src/registry.js';
import { makeCtx } from './helpers.js';

describe('filter_priority_conflicts', () => {
  test('returns only filter collisions — actions excluded', () => {
    const result = tool.handler({}, makeCtx());
    // wp_query_vars (filter, p10) conflicts across alpha+beta.
    // init is an action — excluded. the_content has no cross-codebase filter collision.
    expect(result.total).toBe(1);
    expect(result.results[0].hook).toBe('wp_query_vars');
  });

  test('action hooks never appear even when named explicitly', () => {
    const result = tool.handler({ hook: 'init' }, makeCtx());
    expect(result.total).toBe(0);
    expect(result.results).toEqual([]);
  });

  test('collisions include only priorities shared by ≥min_codebases', () => {
    const { results } = tool.handler({ hook: 'wp_query_vars' }, makeCtx());
    expect(results[0].collisions).toHaveLength(1);
    expect(results[0].collisions[0].priority).toBe(10);
    expect(results[0].collisions[0].codebases).toEqual(['alpha', 'beta']);
  });

  test('excludes hooks where only one codebase registers at a priority', () => {
    // the_content: alpha listens p10 as filter, gamma listens p10 as action (excluded) — no collision.
    const result = tool.handler({ hook: 'the_content' }, makeCtx());
    expect(result.total).toBe(0);
  });

  test('listeners within a collision sorted by codebase then file:line', () => {
    const { results } = tool.handler({ hook: 'wp_query_vars' }, makeCtx());
    const keys = results[0].collisions[0].listeners.map((l) => [l.codebase, l.file, l.line]);
    expect(keys).toEqual([
      ['alpha', 'plugin.php', 90],
      ['beta', 'main.php', 45],
    ]);
  });

  test('listener objects carry codebase, callback, priority', () => {
    const { results } = tool.handler({ hook: 'wp_query_vars' }, makeCtx());
    expect(results[0].collisions[0].listeners[0]).toMatchObject({
      codebase: 'alpha',
      file: 'plugin.php',
      line: 90,
      callback: 'alpha_query_vars',
      priority: 10,
    });
  });

  test('hook_type_by_codebase populated per codebase', () => {
    const { results } = tool.handler({ hook: 'wp_query_vars' }, makeCtx());
    expect(results[0].hook_type_by_codebase).toEqual({
      alpha: 'filter',
      beta: 'filter',
    });
  });

  test('exact hook returns result with query echoed', () => {
    const result = tool.handler({ hook: 'wp_query_vars' }, makeCtx());
    expect(result.total).toBe(1);
    expect(result.query).toMatchObject({ hook: 'wp_query_vars', min_codebases: 2 });
  });

  test('exact hook with no collisions returns empty', () => {
    const result = tool.handler({ hook: 'beta_only' }, makeCtx());
    expect(result.total).toBe(0);
    expect(result.results).toEqual([]);
  });

  test('substring filter case-insensitive on hook name', () => {
    const result = tool.handler({ substring: 'QUERY' }, makeCtx());
    expect(result.results.map((r) => r.hook)).toEqual(['wp_query_vars']);
  });

  test('codebases filter narrows scan set', () => {
    const result = tool.handler({ codebases: ['alpha', 'beta'] }, makeCtx());
    expect(result.results[0].hook).toBe('wp_query_vars');
    expect(result.results[0].collisions[0].codebases).toEqual(['alpha', 'beta']);
  });

  test('pagination caps results and reports has_more', () => {
    const all = tool.handler({}, makeCtx());
    const limited = tool.handler({ limit: 1 }, makeCtx());
    expect(limited.total).toBe(all.total);
    expect(limited.results).toHaveLength(1);
    expect(limited.has_more).toBe(all.total > 1);
  });

  test('throws when both hook and substring provided', () => {
    expect(() => tool.handler({ hook: 'wp_query_vars', substring: 'query' }, makeCtx())).toThrow(
      /at most one/
    );
  });

  test('throws UnknownCodebaseError on bad codebase in filter', () => {
    expect(() => tool.handler({ codebases: ['nope'] }, makeCtx())).toThrow(UnknownCodebaseError);
  });
});
