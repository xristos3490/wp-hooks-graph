# Monorepo Restructure — Design

**Date:** 2026-04-23
**Scope:** Repo layout, build tooling, and distribution wiring. No feature changes. Covers splitting `src/` into distinct packages and preparing each for its target distribution channel.

## Goal

Reshape the repo so the PHP parser, React viewer, MCP server, CLI, and WordPress plugin each have a clean home and can be shipped on their own channels. Motivated by four near-term deliverables:

1. **WP.org plugin** (target: ~1 month) — bundles the parser, ships a wp-scripts-built admin UI.
2. **npm CLI** (`@xristos3490/hooksgraph-cli`) — Node shim over the PHP parser + viewer.
3. **npm MCP server** (`@xristos3490/hooksgraph-mcp`) — standalone, installable via `npx` in MCP client configs.
4. **WP.org plugin review wait** — starting the submission pipeline is critical-path, so structural work needs to land fast.

## Constraints

- Parser code must be bundleable into the WP plugin (independent distribution, no runtime Composer fetch).
- MCP and CLI publish to npm; their installed footprints must not carry viewer deps (React, Cytoscape, `@wordpress/`*).
- Plugin admin UI uses `@wordpress/scripts` (webpack, externalized `react`/`@wordpress/*`) — distinct toolchain from the Vite viewer.
- Existing test suites (PHPUnit, Vitest) keep running; no test rewrite in this work. `tests/phpunit/Cli/` moves into `packages/cli/tests/phpunit/` so the cli package owns its tests. The Node shim itself is thin plumbing and doesn't need its own test suite.
- `server.php` and `bin/*` dispatcher behavior stays intact from the user's perspective.

## Non-goals

- Publishing the parser to Packagist. Deferred; bundling is the chosen integration.
- Sharing React components between the standalone viewer and the plugin admin UI. Deferred until real duplication appears.
- Rewriting the parser in JS. Not feasible and not the goal.
- CI/CD pipelines. Covered by a follow-up plan.

## Target structure

```
packages/
  parser/           PHP library — HooksGraph\ namespace
    composer.json
    src/            (was src/HooksGraph/)
    hooksgraph.php  (was repo-root hooksgraph.php)
    server.php      (was repo-root server.php)
    tests/          (was tests/phpunit/)
  viewer/           Vite React app — standalone, CLI consumer
    package.json
    index.html      (was repo-root index.html)
    src/            (was src/ minus HooksGraph/ and mcp/)
    vite.config.js
  cli/              @xristos3490/hooksgraph-cli (npm)
    package.json    bin: hooksgraph → bin/hooksgraph.js
    bin/hooksgraph.js     Node shim
    php/            copy of parser/ + generated autoloader (built by scripts/build-cli.js)
    dist/           copy of viewer build (built by scripts/build-cli.js)
    tests/
      phpunit/      CLI tests (was tests/phpunit/Cli/) — ArgumentsTest, HelpTest
  mcp/              @xristos3490/hooksgraph-mcp (npm) — standalone
    package.json    bin: hooksgraph-mcp → bin/hooksgraph-mcp.js
    bin/hooksgraph-mcp.js
    src/            (was src/mcp/)
    tests/          (was tests/mcp/)
  plugin/           HooksGraph (WP.org zip, slug: hooksgraph)
    hooksgraph.php  main plugin file
    readme.txt      WP.org readme
    includes/       PHP (admin page, enqueue)
    src/            React UI (wp-scripts input)
    build/          wp-scripts output (enqueued; gitignored)
    vendor/         Composer output with scoped parser (gitignored)
    package.json    devDep: @wordpress/scripts
    composer.json   path dep on ../parser + strauss config
    .distignore     files excluded from WP.org zip

scripts/
  build-cli.js      copies packages/parser → packages/cli/php, viewer build → packages/cli/dist
  build-plugin.sh   runs strauss, wp-scripts build, assembles zip

bin/
  hooksgraph        existing top-level dispatcher, repoints to packages/cli/bin/hooksgraph.js
                    (dev mode: runs against monorepo layout; still useful locally)
  serve             as today, but finds dist/ at packages/viewer/dist/

storage/            unchanged, repo-root (gitignored)
docs/               unchanged
package.json        root — shared devDeps (vitest), root scripts
pnpm-workspace.yaml declares packages/* as workspaces
.npmrc              pnpm config (see "pnpm workspaces" section)
composer.json       root — Composer path repository pointing at packages/parser
phpunit.xml         updated paths
vitest.config.js    new — see "Vitest" section below
```

