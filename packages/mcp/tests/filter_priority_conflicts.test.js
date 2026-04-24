import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';
import * as tool from '../src/tools/filter_priority_conflicts.js';
import { UnknownCodebaseError } from '../src/registry.js';
import { makeCtx } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collisionsDir = path.join(__dirname, 'fixtures-collisions');
const ctx = () => makeCtx(collisionsDir);

describe('filter_priority_conflicts', () => {
  test('returns only filter collisions — actions excluded', () => {
    const result = tool.handler({}, ctx());
    // init is an action — excluded. the_content is a filter — included.
    expect(result.total).toBe(1);
    expect(result.results[0].hook).toBe('the_content');
  });

  test('action hooks never appear even when named explicitly', () => {
    const result = tool.handler({ hook: 'init' }, ctx());
    expect(result.total).toBe(0);
    expect(result.results).toEqual([]);
  });

  test('collisions include only priorities shared by ≥min_codebases', () => {
    const { results } = tool.handler({ hook: 'the_content' }, ctx());
    expect(results[0].collisions).toHaveLength(1);
    expect(results[0].collisions[0].priority).toBe(10);
    expect(results[0].collisions[0].codebases).toEqual(['alpha', 'beta']);
  });

  test('excludes hooks where only one codebase registers at a priority', () => {
    const { results } = tool.handler({}, ctx());
    expect(results.find((r) => r.hook === 'alpha_only')).toBeUndefined();
  });

  test('listeners within a collision sorted by codebase then file:line', () => {
    const { results } = tool.handler({ hook: 'the_content' }, ctx());
    const keys = results[0].collisions[0].listeners.map((l) => [l.codebase, l.file, l.line]);
    expect(keys).toEqual([
      ['alpha', 'plugin.php', 30],
      ['beta', 'main.php', 25],
    ]);
  });

  test('listener objects carry codebase, callback, priority', () => {
    const { results } = tool.handler({ hook: 'the_content' }, ctx());
    expect(results[0].collisions[0].listeners[0]).toMatchObject({
      codebase: 'alpha',
      file: 'plugin.php',
      line: 30,
      callback: 'alpha_filter_content',
      priority: 10,
    });
  });

  test('hook_type_by_codebase populated per codebase', () => {
    const { results } = tool.handler({ hook: 'the_content' }, ctx());
    expect(results[0].hook_type_by_codebase).toEqual({
      alpha: 'filter',
      beta: 'filter',
    });
  });

  test('exact hook returns result', () => {
    const result = tool.handler({ hook: 'the_content' }, ctx());
    expect(result.total).toBe(1);
    expect(result.query).toMatchObject({ hook: 'the_content', min_codebases: 2 });
  });

  test('exact hook with no collisions returns empty', () => {
    const result = tool.handler({ hook: 'alpha_only' }, ctx());
    expect(result.total).toBe(0);
    expect(result.results).toEqual([]);
  });

  test('substring filter case-insensitive on hook name', () => {
    const result = tool.handler({ substring: 'CONTENT' }, ctx());
    expect(result.results.map((r) => r.hook)).toEqual(['the_content']);
  });

  test('codebases filter narrows scan set', () => {
    const result = tool.handler({ codebases: ['alpha', 'beta'] }, ctx());
    expect(result.results[0].hook).toBe('the_content');
    expect(result.results[0].collisions[0].codebases).toEqual(['alpha', 'beta']);
  });

  test('pagination caps results and reports has_more', () => {
    const all = tool.handler({}, ctx());
    const limited = tool.handler({ limit: 1 }, ctx());
    expect(limited.total).toBe(all.total);
    expect(limited.results).toHaveLength(1);
    expect(limited.has_more).toBe(all.total > 1);
  });

  test('throws when both hook and substring provided', () => {
    expect(() => tool.handler({ hook: 'the_content', substring: 'content' }, ctx())).toThrow(
      /at most one/,
    );
  });

  test('throws UnknownCodebaseError on bad codebase in filter', () => {
    expect(() => tool.handler({ codebases: ['nope'] }, ctx())).toThrow(UnknownCodebaseError);
  });
});
