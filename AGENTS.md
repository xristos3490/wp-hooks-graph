# WordPress Hooks Graph

Parses WordPress PHP codebases for hook relationships (do_action/add_action/apply_filters/add_filter) and visualizes them as an interactive graph. The repo is a **pnpm workspace** with five packages under `packages/`: the PHP parser, Vite/React viewer, Node CLI shim, MCP stdio server, and (shell-only) WordPress plugin.

## Commands

| Command                                                                       | Description                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                                                                | Install Node deps for every workspace package                                                                                                                                                                       |
| `composer install`                                                            | Install PHP dev deps at root (PHPUnit) and symlink the parser via the path repo                                                                                                                                     |
| `pnpm setup:alias`                                                            | Install the `hooksgraph` shell alias (wraps `scripts/setup-profile.sh`)                                                                                                                                             |
| `hooksgraph <dir>...` (or `packages/cli/bin/hooksgraph.js`)                   | Parse + serve + open browser shortcut. Writes JSON to `~/.hooksgraph/parsed/`. The `hooksgraph` alias points directly at the Node shim (shebang-executable)                                                         |
| `hooksgraph parse <dir> [dir2...] [--overlap-only] [--exclude a,b] [-o path]` | Parse only into `~/.hooksgraph/parsed/` (override: `$HOOKSGRAPH_PARSED_DIR`). The Node shim spawns the PHP parser with `HOOKSGRAPH_INVOKED_AS="hooksgraph parse"` and `HOOKSGRAPH_OUTPUT_DIR=<resolved parsed dir>` |
| `hooksgraph parse-codebase <dir> [...]`                                       | Parse only into `~/.hooksgraph/codebases/` (override: `$HOOKSGRAPH_CODEBASES_DIR`) for the MCP server to read. Same flag surface as `parse`; no server                                                              |
| `hooksgraph parse --help`                                                     | Parser help with Usage / Examples / Viewing-results sections rebranded via `HOOKSGRAPH_INVOKED_AS`                                                                                                                  |
| `hooksgraph serve [path/to/hooks.json]`                                       | Serve the built viewer with a JSON. No arg = most recent file in `~/.hooksgraph/parsed/`. Resolved by the Node shim                                                                                                 |
| `hooksgraph serve --help`                                                     | Serve help                                                                                                                                                                                                          |
| `hooksgraph --help` (or `hooksgraph` with no args)                            | Top-level help                                                                                                                                                                                                      |
| `pnpm dev` / `pnpm dev:viewer`                                                | Vite dev server for the viewer (alias: `pnpm -F @hooksgraph/viewer dev`). Accepts `--json <path>` via `HOOKSGRAPH_JSON` env to bind a specific hooks JSON                                                           |
| `pnpm dev:plugin`                                                             | wp-scripts watch for the plugin (alias: `pnpm -F @hooksgraph/plugin start`)                                                                                                                                         |
| `pnpm build`                                                                  | Full build: `composer install` at root + `pnpm build:cli` (viewer + parser composer no-dev) + `pnpm build:plugin`. The one-shot "install and build everything" command                                              |
| `pnpm build:viewer`                                                           | Viewer-only build (alias: `pnpm -F @hooksgraph/viewer build`). Outputs `packages/viewer/dist/`                                                                                                                      |
| `pnpm build:cli`                                                              | Assemble `packages/cli/` for npm publish — runs viewer build, `composer install --no-dev` in parser, copies into `packages/cli/{php,dist}/`                                                                         |
| `pnpm build:plugin`                                                           | wp-scripts build for the plugin (alias: `pnpm -F @hooksgraph/plugin build`). Outputs `packages/plugin/build/`                                                                                                       |
| `pnpm test`                                                                   | PHPUnit + Vitest                                                                                                                                                                                                    |
| `pnpm test:php` (or `vendor/bin/phpunit`)                                     | PHPUnit 11 suite at `packages/parser/tests/`                                                                                                                                                                        |
| `pnpm test:js`                                                                | Vitest (MCP suite under `packages/mcp/tests/`, viewer tests under `packages/viewer/src/**/*.test.js`)                                                                                                               |
| `pnpm test:watch`                                                             | Vitest in watch mode                                                                                                                                                                                                |
| `pnpm mcp -- [--storage <dir>]`                                               | Run the stdio MCP server (wraps `packages/mcp/bin/hooksgraph-mcp.js`). Storage resolves CLI arg → `HOOKSGRAPH_CODEBASES_DIR` env → `~/.hooksgraph/codebases/`                                                       |

