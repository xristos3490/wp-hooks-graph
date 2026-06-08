#!/usr/bin/env node
/**
 * hooksgraph — Node shim that dispatches to the bundled PHP parser
 * and serves the pre-built viewer.
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import net from 'node:net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');

const HOOKSGRAPH_HOME = path.join(os.homedir(), '.hooksgraph');
const STORAGE_DEFAULTS = {
  parsed: path.join(HOOKSGRAPH_HOME, 'parsed'),
  codebases: path.join(HOOKSGRAPH_HOME, 'codebases'),
};
const STORAGE_ENV_VARS = {
  parsed: 'HOOKSGRAPH_PARSED_DIR',
  codebases: 'HOOKSGRAPH_CODEBASES_DIR',
};

/**
 * Resolve the on-disk directory for a given storage kind:
 *   - 'parsed'    → output of `hooksgraph parse` and the default `hooksgraph <dir>` shortcut.
 *                   The viewer's `serve` subcommand reads from here.
 *   - 'codebases' → output of `hooksgraph parse-codebase`. The MCP server reads from here.
 * Priority: dedicated env var → ~/.hooksgraph/{kind}/.
 */
function resolveStorageDir(kind) {
  const envVar = STORAGE_ENV_VARS[kind];
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.length > 0) return path.resolve(fromEnv);
  return STORAGE_DEFAULTS[kind];
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

// In a published tarball, `php/` and `dist/` sit inside this package.
// In the monorepo (dev), they live next door under `packages/parser/` and
// `packages/viewer/dist/` — use those so `bin/hooksgraph` works without a
// prior `pnpm build:cli`.
const TARBALL_PHP = path.join(PKG_ROOT, 'php');
const DEV_PHP = path.resolve(PKG_ROOT, '../parser');
const PHP_DIR = existsSync(path.join(TARBALL_PHP, 'hooksgraph.php')) ? TARBALL_PHP : DEV_PHP;

const TARBALL_DIST = path.join(PKG_ROOT, 'dist');
const DEV_DIST = path.resolve(PKG_ROOT, '../viewer/dist');
const DIST_DIR = existsSync(path.join(TARBALL_DIST, 'index.html')) ? TARBALL_DIST : DEV_DIST;

const PARSER_ENTRY = path.join(PHP_DIR, 'hooksgraph.php');
const SERVER_ENTRY = path.join(PHP_DIR, 'server.php');

function ensurePhp() {
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['php']);
  if (which.status === 0) return;
  process.stderr.write(
    [
      "hooksgraph: 'php' was not found on PATH.",
      '',
      'Install PHP 8.2+ and try again:',
      '  macOS:  brew install php',
      '  Debian: sudo apt install php-cli',
      '  Fedora: sudo dnf install php-cli',
      '',
    ].join('\n')
  );
  process.exit(2);
}

function printTopHelp() {
  process.stdout.write(
    [
      'hooksgraph — parse WordPress PHP codebases and visualize hook relationships',
      '',
      'Usage:',
      '  hooksgraph <dir>...              Parse and open the viewer (default shortcut)',
      '  hooksgraph parse <dir>...        Parse only; write JSON to ~/.hooksgraph/parsed/',
      '  hooksgraph parse-codebase <dir>...',
      '                                   Parse only; write JSON to ~/.hooksgraph/codebases/',
      '                                   for the MCP server to read',
      '  hooksgraph serve [path]          Serve the viewer; defaults to most recent JSON',
      '  hooksgraph <subcommand> --help   Show help for a subcommand',
      '',
      'Environment:',
      `  HOOKSGRAPH_PARSED_DIR     Override ${STORAGE_DEFAULTS.parsed}`,
      `  HOOKSGRAPH_CODEBASES_DIR  Override ${STORAGE_DEFAULTS.codebases}`,
      '',
    ].join('\n')
  );
}

/**
 * Spawn the PHP parser. `kind` selects the output directory; the resolved
 * path is forwarded as HOOKSGRAPH_OUTPUT_DIR (a Node→PHP internal contract,
 * not user-facing) so Runner.php stays subcommand-agnostic.
 */
