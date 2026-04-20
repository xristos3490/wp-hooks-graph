# Hooks MCP Server — Design

**Status:** approved for planning
**Date:** 2026-04-21
**Author:** Chris Lilitsas (with Claude)

## 1. Overview & Goals

A local Node MCP server that exposes the contents of `storage/*.json` (hooks graphs produced by `hooks_graph.php`) as structured tools for agents. It is a **library server**: any agent on the machine can query any parsed codebase without the JSON contents entering the agent's context directly.

**In scope (v1):**
- Read-only queries over locally-parsed hooks JSONs.
- Pagination on all list-returning tools.
- Cross-codebase search for callbacks.

**Out of scope (v1):**
- Triggering re-parsing (remains with `npm run parse` / `bin/hooksgraph`).
- HTTP / SSE transport.
- Remote or multi-user access.
- `trace(from, to)`, `overlap(a, b)`, `dynamic_hooks` tools — defer until demand is clear.
- File-system watcher / auto-refresh daemon. (See §4 for mtime-based lazy invalidation, which is sufficient.)

**Non-goal:** replacing `bin/hooksgraph` or the React viewer. The viewer remains the visual tool; the MCP server is the programmatic one.

## 2. Tool Surface

All tools accept a `codebase` parameter (filename stem, e.g. `"gutenberg"`, `"woocommerce-bookings"`) to identify which JSON in `storage/` to query. Where noted, `codebase` is optional — omitting it means "search across all codebases".

```
list_codebases()
  → [
      {
        id,                 // filename stem
        source_labels,      // from metadata.source_labels
        scanned_dirs,       // from metadata.scanned_dirs
        scan_date,
        total_files,
        total_hooks,
        dynamic_hooks,
        path                // absolute path to the JSON file
      }
    ]

find_hook(name, codebase?)
  // With `codebase`:
  //   → { id, type, hook_type, name, fire_count, listen_count,
  //       dynamic, sources } | null
  // Without `codebase`:
  //   → [
  //       { codebase, id, type, hook_type, name, fire_count,
  //         listen_count, dynamic, sources }, ...
  //     ]   // possibly empty
  // Exact name match in both forms.

listeners_of(hook, codebase, limit=50, offset=0)
  → {
      total,
      has_more,
      results: [
        { file, line, callback, callback_type, priority, scope_function }
      ]
    }

firers_of(hook, codebase, limit=50, offset=0)
  → same shape as listeners_of

hooks_in_file(file_path, codebase, limit=50, offset=0)
  → {
      total,
      has_more,
      results: [
        { hook, edge_type, line, callback?, priority?, scope_function? }
      ]
    }
  // edge_type ∈ 'fires' | 'listens'. `callback`, `priority`, and
  // `scope_function` are populated only for 'listens' edges.

search_callbacks(substring, codebase?, limit=50, offset=0)
  → {
      total,
      has_more,
      results: [
        { codebase, hook, file, line, callback, priority }
      ]
    }
  // Case-insensitive substring match on the edge's `callback` /
  // `callback_method` fields. Cross-codebase when `codebase` omitted.

hotspots(codebase, metric='total', limit=20)
  → [{ hook, hook_type, fire_count, listen_count, total }]
  // metric ∈ 'total' | 'fires' | 'listens'. Sorted descending.
```

**Conventions:**

- "Not found" is always a structured empty result (`null` or `{ total: 0, has_more: false, results: [] }`), never an MCP error.
- MCP errors are reserved for: unknown `codebase`, missing/corrupt JSON, invalid params.
- All list-returning tools hard-cap at `limit=500`; requests exceeding this fail param validation.
- Pagination offset beyond `total` returns `{ total, has_more: false, results: [] }`.

## 3. Architecture

Single-process Node server, stdio transport, plain JS to match the existing `src/` convention.

```
bin/hooks-mcp.js          Shebang entry (`#!/usr/bin/env node`).
                          Parses --storage CLI arg, boots the server.

src/mcp/
  server.js               MCP SDK plumbing: tool registration,
                          request routing, error translation.
  registry.js             Lists the storage dir on demand, mapping
                          filename stem → { path, mtime }. Rescans
                          on every tool call (sub-ms `readdir` for
                          ~20 files) so codebases parsed mid-session
                          are visible without restarting the server.
                          Resolves the `codebase` param to a file path.
  index.js                Loads a single JSON and builds per-codebase
                          indexes (see §4). Caches by path; invalidates
                          on mtime change.
  tools/                  One file per tool. Each exports
                          { name, schema, handler }.
    list_codebases.js
    find_hook.js
    listeners_of.js
    firers_of.js
    hooks_in_file.js
    search_callbacks.js
    hotspots.js
  lib/paginate.js         Shared helper:
                          (items, limit, offset) → { total, has_more, results }.

tests/mcp/
  fixtures/               Small hand-authored hooks JSONs.
  *.test.js               Vitest suite.