## Per-package breakdown

### `packages/parser/`

- Pure move + rename. `HooksGraph\` PSR-4 root changes from `src/HooksGraph/` → `packages/parser/src/`.
- `packages/parser/composer.json` declares the PSR-4 map and has no runtime deps. `composer install` inside the package produces `packages/parser/vendor/autoload.php` — a self-contained autoloader the parser owns.
- `hooksgraph.php` (the thin CLI shim) moves inside the package and continues to `require __DIR__ . '/vendor/autoload.php'` (now the package-local vendor dir, not the root's).
- `server.php` moves here too — it's parser-adjacent (serves the JSON produced by the parser). The repo-root `bin/serve` points at the new location.
- No code changes in `src/HooksGraph/` classes.
- Tests move with it; PHPUnit bootstrap path in `phpunit.xml` updates.

### `packages/viewer/`

- Vite root is the package directory. `vite.config.js` stays self-contained inside `packages/viewer/`.
- All JS/JSX/CSS currently under `src/` (except `src/HooksGraph/` and `src/mcp/`) move into `packages/viewer/src/`.
- `build.outDir` is `dist/` (inside the package — `packages/viewer/dist/`). The repo-root `dist/` no longer exists.
- `bin/serve` updates to serve `packages/viewer/dist/`.
- `hooksJsonPlugin` stays as-is — it's self-contained in the Vite config.
- `package.json` inside viewer carries React, Cytoscape, `@wordpress/*`, Vite. `"private": true` — never published.

### `packages/cli/`

Node CLI that wraps the PHP parser and serves the viewer.

- `bin/hooksgraph.js` (Node ES module, `#!/usr/bin/env node`) resolves its own install path via `import.meta.url`, then `child_process.spawn`s `php <pkg>/php/hooksgraph.php ...args` with inherited stdio. Exit code propagates.
- `serve` subcommand spawns `php -S <host:port>` with `<pkg>/php/server.php` as the router, pointed at `<pkg>/dist/`.
- Preflight check: if `php` is not on `PATH`, print a clear install hint (`brew install php`, `apt install php-cli`, etc.) and exit with code 2.
- Publishes to npm as `@xristos3490/hooksgraph`. Only runtime dep: none (Node stdlib only).
- **Tests** (PHPUnit) live under `packages/cli/tests/phpunit/` — `ArgumentsTest.php` and `HelpTest.php` move here from `tests/phpunit/Cli/`. They still test classes in the parser package (`HooksGraph\Cli\*`); the root Composer umbrella's path repo provides the autoloader at test time. Root `phpunit.xml` declares two test suites (parser + cli) so both run with `pnpm test:php`.
- Package contents at publish time are assembled by `scripts/build-cli.js`:
  1. Run `pnpm -F viewer build` → produces `packages/viewer/dist/`.
  2. Run `composer validate --working-dir=packages/parser --no-check-publish` to catch a malformed `composer.json` before it ships.
  3. Run `composer install --working-dir=packages/parser --no-dev --optimize-autoloader` to produce a minimal `vendor/autoload.php`.
  4. Copy `packages/parser/{src,vendor,hooksgraph.php,server.php}` → `packages/cli/php/`.
  5. Copy `packages/viewer/dist/`** → `packages/cli/dist/`.
  6. `packages/cli/.npmignore` (or `"files"` in package.json) keeps only `bin/`, `php/`, `dist/`, `README.md`, `LICENSE`.
- `packages/cli/php/` and `packages/cli/dist/` are gitignored. The only way to populate them is via `scripts/build-cli.js`, so no stale bytes can leak into a publish — every build starts from a fresh `composer install`.

### `packages/mcp/`

- Contents move verbatim from `src/mcp/` → `packages/mcp/src/`, and `tests/mcp/` → `packages/mcp/tests/`.
- `bin/hooksgraph-mcp.js` moves from repo-root `bin/` → `packages/mcp/bin/`. Import path updates from `'../src/mcp/server.js'` → `'../src/server.js'`.
- `package.json` carries `@modelcontextprotocol/sdk` as its only runtime dep. `"private": false`, publishable.
- Usage docs in `packages/mcp/README.md`:
  ```json
  {
    "mcpServers": {
      "hooks": {
        "command": "npx",
        "args": ["-y", "@xristos3490/hooksgraph-mcp", "--storage", "/path/to/storage"]
      }
    }
  }
  ```
- No PHP or viewer dependency — contract is the JSON file format in the storage dir.

### `packages/plugin/`

WordPress plugin, built for WP.org distribution.

**Scope of this spec:** the restructure only scaffolds the package shell — `hooksgraph.php` (plugin header, display name "HooksGraph") and a placeholder PHP file. Everything below describes the **target shape** (implemented in a follow-up spec), not what this restructure produces.

Target shape once fully built:

- `hooksgraph.php` — main plugin entry (`Plugin Name: HooksGraph` header, bootstrap).
- `includes/` — admin page class, enqueue logic, AJAX/REST endpoints. Uses the scoped parser from `vendor/`.
- `src/` — React UI sources (wp-scripts input). `index.js` entry registers a block/page/data-store as appropriate.
- `build/` — wp-scripts output (`index.js`, `index.asset.php`, css). Enqueued by PHP. Gitignored.
- `vendor/` — Composer output. Includes the scoped parser under a prefixed namespace.
- `composer.json`:
  - `require: { "xristos3490/hooks-parser": "*" }`
  - `repositories: [{ "type": "path", "url": "../parser" }]`
  - `extra.strauss`: rewrite `HooksGraph\`* → `Xristos3490\HooksGraph\Vendor\HooksGraph\*` (exact prefix TBD at implementation). Strauss output target: `vendor/prefixed/` (then `composer dump-autoload`).
- `package.json`:
  - `devDependencies: { "@wordpress/scripts": "^27.0.0" }` (pin to current stable at implementation time)
  - Scripts: `build`, `start`, `format`, `lint:js`, `packages-update`.
  - Dev workflow: the plugin folder is symlinked into a local WordPress install's `wp-content/plugins/`. JS/CSS watch runs via `pnpm -F plugin start` (wraps `wp-scripts start`) — any change to `src/` rebuilds `build/` and the running WP picks up new assets on browser reload. PHP changes in `hooksgraph.php` / `includes/` are live on refresh.
- `readme.txt` — WP.org format (not markdown), handled manually.
- `.distignore` — excludes `src/`, `node_modules/`, `tests/`, `package*.json`, `composer*.json`, `.git*`, build artifacts not enqueued.
- WP.org zip is produced by `scripts/build-plugin.sh`: `composer install && strauss && wp-scripts build && rsync --exclude-from=.distignore → dist/hooksgraph/ && zip`.

## Build tooling


| Package  | Language         | Build tool                                             | Output                | Publish target                  |
| -------- | ---------------- | ------------------------------------------------------ | --------------------- | ------------------------------- |
| `parser` | PHP              | Composer autoload                                      | none                  | bundled into cli + plugin       |
| `viewer` | JS/React         | Vite                                                   | `dist/`               | consumed by cli (not published) |
| `cli`    | JS + bundled PHP | `scripts/build-cli.js`                                 | package tarball       | npm                             |
| `mcp`    | JS               | none (raw Node ESM)                                    | package tarball       | npm                             |
| `plugin` | PHP + React      | `scripts/build-plugin.sh` (strauss + wp-scripts + zip) | `dist/hooksgraph.zip` | WP.org                          |


## Cross-cutting concerns

### Vitest

Two separate configs, two different roots:

- `packages/viewer/vite.config.js` — Vite dev/build only. Root is the viewer package. No Vitest fields here.
- `vitest.config.js` (repo root, new) — explicit `root: '.'`, `test.include: ['packages/viewer/src/**/*.test.js', 'packages/mcp/tests/**/*.test.js']`. Keeps existing test discovery working without inheriting viewer's Vite root.

