import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from '../src/registry.js';
import { createIndex } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const fixturesDir = path.join(__dirname, 'fixtures');

export function makeCtx(storageDir = fixturesDir) {
  const registry = createRegistry({ storageDir });
  const index = createIndex();
  return { registry, index };
}
