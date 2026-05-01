#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { runStdioServer } from '../src/server.js';

const DEFAULT_CODEBASES_DIR = path.join(os.homedir(), '.hooksgraph', 'codebases');

function parseArgs(argv) {
  const out = { storage: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--storage') {
      out.storage = argv[++i];
    } else if (arg.startsWith('--storage=')) {
      out.storage = arg.slice('--storage='.length);
    } else if (arg === '-h' || arg === '--help') {
      out.help = true;
    }
  }
  return out;
}

/**
 * Codebases dir is the *only* source the MCP server reads from. It is
 * populated by `hooksgraph parse-codebase`; the viewer-facing `parsed/` dir
 * is intentionally not visible here.
 * Priority: --storage flag → HOOKSGRAPH_CODEBASES_DIR → ~/.hooksgraph/codebases/.
 */
function resolveStorageDir(cliArg) {
  if (cliArg) return path.resolve(cliArg);
  if (process.env.HOOKSGRAPH_CODEBASES_DIR) {
    return path.resolve(process.env.HOOKSGRAPH_CODEBASES_DIR);
  }
  return DEFAULT_CODEBASES_DIR;
}

function printHelp() {
  process.stderr.write(
    [
      'Usage: hooksgraph-mcp [--storage <dir>]',
      '',
      'MCP stdio server exposing wp-hooks-graph codebase JSONs as tools.',
      '',
      'Options:',
      '  --storage <dir>   Path to a directory of hook-graph JSONs (one per',
      '                    codebase). Populate it with `hooksgraph parse-codebase`.',
      `                    Falls back to $HOOKSGRAPH_CODEBASES_DIR, then ${DEFAULT_CODEBASES_DIR}.`,
      '  -h, --help        Show this message.',
      '',
    ].join('\n')
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const storageDir = resolveStorageDir(args.storage);
  try {
    await runStdioServer({ storageDir });
  } catch (err) {
    process.stderr.write(`hooksgraph-mcp: ${err.message}\n`);
    process.exit(1);
  }
}

main();