function runParse({ kind, invokedAs, args }) {
  const outputDir = resolveStorageDir(kind);
  ensureDir(outputDir);
  const child = spawn('php', ['-d', 'memory_limit=1G', PARSER_ENTRY, ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      HOOKSGRAPH_INVOKED_AS: invokedAs,
      HOOKSGRAPH_OUTPUT_DIR: outputDir,
    },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

function runParseCapture(args) {
  const outputDir = resolveStorageDir('parsed');
  ensureDir(outputDir);
  const result = spawnSync('php', ['-d', 'memory_limit=1G', PARSER_ENTRY, '--print-path', ...args], {
    stdio: ['inherit', 'pipe', 'inherit'],
    encoding: 'utf8',
    env: {
      ...process.env,
      HOOKSGRAPH_INVOKED_AS: 'hooksgraph',
      HOOKSGRAPH_OUTPUT_DIR: outputDir,
    },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.trim();
}

async function findFreePort(start = 8080) {
  let port = start;
  while (port < start + 100) {
    const busy = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(true));
      srv.once('listening', () => srv.close(() => resolve(false)));
      srv.listen(port, '127.0.0.1');
    });
    if (!busy) return port;
    port++;
  }
  throw new Error('No free port found');
}

function mostRecentJson(dir) {
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const full = path.join(dir, name);
      return { full, mtime: statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return entries.length > 0 ? entries[0].full : null;
}

async function runServe(args) {
  if (args[0] === '-h' || args[0] === '--help') {
    const parsedDir = resolveStorageDir('parsed');
    process.stdout.write(
      [
        'hooksgraph serve — serve the built viewer against a parsed hooks JSON',
        '',
        'Usage:',
        `  hooksgraph serve                 Use the most recent JSON in ${parsedDir}`,
        '                                   (override with $HOOKSGRAPH_PARSED_DIR)',
        '  hooksgraph serve PATH            Use a specific JSON file',
        '',
      ].join('\n')
    );
    return;
  }

  let hooksJson = args[0];
  if (!hooksJson) {
    const storage = resolveStorageDir('parsed');
    hooksJson = mostRecentJson(storage);
    if (!hooksJson) {
      process.stderr.write(
        `Error: no JSON path given and no files found in ${storage}.\n` +
          "Run 'hooksgraph parse <dir>' first, or pass a path: hooksgraph serve path/to/hooks.json\n"
      );
      process.exit(1);
    }
    process.stderr.write(`Using ${hooksJson} (most recent in ${storage}).\n`);
  }
  if (!existsSync(hooksJson)) {
    process.stderr.write(`Error: ${hooksJson} not found.\n`);
    process.exit(1);
  }

  const port = await findFreePort(8080);
  const url = `http://127.0.0.1:${port}`;

  const srv = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', DIST_DIR, SERVER_ENTRY], {
    stdio: 'inherit',
    env: { ...process.env, HOOKS_JSON: path.resolve(hooksJson) },
  });

  const openers = ['open', 'xdg-open', 'wslview', 'start'];
  for (const candidate of openers) {
    const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [candidate]);
    if (probe.status === 0) {
      setTimeout(() => spawn(candidate, [url], { stdio: 'ignore', detached: true }).unref(), 300);
      break;
    }
  }

  process.stderr.write(`Serving at ${url}\n`);

  const forward = (sig) => {
    if (srv.exitCode === null) srv.kill(sig);
  };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));
  srv.on('exit', (code) => process.exit(code ?? 0));
}

async function main() {
  ensurePhp();
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '-h' || args[0] === '--help' || args[0] === 'help') {
    printTopHelp();
    return;
  }

  const sub = args[0];
  const rest = args.slice(1);

  if (sub === 'parse') {
    runParse({ kind: 'parsed', invokedAs: 'hooksgraph parse', args: rest });
    return;
  }
  if (sub === 'parse-codebase') {
    runParse({ kind: 'codebases', invokedAs: 'hooksgraph parse-codebase', args: rest });
    return;
  }
  if (sub === 'serve') {
    await runServe(rest);
    return;
  }

  // Fall-through: legacy shortcut — parse (into the parsed dir) + serve + open.
  const out = runParseCapture(args);
  await runServe([out]);
}

main().catch((err) => {
  process.stderr.write(`hooksgraph: ${err.message}\n`);
  process.exit(1);
});
