# HooksGraph MCP Server (`packages/mcp/`)

Standalone stdio MCP server exposing parsed wp-hooks-graph JSONs as paginated, structured tools. Published as `@hooksgraph/hooksgraph-mcp` (bin: `hooksgraph-mcp`). Only runtime dep is `@modelcontextprotocol/sdk` + `zod`.

## Layout

```
package.json            @hooksgraph/hooksgraph-mcp. bin: hooksgraph-mcp.
bin/hooksgraph-mcp.js   Entry. Parses --storage / -h, resolves the codebases dir
                        (CLI arg → HOOKSGRAPH_CODEBASES_DIR → ~/.hooksgraph/codebases/),
                        hands off to runStdioServer().
src/
  server.js               createServer({ storageDir }) wires the McpServer instance.
                          Builds { registry, index } ctx, registers every tool, maps
                          known error classes to isError tool results.
  registry.js             Filesystem-backed list of codebases. createRegistry()
                          exposes list() / resolve(id). UnknownCodebaseError +
                          MissingStorageError live here.
  index.js                createIndex() — per-file in-memory index keyed by file
                          path with mtime-based invalidation. buildIndex() shapes
                          the raw JSON into nodes/hookByName/fileByPath/
                          firesByHook/listensByHook/edgesByFile/allEdges.
                          CodebaseLoadError lives here.
  tools/                  One file per tool. Each module exports
                          { name, description, inputSchema, handler }. handlers
                          are sync; pagination is shared via lib/paginate.js.
  lib/
    paginate.js             { limit, offset } helper + envelope shape.
    shape.js                Common record-flattening helpers.
tests/                  Vitest. helpers.js exposes makeCtx(storageDir) so tools can
                        be called in-process without a transport. fixtures/ holds
                        hand-built codebase JSONs.
```

## Architecture invariants

- **Single storage source.** The server reads exclusively from the codebases dir. The viewer-facing `~/.hooksgraph/parsed/` is intentionally invisible here — populate the codebases dir with `hooksgraph parse-codebase <dir>`. Each `<id>.json` file's basename is the codebase id.
- **Resolution order.** `--storage <dir>` → `$HOOKSGRAPH_CODEBASES_DIR` → `~/.hooksgraph/codebases/`. A missing dir throws `MissingStorageError`; we never fall back silently.
- **mtime cache.** `createIndex().get(entry)` keys on file path with `mtime` as the cache buster. Re-parsing a codebase is picked up automatically on the next call — no daemon, no restart. Caveat: `touch -t` rewrites that preserve mtime won't refresh; tests use `fs.utimesSync` to bump it explicitly.
- **Tools are pure over ctx.** Handlers take `(args, { registry, index })`. No global state. Tests call them directly via `makeCtx()` — they don't need a transport.
- **Known errors → isError tool results.** `UnknownCodebaseError`, `CodebaseLoadError`, `MissingStorageError` are caught in `server.js` and returned as `{ isError: true, content: [{ type: 'text', text: err.message }] }`. Anything else bubbles up and crashes the transport. Don't add silent catches in handlers; surface new domain errors as classes and add them to the catch list.
- **Output shape.** Every successful tool result is `{ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }`. Tools return plain data; the server wraps it. Don't return MCP envelopes from handlers.
- **No mutation.** Tools are read-only. Any writes belong in `hooksgraph parse-codebase` upstream.

## Tools

| Tool                          | Purpose                                                                   |
| ----------------------------- | ------------------------------------------------------------------------- |
| `list_codebases`              | Enumerate codebase ids + scan metadata.                                   |
| `find_hook`                   | Exact-name lookup; optional `codebase` scopes to one, else fans out.     |
| `listeners_of`                | Every `add_action`/`add_filter` for a hook.                              |
| `firers_of`                   | Every `do_action`/`apply_filters` call site for a hook.                   |
| `hooks_in_file`               | All hook activity in a specific file path.                                |
| `search_callbacks`            | Case-insensitive substring search over listener callback names.           |
| `hotspots`                    | Top hooks by `total` / `fires` / `listens`.                              |
| `shared_hooks`                | Hooks present in ≥2 codebases, with per-codebase counts + divergence.    |
| `compare_hook`                | Pivot one or more hooks across codebases; listeners sorted by priority.   |
| `filter_priority_conflicts`   | Filter listeners that collide on priority (same hook, same priority).    |

The full list is the canonical surface — root README's MCP Server section has user-facing prompts and example asks. When adding a tool: drop a module under `src/tools/`, import it in `server.js`'s `TOOLS` array, add a Vitest under `tests/`.

## Commands

Run from monorepo root.

| Command                                          | Description                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `pnpm mcp -- [--storage <dir>]`                  | Run the stdio server (wraps `bin/hooksgraph-mcp.js`).                  |
| `pnpm test:js`                                   | Vitest — runs this package's suite plus the viewer's.                  |
| `pnpm -F @hooksgraph/hooksgraph-mcp test`        | Vitest in this package only (if invoked directly).                     |

## Gotchas

- **Don't read from `parsed/`.** That dir is for the viewer. The MCP server intentionally has zero awareness of it. If a user asks "why doesn't `list_codebases` show my graph", check that they ran `parse-codebase`, not `parse`.
- **`HOOKSGRAPH_OUTPUT_DIR` is upstream, not here.** That env var is a Node→PHP contract inside the CLI shim. The MCP server doesn't read or write it.
- **Storage dir is resolved once per process.** `createRegistry({ storageDir })` resolves the path at startup. Re-pointing requires restarting the MCP server (Claude Code restarts it when you change `claude mcp` config).
- **Registry vs index.** `registry.list()` is a cheap directory scan (no JSON parse). `index.get(entry)` is the expensive one (JSON parse + build). Tools that only need codebase metadata (`list_codebases`) call the registry; everything else goes through the index.
- **`buildIndex` reads only what it knows.** Unknown node/edge fields pass through opaquely as part of `nodes.get(id)` / edge records. If the parser adds a new field, downstream tools see it for free — but if you want to query on it, build a new map in `buildIndex` rather than scanning `allEdges` repeatedly.
- **Sort stability.** `registry.list()` sorts by id ascending. Tools that want a different order (e.g. `hotspots` by metric) must re-sort the result themselves.
- **Tool input schemas use Zod via the MCP SDK.** Don't hand-write JSON Schema; pass a Zod object as `inputSchema` and the SDK serializes it.

## Testing

- `tests/helpers.js` — `makeCtx(storageDir)` returns `{ registry, index }` for direct handler calls. Use this for every tool test; do not spin up the transport.
- `tests/fixtures/` — small, hand-built JSON files representing entire codebases. Each fixture is a complete graph; add a new file rather than mutating an existing one when a test needs a different shape.
- Pagination is tested via `tests/paginate.test.js` against `lib/paginate.js`. New tools that paginate should rely on that helper rather than rolling their own slicing.
- The registry's `MissingStorageError` and `UnknownCodebaseError` paths are tested via temp dirs created per-test — don't share storage dirs across tests, or the mtime cache will surprise you.

## Code style

- ES modules throughout. Node 18+ APIs only (`node:fs`, `node:path`, `node:os`).
- Handlers stay synchronous and pure over ctx. Async leaks into the SDK callback in `server.js`, not into tool code.
- Errors are classes with `code` strings (`unknown_codebase`, `missing_storage`, `codebase_load_failed`). Add a code when you add a class.
