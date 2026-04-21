# hooksgraph subcommand CLI — design

**Date:** 2026-04-21
**Status:** Approved — ready for implementation plan

## Problem

Two pain points with the current `hooksgraph` shell alias:

1. **Unbranded help.** `hooksgraph --help` runs `php hooks_graph.php --help`, which prints PHP-centric usage (`Usage: php hooks_graph.php ...`) and references `bin/hooksgraph` / `npm run serve` at the bottom. It reads as if the user invoked PHP directly, not the alias they actually typed.
2. **Half of the commands are repo-local.** The `hooksgraph` alias is a one-shot "parse + serve + open." To parse without serving, or serve without re-parsing, the user has to `cd` into the repo and run `npm run parse --` or `npm run serve`. There is no global way to reach those.

## Goals

- Alias-branded help everywhere the user can land.
- Global access to "parse only" and "serve only" without `cd`-ing into the repo.
- No breaking change to the existing `hooksgraph <dir>` muscle memory.

## Non-goals

- Automated bash-level testing of the dispatcher. Dispatcher is thin; manual smoke checks are documented instead.
- Rewriting `hooks_graph.php`'s help machinery. The PHP keeps its current output when run standalone.
- New functionality (new flags, new output formats, parallel parsing, etc.). This is purely a CLI surface change.

## Decision summary

| Question | Decision |
|---|---|
| Command shape | **Subcommands on one alias** (`hooksgraph parse`, `hooksgraph serve`, ...) |
| Bare `hooksgraph <dir>` | **Keep as shortcut** for parse+serve+open |
| Where help lives | **Bash owns top-level and `serve` help; PHP owns `parse` help (rebranded via env var)** |

## Command surface

```
hooksgraph <dir>...                    # shortcut: parse + serve + open (unchanged)
hooksgraph parse <dir>... [flags]      # parse only (wraps hooks_graph.php)
hooksgraph serve [path/to/hooks.json]  # serve only (wraps bin/serve)
hooksgraph --help | -h                 # top-level help (bash)
hooksgraph parse --help                # parser help (PHP, rebranded)
hooksgraph serve --help                # serve help (bash)
hooksgraph                             # no args → print top-level help, exit 0
```

### Dispatcher logic (in `bin/hooksgraph`)

Simple `case "$1"` on the first argument:

- `""` (no args) → print top-level help, exit 0
- `-h | --help | help` → print top-level help, exit 0
- `parse` → shift, export `HOOKSGRAPH_INVOKED_AS="hooksgraph parse"`, exec `php hooks_graph.php "$@"`
- `serve` → shift, exec `bin/serve "$@"` (bin/serve grows its own `--help` handling)
- anything else → treat as legacy shortcut (parse + serve + open), same body as today

**Trade-off:** a typo like `hooksgraph parsse ~/wp` falls through to the shortcut path and eventually errors in the parser with "directory not found." This is acceptable; the alternative (pre-validating the first arg looks like a path) is brittle and rejects legitimate relative paths like `./parse-me`.

## Help text

### `hooksgraph --help` (bash-written, alias-branded)

```
hooksgraph — parse WordPress PHP codebases and visualize hook relationships

Usage:
  hooksgraph <dir>...              Parse and open the viewer (default shortcut)
  hooksgraph parse <dir>...        Parse only; write JSON to storage/
  hooksgraph serve [path]          Serve the viewer; defaults to most recent JSON
  hooksgraph <subcommand> --help   Show help for a subcommand

Examples:
  hooksgraph ~/Code/wordpress
  hooksgraph parse ~/Code/wordpress ~/Code/my-plugin --overlap-only
  hooksgraph serve storage/wp-core.json
```

### `hooksgraph parse --help`

Delegates to `hooks_graph.php --help`. The PHP reads `HOOKSGRAPH_INVOKED_AS` via `getenv()` and substitutes three sections of its help output when the var is set:

- `Usage: php hooks_graph.php [options] DIR [DIR...]` → `Usage: hooksgraph parse [options] DIR [DIR...]`
- `Examples:` block — `php hooks_graph.php` lines become `hooksgraph parse` lines
- `Viewing results:` block — `bin/hooksgraph DIR` → `hooksgraph <dir>`; `npm run serve -- PATH.json` → `hooksgraph serve PATH.json`

When `HOOKSGRAPH_INVOKED_AS` is **unset** (e.g., `php hooks_graph.php --help` from the repo), the PHP's output is unchanged — single source of truth, two presentations.

### `hooksgraph serve --help` (bash-written)

```
hooksgraph serve — serve the built viewer against a parsed hooks JSON

Usage:
  hooksgraph serve                 Use the most recent JSON in storage/
  hooksgraph serve PATH            Use a specific JSON file

The viewer opens in your browser automatically when available.
```

## Files touched

| File | Change |
|---|---|
| `bin/hooksgraph` | Add subcommand dispatcher and top-level help function. Existing shortcut body becomes the fall-through case. |
| `hooks_graph.php` | Help-printing code reads `HOOKSGRAPH_INVOKED_AS` and substitutes the three sections above. No other behavior change. |
| `bin/serve` | Add `-h`/`--help` branch that prints the serve help and exits 0. |
| `bin/setup_profile.sh` | **No change.** Still installs a single `hooksgraph` alias; subcommands are reached through the dispatcher. |
| `package.json` | **No change.** `scripts.parse` and `scripts.serve` stay for in-repo development. |
| `README.md` | Update quickstart to feature subcommands; drop the `npm run parse --` / `npm run serve` workarounds that existed because global access was unavailable. |
| `CLAUDE.md` | Refresh the Commands table. |

## Testing

### Automated

- **`tests/test_help_branding.php`** — new. Asserts:
  - With `HOOKSGRAPH_INVOKED_AS="hooksgraph parse"`, the help output contains `Usage: hooksgraph parse` and does **not** contain `php hooks_graph.php`.
  - With `HOOKSGRAPH_INVOKED_AS` unset, the help output contains `Usage: php hooks_graph.php` (current behavior preserved).
  - The substitution also applies to the `Examples:` and `Viewing results:` blocks.

  Exercises the help-printing function directly (no CLI subprocess). The implementation plan will factor the help printing into a callable function if it isn't already.

- **Existing suites (`test_parser.php`, `test_graph.php`, Vitest)** — no change. Hook extraction and viewer filter behavior are untouched.

### Manual smoke checks (documented in plan, not automated)

- `hooksgraph --help` shows the top-level bash help.
- `hooksgraph parse --help` shows the rebranded PHP help (no `php hooks_graph.php` references).
- `hooksgraph serve --help` shows the bash serve help.
- `hooksgraph ~/some/wp` still does parse + serve + open.
- `hooksgraph parse ~/some/wp` writes JSON to `storage/` and exits (no server started).
- `hooksgraph serve` with no args picks the most recent JSON and opens the browser.
- `hooksgraph foo` (unknown first arg that isn't a dir) — falls through to the shortcut and surfaces the parser's existing "directory not found" error.

## Open risks

- **Env var leakage.** If a user sets `HOOKSGRAPH_INVOKED_AS` in their own environment (unlikely — unusual name), `php hooks_graph.php --help` would show rebranded output. Acceptable; the name is specific enough to treat as a private contract.
- **Shortcut ambiguity.** A user with a directory literally named `parse` or `serve` can't parse+serve+open it via the shortcut — they'd need `hooksgraph parse ./parse` or similar. Edge case, not worth special-casing.
