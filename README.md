# WordPress Hooks Graph

A static analysis tool that maps WordPress hook dependencies and visualizes them as an interactive graph. Point it at any combination of plugins, themes, and core — it parses every `do_action`, `add_action`, `apply_filters`, and `add_filter` call and shows you how they connect.

Built on PHP's built-in `token_get_all()` tokenizer. No WordPress runtime, no database, no autoloading — just source files in, dependency graph out.

![Hooks Graph viewer showing the posts_clauses hook across WordPress and WooCommerce](wp-woo-screen-clauses.jpg)

## Requirements

- PHP 7.4+ (for the parser and dev server)
- Node 18+ (for the React viewer)

## Quick Start

```sh
npm install
npm run build          # build the React viewer into dist/
bin/hooksgraph /path/to/wordpress
```

`bin/hooksgraph` parses the given directory (or directories), starts a local PHP server, and opens the viewer in your browser. The port defaults to 8080 and falls back to the next free port.

Or run the steps separately:

```sh
npm run parse -- /path/to/wordpress -o storage/wp.json
HOOKS_JSON=storage/wp.json php -S 127.0.0.1:8080 -t dist server.php
```

## Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install Node dependencies |
| `npm run build` | Build the React viewer into `dist/` |
| `npm run dev` | Vite dev server for the viewer |
| `npm run parse -- <dirs...>` | Parse PHP files; output path printed at the end |
| `npm run parse -- <dirs...> --overlap-only` | Only include hooks shared across 2+ directories |
| `npm run parse -- <dirs...> --exclude vendor,tests` | Exclude folders by name (in addition to .gitignore) |
| `npm run parse -- <dirs...> -o storage/custom.json` | Custom output path |
| `npm run parse:help` | Show full parser help |
| `bin/hooksgraph <dirs...>` | Parse + serve + open browser in one step |
| `npm test` | Run filter-pipeline tests |

## Parse Options

All arguments after `--` are passed directly to the parser:

```sh
# Single directory
npm run parse -- ~/Code/wordpress

# Multiple directories (useful with --overlap-only)
npm run parse -- ~/Code/wordpress ~/Code/my-plugin --overlap-only

# Exclude folders by name (in addition to .gitignore)
npm run parse -- ~/Code/wordpress --exclude vendor,tests,node_modules

# Custom output file
npm run parse -- ~/Code/wordpress -o storage/wp-core.json
```

## Viewer

Run `bin/hooksgraph <dir>` (or `npm run dev` after parsing separately) to open the viewer. Features: search, layout switching (dagre/force/concentric), source filtering, hotspot highlighting, and a detail panel on node click.

## Limitations

This is a **static parser**, not a runtime tracer. A few things to keep in mind:

- **Dynamic hook names** — Hooks built from variables (e.g., `do_action( "save_post_{$post->post_type}" )`) can't be fully resolved at parse time. The parser extracts what it can and marks the rest with a `*` wildcard (`save_post_*`). Fully dynamic names (bare variables) are flagged but unresolvable.
- **Conditional registration** — The parser sees every `add_action`/`add_filter` call in the source, whether or not the surrounding `if` block would execute at runtime. The graph shows what *could* run, not what *will* run.
- **Callbacks only, not call chains** — The graph connects hooks to their direct callbacks. It won't trace what happens *inside* a callback (e.g., if a callback fires another hook, that's a separate edge — not a linked chain).
- **No autoloading or `include` resolution** — Files are parsed independently. If a hook name or callback is defined in an included file, the parser won't cross-reference it — just scan both directories.

## Project Structure

```
hooks_graph.php   PHP CLI parser + graph builder
server.php        Router for `php -S`
bin/hooksgraph    Parse + serve + open-browser wrapper
src/              React viewer (Vite + Cytoscape)
filters.js        Filter pipeline (shared by viewer and tests)
storage/          Generated JSON output (git-ignored)
```

## Tests

```sh
npm test              # PHP parser/graph + JS filter pipeline
npm run test:php      # PHP only (tests/run.php)
npm run test:filters  # JS only (test_filters.js)
```
