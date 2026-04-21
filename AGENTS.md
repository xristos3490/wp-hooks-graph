# WordPress Hooks Graph

Parses WordPress PHP codebases for hook relationships (do_action/add_action/apply_filters/add_filter) and visualizes them as an interactive graph.

## Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install Node dependencies for the Vite/React viewer |
| `npm run setup` | Install the `hooksgraph` shell alias (wraps `bin/setup_profile.sh`) |
| `npm run parse -- <dir> [dir2...] [--overlap-only] [--exclude a,b] [-o path]` | Parse PHP files. Output defaults to `storage/<dirnames>.json`. The `--` is required to pass args through npm |
| `npm run parse:help` | Show full parser help with all options, examples, and output format |
| `npm run serve -- [path/to/hooks.json]` | Serve the built viewer with a JSON. No arg = most recent file in `storage/`. Wraps `bin/serve` |
| `npm run dev` | Vite dev server for the React viewer (accepts `--json <path>` to bind a specific hooks JSON) |
| `npm run build` | Build the React viewer into `dist/` |
| `npm run preview` | Preview the built viewer |
| `bin/hooksgraph <dir>...` (or `hooksgraph` if alias installed) | Parse + serve + open browser. Delegates the serve step to `bin/serve` |
| `npm test` | Run PHP + JS test suites |
| `npm run test:php` | PHP parser + graph tests (custom runner under `tests/`) |
| `npm run test:js` | Vitest suite for JS (currently `src/lib/filters.test.js`) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run mcp -- [--storage <dir>]` | Run the stdio MCP server (wraps `bin/hooks-mcp.js`). Storage resolves CLI arg → `HOOKSGRAPH_STORAGE` env → `./storage` |

## Architecture

```
hooks_graph.php   PHP CLI entry point. Uses token_get_all() to tokenize PHP; walks tokens to extract hook calls.
                  Handles file discovery, .gitignore respect, progress UI, graph construction, overlap filtering, JSON output.
server.php        Router for `php -S`. Serves the parsed JSON at /hooks.json; delegates everything else to dist/.
bin/hooksgraph    Bash wrapper: runs the parser, then delegates to `bin/serve`. Primary user-facing entry point.
bin/serve         Bash helper: finds a free port, launches `php -S` with server.php, opens the browser. Accepts an optional JSON path; defaults to latest file in `storage/`.
bin/setup_profile.sh Installs the `hooksgraph` alias in `~/.zshrc`.
src/              React viewer (Vite + @wordpress/components + Cytoscape). Entry: src/main.jsx → src/App.jsx.
src/lib/          Framework-agnostic helpers: `filters.js` (pure filter pipeline) + `filters.test.js` (Vitest),
                  `cytoscape-setup.js`, `color-palette.js`, `constants.js`.
src/mcp/          MCP server that exposes the parsed graph JSONs as tools. `server.js` (McpServer + stdio transport),
                  `registry.js` (lists codebases from a storage dir), `index.js` (mtime-cached graph index),
                  `tools/` (list_codebases, find_hook, listeners_of, firers_of, hooks_in_file, search_callbacks, hotspots),
                  `lib/` (paginate, shape helpers).
tests/            PHP test suite (zero-dep runner + parser/graph tests).
tests/mcp/        Vitest suite for the MCP server (tools, registry, pagination, fixtures under `tests/mcp/fixtures/`).
index.html        Vite entry HTML.
dist/             Vite build output (git-ignored).
storage/          Git-ignored output directory for generated JSON files (.keep tracked).
```

### Data flow

```
PHP files → hooks_graph.php (tokenize → extract → build graph → optional overlap filter) → JSON
         → server.php serves JSON at /hooks.json
         → React viewer renders via Cytoscape