## Architecture

```
packages/
  parser/             PHP library — HooksGraph\ namespace, self-contained autoloader.
    composer.json       name: hooksgraph/hooks-parser, psr-4 HooksGraph\ → src/
    hooksgraph.php      Thin CLI shim; requires vendor/autoload.php and runs HooksGraph\Cli\Runner.
    server.php          Router for `php -S`. Serves the parsed JSON at /hooks.json; everything else falls through.
    src/                PHP classes (was src/HooksGraph/). Parser/ Graph/ Discovery/ Cli/.
    tests/              PHPUnit tests mirroring src/ (Parser/, Graph/, Discovery/, Cli/, Support/).
    vendor/             Composer output (package-local, gitignored). Bundled into the CLI tarball.
  viewer/             Vite + React app. "private": true — never published. Consumed by the CLI build.
    package.json        React, Sigma + graphology, @wordpress/* deps.
    index.html          Vite entry HTML.
    src/                App.jsx, main.jsx, components/, context/, hooks/, lib/, styles/.
    vite.config.js      Self-contained; outDir = dist/ (inside the package).
  cli/                @hooksgraph/hooksgraph (npm package). Node shim over PHP + viewer.
    package.json        bin: hooksgraph → bin/hooksgraph.js
    bin/hooksgraph.js   Node ES module. Dev-aware: uses packages/parser/ + packages/viewer/dist/ when
                        running from a monorepo checkout; uses local php/ + dist/ when run from a tarball.
    php/                Generated by scripts/build-cli.js (copy of parser src + vendor, gitignored).
    dist/               Generated by scripts/build-cli.js (copy of viewer build, gitignored).
  mcp/                @hooksgraph/hooksgraph-mcp (npm package). Standalone stdio MCP server.
    package.json        bin: hooksgraph-mcp. Only runtime dep: @modelcontextprotocol/sdk.
    bin/hooksgraph-mcp.js   Entry point; parses --storage / -h and hands off to runStdioServer().
    src/                server.js, registry.js, index.js, tools/, lib/.
    tests/              Vitest (per-tool coverage + registry + pagination, fixtures under tests/fixtures/).
  plugin/             WP.org plugin shell — scaffolding only. Real build pipeline (strauss + wp-scripts) is a follow-up spec.
    hooksgraph.php      Plugin header only.

scripts/
  build-cli.js        Builds the viewer, validates and installs parser composer deps, copies into packages/cli/.
  setup-profile.sh    Installs the `hooksgraph` alias in zsh / bash / fish RC files —
                      points directly at packages/cli/bin/hooksgraph.js (shebang-executable).

Root config:
  package.json        Workspace umbrella. devDep: vitest. Scripts delegate to per-package pnpm -F calls.
  composer.json       Dev umbrella. Path repo → packages/parser; require-dev: phpunit.
  phpunit.xml         Bootstrap = vendor/autoload.php; testsuite "parser" → packages/parser/tests/.
  vitest.config.js    Explicit root=".", include = packages/viewer/src/**/*.test.js + packages/mcp/tests/**/*.test.js.
  pnpm-workspace.yaml packages: - "packages/*"
  .npmrc              public-hoist-pattern[] for react/webpack/@wordpress (wp-scripts compatibility).
  storage/            Legacy git-ignored output directory (.keep tracked). New runs write to
                      ~/.hooksgraph/{parsed,codebases}/; this dir is kept for back-compat with
                      `php hooksgraph.php` invocations that bypass the Node shim.
```

## Storage layout (user-level)

