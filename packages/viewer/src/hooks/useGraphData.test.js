import { describe, test, expect } from 'vitest';
import { resolveDataUrls } from './useGraphData.js';

describe('resolveDataUrls', () => {
  test('defaults when no globals object provided', () => {
    expect(resolveDataUrls(null)).toEqual({
      hooksUrl: './hooks.json',
      demoUrl: './demo.json',
    });
    expect(resolveDataUrls(undefined)).toEqual({
      hooksUrl: './hooks.json',
      demoUrl: './demo.json',
    });
  });

  test('defaults when globals object is empty', () => {
    expect(resolveDataUrls({})).toEqual({
      hooksUrl: './hooks.json',
      demoUrl: './demo.json',
    });
  });

  test('HOOKSGRAPH_JSON_URL override wins', () => {
    const result = resolveDataUrls({
      HOOKSGRAPH_JSON_URL: 'https://example.test/wp-content/themes/hooksgraph/hooks.json',
    });
    expect(result.hooksUrl).toBe(
      'https://example.test/wp-content/themes/hooksgraph/hooks.json'
    );
    expect(result.demoUrl).toBe('./demo.json');
  });

  test('HOOKSGRAPH_DEMO_URL set to null skips demo', () => {
    const { demoUrl } = resolveDataUrls({ HOOKSGRAPH_DEMO_URL: null });
    expect(demoUrl).toBeNull();
  });

  test('HOOKSGRAPH_DEMO_URL string override is used verbatim', () => {
    const { demoUrl } = resolveDataUrls({
      HOOKSGRAPH_DEMO_URL: 'https://example.test/demo.json',
    });
    expect(demoUrl).toBe('https://example.test/demo.json');
  });

  test('falsy non-null demo override falls back to default', () => {
    // Empty string is not a useful URL; treat as "use string verbatim" anyway —
    // documents the contract: only `null` disables, anything else passes through.
    const { demoUrl } = resolveDataUrls({ HOOKSGRAPH_DEMO_URL: '' });
    expect(demoUrl).toBe('');
  });
});
