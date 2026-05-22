# HooksGraph Plugin

`@hooksgraph/plugin` — WordPress plugin that wraps the [wp-hooks-graph parser](../parser/) and exposes a Tools-menu admin UI for parsing installed plugins on-demand, browsing the resulting JSON graphs, and running AI-assisted scans (e.g. priority-conflict triage) over them.

This is the in-WordPress companion to the standalone CLI + viewer documented in the [root README](../../README.md). The release pipeline (strauss + zip) is still a follow-up; for now this package is consumed via the monorepo for local development.

## What it does

- **Tools → HooksGraph** admin page listing every active plugin with its parse state (`needs_parsing` / `scheduled` / `parsed` / `stale`).
- Schedule a parse against any installed plugin; results are stored under `wp-content/hooksgraph/<basename>-<version>.json` and downloadable from the same screen.
- REST API at `hooksgraph/v1/*` (gated by `manage_options`) covering plugin listing, parse scheduling, JSON download, and AI chat.
- Abilities API integration: every graph query (`find_hook`, `listeners_of`, `compare_hook`, …) is registered as a `hooksgraph` ability so the WP AI Client can call them as tools — the same surface the MCP server exposes externally.
- `hg_scan` custom post type that drives AI-assisted scan runs through chained WP-Cron events (init → per-finding triage → finalize).

## Requirements

- WordPress 6.5+
- PHP 8.2+
- Node 18+ and pnpm 10+ for the JS build
- The WordPress AI Client and Abilities API features (bundled with WP 7.0+, available via Performance Lab on older versions) for the AI chat + scan flows

## Install (monorepo dev)

From the repo root:

```sh
pnpm install
composer install --working-dir=packages/plugin
pnpm -F @hooksgraph/plugin build
```

Then symlink (or copy) `packages/plugin/` into your WP install's `wp-content/plugins/` and activate **HooksGraph**.

The bootstrap autoloader prefers `packages/plugin/vendor/`, falling back to `packages/parser/vendor/` for dev installs that haven't run the plugin's own `composer install`.

## Commands

Run from the monorepo root unless noted.

| Command                              | Description                            |
| ------------------------------------ | -------------------------------------- |
| `pnpm -F @hooksgraph/plugin start`   | wp-scripts dev build (watch) → `build/` |
| `pnpm -F @hooksgraph/plugin build`   | wp-scripts production build → `build/`  |
| `pnpm -F @hooksgraph/plugin format`  | Prettier via wp-scripts                |
| `pnpm -F @hooksgraph/plugin lint:js` | ESLint via wp-scripts                  |
| `pnpm test:plugin`                   | PHPUnit 9 suite (needs the WP test lib — first time, run `pnpm test:plugin:install`) |

## Project layout

See [AGENTS.md](./AGENTS.md) for the full file map, REST routes, scan-runner state machine, and architectural notes. The short version:

- `hooksgraph.php` — plugin bootstrap.
- `includes/` — PHP runtime (`HooksGraph\Plugin\` namespace).
- `includes/abilities/` — one file per registered ability; the AI surface.
- `src/` — React admin UI (wp-scripts).
- `tests/unit/` — PHPUnit suite covering storage, REST, scans, and each ability.

## Related

- [Root README](../../README.md) — the project overview and CLI quick-start
- [`@hooksgraph/hooksgraph-mcp`](../mcp/README.md) — the MCP server that exposes the same graph queries to external agents
- [`hooksgraph/hooks-parser`](../parser/) — the PHP parser library this plugin wraps