```
~/.hooksgraph/
  parsed/      Output of `hooksgraph parse` and the default `hooksgraph <dir>` shortcut.
               Read by `hooksgraph serve` (most-recent JSON wins).
               Override with $HOOKSGRAPH_PARSED_DIR.
  codebases/   Output of `hooksgraph parse-codebase`. The MCP server reads exclusively
               from here. Override with $HOOKSGRAPH_CODEBASES_DIR (or --storage on the
               MCP shim).
```

The Node CLI shim is the single source of truth for routing parsed-vs-codebase output. It picks the dir per subcommand and forwards it to the PHP parser via `HOOKSGRAPH_OUTPUT_DIR` (a Node→PHP internal contract — not user-facing). `Runner.php` stays subcommand-agnostic.

### Data flow

```
PHP files → HooksGraph\Cli\Runner (discover → FileParser tokenize/extract → Builder → optional OverlapFilter) → JSON
         → packages/parser/server.php serves JSON at /hooks.json
         → React viewer (from packages/viewer/dist/) renders via Sigma (WebGL) + graphology
```

## Key Files

- `packages/parser/hooksgraph.php` — Thin CLI shim; requires package-local `vendor/autoload.php` and invokes `HooksGraph\Cli\Runner::run()`. Guarded with `defined('HOOKS_GRAPH_TESTING')` so tests don't execute the CLI.
- `packages/parser/src/Parser/FileParser.php` — Entry point for parsing a single file. Walks `token_get_all()` output, delegates hook-name/callback/doc-comment extraction to sibling classes, tracks scope via `ScopeTracker`.
- `packages/parser/src/Graph/Builder.php` / `OverlapFilter.php` — Build the node/edge graph from parsed hook calls; optionally filter to cross-source hooks.
- `packages/parser/src/Cli/Runner.php` — CLI orchestration: argument parsing, file discovery, per-file parse loop, summary rendering, output write.
- `packages/parser/server.php` — Minimal router; any path other than `/hooks.json` falls through to the static file server rooted at the viewer dist dir.
- `packages/cli/bin/hooksgraph.js` — Node shim. Primary entry point — the shell alias installed by `scripts/setup-profile.sh` points directly at this file (shebang-executable). Dev-aware path resolution: falls back to `../parser/hooksgraph.php` and `../viewer/dist/` when tarball-local `php/` and `dist/` are absent. Spawns `php` with `stdio: 'inherit'`.
- `packages/viewer/src/App.jsx` — Top-level React component; orchestrates sidebar, graph canvas, and detail panel. Mounts `<SigmaGraphCanvas>` once a graph JSON is loaded.
- `packages/viewer/src/components/SigmaGraphCanvas.jsx` — Sigma/graphology renderer. Owns the Sigma WebGL instance and the graphology `Graph`. Populates `cyRef` with a small cy-style adapter so `DetailPanel.jsx` can keep its query syntax. Layout is hardcoded to `communities` — no dropdown.
- `packages/viewer/src/lib/sigma-setup.js` — Graphology graph builder + cy-style adapter. `buildSigmaGraph(data, …)` produces the graphology `Graph`; `buildCyAdapter(graph)` exposes the narrow `cy.getElementById` / `cy.edges('[target="X"][edgeType="Y"]')` surface that DetailPanel calls. The adapter is the last bit of cy-shaped indirection — refactoring DetailPanel to read raw data from context would let it go away.
- `packages/viewer/src/lib/sigma-layouts.js` — Layout module. `applyLayout(graph, mode, { isLargeGraph, spread })` mutates `x`/`y` in place. Only `communities` is wired up in the UI; the other modes (`directory`, `force`, `force-noverlap`, `circular`, `source-clusters`, `hook-type-split`, `bipartite`, `random`) remain as callable strategies for future re-exposure. Cluster layouts (`communities`, `directory`) are two-stage: per-cluster FA2 → normalize to a target radius → super-graph FA2 + noverlap to keep cluster bounding circles separated.
- `packages/mcp/bin/hooksgraph-mcp.js` — Node entry point for the MCP server. Parses `--storage` / `-h`, resolves the storage dir, and hands off to `runStdioServer()` in `packages/mcp/src/server.js`.
- `scripts/build-cli.js` — Builds the CLI tarball contents: viewer build → `packages/cli/dist/`, parser (src + composer no-dev vendor + shims) → `packages/cli/php/`.

