# HooksGraph CLI (`packages/cli/`)

Node ES-module shim that ships as the [`@hooksgraph/hooksgraph`](https://www.npmjs.com/package/@hooksgraph/hooksgraph)
npm package. Wraps the PHP parser ([`packages/parser/`](../parser/)) and the static
viewer build ([`packages/viewer/`](../viewer/)) into one binary, `hooksgraph`.

The shim is **the single source of truth** for parsed-vs-codebase storage routing and
PHP/viewer path resolution. `Cli\Runner` on the PHP side stays subcommand-agnostic and
just honors `HOOKSGRAPH_OUTPUT_DIR`.

## Layout

```
package.json            @hooksgraph/hooksgraph. type=module. bin: hooksgraph → bin/hooksgraph.js.
                        `files` whitelists bin/, php/, dist/, README, LICENSE for npm publish.
                        No runtime deps — Node stdlib only.
bin/hooksgraph.js       The entire shim. Shebang-executable (#!/usr/bin/env node).
                        The shell alias installed by scripts/setup-profile.sh points
                        directly at this file.
php/                    Build output (gitignored). Populated by scripts/build-cli.js
                        with parser src/, vendor/, hooksgraph.php, server.php.
dist/                   Build output (gitignored). Populated by scripts/build-cli.js
                        with the viewer build (packages/viewer/dist/).
```

## Subcommand surface

| Subcommand                          | Output                                              | invokedAs (env)              |
| ----------------------------------- | --------------------------------------------------- | ---------------------------- |
| `hooksgraph <dirs...>`              | parse → `~/.hooksgraph/parsed/` → serve → open browser | `hooksgraph`                 |
| `hooksgraph parse <dirs...>`        | `~/.hooksgraph/parsed/`                             | `hooksgraph parse`           |
| `hooksgraph parse-codebase <dirs...>` | `~/.hooksgraph/codebases/`                        | `hooksgraph parse-codebase`  |
| `hooksgraph serve [path]`           | starts `php -S` on port 8080+ against viewer dist   | n/a                          |
| `hooksgraph [--help|-h]`            | top-level help                                       | n/a                          |

The no-arg-subcommand shortcut (`hooksgraph <dir>`) parses with `--print-path`,
captures stdout to get the output path, then re-invokes `serve` with it.

## Dev-aware path resolution

`bin/hooksgraph.js` checks for tarball-local `php/hooksgraph.php` and `dist/index.html`
to decide whether it's running from a published tarball or a monorepo checkout:

- **Tarball**: uses `./php/` (bundled parser + vendor) and `./dist/` (bundled viewer).
- **Monorepo (dev)**: falls back to `../parser/` and `../viewer/dist/` — so
  `packages/cli/bin/hooksgraph.js` works as soon as the viewer has been built once,
  no prior `pnpm build:cli` required.

The probe is for sentinel files (`hooksgraph.php`, `index.html`), not just directory
existence — `php/` and `dist/` may exist as empty placeholders during partial builds.

## The Node → PHP contract

Three environment variables flow from this shim to `packages/parser/hooksgraph.php`:

| Var                        | Set by              | Read by                  | Purpose                                                                 |
| -------------------------- | ------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `HOOKSGRAPH_OUTPUT_DIR`    | shim, per subcommand | `Cli\Runner`            | Storage dir for the JSON. Internal; not user-facing.                    |
| `HOOKSGRAPH_INVOKED_AS`    | shim                | `Cli\Help`              | Program name shown in help/usage text (`hooksgraph parse ...`).         |
| `HOOKS_JSON`               | shim (serve only)   | `packages/parser/server.php` | Absolute path to the JSON to serve at `/hooks.json`.               |
| `HOOKSGRAPH_PARSED_DIR`    | user                | shim → `resolveStorageDir('parsed')` | Override default `~/.hooksgraph/parsed/`.                   |
| `HOOKSGRAPH_CODEBASES_DIR` | user                | shim → `resolveStorageDir('codebases')` | Override default `~/.hooksgraph/codebases/`.             |

Don't move storage routing into PHP. Keeping it in Node means `Cli\Runner` stays usable
by other PHP callers (the in-monorepo plugin uses the lower-level classes anyway, but
the principle holds) and we only have one place to grep for "where does the JSON go?".

## Process model

- PHP is spawned with `stdio: 'inherit'` for `parse` / `parse-codebase` / `serve` so
  the user sees the parser's ANSI progress bar and the `php -S` access log directly.
- The legacy shortcut uses `spawnSync('php', ['--print-path', ...args], { stdio:
  ['inherit', 'pipe', 'inherit'] })` — stdout is piped (captures the resolved output
  path), stderr is inherited (progress UI). `--print-path` mode redirects all parser
  echo/printf to stderr, so the only thing on stdout is the final path.
- `serve` finds a free port starting at 8080 (probes up to +100), forwards SIGINT /
  SIGTERM to the PHP child, and opens the URL with the first of `open` / `xdg-open` /
  `wslview` / `start` available on PATH.
- `ensurePhp()` runs once at startup and exits with code 2 + an install hint if `php`
  is missing.

## Build pipeline

`scripts/build-cli.js` (at repo root) assembles the publishable package:

1. `pnpm -F @hooksgraph/viewer build` → `packages/viewer/dist/`
2. `composer validate --working-dir=packages/parser --no-check-publish`
3. `composer install --working-dir=packages/parser --no-dev --optimize-autoloader`
4. Reset `packages/cli/php/`, copy parser `src/` + `vendor/` + `hooksgraph.php` +
   `server.php` into it.
5. Reset `packages/cli/dist/`, copy viewer `dist/` into it.

Both `php/` and `dist/` are gitignored — they only exist post-build. The
`package.json#files` whitelist still includes them so they ship in the tarball.

## Code style

- ES modules (`type: "module"`). `import` from `node:` namespace for stdlib.
- Single-file shim by design — every code path is in `bin/hooksgraph.js`. Resist the
  urge to split into `src/` files; this binary should be diff-able as a unit.
- No runtime npm deps. The whole shim is `node:child_process` + `node:path` +
  `node:os` + `node:fs` + `node:net` + `node:url`.

## Gotchas

- The shell alias installed by `scripts/setup-profile.sh` points at
  `packages/cli/bin/hooksgraph.js` directly (shebang-executable), not at a `node`
  wrapper. Removing the shebang or the executable bit breaks every existing install.
- `bin/hooksgraph.js` runs from a published tarball **without** ever importing from
  `../parser/` or `../viewer/` — when both probes find their sentinel files, the dev
  branches are inert. Keep it that way: any `import` of a sibling-package file would
  blow up `npm install -g @hooksgraph/hooksgraph` (those packages aren't published).
- `runServe()` resolves the JSON path **before** spawning `php -S` and passes the
  absolute path via `HOOKS_JSON`. Don't pass a relative path — the PHP server's CWD is
  the viewer dist dir, not yours.
- `mostRecentJson()` only looks at `*.json` mtimes in the parsed dir; it ignores
  subdirectories. Don't introduce nested storage layouts without updating it.
- `findFreePort()` probes on `127.0.0.1`, not `0.0.0.0`. A port can pass the probe and
  then fail in `php -S` if another tool grabs it in the race window — rare, but it
  surfaces as `php` exiting non-zero, which we forward as-is.
- The fall-through shortcut (no recognised subcommand) treats *all* args as parse
  targets — there's no "unknown subcommand" error. A typo like `hooksgraph parsee
  ~/wp` will be sent to the parser as a directory list, which will then complain about
  the bogus path. That's intentional (forgiveness over strictness) but if you add a
  new subcommand, list it explicitly before the fall-through.

## Tests

There is no Node-level test suite for the shim — the parser pipeline it dispatches to
is covered by PHPUnit (`pnpm test:parser`) and the viewer it serves is covered by
Vitest (`pnpm test:js`). If you add logic beyond glue (e.g. complex arg parsing,
storage layout migration), add a Vitest suite under `packages/cli/tests/` and wire it
into the root `vitest.config.js`.

See [`../../README.md`](../../README.md) for the user-facing surface and
[`../parser/AGENTS.md`](../parser/AGENTS.md) for what the spawned PHP does.