This avoids the silent gotcha where Vitest picks up viewer's `root: 'viewer'` and quietly skips MCP tests.

### pnpm workspaces

Package manager: **pnpm** (not npm). Chosen for strict dependency hygiene, faster installs, and better filter ergonomics. CI and local dev use `pnpm install` / `pnpm -F <pkg> <script>`.

`pnpm-workspace.yaml` at root:

```yaml
packages:
  - "packages/*"
```

Root `package.json`:

```json
{
  "private": true,
  "scripts": {
    "dev": "pnpm -F viewer dev",
    "build": "pnpm -F viewer build",
    "build:cli": "node scripts/build-cli.js",
    "build:plugin": "bash scripts/build-plugin.sh",
    "mcp": "node packages/mcp/bin/hooksgraph-mcp.js",
    "test": "pnpm test:php && pnpm test:js",
    "test:php": "vendor/bin/phpunit",
    "test:js": "vitest run"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
```

Shared devDeps (vitest) live at root; package-specific deps live in each package's `package.json`. pnpm's strict layout means each package can only import what its own `package.json` declares — phantom deps fail loudly.

Workspace-local deps use the `workspace:` protocol where applicable (e.g., if a shared UI package is added later, consumers declare `"workspace:*"`). Not needed initially because no package imports another at the JS level — parser is bundled by scripts, viewer dist is copied by scripts, MCP is standalone.

