import { describe, test, expect } from 'vitest';
import { paginate } from '../../src/mcp/lib/paginate.js';

describe('paginate', () => {
  const items = [1, 2, 3, 4, 5];

  test('returns full page when limit exceeds total', () => {
    expect(paginate(items, 10, 0)).toEqual({ total: 5, has_more: false, results: [1, 2, 3, 4, 5] });
  });

  test('slices to limit and reports has_more', () => {
    expect(paginate(items, 2, 0)).toEqual({ total: 5, has_more: true, results: [1, 2] });
  });

  test('respects offset', () => {
    expect(paginate(items, 2, 2)).toEqual({ total: 5, has_more: true, results: [3, 4] });
  });

  test('offset at end returns empty but correct total', () => {
    expect(paginate(items, 2, 5)).toEqual({ total: 5, has_more: false, results: [] });
  });

  test('offset beyond total returns empty', () => {
    expect(paginate(items, 10, 100)).toEqual({ total: 5, has_more: false, results: [] });
  });

  test('empty array', () => {
    expect(paginate([], 10, 0)).toEqual({ total: 0, has_more: false, results: [] });
  });
});
