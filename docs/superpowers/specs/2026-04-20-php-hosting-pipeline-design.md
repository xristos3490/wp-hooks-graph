# PHP Hosting Pipeline — Design

**Status:** Approved
**Date:** 2026-04-20

## Goal

Replace the Python-based serving pipeline with a pure-PHP flow. A single shell alias `hooksgraph <repo>` should parse the target repo(s), write a JSON graph to the repo's `storage/` directory, and start a local server that loads that JSON into the React UI — with no Python, no `passthru()` shell-outs, and no multi-line user-facing alias.

## Non-Goals

- On-demand re-parsing via HTTP (`/api/parse`). The parser runs once, up front.
- Watching the target repo for changes. Each invocation is parse + serve + Ctrl+C.
- Multi-tenant / multi-user hosting. This is a localhost dev tool.
- Preserving the Python scripts (`hooks_graph.py`, `parser.py`, `graph.py`, `serve.py`) — these are deprecated and out of scope for this design. They are not deleted as part of this change; that can happen later.

## User-Facing Flow

```
$ hooksgraph ~/code/woocommerce
  … pretty parser output to stderr …
  → opens http://127.0.0.1:8080 in browser with the graph loaded
  (Ctrl+C to stop the server)
```

The alias works from any directory, passes all args through to the parser.

## Architecture

```
~/.zshrc
  └─ alias hooksgraph='…/wp-hooks-graph/bin/hooksgraph'   ← one line

wp-hooks-graph/
  ├─ bin/hooksgraph            ← launcher (bash, ~15 lines)
  ├─ hooks_graph.php           ← parser (modified: default path + --print-path)
  ├─ server.php                ← router (~10 lines)
  ├─ dist/                     ← vite build output (served statically)
  └─ storage/                  ← parser writes <dir-names>.json here
```

### Data flow

```
hooksgraph <repo>
      │
      ▼
bin/hooksgraph  ──► php hooks_graph.php --print-path <repo>
      │                     │
      │                     ▼
      │             storage/<dir-names>.json  (overwrites if exists)
      │                     │
      │             stdout: "/abs/path/to/storage/<dir-names>.json"
      ▼
HOOKS_JSON=<path> php -S 127.0.0.1:<port> server.php -t dist
      │
      ▼
open http://127.0.0.1:<port>
      │
      ▼
React app fetches /hooks.json  ──► server.php readfile($HOOKS_JSON)
```

## Components

### 1. `~/.zshrc` alias (one line)

```bash
alias hooksgraph='/Users/chris/Repos/AI/wp-hooks-graph/bin/hooksgraph'
```

Written by a refreshed `setup_profile.sh`. Idempotent — skipped if the marker line is already present.

### 2. `bin/hooksgraph` (launcher)

```bash
#!/usr/bin/env bash
set -euo pipefail
HG="$(cd "$(dirname "$0")/.." && pwd)"

# Parse. --print-path makes the parser emit ONLY the output path on stdout;
# its pretty UI output goes to stderr.
out=$(php "$HG/hooks_graph.php" --print-path "$@")

# Pick a free port starting at 8080.
port=8080
while lsof -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; do port=$((port+1)); done

HOOKS_JSON="$out" php -S "127.0.0.1:$port" "$HG/server.php" -t "$HG/dist" &
srv=$!
trap "kill $srv 2>/dev/null" EXIT INT TERM
sleep 0.3 && open "http://127.0.0.1:$port"
wait $srv
```

- Pure bash, no Python, no Node.
- `lsof` is preinstalled on macOS; no dependencies to add.
- Trap cleans up the server on Ctrl+C.

### 3. `hooks_graph.php` changes

Three edits, all localized:

1. **Default output path** (line ~895). Replace:
   ```php
   $output = sys_get_temp_dir() . "/hooksgraph-{$user}/{$filename}";
   ```
   with:
   ```php
   $output = __DIR__ . "/storage/{$filename}";
   ```
   Parser keeps its existing `<dir-names>.json` naming, so `hooksgraph ~/code/woocommerce` → `storage/woocommerce.json`. Re-running overwrites.

