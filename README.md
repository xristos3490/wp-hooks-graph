# WordPress Hooks Graph

A static analysis tool that maps WordPress hook dependencies and visualizes them as an interactive graph. Point it at any combination of plugins, themes, and core — it parses every `do_action`, `add_action`, `apply_filters`, and `add_filter` call and shows you how they connect.

Built on [tree-sitter](https://tree-sitter.github.io/tree-sitter/) for AST-level PHP parsing. No WordPress runtime, no database, no autoloading — just source files in, dependency graph out.

![Hooks Graph viewer showing the posts_clauses hook across WordPress and WooCommerce](wp-woo-screen-clauses.jpg)

## Quick Start

```sh
npm install
npm run build
npm run parse -- /path/to/wordpress
```

Then start the local server and open it in your browser:

```sh
npm run serve
# → http://localhost:8080 (falls back to a random port if 8080 is busy)
```

Upload the generated JSON file from `storage/`.

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Set up Python venv and install dependencies |
| `npm run parse -- <dirs...>` | Parse PHP files and output to `storage/hooks.json` |
| `npm run parse -- <dirs...> --overlap-only` | Only include hooks shared across 2+ directories |
| `npm run parse -- <dirs...> --exclude vendor,tests` | Exclude folders by name (in addition to .gitignore) |
| `npm run parse -- <dirs...> -o storage/custom.json` | Custom output path |
| `npm run parse:help` | Show full parser help with all options, examples, and output format |
| `npm run serve` | Start local server at http://localhost:8080 (auto-fallback if busy) |
| `npm test` | Run all tests (graph, parser, filters) |

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

Run `npm run serve` and open http://localhost:8080. Click **Upload JSON file** to load a generated graph from `storage/`.

Features: search, layout switching (dagre/force/concentric), source filtering, hotspot highlighting, and detail panel on node click.

## Limitations

This is a **static parser**, not a runtime tracer. A few things to keep in mind:

- **Dynamic hook names** — Hooks built from variables (e.g., `do_action( "save_post_{$post->post_type}" )`) can't be fully resolved at parse time. The parser extracts what it can and marks the rest with a `*` wildcard (`save_post_*`). Fully dynamic names (bare variables) are flagged but unresolvable.
- **Conditional registration** — The parser sees every `add_action`/`add_filter` call in the source, whether or not the surrounding `if` block would execute at runtime. The graph shows what *could* run, not what *will* run.
- **Callbacks only, not call chains** — The graph connects hooks to their direct callbacks. It won't trace what happens *inside* a callback (e.g., if a callback fires another hook, that's a separate edge — not a linked chain).
- **No autoloading or `include` resolution** — Files are parsed independently. If a hook name or callback is defined in an included file, the parser won't cross-reference it — just scan both directories.

## Project Structure

```
hooks_graph.py    CLI entry point
parser.py         Tree-sitter PHP parsing
graph.py          Graph construction and deduplication
index.html        Cytoscape.js interactive viewer
filters.js        Filter pipeline (shared by viewer and tests)
serve.py          Local dev server (port 8080, auto-fallback if busy)
storage/          Generated JSON output (git-ignored)
```

## Tests

```sh
npm test              # all tests
npm run test:graph    # graph builder (pytest)
npm run test:parser   # parser (37 tests)
npm run test:filters  # filter pipeline (Node.js)
```