```

## Key Files

- `hooks_graph.php` — Single-file parser + graph builder. No external PHP dependencies; uses the built-in tokenizer.
- `server.php` — Minimal router; any path other than `/hooks.json` falls through to the static file server rooted at `dist/`.
- `bin/hooksgraph` — Primary user-facing entry point. `--print-path` makes the parser emit only the output path on stdout (pretty UI goes to stderr), which this script captures and hands to `bin/serve`.
- `bin/serve` — Serving half of `hooksgraph`. Also invoked directly by `npm run serve`. Accepts an optional JSON path; when omitted, picks the most recently modified file in `storage/`.
- `src/App.jsx` — Top-level React component; orchestrates sidebar, graph canvas, and detail panel.
- `bin/hooks-mcp.js` — Node entry point for the MCP server (exposed as the `hooks-mcp` bin in package.json). Parses `--storage` / `-h`, resolves the storage dir, and hands off to `runStdioServer()` in `src/mcp/server.js`.

## Code Style

- PHP: constants via `define()`, private helpers prefixed with `_` are not used — functions are file-scope and named plainly
- Constants: `UPPER_SNAKE` (e.g., `HOOK_FUNCTIONS`, `ACTION_FUNCTIONS`)
- Data structures: associative arrays; no classes in the parser
- Node IDs: `type::identifier` format (e.g., `hook::init`, `file::wp::wp-includes/plugin.php`)
- JS: ES modules, React function components, hooks in `src/hooks/`

## Testing

- `npm test` runs the PHP suite (`tests/run.php`) and the JS suite (Vitest — picks up `src/**/*.test.js` and `tests/**/*.test.js`).
- `tests/run.php` is a zero-dependency runner: each `tests/test_*.php` file calls `test('name', fn)` to register cases. `assert_eq`, `assert_null`, `assert_true`, `assert_false`, `assert_count`, and `assert_contains` are available.
- `tests/test_parser.php` exercises `parse_php_file()` via a `parse_source($code, $label)` helper that writes the source to a temp file and parses it. Covers literal/concat/interpolated hook names, all callback shapes (string, array, `$this`, `self::class`, closure, arrow fn, variable), scope tracking, priority, doc comments, and rejection of method/nullsafe calls.
- `tests/test_graph.php` exercises `build_graph()` and `filter_graph_by_overlap()` directly with in-memory call dicts (no temp files). A `mk_call($overrides)` helper provides sane defaults. Fake paths like `/fake/wp-core/...` are fine because `realpath()` fallbacks in the graph code tolerate missing dirs.
- `hooks_graph.php` guards its `main()` call with `defined('HOOKS_GRAPH_TESTING')` so `require`-ing the file from tests does not execute the CLI.
- `tests/mcp/` covers each MCP tool plus the registry and pagination helper. `tests/mcp/helpers.js` exposes `makeCtx(storageDir)` backed by `tests/mcp/fixtures/` JSON files so tools can be called in-process without spinning up a transport.

## Gotchas

- Hook name extraction for concatenation (`'prefix_' . $var`) produces `prefix_*` — the `*` is a convention, not a glob
- File IDs include source label to prevent collisions across scanned directories: `file::{source}::{rel_path}`
- Dynamic hook names (bare variables, interpolations) get a `*` suffix or a synthetic counter id; don't rely on stability across runs
- `--print-path` mode reserves stdout for the output file path; the progress UI is redirected to stderr. `bin/hooksgraph` depends on this
- `server.php` returns `false` for unknown paths so `php -S` serves static files itself — don't add logic that returns `true` by default
- The viewer's hotspot threshold is adaptive (top 10% of connections), not a fixed number
- MCP storage dir resolves in this order: CLI `--storage` → `HOOKSGRAPH_STORAGE` env → `cwd/storage`. A missing dir throws `MissingStorageError` — don't fall back silently.
- The MCP graph index caches parsed JSON by file path and invalidates on `mtime` change. Rewriting a storage JSON with the same mtime (rare, but possible with `touch -t`) will not refresh the cache.
- MCP tools receive `{ registry, index }` via a shared ctx from `createServer()`. `UnknownCodebaseError` / `CodebaseLoadError` / `MissingStorageError` are converted to `isError` tool results; anything else bubbles up and crashes the transport.

## Supported Hook Functions

```
do_action, do_action_ref_array         → edge_type="fires",   hook_type="action"
apply_filters, apply_filters_ref_array → edge_type="fires",   hook_type="filter"
add_action                             → edge_type="listens", hook_type="action"
add_filter                             → edge_type="listens", hook_type="filter"
```