2. **Add `--print-path` flag** to the arg parser. When set:
   - Suppresses the pretty section/row output on stdout (routed to stderr instead).
   - After writing the JSON, prints the absolute output path as the sole stdout line.
   - Exit 0 on success, non-zero on error.

3. **Remove `passthru()` block** (line ~1028). The parser no longer knows or cares about serving. `--serve` flag can be deleted along with it.

### 4. `server.php` (new file)

```php
<?php
$json = getenv('HOOKS_JSON');

if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/hooks.json') {
    if (!$json || !is_file($json)) {
        http_response_code(404);
        return true;
    }
    header('Content-Type: application/json');
    readfile($json);
    return true;
}
return false;  // let php -S serve static files from `dist/`
```

Three responsibilities:
1. Serve the parsed JSON at `/hooks.json` from the path in `$HOOKS_JSON`.
2. `return false` for anything else → PHP's built-in server serves from `dist/` (correct MIME types free).
3. 404 if the JSON vanished between parse and fetch (defensive; shouldn't happen in practice).

### 5. `setup_profile.sh` refresh

Current script writes a multi-line shell function pointing at the Python venv. Replace with a one-line alias pointing at `bin/hooksgraph`:

```bash
# --- WordPress Hooks Graph ---
alias hooksgraph='<HG_DIR>/bin/hooksgraph'
# --- /WordPress Hooks Graph ---
```

Idempotency, `y/N` prompt, and "source ~/.zshrc" reminder all preserved from the existing script.

### 6. React UI change

The app currently has an upload-only file picker in `index.legacy.html`, and the Vite app is being wired up on `test/wp-ui`. On load, the Vite app should `fetch('/hooks.json')` and render automatically. Existing upload flow can stay as a fallback (for viewing arbitrary JSON files the user drags in), but auto-load on startup is the default path for the `hooksgraph` command.

This is a small change in the existing data-loading hook (likely `useGraphData`) — not a new architecture.

## What This Replaces

- `serve.py` — no longer invoked by anything. Can be deleted in a follow-up.
- `passthru()` call in `hooks_graph.php` line 1028 — deleted in this change.
- `setup_profile.sh` multi-line function body — replaced with one-line alias.
- `npm run serve` — repointed to a tiny node/PHP wrapper, or deleted (dev flow uses `npm run dev` which is Vite).

## Concurrency & Port Handling

`php -S` is single-threaded: one request at a time. Fine here — the app makes one `fetch('/hooks.json')` plus a few static asset requests, all fast.

Port conflict handling: launcher increments from 8080 until it finds a free port. No cap; two or three concurrent `hooksgraph` sessions just land on 8081, 8082, etc.

## Overwrite Semantics

Running `hooksgraph ~/code/woocommerce` twice overwrites `storage/woocommerce.json`. Simple, no file-system clutter. If history is ever needed, add a `--stamped` flag later that appends a timestamp to the filename.

## Open Questions

None blocking. Follow-ups that can happen later:
- Delete deprecated Python files (`*.py`, `venv/`, `requirements.txt`).
- Update `package.json` scripts to remove `venv` references.
- Update `AGENTS.md` / `CLAUDE.md` to reflect the PHP-only pipeline.

## Testing

- **Parser**: existing PHP parser has no test suite yet (Python tests covered the old pipeline). Not adding a suite in this change; the `--print-path` flag change is small enough to verify manually.
- **Launcher**: manual smoke tests — `hooksgraph <known-repo>` opens browser with graph, Ctrl+C stops server, rerun overwrites JSON, second invocation picks a different port.
- **Server.php**: verify 200 on `/hooks.json`, 200 on `/assets/...`, 404 on missing JSON, index.html served at `/`.
