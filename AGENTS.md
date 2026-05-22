# WordPress Hooks Graph

Parses WordPress PHP codebases for hook relationships (`do_action` / `add_action` / `apply_filters` / `add_filter`) and visualizes them as an interactive graph. This file is the **monorepo orchestrator** — workspace shape, cross-package commands, contribution flow. Package internals live in each package's own `CLAUDE.md` / `README.md`.

## Workspace shape

pnpm workspace (`pnpm-workspace.yaml` → `packages/*`). Six packages, each independently testable and (where applicable) publishable:

| Package              | Role                                                                                                   | Internals                          |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `packages/parser/`   | PHP library — `HooksGraph\` namespace. Tokenizes PHP, extracts hook calls, builds the graph JSON.      | `packages/parser/CLAUDE.md`        |
| `packages/viewer/`   | Vite + React app (Sigma WebGL + graphology). Private; consumed by the CLI and theme builds.            | `packages/viewer/CLAUDE.md`        |
| `packages/cli/`      | `@hooksgraph/hooksgraph` npm package. Node shim that wraps the PHP parser + viewer for end users.      | `packages/cli/CLAUDE.md`           |
| `packages/mcp/`      | `@hooksgraph/hooksgraph-mcp` npm package. Stdio MCP server exposing parsed codebases as agent tools.   | `packages/mcp/CLAUDE.md`           |
| `packages/plugin/`   | WP.org plugin shell. Scaffolded; pipeline (strauss + wp-scripts) lands in a follow-up spec.            | `packages/plugin/CLAUDE.md`        |
| `packages/theme/`    | Classic WordPress theme that embeds the viewer on its front page.                                      | `packages/theme/CLAUDE.md`         |

Three runnable products fall out of these: **CLI** (parser + viewer), **MCP server** (parser output + stdio tools), **WP theme/plugin** (viewer in a WP site).

## Cross-package commands

Root-level only. Per-package scripts and dev workflows are documented inside each package.

| Command                 | Description                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`          | Install Node deps across the workspace                                                                                                   |
| `composer install`      | Install root PHP dev deps (PHPUnit 11) and symlink the parser via the path repo                                                          |
| `pnpm setup:alias`      | Install the `hooksgraph` shell alias (`scripts/setup-profile.sh`)                                                                        |
| `pnpm build`            | One-shot full build: `composer install` + `pnpm build:cli` + `pnpm build:plugin` + `pnpm build:theme`                                    |
| `pnpm build:viewer`     | Viewer-only rebuild → `packages/viewer/dist/`                                                                                            |
| `pnpm build:cli`        | Assemble `packages/cli/` for npm publish (viewer build + parser composer no-dev → `packages/cli/{dist,php}/`)                            |
| `pnpm build:plugin`     | wp-scripts build for the plugin                                                                                                          |
| `pnpm build:theme`      | Build the theme: viewer build → `packages/theme/assets/` + `manifest.json`                                                               |
| `pnpm dev` / `dev:viewer` / `dev:plugin` | Per-package dev servers (delegated via `pnpm -F`)                                                                       |
| `pnpm test`             | PHP + JS suites: `pnpm test:php && pnpm test:js`                                                                                         |
| `pnpm test:php`         | Both PHP suites: `pnpm test:parser` (PHPUnit 11, no WP) then `pnpm test:plugin` (PHPUnit 9, WP test lib)                                 |
| `pnpm test:js`          | Vitest — viewer (`packages/viewer/src/**/*.test.js`) + MCP (`packages/mcp/tests/**/*.test.js`). Root `vitest.config.js` pins the includes |
| `pnpm test:plugin:install` | One-time WP test-lib installer for the plugin suite. Needs MySQL + svn                                                                |
| `pnpm mcp -- [--storage <dir>]` | Run the stdio MCP server                                                                                                         |
| `hooksgraph <dir>...`   | Top-level user command after `pnpm setup:alias` — parse + serve + open                                                                   |

For everything beyond cross-package orchestration (parser flags, viewer dev knobs, MCP tool list, plugin internals, theme bootstrap), see the package's own docs.

## Storage layout (user-level)

```
~/.hooksgraph/
  parsed/      `hooksgraph parse` + the `hooksgraph <dir>` shortcut. Read by `hooksgraph serve`
               (most-recent JSON wins). Override: $HOOKSGRAPH_PARSED_DIR.
  codebases/   `hooksgraph parse-codebase`. Read exclusively by the MCP server.
               Override: $HOOKSGRAPH_CODEBASES_DIR (or `--storage` on the MCP shim).
```

The Node CLI shim (`packages/cli/bin/hooksgraph.js`) is the single source of truth for routing parsed-vs-codebase output. It picks the dir per subcommand and forwards it to the PHP parser via `HOOKSGRAPH_OUTPUT_DIR` (Node→PHP internal contract, not user-facing). The parser stays subcommand-agnostic.

## Repo-wide invariants

- **Three composer scopes.** Don't conflate them.
  1. **Root** — dev umbrella. PHPUnit 11 + parser via path repo. Runs the parser tests.
  2. **`packages/parser/`** — self-contained autoloader bundled into the CLI tarball. `packages/parser/hooksgraph.php` requires this package-local `vendor/`.
  3. **`packages/plugin/`** — PHPUnit 9 + yoast/phpunit-polyfills. Runs the plugin WP suite.
- **pnpm workspace strictness.** Each package only resolves deps it declares; phantom deps fail loudly. `.npmrc` public-hoists `react` / `webpack` / `@wordpress/*` for wp-scripts compatibility.
- **Vitest root config.** `vitest.config.js` at the repo root pins `root: "."` and explicit includes for viewer + MCP. Adding a new JS test suite requires editing that include list.
- **PHPUnit configs.** Root `phpunit.xml` covers the parser; the plugin has its own `packages/plugin/phpunit.xml.dist`.
- **Storage dir resolution is fail-fast for MCP.** Missing dir → `MissingStorageError`, no silent fallback. MCP never reads `parsed/`; populate `codebases/` with `hooksgraph parse-codebase`.

## Code style

- **PHP** — namespaced under `HooksGraph\`; `declare(strict_types=1)` at top of every file; final classes; camelCase methods.
- **Parsed JSON shape** — associative arrays with **snake_case** keys; node IDs are `type::identifier` (`hook::init`, `file::wp::wp-includes/plugin.php`).
- **JS** — ES modules, React function components, hooks under `packages/<pkg>/src/hooks/`.
- **Supported hook fns:** `do_action[_ref_array]` / `apply_filters[_ref_array]` → fires; `add_action` / `add_filter` → listens. `hook_type` ∈ `action | filter`.

## Contribution flow

1. `pnpm install && composer install` — bootstrap both stacks.
2. Work in the relevant package; read its `CLAUDE.md` first.
3. `pnpm test` before opening a PR (fans out to both PHP suites + Vitest). If you touched only one package, the per-package script (`pnpm -F @hooksgraph/<pkg> test`) is faster for inner-loop iteration.
4. If you change the CLI surface or output shape, update **the affected package's docs** plus this file's command table — orchestrator-level commands live here, package internals don't.

## See also

- `README.md` — user-facing overview, install, quick start, viewer + MCP usage.
- `packages/<name>/CLAUDE.md` — per-package architecture, file map, gotchas.
- `packages/<name>/README.md` — per-package public docs (where published).