## Sigma renderer

The viewer renders via Sigma (WebGL) on top of a graphology `Graph`. There is one renderer; no toggle. The layout emphasises _bounded contexts_ — visually separated clusters per Louvain community, rather than one tight FA2 blob.

**Wiring.** `App.jsx` mounts `<SigmaGraphCanvas>` once a graph JSON is loaded. The canvas populates `cyRef` with a tiny cy-style adapter built by `buildCyAdapter(graph)` in `lib/sigma-setup.js` so `DetailPanel.jsx` can keep its `cy.getElementById(...)` / `cy.edges('[target|source="X"][edgeType="…"]')` query syntax. The adapter only implements the surface DetailPanel touches; everything else returns empty collections. Refactoring DetailPanel to read raw data from context would let the adapter go.

**Layout.** Hardcoded to `communities` (Louvain) with `spread = 0.3` — no dropdown, no UI. `applyLayout` in `lib/sigma-layouts.js` still exposes other strategies (`directory`, `force`, `force-noverlap`, etc.) as callable code for future re-exposure, but only `communities` is wired into the canvas. The cluster layouts (`communities`, `directory`) are two-stage:

1. Bucket nodes into clusters (by directory prefix or Louvain community).
2. Run FA2 on each cluster's _internal_ subgraph for an organic shape.
3. Normalize each cluster to a target radius (`15 + sqrt(n)*4`) so the next stage has consistent geometry to work with.
4. Build a super-graph with one node per cluster sized to that radius, run FA2 with `adjustSizes: true` and a `noverlap` pass — this guarantees cluster bounding circles never touch.
5. Translate each member position by its cluster's super-position.

**Visual constraints.** Sigma 3 default programs only ship circle nodes, line + arrow edges, hex colors. So:

- Hook nodes render as circles; file/class nodes render as squares via `@sigma/node-square` (registered in `SigmaGraphCanvas.jsx`). The square program is 1:1 with a single radius, not a true text-width rectangle.
- Both fires and listens use the stock straight `arrow` program. The only differentiator is edge color from the palette (no built-in dashed style in sigma 3).
- No dashed border on `[?dynamic]` hooks.
- No 3px stroke ring on selected node — size bump only.
- No `text-background` pill behind highlighted hook labels.

These are fixable by registering more custom WebGL programs.

## Code Style

