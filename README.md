# WordPress Hooks Graph

Static analysis for WordPress hook dependencies. Point it at plugins, themes, or core and get an interactive dependency graph of every `do_action`, `add_action`, `apply_filters`, and `add_filter` call — parsed straight from source via PHP's `token_get_all()` tokenizer. No WordPress runtime, no database.

🔗 **Live demo:** [wphooksgraph.wpcomstaging.com](https://wphooksgraph.wpcomstaging.com/)

![Hooks Graph viewer exploring the Gutenberg codebase](images/gutenberg-hooksgraph-demo.jpg)

## What's in the monorepo

pnpm workspace. Each package ships on its own channel — see its README for usage and internals.

| Package                                | Purpose                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`parser/`](packages/parser/README.md) | The core. PHP tokenizer + graph builder under the `HooksGraph\` namespace. Outputs the graph JSON.     |
| [`viewer/`](packages/viewer/README.md) | The UI. React + Sigma (WebGL) app that renders the graph. Bundled into the CLI and the theme.          |
| [`cli/`](packages/cli/README.md)       | The entry point. `@hooksgraph/hooksgraph` — Node shim that orchestrates parser + viewer from a shell.  |
| [`mcp/`](packages/mcp/README.md)       | For AI agents. `@hooksgraph/hooksgraph-mcp` — stdio MCP server exposing every parsed codebase as tools.|
| [`plugin/`](packages/plugin/README.md) | For WordPress. Plugin with admin UI + AI-assisted priority-conflict triage on installed plugins.       |
| [`theme/`](packages/theme/README.md)   | For hosting. Classic WP theme that embeds the viewer inside a WordPress site.                          |

For cross-package commands and workspace conventions, see [`AGENTS.md`](AGENTS.md).

## Install

**Requires:** PHP 8.2+, Node 18+, pnpm 10+.

```sh
pnpm install
pnpm setup:alias                 # one-time: installs the `hooksgraph` shell alias
hooksgraph /path/to/wordpress    # parse + serve + open
```

Tips:

- The alias supports zsh, bash, and fish — `pnpm setup:alias` picks the right RC file based on `$SHELL` and prints the `source` command to re-run.
- Don't want a global alias? Call `packages/cli/bin/hooksgraph.js` directly — no setup step needed.
- First run builds the viewer; subsequent runs skip it. Force a rebuild with `pnpm build`.
- Parsed graphs land in `~/.hooksgraph/parsed/` (viewer) and `~/.hooksgraph/codebases/` (MCP). Override with `$HOOKSGRAPH_PARSED_DIR` / `$HOOKSGRAPH_CODEBASES_DIR`.

### AI-assisted setup (Claude Code)

This repo ships an onboarding skill at [`.ai/skills/hooksgraph-setup/`](.ai/skills/hooksgraph-setup/SKILL.md). Open the repo in Claude Code and say _"set up wp-hooks-graph"_ — the skill runs `pnpm install`, wires the shell alias, and registers the [`hooks-graph` MCP server](packages/mcp/README.md) in one pass. Reruns are idempotent, so it's also the fastest way to repair a partial setup.