```

**Runtime dependency:** `@modelcontextprotocol/sdk` (the only new package).

**Per-call flow:**

1. `server.js` receives an MCP tool call → routes to the matching handler.
2. Handler validates params against its schema.
3. Handler resolves `codebase` via `registry` (if the tool takes one).
4. Handler calls `index.get(codebasePath)` → returns cached indexes or rebuilds them.
5. Handler queries the index, paginates via `lib/paginate`, returns the response.

## 4. Indexing & Caching

On first access to a codebase, parse the JSON once and build these in-memory structures:

```js
{
  meta,                          // metadata object from the JSON
  nodes: Map<id, node>,          // all nodes by id
  hookByName: Map<name, hook>,   // "init" → hook node
  firesByHook: Map<hookId, edge[]>,
  listensByHook: Map<hookId, edge[]>,
  edgesByFile: Map<fileId, edge[]>,
  allEdges: edge[],              // for substring scans (search_callbacks)
  mtime,                         // for invalidation
}
```

**Invalidation.** Before returning a cached index, compare the current file mtime (via `fs.stat`) to the stored one. If changed, rebuild. This gives a simple mental model: re-parse a codebase → the next MCP query picks up the new data automatically. No watcher process needed.

**Cross-codebase queries** (`find_hook` / `search_callbacks` without `codebase`): iterate `registry` entries in a deterministic order (sorted by id), call `index.get()` for each, and concatenate per-codebase results. Apply the caller's `limit` and `offset` to the concatenated list. This keeps pagination predictable; codebases earlier in the sort order fill earlier pages, which is fine for this workload (agents either page through, or narrow with `codebase`).

**Memory footprint.** Worst case — all ~20 JSONs indexed — is projected well under 100MB (the largest JSON is 4.5MB raw; indexes roughly double that). No eviction: the stdio server's lifetime is a session.

## 5. Codebase Identification & Storage Path

- **Canonical ID:** filename stem. `storage/gutenberg.json` → id `"gutenberg"`.
- **Storage path resolution order:**
  1. `--storage <path>` CLI arg (preferred, explicit in MCP config).
  2. `HOOKSGRAPH_STORAGE` env var (fallback).
  3. `./storage/` relative to cwd (dev convenience).
- **Discoverability.** `list_codebases` surfaces `source_labels` and `scanned_dirs` from each JSON's metadata so agents can map from "the codebase I care about" to the ID to pass.
- **Unknown-codebase errors are helpful.** If an agent passes an unknown `codebase`, the error message lists the available IDs so the next call can recover without an extra `list_codebases` round-trip.

## 6. Error Handling

Three error categories, surfaced as MCP tool errors with clear messages:

- **Unknown codebase.** `"unknown codebase 'gutenburg'. Available: gutenberg, wp-includes, woocommerce-bookings, ..."`
- **Missing / corrupt JSON.** If a file disappears between `list_codebases` and the next call, or fails to parse: `"failed to load codebase 'X': <reason>"`.
- **Invalid params.** Schema validation failure — missing required field, wrong type, `limit` exceeds 500.

Not errors — returned as structured empty results:

- Hook / file / callback not found.
- Pagination offset beyond `total`.

## 7. Integration & Distribution

- **Entry point:** `bin/hooks-mcp.js` with `#!/usr/bin/env node` shebang, executable bit set.
- **`package.json` changes:**
  - Add `"hooks-mcp": "bin/hooks-mcp.js"` to `bin`.
  - Add `"mcp": "node bin/hooks-mcp.js"` to `scripts` for dev use.
  - Add `@modelcontextprotocol/sdk` to `dependencies`.
- **Claude Code registration (documented in README):**
  ```
  claude mcp add hooks-graph \
    node /path/to/wp-hooks-graph/bin/hooks-mcp.js \
    --storage /path/to/wp-hooks-graph/storage
  ```
- **No changes to `bin/hooksgraph`, `bin/serve`, `server.php`, or `hooks_graph.php`.** The MCP server is purely additive.
- **README update:** new section documenting the server, its tools, and registration. Include a short "what to ask it" example block.

## 8. Testing

- **Framework:** Vitest, matching the existing `src/lib/filters.test.js` convention.
- **Location:** `tests/mcp/`.
- **Fixtures:** small hand-authored hooks JSONs under `tests/mcp/fixtures/` with known shape — a handful of hooks (both action and filter), at least one dynamic hook, cross-file listeners so pagination can be exercised. No reliance on real `storage/` output.
- **Coverage targets:**
  - `registry` — codebase discovery, stem → path mapping, unknown-codebase error text.
  - `index` — index shape, mtime invalidation (touch fixture, assert rebuild).
  - Each tool handler — happy path, pagination (`total` / `has_more` / `offset`), empty-result shape, param validation errors.
  - `search_callbacks` cross-codebase — fairness across sources.
- **Not covered by automated tests:** the actual MCP stdio transport (trust the SDK). A manual smoke-test note lives in the README for `claude mcp add` + a sample call.

## 9. Open Questions / Deferred

- **Trace / overlap / dynamic-hooks tools.** Deferred. Revisit once v1 has real usage and we know which missing queries are painful.
- **Parse trigger.** Deferred. If it's needed, v2 should expose a `parse(source_dir)` tool that shells out to `hooks_graph.php --print-path` and re-indexes on completion.
- **Remote transport.** Deferred. If multiple machines ever need to share an index, revisit HTTP/SSE.
