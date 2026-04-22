import { describe, test, expect } from 'vitest';
import * as tool from '../src/tools/compare_hook.js';
import { UnknownCodebaseError } from '../src/registry.js';
import { makeCtx } from './helpers.js';

describe('compare_hook', () => {
  test('exact hook name returns a single match with all codebases pivoted', () => {
    const result = tool.handler({ hook: 'init' }, makeCtx());
    expect(result.query).toEqual({ hook: 'init' });
    expect(result.total).toBe(1);
    expect(result.capped).toBe(false);
    expect(result.matches).toHaveLength(1);

    const [match] = result.matches;
    expect(match.hook).toBe('init');
    expect(match.hook_type_by_codebase).toEqual({
      alpha: 'action',
      beta: 'action',
      gamma: 'action',
    });
    expect(match.fires).toHaveLength(1);
    expect(match.fires[0]).toMatchObject({ codebase: 'alpha', file: 'core.php', line: 10 });
    expect(match.listeners).toHaveLength(6);
  });

  test('listeners are sorted by priority ASC, then codebase, then file:line', () => {
    const { matches } = tool.handler({ hook: 'init' }, makeCtx());
    const order = matches[0].listeners.map((l) => ({
      p: l.priority,
      c: l.codebase,
      f: l.file,
      line: l.line,
    }));
    expect(order).toEqual([
      { p: 5, c: 'beta', f: 'main.php', line: 15 },
      { p: 10, c: 'alpha', f: 'extras.php', line: 5 },
      { p: 10, c: 'alpha', f: 'plugin.php', line: 20 },
      { p: 15, c: 'gamma', f: 'plugin.php', line: 10 },
      { p: 20, c: 'alpha', f: 'plugin.php', line: 25 },
      { p: 50, c: 'gamma', f: 'plugin.php', line: 11 },
    ]);
  });

  test('exact hook with no match returns empty matches array', () => {
    const result = tool.handler({ hook: 'no_such_hook' }, makeCtx());
    expect(result.total).toBe(0);
    expect(result.matches).toEqual([]);
  });

  test('substring returns all matching hooks, alphabetically', () => {
    const result = tool.handler({ substring: 'init' }, makeCtx());
    expect(result.query).toEqual({ substring: 'init' });
    expect(result.matches.map((m) => m.hook)).toEqual(['init', 'init_extra']);
    const initExtra = result.matches.find((m) => m.hook === 'init_extra');
    expect(initExtra.hook_type_by_codebase).toEqual({ gamma: 'action' });
    expect(initExtra.listeners).toHaveLength(1);
    expect(initExtra.listeners[0]).toMatchObject({
      codebase: 'gamma',
      callback: 'gamma_init_extra',
      priority: 10,
    });
  });

  test('substring is case-insensitive', () => {
    const result = tool.handler({ substring: 'InIt' }, makeCtx());
    expect(result.matches.map((m) => m.hook)).toEqual(['init', 'init_extra']);
  });

  test('codebases filter narrows both candidate discovery and the pivot', () => {
    const result = tool.handler(
      { substring: 'init', codebases: ['alpha', 'beta'] },
      makeCtx(),
    );
    expect(result.matches.map((m) => m.hook)).toEqual(['init']);
    const init = result.matches[0];
    expect(Object.keys(init.hook_type_by_codebase).sort()).toEqual(['alpha', 'beta']);
    expect(init.listeners.every((l) => l.codebase === 'alpha' || l.codebase === 'beta')).toBe(true);
  });

  test('divergent hook_type surfaces per codebase', () => {
    const result = tool.handler({ hook: 'the_content' }, makeCtx());
    expect(result.matches[0].hook_type_by_codebase).toEqual({
      alpha: 'filter',
      gamma: 'action',
    });
  });

  test('throws when neither hook nor substring is provided', () => {
    expect(() => tool.handler({}, makeCtx())).toThrow(/exactly one/);
  });

  test('throws when both hook and substring are provided', () => {
    expect(() => tool.handler({ hook: 'init', substring: 'init' }, makeCtx())).toThrow(
      /exactly one/,
    );
  });

  test('pagination caps matches and reports has_more', () => {
    const ctx = makeCtx();
    const all = tool.handler({ substring: 'init' }, ctx);
    const limited = tool.handler({ substring: 'init', limit: 1 }, ctx);
    expect(limited.total).toBe(all.total);
    expect(limited.matches).toHaveLength(1);
    expect(limited.has_more).toBe(all.total > 1);
  });

  test('CANDIDATE_CAP is set defensively at 500', () => {
    expect(tool.CANDIDATE_CAP).toBe(500);
  });

  test('throws UnknownCodebaseError on bad codebase in filter', () => {
    expect(() => tool.handler({ hook: 'init', codebases: ['nope'] }, makeCtx())).toThrow(
      UnknownCodebaseError,
    );
  });
});
