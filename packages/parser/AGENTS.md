# HooksGraph Parser (`packages/parser/`)

PHP library that tokenises WordPress source with `token_get_all()` and extracts hook
relationships (`do_action` / `add_action` / `apply_filters` / `add_filter`) into a JSON
graph. No WordPress runtime, no database, no `include` resolution — pure static analysis
over source files.

Consumed two ways:

- **Via `Cli\Runner`** — the interactive entry point used by the `hooksgraph` Node shim.
  Prints progress to stdout/stderr, writes JSON to `~/.hooksgraph/{parsed,codebases}/`.
- **Via the lower-level `Discovery` + `Parser` + `Graph` classes** — embedded in the
  WordPress plugin (`packages/plugin/`) for in-process parsing without a console. **Don't
  route plugin / library callers through `Cli\Runner`**, it would dump ANSI escapes into
  the response stream.

## Layout

```
hooksgraph.php          Thin CLI shim. Requires package-local vendor/autoload.php
                        and invokes HooksGraph\Cli\Runner::run($argv). Guarded with
                        `defined('HOOKS_GRAPH_TESTING')` so PHPUnit can load it without
                        triggering execution.
server.php              Router for `php -S`. Serves the parsed JSON at /hooks.json
                        (reads path from $_ENV['HOOKS_JSON']); returns `false` for
                        everything else so the built-in static server takes over.
                        Returns 204 (not 404) when no JSON is bound — the viewer's
                        homepage probes this endpoint and treats 204 as "empty state".
composer.json           name: hooksgraph/hooks-parser. PSR-4 HooksGraph\ → src/.
                        PHP >=8.2. No runtime deps — autoloader only.
vendor/                 Composer output (gitignored). Bundled into the CLI tarball
                        verbatim by scripts/build-cli.js.
src/                    HooksGraph\ namespace.
  Cli/                    Interactive entry point.
    Runner.php              Orchestrates: argv → Arguments → discover → FileParser loop
                            → Builder → optional OverlapFilter → JSON write → summary.
                            Reads HOOKSGRAPH_OUTPUT_DIR for the output directory;
                            falls back to ./storage when unset (direct `php hooksgraph.php`
                            invocations bypassing the Node shim).
    Arguments.php           argv → typed args (dirs, exclude, output, overlap_only,
                            print_path, help).
    Console.php             ANSI styling + progress bar. Constructed with the target
                            stream so --print-path mode can redirect everything to stderr.
    Help.php                Static help text. Reads HOOKSGRAPH_INVOKED_AS to rebrand
                            the program name in usage examples (`hooksgraph parse ...`
                            vs `php hooksgraph.php ...`).
  Discovery/              File-system traversal.
    PhpFileFinder.php       Recursive .php discovery. Honors .gitignore + the
                            --exclude list.
    ExcludeMatcher.php      Path-segment matcher for --exclude.
  Parser/                 Token-walking core. One class per concern.
    FileParser.php          Per-file entry. Walks token_get_all() output, delegates
                            to sibling extractors, tracks scope via ScopeTracker.
                            Builds a per-file method index so callback metadata
                            analyzers can resolve same-file [$this, 'm'] / [Cls, 'm']
                            / 'Cls::m' references.
    HookNameExtractor.php   Extracts the literal or partially-resolved hook name from
                            the first arg. Concatenation `'pre_' . $var` → `pre_*`.
    CallbackExtractor.php   Extracts the callback argument shape (closure | arrow fn |
                            string | [obj,'m'] | [Cls,'m'] | first-class callable).
    DocCommentExtractor.php Pulls the doc-comment immediately preceding a hook call.
    CallbackBodyAnalyzer.php  Per-callback static analyzer. Emits effects[], targets[],
                            called_apis[]. Pure function over a body-token slice.
    FilterReturnAnalyzer.php  Filter-only return-origin classifier + arg0 mutation
                            tracker. Emits filter_behavior {return_origin, mutates_input,
                            modified_paths}.
    WpApiMap.php            Static catalogue of WP / PHP / $wpdb APIs. Each entry:
                            {function, kind, op, key_arg_index, effect}.
    ScopeTracker.php        Brace-depth tracker; identifies class / function bodies.
    Tokens.php              Token helpers (skip whitespace, peek next non-ws, …).
  Graph/                  JSON shape assembly.
    Builder.php             call records → {nodes, edges, metadata}. Attaches callback
                            metadata onto edge `data` via array_key_exists check — only
                            non-null fields ride along, so consumers must treat absence
                            as "unknown".
    OverlapFilter.php       Filters the graph to hooks fired AND listened to across
                            ≥2 source dirs. Driven by --overlap-only.
tests/                  PHPUnit 11. Mirrors src/ one-to-one.
  Cli/                    Runner / Arguments / Help / Console.
  Discovery/, Graph/, Parser/
  Support/                ParsesSource trait — writes a snippet to a temp file and
                          invokes FileParser::parse() so tests can assert on the
                          actual token-walking pipeline (not a unit mock).
```

## Composer scopes (important)

Three composer scopes coexist in the monorepo and must not be conflated:

| Scope                      | composer.json                | Purpose                                                                        |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| Root                       | `/composer.json`             | Dev umbrella. PHPUnit 11 + parser via path repo. Runs `pnpm test:parser`.      |
| **Parser (this package)**  | `packages/parser/composer.json` | Self-contained autoloader. `composer install` here populates `vendor/` which the CLI tarball ships. |
| Plugin                     | `packages/plugin/composer.json` | PHPUnit 9 + yoast/phpunit-polyfills + parser via path repo. Runs `pnpm test:plugin`. |

