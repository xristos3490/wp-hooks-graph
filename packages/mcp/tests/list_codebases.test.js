import { describe, test, expect } from 'vitest';
import * as tool from '../src/tools/list_codebases.js';
import { makeCtx } from './helpers.js';

describe('list_codebases', () => {
  test('returns entries sorted by id with metadata', () => {
    const result = tool.handler({}, makeCtx());
    expect(result.map((r) => r.id)).toEqual(['alpha', 'beta', 'gamma']);

    const alpha = result.find((r) => r.id === 'alpha');
    expect(alpha.source_labels).toEqual(['alpha']);
    expect(alpha.total_files).toBe(3);
    expect(alpha.total_hooks).toBe(5);
    expect(alpha.dynamic_hooks).toBe(1);
    expect(alpha.scan_date).toBe('2026-04-21T00:00:00+00:00');
    expect(alpha.path.endsWith('alpha.json')).toBe(true);
  });
});
