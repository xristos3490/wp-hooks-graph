#!/usr/bin/env node
import path from 'node:path';
import { runStdioServer } from '../src/server.js';

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

function resolveStorageDir(cliArg) {
  if (cliArg) return path.resolve(cliArg);
  if (process.env.HOOKSGRAPH_STORAGE) return path.resolve(process.env.HOOKSGRAPH_STORAGE);
  return path.resolve(process.cwd(), 'storage');
}

function printHelp() {
  process.stderr.write(
    [
      'Usage: hooksgraph-mcp [--storage <dir>]',
      '',
      'MCP stdio server exposing wp-hooks-graph storage JSONs as tools.',
      '',
      'Options:',
      '  --storage <dir>   Path to storage/ dir with hook-graph JSONs.',
      '                    Falls back to $HOOKSGRAPH_STORAGE, then ./storage.',
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