### `.npmrc` for wp-scripts compatibility

pnpm's default symlinked layout can confuse webpack-based tools (including `@wordpress/scripts`) that assume hoisted node_modules. Preemptive `.npmrc` at repo root:

```
public-hoist-pattern[]=*react*
public-hoist-pattern[]=*webpack*
public-hoist-pattern[]=@wordpress/*
strict-peer-dependencies=false
```

This hoists the named patterns to the root `node_modules` (visible to all packages' resolvers) while keeping everything else strict. `strict-peer-dependencies=false` avoids install-time errors from `@wordpress/scripts`' large and sometimes-inconsistent peer dep surface; unmet peers still warn.

If a specific React duplication still surfaces during plugin dev, pin `react` and `react-dom` at root `devDependencies` to match what `@wordpress/scripts` expects — belt and suspenders.

### Composer

Three independent Composer scopes, each with its own `composer.json` and `vendor/`:

1. **Root** (dev umbrella) — pulls PHPUnit and wires the parser via a path repo so tests can autoload parser classes.
  ```json
   {
     "name": "xristos3490/wp-hooks-graph",
     "repositories": [
       { "type": "path", "url": "packages/parser" }
     ],
     "require": { "xristos3490/hooks-parser": "*" },
     "require-dev": { "phpunit/phpunit": "^11" }
   }
  ```
2. `**packages/parser/composer.json**` — self-contained. Declares `HooksGraph\` PSR-4 map, no runtime deps. `composer install` here produces the autoloader that `hooksgraph.php` requires. This is the vendor dir bundled into the CLI tarball.
3. `**packages/plugin/composer.json**` — depends on parser via its own path repo, applies strauss prefixing. `composer install` here produces the scoped `vendor/` committed into the plugin zip.

Root `phpunit.xml` declares two test suites — `parser` (at `packages/parser/tests/`) and `cli` (at `packages/cli/tests/phpunit/`) — both running under `pnpm test:php`.

### Bin dispatcher

`bin/hooksgraph` (repo-root bash wrapper) stays for local dev convenience. It now points into `packages/cli/bin/hooksgraph.js` and resolves PHP from `packages/parser/hooksgraph.php`. This keeps the developer workflow (`hooksgraph parse path/to/plugin`) unchanged.

### `.gitignore` updates

- `dist/` at root → remove (dist now lives per-package).
- Add: `packages/viewer/dist/`, `packages/cli/dist/`, `packages/cli/php/`, `packages/plugin/build/`, `packages/plugin/vendor/`, `packages/plugin/dist/`.
- `storage/` unchanged at root.
- `package-lock.json` deleted (pnpm replaces it). `pnpm-lock.yaml` is committed.

## Migration order

Dependency-respecting sequence. Each step ends with green tests.

1. **Scaffold monorepo shell.** Create `packages/`, `pnpm-workspace.yaml`, `.npmrc`, updated root `package.json`, root `vitest.config.js`, root Composer path repo. Run `pnpm install` to regenerate the lockfile as `pnpm-lock.yaml`.
2. **Move parser.** `src/HooksGraph/` → `packages/parser/src/`. Move `hooksgraph.php`, `server.php`, and `tests/phpunit/` **except** `tests/phpunit/Cli/` (which is deferred to step 5). Update `phpunit.xml` for the parser suite; run `composer dump-autoload`; parser tests green.
3. **Move viewer.** `src/` (remaining) + `index.html` + `vite.config.js` → `packages/viewer/`. Update `bin/serve` path reference. Smoke test `pnpm dev` and `pnpm build`.
4. **Move MCP.** `src/mcp/` → `packages/mcp/src/`, `tests/mcp/` → `packages/mcp/tests/`, `bin/hooksgraph-mcp.js` → `packages/mcp/bin/`. Update the one import path. Run `pnpm test:js`.
5. **Create cli package.** New `packages/cli/` with Node shim, `scripts/build-cli.js`, and `tests/phpunit/` (seeded from the deferred `tests/phpunit/Cli/`). Add the `cli` test suite to root `phpunit.xml`. End-to-end: `pnpm build:cli` produces a tarball, `npx ./tarball parse <fixture>` works, and `pnpm test:php` runs both suites green.
6. **Scaffold plugin package shell.** Create `packages/plugin/` with a minimal `hooksgraph.php` (WP plugin header only — `Plugin Name: HooksGraph`) and an empty placeholder PHP file to hold the package. Nothing else — no wp-scripts, no strauss, no build pipeline. Purpose is only to reserve the package slot and keep step 6 small.
7. **Clean up.** Remove old paths (old `dist/` gitignore entry, repo-root leftovers).

Steps 2–4 are essentially mechanical moves. Step 5 introduces new code (Node shim). Step 6 is intentionally minimal — the real plugin build pipeline (strauss, wp-scripts, zip, readme.txt, admin UI) is out of scope for this restructure and handled in a follow-up spec.

## Deferred / open

- **Plugin build pipeline.** Strauss config, wp-scripts wiring, `readme.txt`, `.distignore`, `scripts/build-plugin.sh`, admin UI scaffolding — all in a follow-up spec. This restructure only reserves the `packages/plugin/` slot.
- **Parser on Packagist.** Reassess after WP plugin ships.
- **Shared UI components package.** Create `packages/ui/` only if real duplication between viewer and plugin UI appears.
- **CI pipeline.** GitHub Actions for per-package test + publish. Follow-up plan.
- **Plugin admin UI scope.** What the UI actually shows (dashboard? per-hook view? graph canvas?) — design in its own spec; out of scope here.
- **Strauss prefix naming.** `Xristos3490\HooksGraph\Vendor\HooksGraph\`* vs a shorter form — decide at plugin implementation time; doesn't affect structure.
- **MCP package scope.** If, later, users want the MCP server to also *invoke* the parser (rather than reading pre-generated JSON), that would introduce a dependency from mcp to cli. Not in scope now; MCP stays JSON-reader-only.

## Risks

- **wp-scripts + pnpm resolution.** Known gotcha with pnpm's strict layout; mitigation ready (`.npmrc` public-hoist-pattern + optional root-level React pin). Surfaces once the plugin build pipeline is implemented.
