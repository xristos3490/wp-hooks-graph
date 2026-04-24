#!/usr/bin/env node
/**
 * Assemble packages/cli/ for npm publish:
 *   1. Build the viewer (pnpm -F viewer build).
 *   2. Validate parser composer.json.
 *   3. Install parser deps (no-dev, optimized autoloader).
 *   4. Copy parser src/vendor/*.php → packages/cli/php/.
 *   5. Copy viewer dist → packages/cli/dist/.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PARSER = path.join(ROOT, 'packages/parser');
const VIEWER = path.join(ROOT, 'packages/viewer');
const CLI = path.join(ROOT, 'packages/cli');
const CLI_PHP = path.join(CLI, 'php');
const CLI_DIST = path.join(CLI, 'dist');

function run(cmd, args, opts = {}) {
  process.stderr.write(`\n▶ ${cmd} ${args.join(' ')}\n`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.status !== 0) {
    process.stderr.write(`\nCommand failed: ${cmd} ${args.join(' ')}\n`);
    process.exit(result.status ?? 1);
  }
}

function reset(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

function copyIntoPhp(source, destName) {
  const target = path.join(CLI_PHP, destName);
  cpSync(source, target, { recursive: true });
}

process.stderr.write(`Building CLI package at ${CLI}\n`);

run('pnpm', ['-F', 'viewer', 'build'], { cwd: ROOT });

run('composer', ['validate', '--working-dir=packages/parser', '--no-check-publish'], { cwd: ROOT });

run('composer', ['install', '--working-dir=packages/parser', '--no-dev', '--optimize-autoloader'], {
  cwd: ROOT,
});

reset(CLI_PHP);
copyIntoPhp(path.join(PARSER, 'src'), 'src');
copyIntoPhp(path.join(PARSER, 'vendor'), 'vendor');
copyIntoPhp(path.join(PARSER, 'hooksgraph.php'), 'hooksgraph.php');
copyIntoPhp(path.join(PARSER, 'server.php'), 'server.php');

reset(CLI_DIST);
cpSync(path.join(VIEWER, 'dist'), CLI_DIST, { recursive: true });

process.stderr.write(`\n✓ CLI package ready: ${CLI}\n`);
