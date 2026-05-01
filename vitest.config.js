import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: '.',
  test: {
    include: ['packages/viewer/src/**/*.test.js', 'packages/mcp/tests/**/*.test.js'],
  },
});
