# WordPress Hooks Graph

Parses WordPress PHP codebases for hook relationships (do_action/add_action/apply_filters/add_filter) and visualizes them as an interactive graph.

## Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install Node dependencies for the Vite/React viewer |
| `composer install` | Install PHP dependencies (PHPUnit for tests) |
| `npm run setup` | Install the `hooksgraph` shell alias (wraps `bin/setup-profile.sh`) |
| `hooksgraph <dir>...` (or `bin/hooksgraph`) | Parse + serve + open browser shortcut. Dispatcher falls through to this when the first arg isn't a known subcommand |
| `hooksgraph parse <dir> [dir2...] [--overlap-only] [--exclude a,b] [-o path]` | Parse only; output defaults to `storage/<dirnames>.json`. Dispatcher exports `HOOKSGRAPH_INVOKED_AS` and execs `php hooksgraph.php` |
| `hooksgraph parse --help` | Parser help with Usage / Examples / Viewing-results sections rebranded via `HOOKSGRAPH_INVOKED_AS` |
| `hooksgraph serve [path/to/hooks.json]` | Serve the built viewer with a JSON. No arg = most recent file in `storage/`. Wraps `bin/serve` |
| `hooksgraph serve --help` | Serve help (bash) |
| `hooksgraph --help` (or `hooksgraph` with no args) | Top-level help listing the subcommands (bash) |
| `npm run dev` | Vite dev server for the React viewer (accepts `--json <path>` to bind a specific hooks JSON) |
| `npm run build` | Build the React viewer into `dist/` |
| `npm run preview` | Preview the built viewer |
| `npm test` | Run PHP + JS test suites |
| `npm run test:php` (or `vendor/bin/phpunit`) | PHPUnit 11 suite under `tests/phpunit/` |
| `npm run test:js` | Vitest suite for JS (currently `src/lib/filters.test.js`) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run mcp -- [--storage <dir>]` | Run the stdio MCP server (wraps `bin/hooks-mcp.js`). Storage resolves CLI arg → `HOOKSGRAPH_STORAGE` env → `./storage` |

## Architecture

```
hooksgraph.php          Thin CLI entry. Loads composer autoload and hands off to HooksGraph\Cli\Runner.
server.php              Router for `php -S`. Serves the parsed JSON at /hooks.json; delegates everything else to dist/.
composer.json           PHP dependencies + PSR-4 autoload (HooksGraph\ → src/HooksGraph/).
phpunit.xml             PHPUnit 11 config; test suite rooted at tests/phpunit/.
bin/hooksgraph          Bash wrapper: runs the parser, then delegates to `bin/serve`. Primary user-facing entry point.
bin/serve               Bash helper: finds a free port, launches `php -S` with server.php, opens the browser. Accepts an optional JSON path; defaults to latest file in `storage/`.
bin/setup-profile.sh    Installs the `hooksgraph` alias in `~/.zshrc`.
src/HooksGraph/         PHP classes (namespace HooksGraph\):
  Parser/                 FileParser, Tokens, HookNameExtractor, CallbackExtractor, DocCommentExtractor, ScopeTracker.
  Graph/                  Builder, OverlapFilter.
  Discovery/              PhpFileFinder, ExcludeMatcher.
  Cli/                    Runner (orchestrator), Arguments, Help, Console (TTY styling + progress).
src/                    React viewer (Vite + @wordpress/components + Cytoscape). Entry: src/main.jsx → src/App.jsx.
src/lib/                Framework-agnostic helpers: `filters.js` (pure filter pipeline) + `filters.test.js` (Vitest),
                        `cytoscape-setup.js`, `color-palette.js`, `constants.js`.
src/mcp/                MCP server that exposes the parsed graph JSONs as tools. `server.js` (McpServer + stdio transport),
                        `registry.js` (lists codebases from a storage dir), `index.js` (mtime-cached graph index),
                        `tools/` (list_codebases, find_hook, listeners_of, firers_of, hooks_in_file, search_callbacks, hotspots,
                        shared_hooks, compare_hook), `lib/` (paginate, shape helpers).
tests/phpunit/          PHPUnit tests mirroring src/HooksGraph/ (Parser/, Graph/, Discovery/, Cli/, Support/).
tests/mcp/              Vitest suite for the MCP server (tools, registry, pagination, fixtures under `tests/mcp/fixtures/`).
index.html              Vite entry HTML.
dist/                   Vite build output (git-ignored).
storage/                Git-ignored output directory for generated JSON files (.keep tracked).
vendor/                 Composer-managed PHP dependencies (git-ignored).
```

### Data flow

```
PHP files → HooksGraph\Cli\Runner (discover → FileParser tokenize/extract → Builder → optional OverlapFilter) → JSON
         → server.php serves JSON at /hooks.json
         → React viewer renders via Cytoscape
```

## Key Files

- `hooksgraph.php` — Thin CLI shim; requires `vendor/autoload.php` and invokes `HooksGraph\Cli\Runner::run()`.
- `src/HooksGraph/Parser/FileParser.php` — Entry point for parsing a single file. Walks `token_get_all()` output, delegates hook-name/callback/doc-comment extraction to sibling classes, tracks scope via `ScopeTracker`.
- `src/HooksGraph/Graph/Builder.php` / `OverlapFilter.php` — Build the node/edge graph from parsed hook calls; optionally filter to cross-source hooks.
- `src/HooksGraph/Cli/Runner.php` — CLI orchestration: argument parsing, file discovery, per-file parse loop, summary rendering, output write.
- `server.php` — Minimal router; any path other than `/hooks.json` falls through to the static file server rooted at `dist/`.
- `bin/hooksgraph` — Primary user-facing entry point. Dispatches on the first arg: `parse` (sets `HOOKSGRAPH_INVOKED_AS` and execs PHP), `serve` (execs `bin/serve`), `-h`/`--help`/no-args (prints top-level help), anything else (legacy shortcut: `--print-path` captures the JSON path on stdout — pretty UI goes to stderr — then hands off to `bin/serve`).
- `bin/serve` — Serving half of `hooksgraph`. Also invoked directly by `npm run serve`. Accepts an optional JSON path; when omitted, picks the most recently modified file in `storage/`.
- `src/App.jsx` — Top-level React component; orchestrates sidebar, graph canvas, and detail panel.
- `bin/hooks-mcp.js` — Node entry point for the MCP server (exposed as the `hooks-mcp` bin in package.json). Parses `--storage` / `-h`, resolves the storage dir, and hands off to `runStdioServer()` in `src/mcp/server.js`.

## Code Style

- PHP: namespaced classes under `HooksGraph\`; `declare(strict_types=1)` at top of every file; final classes; camelCase methods.
- Parsed hook records are associative arrays with snake_case keys — matches the JSON output shape.
- Node IDs: `type::identifier` format (e.g., `hook::init`, `file::wp::wp-includes/plugin.php`)
- JS: ES modules, React function components, hooks in `src/hooks/`

## Testing

- `npm test` runs both suites (`npm run test:php` → PHPUnit, `npm run test:js` → Vitest).
- `tests/phpunit/` mirrors `src/HooksGraph/`: one test class per source class. `tests/phpunit/Support/ParsesSource.php` is a trait that writes a snippet to a temp file and invokes `FileParser::parse()`.
- PHPUnit 11 config lives in `phpunit.xml`; bootstrap uses Composer's autoloader, so `composer install` must have been run at least once.
- `hooksgraph.php` guards its Runner invocation with `defined('HOOKS_GRAPH_TESTING')` so tests that require it do not execute the CLI.
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