The parser's `hooksgraph.php` requires its **package-local** `vendor/autoload.php`. The
PHPUnit suite in `tests/` is bootstrapped from the **root** autoloader (`phpunit.xml` →
`vendor/autoload.php` at repo root), which resolves `HooksGraph\` through the path
repo and `HooksGraph\Tests\` via root `autoload-dev`.

## Code style

- `declare(strict_types=1);` at top of every file.
- `final` classes, namespaced under `HooksGraph\`. camelCase methods, snake_case JSON
  keys (the JSON wire format is set by the parsed records — match it).
- No runtime composer deps. The parser must stay loadable on a vanilla PHP 8.2 install
  via its package-local autoloader alone.
- Node IDs are `type::identifier` (e.g. `hook::init`, `file::wp::wp-includes/plugin.php`).
  The source label is included in file IDs to prevent collisions across scanned dirs.

## Callback metadata extraction

Listener edges carry static facts about what each callback body does. Analyzers run
inside `FileParser::parse()` per listener; output rides along on existing JSON.

Fields on listener records / edges:

- `effects[]` — closed-set tags from `WpApiMap::EFFECTS` (`reads_option`,
  `writes_post_meta`, `io_http`, `redirect`, `fires_hook`, …).
- `targets[]` — `{kind, key, op, confidence}` touch list. `kind` ∈ `option | post_meta |
  user_meta | term_meta | transient | capability | hook_fire | global | superglobal |
  chain | db_table`. `confidence` is `literal` (string literal at a known API) or
  `syntactic` (variable-rooted chain).
- `called_apis[]` — recognised functions / `$wpdb->method` calls, deduped.
- `filter_behavior` — **filter listeners only**. `{return_origin, mutates_input,
  modified_paths}`. Absent on action listeners.

Decisions pinned in tests (so you don't second-guess them while refactoring):

- `delete_*` folds into `writes_*` effects (no separate "delete" tag).
- `current_user_can(...)` emits a target but no effect.
- Method calls `$x->foo()` never produce a `chain` target; they go to `called_apis`.
- Nested closures / arrow fns inside a callback do **not** contribute to the outer
  callback's effects.
- By-ref / variadic / no-param filter callbacks → `return_origin: unknown`.
- Mutation detection is structural (LHS root literally `$arg0`), not flow-sensitive.
  `$out = $v; $out['x'] = 1` doesn't count — token-level analysis doesn't model PHP
  reference semantics.
- `try` / `catch` return paths roll up to `conditional`; `finally` returns count as a path.
- Dynamic chain keys (`$v[$key]`) normalise to `arg0[*]`.
- Implicit fallthrough (no top-level `return` at end) injects a synthetic `replaced`
  return.

**Wire-up gotcha**: `Graph\Builder` only attaches fields that are present and non-null
(`array_key_exists` check). For callbacks the parser can't see into (string callbacks,
cross-file methods), the listener record has no `effects` / `targets` /
`filter_behavior` key. Consumers must treat absence as "unknown", not as "no effects".

## Supported hook functions

```
do_action, do_action_ref_array         → edge_type="fires",   hook_type="action"
apply_filters, apply_filters_ref_array → edge_type="fires",   hook_type="filter"
add_action                             → edge_type="listens", hook_type="action"
add_filter                             → edge_type="listens", hook_type="filter"
```

## Gotchas

- Hook-name extraction for concatenation (`'prefix_' . $var`) produces `prefix_*` — the
  `*` is a convention, not a glob. Fully dynamic names (bare variables, complex
  interpolations) get a `*` suffix or a synthetic counter id; don't rely on stability
  across runs.
- File IDs include the source label (`file::{source}::{rel_path}`) to keep multi-dir
  scans collision-free.
- `--print-path` mode reserves stdout for the final output path; the progress UI is
  redirected to stderr via an `ob_start` buffer. The Node shim's legacy `hooksgraph
  <dir>` shortcut depends on this — it captures stdout to feed `serve`.
- `server.php` returns `false` for unknown paths so `php -S` serves static files
  itself. Don't add logic that returns `true` by default — it would short-circuit the
  built-in static server.
- `Runner::defaultStorageDir()` falls back to `./storage` (cwd-relative) when
  `HOOKSGRAPH_OUTPUT_DIR` is unset. That's a safety net for direct `php hooksgraph.php`
  invocations; the Node shim always sets it explicitly so the user-level
  `~/.hooksgraph/{parsed,codebases}/` routing is honored.
- The bundled `vendor/` is part of the CLI tarball contract. If you add a runtime
  composer dep, update `scripts/build-cli.js` (it does `composer install --no-dev` for
  you, but you'll need to verify the result fits) and check it works against a
  monorepo-less install.

## Testing

```sh
pnpm test:parser            # alias for vendor/bin/phpunit
vendor/bin/phpunit           # from repo root
```

PHPUnit 11, configured in the root `phpunit.xml` (testsuite "parser"). No WP bootstrap.
One test class per source class. `tests/Support/ParsesSource.php` writes a snippet to a
temp file and invokes `FileParser::parse()` end-to-end — favour that over mocking the
token walker. CLI tests live under `tests/Cli/` because the classes under test (Runner,
Arguments, Help, Console) belong to this package; `packages/cli/` is purely a Node
entry point.

See [`../../README.md`](../../README.md) for the user-facing CLI surface and
[`../../AGENTS.md`](../../AGENTS.md) for cross-package architecture.
