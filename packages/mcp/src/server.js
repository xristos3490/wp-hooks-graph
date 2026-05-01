import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRegistry, UnknownCodebaseError, MissingStorageError } from './registry.js';
import { createIndex, CodebaseLoadError } from './index.js';

import * as listCodebases from './tools/list_codebases.js';
import * as findHook from './tools/find_hook.js';
import * as listenersOf from './tools/listeners_of.js';
import * as firersOf from './tools/firers_of.js';
import * as hooksInFile from './tools/hooks_in_file.js';
import * as searchCallbacks from './tools/search_callbacks.js';
import * as hotspots from './tools/hotspots.js';
import * as sharedHooks from './tools/shared_hooks.js';
import * as compareHook from './tools/compare_hook.js';
import * as filterPriorityConflicts from './tools/filter_priority_conflicts.js';

const TOOLS = [
  listCodebases,
  findHook,
  listenersOf,
  firersOf,
  hooksInFile,
  searchCallbacks,
  hotspots,
  sharedHooks,
  compareHook,
  filterPriorityConflicts,
];

function toolErrorResult(err) {
  return {
    isError: true,
    content: [{ type: 'text', text: err.message }],
  };
}

function successResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

export function createServer({ storageDir }) {
  const registry = createRegistry({ storageDir });
  const index = createIndex();
  const ctx = { registry, index };

  const server = new McpServer(
    { name: 'hooks-graph', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Query WordPress hook graphs built by wp-hooks-graph. Call list_codebases first to see which codebases are available, then pass the codebase id to the other tools.',
    }
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args) => {
        try {
          const data = tool.handler(args ?? {}, ctx);
          return successResult(data);
        } catch (err) {
          if (
            err instanceof UnknownCodebaseError ||
            err instanceof CodebaseLoadError ||
            err instanceof MissingStorageError
          ) {
            return toolErrorResult(err);
          }
          throw err;
        }
      }
    );
  }

  return server;
}

export async function runStdioServer({ storageDir }) {
  const server = createServer({ storageDir });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
