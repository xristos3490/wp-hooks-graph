import { describe, test, expect } from 'vitest';
import * as tool from '../../src/mcp/tools/hooks_in_file.js';
import { makeCtx } from './helpers.js';

describe('hooks_in_file', () => {
  test('lists every hook edge in a file with edge_type and optional listen fields', () => {
    const result = tool.handler(
      { file_path: 'plugin.php', codebase: 'alpha' },
      makeCtx(),
    );
    expect(result.total).toBe(4);
    const byHook = Object.fromEntries(result.results.map((r) => [`${r.hook}@${r.line}`, r]));
    expect(byHook['init@20']).toEqual({
      hook: 'init',
      edge_type: 'listens',
      line: 20,
      callback: 'alpha_setup',
      priority: 10,
      scope_function: 'alpha_boot',
    });
  });

  test('fires edges omit callback/priority/scope_function', () => {
    const result = tool.handler({ file_path: 'core.php', codebase: 'alpha' }, makeCtx());
    const fires = result.results.filter((r) => r.edge_type === 'fires');
    expect(fires.length).toBeGreaterThan(0);
    for (const f of fires) {
      expect(f.callback).toBeUndefined();
      expect(f.priority).toBeUndefined();
      expect(f.scope_function).toBeUndefined();
    }
  });

  test('empty structured result when file unknown', () => {
    const result = tool.handler({ file_path: 'no-such-file.php', codebase: 'alpha' }, makeCtx());
    expect(result).toEqual({ total: 0, has_more: false, results: [] });
  });
});
