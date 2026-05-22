# @hooksgraph/hooksgraph-mcp

Local MCP stdio server that exposes [wp-hooks-graph](../../README.md) codebases as paginated, structured tools — so any agent on the machine can query WordPress hook graphs without slurping JSON into context.

Reads from `~/.hooksgraph/codebases/`; each `<id>.json` is one codebase the tools can address. Populate that directory with `hooksgraph parse-codebase <dir>` (see the [root README](../../README.md#mcp-server)).

## Install / register

The fastest path is the `hooksgraph-setup` skill described in the [root README](../../README.md#ai-assisted-setup-claude-code). To register manually with Claude Code at user scope:

```sh
claude mcp add hooks-graph --scope user -- \
  node /absolute/path/to/wp-hooks-graph/packages/mcp/bin/hooksgraph-mcp.js
```

Verify with `claude mcp list` (should show `hooks-graph: ✓ Connected`). Drop `--scope user` to register per-project instead. Once published, `npx -y @hooksgraph/hooksgraph-mcp` will work as the command — for now use the absolute path into this checkout.

## Run directly

```sh
pnpm mcp                        # uses ~/.hooksgraph/codebases/
pnpm mcp -- --storage /tmp/cbs  # point at a different dir
```

Storage resolution: `--storage <dir>` → `$HOOKSGRAPH_CODEBASES_DIR` → `~/.hooksgraph/codebases/`. A missing dir is a hard error — populate it first with `hooksgraph parse-codebase`.

## Tools

| Tool                          | Purpose                                                                  |
| ----------------------------- | ------------------------------------------------------------------------ |
| `list_codebases`              | Enumerate available codebases with scan metadata                         |
| `find_hook`                   | Exact-name hook lookup, single codebase or across all                    |
| `listeners_of`                | Every `add_action` / `add_filter` for a hook                             |
| `firers_of`                   | Every `do_action` / `apply_filters` call site                            |
| `hooks_in_file`               | All hook activity in a specific file                                     |
| `search_callbacks`            | Case-insensitive substring search over listener callbacks                |
| `hotspots`                    | Top hooks by `total` / `fires` / `listens`                               |
| `shared_hooks`                | Hooks present in ≥2 codebases, with per-codebase counts + divergence     |
| `compare_hook`                | Pivot one or more hooks across codebases; listeners sorted by priority   |
| `filter_priority_conflicts`   | Filter listeners colliding on priority (same hook, same priority)        |

All tools that return lists support `limit` / `offset` pagination. Re-parse a codebase and the next call picks up the new data automatically (mtime-based invalidation, no daemon, no restart).

## Sample prompts

- _"Which callbacks in `woocommerce-bookings` listen on `woocommerce_before_single_product`?"_
- _"Across every codebase, anything with `gateway_stripe_webhook` in the callback name?"_
- _"Show every listener on `woocommerce_add_to_cart_validation` across my Woo extensions, in priority order."_

The [root README](../../README.md#mcp-server) has more.

## Tests

```sh
pnpm test:js                                # workspace-wide Vitest
pnpm -F @hooksgraph/hooksgraph-mcp test     # this package only
```

Per-tool coverage under `tests/`, with hand-built fixtures in `tests/fixtures/`. The `makeCtx()` helper in `tests/helpers.js` lets you call tools in-process without a transport — handy for reproducing a user-reported result locally.

## Internals

See [CLAUDE.md](./CLAUDE.md) for the architecture invariants, mtime cache behaviour, error model, and how to add a new tool.

## Related

- [Root README](../../README.md) — project overview, the `hooksgraph` CLI, viewer, and storage layout
- [`@hooksgraph/plugin`](../plugin/README.md) — in-WordPress companion that exposes the same graph queries via the Abilities API and an admin chat UI
