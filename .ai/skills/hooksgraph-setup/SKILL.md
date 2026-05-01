---
name: hooksgraph-setup
description: Full onboarding for wp-hooks-graph — installs Node dependencies, wires the `hooksgraph` shell alias into the user's RC file, and registers the hooks-graph MCP server with Claude Code. Use whenever the user wants to set up / install / onboard / configure wp-hooks-graph or the hooks-graph MCP server, including phrases like "set this up", "how do I get started", "install hooksgraph", "register the MCP", "wire up the tool", or lands in this repo fresh and asks how to run it. Also use when the user says something broke in their setup and they want it re-run — the skill is idempotent.
---

# wp-hooks-graph onboarding

Walk the user from a fresh clone to a working `hooksgraph` CLI + a connected `hooks-graph` MCP server in Claude Code, executing each step yourself after explicit confirmation. This skill is idempotent: rerun it any time to fix a partial setup.

## Why this skill exists

The README covers the steps, but onboarding hits a few rough edges that trip people up: the interactive shell-alias script needs a TTY, the MCP command needs absolute paths, and there are four small state checks (Node deps, shell alias, MCP registration, PATH refresh) that each need their own verification. Rather than make the user juggle those, run them in order and verify as you go.

## Shape of the run

Execute in this order. Each phase is explained below.

1. **Preflight** — verify we're in the repo and the required runtimes are present.
2. **State audit** — figure out which of the four steps are already done.
3. **Confirm plan** — tell the user the outstanding steps in one message and ask to proceed.
4. **Execute** — run each outstanding step, reporting inline.
5. **Hand off** — tell the user the exact `source` command for their shell and suggest a first run.

Don't execute anything destructive (shell-RC edits, MCP registration) without a single explicit confirmation covering the full plan. One confirmation for the whole set is enough — you already told them what's coming.

## Phase 1 — Preflight

Run these up front. If any fail, stop and surface the problem instead of continuing.

- **Repo root.** Confirm `pnpm-workspace.yaml` and `packages/parser/hooksgraph.php` exist in the current working directory (or a parent — walk up if needed and `cd` there). If not found, tell the user to run the skill from inside a `wp-hooks-graph` checkout.
- **PHP ≥ 8.2.** `php -r 'echo PHP_VERSION;'` — compare against 8.2.0.
- **Node ≥ 18.** `node -v` — strip the leading `v`, compare major against 18.
- **pnpm present.** `command -v pnpm` — install hint if missing: `npm install -g pnpm` or `brew install pnpm`.
- **Claude CLI.** `command -v claude` — if missing, you can still do steps 1 and 2 but must skip MCP registration; surface that clearly so the user knows what they're losing.

Report the preflight results as a compact list, not as five separate blocks of prose.

## Phase 2 — State audit

Check what's already done so reruns don't redo finished work:

| Step           | How to check                                                                                                                                   | Already done if…            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Node deps      | `test -f pnpm-lock.yaml && test -d node_modules`                                                                                               | both exist                  |
| Shell alias    | `grep -lF "# --- WordPress Hooks Graph ---" "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.config/fish/config.fish" 2>/dev/null` | marker found in any RC file |
| MCP registered | `claude mcp get hooks-graph 2>/dev/null`                                                                                                       | exit 0                      |
| MCP connected  | `claude mcp list 2>/dev/null` shows `hooks-graph: ✓ Connected`                                                                                 | line matches                |

The last two are distinct: a server can be registered but failing to start (wrong path, missing deps). If registered-but-not-connected, don't re-register — diagnose.

## Phase 3 — Confirm the plan

Send one short message listing only the outstanding steps, e.g.:

> Here's what I'll run:
>
> 1. `pnpm install` (installs Node deps across the workspace)
> 2. Append the `hooksgraph` alias block to `~/.zshrc`
> 3. Register `hooks-graph` MCP server with Claude Code at user scope
>
> OK to proceed?

If everything is already done, skip Phase 3 and Phase 4 entirely — go straight to Phase 5 and tell the user setup is complete.

## Phase 4 — Execute

### 4a. `pnpm install`

Just run `pnpm install` from the repo root. This is a pnpm workspace — a single install hydrates every package under `packages/`. It's noisy; don't paste the full output back — summarize as "installed N packages" and surface warnings only if they look actionable.

### 4b. Shell alias

The provided `scripts/setup-profile.sh` does the right detection (zsh / bash / fish) and writes a marker-fenced block so it's idempotent. But it prompts interactively, which doesn't play well with non-TTY execution. Pipe `y` in to answer its prompt:

```sh
printf 'y\n' | bash scripts/setup-profile.sh
```

Don't try to edit the RC file yourself — reuse the script so the marker format stays consistent and future reruns detect it correctly.

If the script says "already present — nothing to do", treat that as success.

After it runs, capture the RC file path from the script output (it prints `✓ Added hooksgraph alias to <path>`). You'll need that path for the hand-off message in Phase 5.

### 4c. MCP registration

Build the command with absolute paths — Claude Code stores the command as given, and relative paths break when the server launches from a different cwd:

```sh
REPO="$(pwd)"
claude mcp add hooks-graph --scope user -- \
  node "$REPO/packages/mcp/bin/hooksgraph-mcp.js" \
  --storage "$REPO/storage"
```

Then verify:

```sh
claude mcp list
```

Look for `hooks-graph: ✓ Connected`. If it shows as failed, the most common causes are:

- `node_modules` wasn't installed (re-run 4a)
- The storage dir doesn't exist yet — `mkdir -p storage` and retry
- An older node on `PATH` — `node -v` should report ≥ 18

Don't retry blindly. Read the error, fix it, then re-run `claude mcp list`.

## Phase 5 — Hand off

Finish with a short message the user can act on. Include:

1. **The exact source command** for their RC file. This matters — the alias won't work in the current shell until they source. Use the RC path you captured in 4b; don't guess.
   - zsh: `source ~/.zshrc`
   - bash: `source ~/.bash_profile` or `source ~/.bashrc` (use whichever the script picked)
   - fish: `source ~/.config/fish/config.fish`
2. **A concrete first run** they can copy-paste, using their own codebase path:
   ```
   hooksgraph ~/path/to/wordpress-checkout
   ```
3. **How to query the MCP** from Claude: mention that they can now ask questions like "which callbacks listen on `init` in my codebase" and the `hooks-graph` MCP tools will answer.

Keep this final message under ~10 lines. They just watched you run three commands — they don't need a recap.

## Gotchas

- **The alias is inactive in the current shell.** You cannot `source` on the user's behalf — Bash runs in its own subshell and any `source` you run doesn't persist. Always hand the command back to the user.
- **`claude mcp add` with relative paths silently appears to work.** It only fails when the server is invoked from a different cwd. Always resolve to absolute paths before calling it.
- **`pnpm setup:alias` wraps `scripts/setup-profile.sh` with `< /dev/tty`**, which breaks under non-TTY execution. Call the script directly with piped input instead.
- **MCP registration is user-scoped** (`--scope user`). If the user later runs this skill from a different checkout of the repo, the registered path will still point at the original checkout. Flag this if you notice the `claude mcp get` output points somewhere other than the current repo — ask whether to re-register.
- **Don't call `pnpm build`.** `hooksgraph <dir>` builds the viewer automatically on first run, and the viewer is only needed for the browser UI — not for the MCP server or the CLI. Skipping it keeps onboarding fast.
