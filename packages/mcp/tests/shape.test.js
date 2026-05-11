import { describe, test, expect } from 'vitest';
import {
  listenerResult,
  firerResult,
  fileEdgeResult,
  callbackSearchResult,
  codebasedListenerResult,
} from '../src/lib/shape.js';

const stubIndex = { nodes: new Map() };

const baseListener = {
  source: 'file::alpha::plugin.php',
  target: 'hook::the_content',
  type: 'listens',
  line: 42,
  callback: 'Alpha\\Filter::content',
  callback_type: 'static_method',
  priority: 10,
  scope_function: 'init',
};

const fullMetadata = {
  effects: ['reads_option'],
  targets: [{ kind: 'option', key: 'siteurl', op: 'read', confidence: 'literal' }],
  called_apis: ['get_option'],
  filter_behavior: { return_origin: 'input_mutated', mutates_input: true, modified_paths: ['arg0[title]'] },
};

describe('shape helpers — callback metadata pass-through', () => {
  test('listenerResult surfaces effects / targets / called_apis / filter_behavior when present', () => {
    const out = listenerResult({ ...baseListener, ...fullMetadata }, stubIndex);
    expect(out).toMatchObject(fullMetadata);
    expect(out).toMatchObject({
      file: 'plugin.php',
      line: 42,
      callback: 'Alpha\\Filter::content',
      priority: 10,
    });
  });

  test('listenerResult omits metadata keys entirely when edge has none', () => {
    const out = listenerResult(baseListener, stubIndex);
    expect(out).not.toHaveProperty('effects');
    expect(out).not.toHaveProperty('targets');
    expect(out).not.toHaveProperty('called_apis');
    expect(out).not.toHaveProperty('filter_behavior');
  });

  test('listenerResult preserves empty arrays and explicit nulls (absence ≠ empty)', () => {
    const out = listenerResult({ ...baseListener, effects: [], targets: [] }, stubIndex);
    expect(out.effects).toEqual([]);
    expect(out.targets).toEqual([]);
    expect(out).not.toHaveProperty('filter_behavior');
  });

  test('firerResult surfaces metadata when an action callback has effects', () => {
    const fireEdge = {
      source: 'file::alpha::plugin.php',
      target: 'hook::my_event',
      type: 'fires',
      line: 7,
      scope_function: 'bootstrap',
      effects: ['fires_hook'],
      targets: [{ kind: 'hook_fire', key: 'my_event', op: 'fire', confidence: 'literal' }],
    };
    const out = firerResult(fireEdge, stubIndex);
    expect(out.effects).toEqual(['fires_hook']);
    expect(out.targets).toHaveLength(1);
  });

  test('fileEdgeResult includes metadata on listen rows', () => {
    const out = fileEdgeResult({ ...baseListener, ...fullMetadata }, stubIndex);
    expect(out.edge_type).toBe('listens');
    expect(out).toMatchObject(fullMetadata);
  });

  test('callbackSearchResult includes metadata', () => {
    const out = callbackSearchResult({ ...baseListener, ...fullMetadata }, 'alpha', stubIndex);
    expect(out.codebase).toBe('alpha');
    expect(out).toMatchObject(fullMetadata);
  });

  test('codebasedListenerResult includes metadata (compare_hook / filter_priority_conflicts path)', () => {
    const out = codebasedListenerResult({ ...baseListener, ...fullMetadata }, 'alpha', stubIndex);
    expect(out.codebase).toBe('alpha');
    expect(out).toMatchObject(fullMetadata);
  });
});
