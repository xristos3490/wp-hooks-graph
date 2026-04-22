import { describe, test, expect } from 'vitest';
import * as tool from '../src/tools/hotspots.js';
import { makeCtx } from './helpers.js';

describe('hotspots', () => {
  test('sorts by total desc by default', () => {
    const result = tool.handler({ codebase: 'alpha' }, makeCtx());
    expect(result[0].hook).toBe('init');
    expect(result[0].total).toBe(4);
    expect(result[0].fire_count).toBe(1);
    expect(result[0].listen_count).toBe(3);
  });

  test('metric=fires sorts by fire_count', () => {
    const result = tool.handler({ codebase: 'alpha', metric: 'fires' }, makeCtx());
    for (let i = 1; i < result.length; i++) {
      expect(result[i].fire_count).toBeLessThanOrEqual(result[i - 1].fire_count);
    }
  });

  test('metric=listens sorts by listen_count', () => {
    const result = tool.handler({ codebase: 'alpha', metric: 'listens' }, makeCtx());
    expect(result[0].hook).toBe('init');
    expect(result[0].listen_count).toBe(3);
  });

  test('limit caps results', () => {
    const result = tool.handler({ codebase: 'alpha', limit: 2 }, makeCtx());
    expect(result).toHaveLength(2);
  });
});
