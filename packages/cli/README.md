# `@hooksgraph/hooksgraph`

Node CLI for [WordPress Hooks Graph](../../README.md). Wraps the PHP parser and the
React viewer into a single `hooksgraph` binary — parse a WordPress codebase and explore
its `do_action` / `add_action` / `apply_filters` / `add_filter` relationships in your
browser.

## Requirements

- **Node** 18+
- **PHP** 8.2+ on `PATH`

## Install

From npm (recommended):

```sh
npm install -g @hooksgraph/hooksgraph
hooksgraph /path/to/wordpress
```

From this monorepo (dev):

```sh
pnpm install
pnpm setup:alias                          # one-time: installs `hooksgraph` shell alias
hooksgraph /path/to/wordpress
# or call the shim directly:
packages/cli/bin/hooksgraph.js /path/to/wordpress
```

The shim is dev-aware — running from the monorepo it falls back to
`packages/parser/` and `packages/viewer/dist/`, no prior `pnpm build:cli` needed
(except a one-time viewer build).

## Usage

```sh
hooksgraph <dirs...>              # parse + serve + open browser (shortcut)
hooksgraph parse <dirs...>        # parse only → ~/.hooksgraph/parsed/
hooksgraph parse-codebase <dirs...>  # parse only → ~/.hooksgraph/codebases/ (for the MCP server)
hooksgraph serve [path]           # serve viewer; defaults to most recent JSON in ~/.hooksgraph/parsed/
hooksgraph --help                 # top-level help
hooksgraph parse --help           # subcommand flags + examples
hooksgraph serve --help
```

### Flags (forwarded to the parser)

```sh
hooksgraph parse ~/Code/wp ~/Code/my-plugin --overlap-only
hooksgraph parse ~/Code/wp --exclude vendor,tests,node_modules
hooksgraph parse ~/Code/wp -o ~/.hooksgraph/parsed/wp-core.json
```

### Storage

| Directory                  | Written by                             | Read by                     | Override                     |
| -------------------------- | -------------------------------------- | --------------------------- | ---------------------------- |
| `~/.hooksgraph/parsed/`    | `hooksgraph parse`, `hooksgraph <dir>` | `hooksgraph serve` (viewer) | `$HOOKSGRAPH_PARSED_DIR`     |
| `~/.hooksgraph/codebases/` | `hooksgraph parse-codebase`            | the MCP server              | `$HOOKSGRAPH_CODEBASES_DIR`  |

Use `parse` for ad-hoc viewer runs (latest wins). Use `parse-codebase` to add a stable
entry to your MCP corpus — the JSON's filename becomes the codebase id agents query.

## What it does

1. Spawns the bundled PHP parser (`packages/parser/`) with `stdio: 'inherit'`, writing
   JSON to the routed storage dir.
2. For `serve` / the no-subcommand shortcut, spins up `php -S` against the bundled
   viewer build (`packages/viewer/dist/`) on the first free port at 8080+.
3. Opens the URL in your default browser (`open` / `xdg-open` / `wslview` / `start`).

## Build

From the monorepo root:

```sh
pnpm build:cli       # composes packages/cli/php/ + packages/cli/dist/ for npm publish
```

`scripts/build-cli.js` runs the viewer build, `composer install --no-dev` in the
parser, and copies the outputs into `packages/cli/`. Both `php/` and `dist/` are
gitignored — they only exist post-build.

## More

- Repo-level overview, MCP server, viewer features: [`../../README.md`](../../README.md)
- Parser library (PHP): [`../parser/README.md`](../parser/README.md)
- Agent-facing notes for this package: [`AGENTS.md`](AGENTS.md)
