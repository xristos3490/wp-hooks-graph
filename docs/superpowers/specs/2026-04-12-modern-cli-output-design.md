# Modern CLI Output Design

## Goal

Modernize the CLI output in `hooks_graph.py` with ANSI colors, a progress bar, and structured sections using box-drawing characters. No new dependencies — hand-rolled formatting with TTY detection.

## Color Helpers

A small block at the top of `hooks_graph.py`:

- ANSI constants: `BOLD`, `DIM`, `RESET`, `CYAN`, `GREEN`, `YELLOW`, `RED`, `MAGENTA`
- `_style(text, *codes)` — wraps text in ANSI codes, returns plain text when `sys.stdout.isatty()` is `False`
- TTY detection is checked once at module level and stored in a `_IS_TTY` flag

## Progress Bar

Replace the `[249/249] 948 files/sec` counter with a fixed-width bar:

```
  Parsing ████████████████████░░░░░ 249/249  948/sec
```

- Bar width: 25 characters
- Filled: `█`, empty: `░`
- Bar in green, rate in dim
- Uses `\r` overwrite during parsing, final line persists
- Completion summary line follows: `Parsed 249 files in 0.3s` (green)

## Output Structure

Three sections with box-drawing lines (`─`) and colored headers:

### Pre-summary (scanning phase)

```
Scanning for PHP files...
  . ─ 249 files

Parsing 249 files...
  Parsing ████████████████████░░░░░ 249/249  948/sec
  Parsed 249 files in 0.3s
```

- Source labels in bold, file counts in dim
- Completion line in green

### Section 1: Scan

```
─────────────────────────────────────────────
 Scan
─────────────────────────────────────────────
  Files scanned     249
  Files with hooks  133
  Parse errors        0          (only shown when > 0, yellow)
```

### Section 2: Hooks

```
─────────────────────────────────────────────
 Hooks
─────────────────────────────────────────────
  Total hooks       451 │ Actions  206 │ Filters  245
  Dynamic hooks      27
  Total edges       641
  Overlap filter  enabled        (only shown when active)
  Pre-filter hooks  500          (only shown when active)
```

### Section 3: Top Hooks

```
─────────────────────────────────────────────
 Top Hooks
─────────────────────────────────────────────
  init                            23 │  0 fires  23 listens
  woo_bookings_use_extensive...   23 │  1 fires  22 listens
  admin_init                      10 │  0 fires  10 listens
  save_post                        7 │  0 fires   7 listens
  woocommerce_email_footer         7 │  7 fires   0 listens
```

### Footer

```
  Output  /Users/chris/.hooksgraph/cache/hooks.json
  Server  http://localhost:8080
```

Labels bold, paths/URLs in cyan.

## Color Assignments

| Element | Style |
|---------|-------|
| Section headers | bold cyan |
| Numbers/counts | bold |
| Labels | dim |
| `│` separators | dim |
| Errors/warnings | yellow |
| Success messages | green |
| Progress bar fill | green |
| Paths/URLs | cyan |

## Scope

- All changes in `hooks_graph.py` only
- No new files or dependencies
- No changes to `parser.py`, `graph.py`, or `serve.py`
- TTY-safe: clean uncolored output when piped or redirected

## Non-goals

- No `rich` or `click` dependency
- No animation beyond `\r` progress bar
- No changes to the data pipeline or JSON output
