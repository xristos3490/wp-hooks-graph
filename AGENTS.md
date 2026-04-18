# WordPress Hooks Graph

Parses WordPress PHP codebases for hook relationships (do_action/add_action/apply_filters/add_filter) and visualizes them as an interactive graph.

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Set up Python venv and install pip dependencies |
| `npm run parse -- <dir> [dir2...] [--overlap-only] [--exclude a,b] [-o path]` | Parse PHP files, output defaults to `$TMPDIR/hooksgraph-$USER/hooks.json`. The `--` is required to pass args through npm to the Python script |
| `npm run parse:help` | Show full parser help with all options, examples, and output format |
| `npm run serve` | Start local dev server (port 8080, auto-fallback if busy) |
| `npm test` | Run all tests (graph, parser, filters) |
| `npm run test:graph` | Graph builder tests (pytest) |
| `npm run test:parser` | Parser tests (37 tests, custom runner) |
| `npm run test:filters` | Filter pipeline tests (Node.js) |

## Architecture

```
hooks_graph.py    CLI entry point: argparse, file discovery, orchestration, progress/summary output
parser.py         Tree-sitter PHP parsing: walks ASTs, extracts hook function calls
graph.py          Graph construction: deduplicates hooks, builds nodes/edges/metadata JSON
index.html        Self-contained Cytoscape.js viewer (upload-only, dagre/force/concentric layouts, search, filters)
filters.js        Pure filter pipeline functions extracted from viewer (no DOM dependency, testable with Node)
serve.py          Local dev server (port 8080, auto-fallback to random port if busy)
storage/          Git-ignored output directory for generated JSON files (.keep tracked)
test_parser.py    Parser tests (custom runner, no pytest)
test_graph.py     Graph builder tests (pytest)
test_filters.js   Filter pipeline tests (Node.js, custom runner)
```

### Data flow

```
PHP files → parser.parse_file() → list[dict] → graph.build_graph() → [optional: filter_graph_by_overlap()] → storage/hooks.json → index.html (upload)
```

## Key Files

- `parser.py` — Core extraction logic. `parse_file(filepath, source_label)` returns list of hook call dicts
- `graph.py` — `build_graph(hook_calls, scanned_dirs, total_files)` returns the full JSON structure; `filter_graph_by_overlap(graph)` filters to hooks that appear in multiple scanned directories
- `hooks_graph.py` — CLI only; all logic lives in parser.py and graph.py
- `index.html` — Loads Cytoscape.js + dagre from CDN. No build step. Upload-only file picker

## Code Style

- Private functions: `_leading_underscore`
- Constants: `UPPER_SNAKE` (e.g., `HOOK_FUNCTIONS`)
- Data structures: plain dicts, no dataclasses
- Tests: `test_graph.py` uses pytest; `test_parser.py` uses custom `if __name__ == "__main__"` runner
- Node IDs: `type::identifier` format (e.g., `hook::init`, `file::wp::wp-includes/plugin.php`)
- UTF-8 decoding: always use `errors="replace"`

## Testing

- All Python commands run through the venv automatically via npm scripts
- `npm test` — runs all three test suites
- `npm run test:graph` — graph builder tests (pytest)
- `npm run test:parser` — 37 parser tests (custom runner, not pytest)
- `npm run test:filters` — filter pipeline tests (Node.js)
- Test helpers: `_parse_php(code)` creates temp files, `_make_call(**overrides)` is a factory with defaults

## Gotchas

- `graph.py` has a `_dynamic_counter` global that **must be reset** at the start of `build_graph()` — it already does this, but don't call `_hook_id()` outside of `build_graph()`
- Tree-sitter line numbers are 0-indexed; the parser adds 1 (`start_point[0] + 1`) to match editor conventions
- tree-sitter-php exposes `language_php()` not `language()` — the API name is non-obvious
- `_extract_callback` must unwrap the `array_element_initializer` node before calling `_extract_string_value` — the AST wraps array elements in an extra node layer
- Hook name extraction for concatenation (`'prefix_' . $var`) produces `prefix_*` — the `*` is a convention, not a glob
- File IDs include source label to prevent collisions across scanned directories: `file::{source}::{rel_path}`
- The HTML viewer's hotspot threshold is adaptive (top 10% of connections), not a fixed number
- Comments in PHP are correctly ignored — tree-sitter parses them as separate AST nodes, not function calls

## Supported Hook Functions

```python
do_action, do_action_ref_array         → edge_type="fires", hook_type="action"
apply_filters, apply_filters_ref_array → edge_type="fires", hook_type="filter"
add_action                             → edge_type="listens", hook_type="action"
add_filter                             → edge_type="listens", hook_type="filter"
```