- PHP: namespaced classes under `HooksGraph\`; `declare(strict_types=1)` at top of every file; final classes; camelCase methods.
- Parsed hook records are associative arrays with snake_case keys — matches the JSON output shape.
- Node IDs: `type::identifier` format (e.g., `hook::init`, `file::wp::wp-includes/plugin.php`)
- JS: ES modules, React function components, hooks in `packages/viewer/src/hooks/`.

## Testing

- `pnpm test` runs both suites (`pnpm test:php` → PHPUnit, `pnpm test:js` → Vitest).
- `packages/parser/tests/` mirrors `packages/parser/src/`: one test class per source class. `packages/parser/tests/Support/ParsesSource.php` is a trait that writes a snippet to a temp file and invokes `FileParser::parse()`. CLI tests live under `packages/parser/tests/Cli/` — they exercise classes in the same package, so they belong with the parser; `packages/cli/` is purely the Node entrypoint.
- PHPUnit 11 config lives in `phpunit.xml`; bootstrap uses the **root** Composer autoloader (not the parser's package-local one), which resolves `HooksGraph\` via the path repo and `HooksGraph\Tests\` via root autoload-dev.
- `packages/mcp/tests/` covers each MCP tool plus the registry and pagination helper. `packages/mcp/tests/helpers.js` exposes `makeCtx(storageDir)` backed by `packages/mcp/tests/fixtures/` JSON files so tools can be called in-process without spinning up a transport.

## Gotchas

- Hook name extraction for concatenation (`'prefix_' . $var`) produces `prefix_*` — the `*` is a convention, not a glob.
- File IDs include source label to prevent collisions across scanned directories: `file::{source}::{rel_path}`.
- Dynamic hook names (bare variables, interpolations) get a `*` suffix or a synthetic counter id; don't rely on stability across runs.
- `--print-path` mode reserves stdout for the output file path; the progress UI is redirected to stderr. The CLI shim's legacy-shortcut path depends on this.
- `packages/parser/server.php` returns `false` for unknown paths so `php -S` serves static files itself — don't add logic that returns `true` by default.
- The viewer's hotspot threshold is adaptive (top 10% of connections), not a fixed number.
- MCP storage dir resolves in this order: CLI `--storage` → `HOOKSGRAPH_CODEBASES_DIR` env → `~/.hooksgraph/codebases/`. A missing dir throws `MissingStorageError` — don't fall back silently. The MCP server never reads from the parsed dir; populate the codebases dir with `hooksgraph parse-codebase`.
- The MCP graph index caches parsed JSON by file path and invalidates on `mtime` change. Rewriting a storage JSON with the same mtime (rare, but possible with `touch -t`) will not refresh the cache.
- MCP tools receive `{ registry, index }` via a shared ctx from `createServer()`. `UnknownCodebaseError` / `CodebaseLoadError` / `MissingStorageError` are converted to `isError` tool results; anything else bubbles up and crashes the transport.
- Two composer scopes exist: root (dev umbrella — phpunit + parser via path repo) and `packages/parser/` (self-contained autoloader bundled into the CLI tarball). `packages/parser/hooksgraph.php` requires the package-local vendor; tests run against the root vendor. Don't conflate them.
- pnpm workspace. Each package only resolves dependencies it declares; phantom deps fail loudly. `.npmrc` public-hoists react/webpack/@wordpress/\* for wp-scripts compatibility (needed once the plugin pipeline is built).
- Sigma renderer: node `type` attribute selects the Sigma rendering program (e.g. `'circle'`), so the app's hook/file/class type is stored as `nodeType` on the graphology node and surfaced back through the cy-adapter's `data().type`. Same for edges: `type: 'arrow' | 'line'` is the program, not the hook semantic.
- Sigma renderer: default WebGL programs only parse `#RRGGBB(AA)` colors. The repo palette emits `rgba(...)` strings for `fireEdgeAlpha` / `listenEdgeAlpha` / `*Highlight` — the sigma builder uses the hex variants (`fireEdge`, `listenEdge`) instead. Passing rgba silently zeroes the color buffer and the entire canvas goes blank.
- Sigma renderer: `camera.animate({ x, y })` uses **camera-space** (normalized across the framed graph bbox), not graph-space. To pan to a node, use `sigma.getNodeDisplayData(id)` which returns the right coords. Passing graph-space xy will fly the camera off-screen.
- Sigma renderer: node `size` is in **screen pixels** (radius), not graph-px diameter. `nodeSizeFor` in `sigma-setup.js` returns sigma-space directly on a degree-driven sqrt curve (≈3 → ≈28), with a 3px floor in `addNode`. Leaves intentionally fall under `labelRenderedSizeThreshold` at default zoom — the threshold is the hub/leaf importance filter, so don't reintroduce a flat minimum (was previously `Math.max(15, …)`) or it collapses the hierarchy. The reducer in `SigmaGraphCanvas.jsx` sets `forceLabel: true` for hovered/searched/selected neighborhoods to bypass the throttle.
- Sigma renderer: cluster layouts mutate `x`/`y` on the graph in place. The current canvas runs `applyLayout` once at init and never again, but the in-place contract still matters if you re-introduce a layout switcher — rebuilding sigma is expensive and resets the camera.

## Supported Hook Functions

```
do_action, do_action_ref_array         → edge_type="fires",   hook_type="action"
apply_filters, apply_filters_ref_array → edge_type="fires",   hook_type="filter"
add_action                             → edge_type="listens", hook_type="action"
add_filter                             → edge_type="listens", hook_type="filter"
```
