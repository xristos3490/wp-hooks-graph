---
name: find-conflicts
description: Strategy for finding conflicts between two WordPress codebases (plugin↔plugin, plugin↔theme, plugin↔core) via the `hooks-graph` MCP server. Use whenever the user wants to compare, diff, audit, or find conflicts/collisions/clashes/interference between two repos, plugins, themes, or codebases — including phrases like "do these two plugins conflict", "find overlap between X and Y", "what hooks do A and B share", "where will plugin X step on plugin Y", "audit integration risk between these repos", "priority conflicts", "callback collisions", or any request to compare two parsed codebases in `~/.hooksgraph/codebases/`. Apply this skill even if the user names only "conflicts" without saying "hooks" — in WordPress, cross-plugin conflicts almost always surface through the hook system.
---

# Finding conflicts between two codebases

Use the `hooks-graph` MCP server to detect where two parsed WordPress codebases will interfere at runtime. The MCP gives you static facts (who fires what, who listens, at what priority, where in the source). Your job is to combine those facts into a ranked list of plausible conflicts and present them with enough evidence that the user can act.

## Why this skill exists

The MCP exposes ~10 tools, but no single tool answers "do these two repos conflict." The naive approach (dump `shared_hooks` and call it done) buries signal in noise: a shared `init` listener is usually fine; two filters both registered on `the_content` at priority 10 may silently overwrite each other. The strategy below filters the shared-hook universe through priority overlap and call-site evidence, then leaves you free to open the source file when you need to decide severity.

**You can always read the file.** Every result the MCP returns carries `file` and `line`. When the static facts aren't enough to judge a finding — is this listener a passthrough or does it actually rewrite the value? does this writer touch the same key conditionally? — open the file and read the callback body. Don't manufacture a verdict from the tool output alone, and don't ask the user for permission. Read the source when reading the source helps.

## Preflight

Before any analysis, confirm both codebases are loaded:

1. Call `list_codebases`. If either repo the user named is missing, **stop** and tell them to run:
   ```
   hooksgraph parse-codebase /path/to/repo
   ```
   for the missing one. The MCP only reads from `~/.hooksgraph/codebases/`; the parsed dir is a different surface and won't help here.
2. If the user gave directory paths instead of codebase IDs, match by the `path` field returned from `list_codebases` and confirm the resolved IDs back to the user in one line before continuing.

Pin the two codebase IDs as `A` and `B` for the rest of the run and use them verbatim — the tools are strict about IDs.

## The conflict taxonomy

Frame everything in terms of these four categories. Findings get ranked roughly in this order; severity within a category depends on what the callbacks actually do — go read the file when you need to know.

1. **Priority collisions on shared hooks** — multiple listeners registered at the same priority on the same hook across the two repos. Order between them becomes load-order-dependent (whichever plugin's file loaded last wins), which is non-deterministic from the user's POV. For filters this also means the later callback can clobber the earlier one's return value.
2. **State write conflicts** — callbacks from both codebases touch the same `option`, `post_meta`, `user_meta`, `term_meta`, or `transient` key. Last-writer-wins, but only one of them logs it. Confirm by reading the call sites.
3. **Same custom hook fired from both repos** — a non-core hook (`hook::my_plugin_thing`) that both repos `do_action`/`apply_filters` on. Usually means one repo is reaching into the other's extensibility surface; worth surfacing even if it isn't strictly a bug.
4. **Integration surface** — one repo fires a hook the other listens on (or vice versa). Not a conflict, but the user often wants to see this when auditing compatibility, so collect it and present it last as context.

Anything that doesn't fit one of these four buckets is probably noise — don't surface it.

## Execution order

Run the steps below in this order. Each step narrows the candidate set; later steps may need per-hook calls, and you only want to spend them on hooks that already survived the cheaper filters.

### Step 1 — Shared-hook universe

Call `shared_hooks(codebase_a=A, codebase_b=B)`. This is the universe of every hook touched by both repos. For each shared hook, the tool tells you whether each side fires it, listens on it, or both. Bucket the results:

- **both-listen** → candidates for category 1 (priority collisions). Also worth scanning for category 2 evidence at the call sites.
- **A-fires + B-listens** (or symmetric) → category 4 (integration surface).
- **both-fire** → category 3 if the hook name is not a core hook.

Core-hook detection: if the hook name is one of WordPress's well-known names (`init`, `wp_loaded`, `the_content`, `save_post`, `wp_enqueue_scripts`, `admin_init`, etc.), "both fire" is impossible-by-definition (core fires it, plugins listen) — that case shouldn't appear in real data, but if it does, drop it as noise.

### Step 2 — Filter priority conflicts (category 1, filters)

Call `filter_priority_conflicts(codebases=[A, B])`. **This tool is filter-only by design — actions are skipped server-side** (see `packages/mcp/src/tools/filter_priority_conflicts.js`). Don't expect action-on-action priority collisions here; handle those separately in Step 2b.

The response shape:

```
results: [
  {
    hook: "the_content",
    hook_type_by_codebase: { "<A>": "filter", "<B>": "filter" },
    collision_count: 2,
    collisions: [
      {
        priority: 10,
        codebases: ["<A>", "<B>"],
        listener_count: 3,
        listeners: [ { codebase, file, line, callback, callback_type, priority, scope_function }, ... ]
      }
    ]
  }
]
```

For each collision you get the two (or more) callback identifiers and their `file:line`. That's enough to **localize** the conflict; it is rarely enough to **judge** it. To rank a finding, you need to know what each callback actually does to the filter value — passthrough, mutation of one field, full replacement, conditional, etc. The static fact "same hook + same priority" doesn't tell you that.

When the verdict matters, **open the file at the listener's `file:line` and read the callback body**. Read both sides. Then judge:

- If both callbacks return a value computed independently of the input (full replacement on each side), you've got a guaranteed clobber. Severity: high.
- If both callbacks mutate the same field of the input, you've got a likely clobber on that field. Severity: medium-high — depends on the field.
- If both callbacks mutate disjoint fields, they coexist despite the priority collision. Severity: low — note it but don't lead with it.
- If one side is a passthrough (returns input unchanged) and the other mutates or replaces, the mutating side wins regardless of order. Severity: low for the priority collision itself, but worth noting the asymmetry.
- If the callback body is unreadable from this codebase (string callback pointing at a class you don't have, dynamic dispatch, vendored code), record the pair under "couldn't verify" with the file:line so the user can check.

Don't dedupe across hooks: the same callback registered on multiple hooks counts as multiple findings.

**Priority value as context (not a verdict):**

- Priority `10` is WordPress's default; collisions there are common and often coincidental (both authors just took the default).
- Collisions at a deliberate non-default priority (e.g. both at `99` or both at `5`) are stronger intent signals — somebody chose that number to run before/after something specific, and the other plugin chose the same. Surface this in the finding line.

### Step 2b — Action priority collisions (still category 1)

`filter_priority_conflicts` will not surface action collisions. For actions, derive them from Step 1's **both-listen** bucket where `hook_type = "action"`:

- Call `compare_hook(hook=<name>, codebase_a=A, codebase_b=B)` for each such hook.
- Walk the returned listener pairs; flag any priority that appears on both sides.
- For actions the conflict is rarely about return value (actions return nothing) — it's about side-effect ordering. Open the callback files and check whether either side writes state that the other reads, redirects, exits early, fires further hooks, etc. The judgment is yours; the file is right there.

If the both-listen action set is large (>20 hooks), don't fan out blindly — start with hooks whose names already look load-bearing (`save_post`, `wp_login`, `template_redirect`, `init`, etc.) and skip generic-noise hooks unless the issue surface demands them.

### Step 3 — State write conflicts (category 2)

Use `search_callbacks` on each side to surface listeners that look like they write state — searching for the relevant API names (`update_option`, `update_post_meta`, `update_user_meta`, `set_transient`, `$wpdb->update`, etc.) is usually the fastest path. Cross-reference the results by the literal key they target.

The MCP can give you candidates, but **the keys it can flag with high confidence come from string literals in the callback body**. For variable keys, dynamic prefixes, or computed names, the MCP won't help — you'll need to open the file and read the surrounding context to decide whether two writes converge on the same key.

Examples that should fire:

- A and B both call `update_option('woocommerce_currency', ...)`.
- A and B both call `update_post_meta($id, '_price', ...)`.

For each candidate match, open both call sites and confirm the writes really do collide. False positives are common when the key is computed from a variable or filtered through a helper — don't ship the finding without reading the source.

### Step 4 — Custom hook ownership (category 3)

From the **both-fire** bucket in Step 1, filter out core hooks (extend the list with obvious ecosystem hooks you recognize: `woocommerce_*`, `gravityforms_*`, `wpseo_*`, etc.). What's left is custom hooks that both repos claim ownership of. Call `firers_of(hook=<name>, codebase=A)` and `firers_of(hook=<name>, codebase=B)` to grab the call sites; open the files if you need to understand whether one side is intentionally piggybacking on the other's extensibility surface or whether the name collision is coincidental.

### Step 5 — Integration surface (category 4)

The fire-on-one-side, listen-on-the-other bucket from Step 1 is already the answer. No additional MCP calls needed — just collect the listener locations via `listeners_of` if you want the file:line evidence for the report.

## Report shape

Group findings by category, ordered 1 → 4. Within a category, sort by likely impact (a confirmed clobber on `the_content` is more interesting than one on a niche admin filter). Use this structure:

```
# Conflict audit: <repo-A> ↔ <repo-B>

## 1. Priority collisions (N findings)
- **`the_content`** — both at priority 10, both replace the input (verified by reading callback bodies)
  - A: `MyPlugin\Filters::content` (plugin-a/src/Filters.php:42)
  - B: `OtherPlugin\Render::content` (plugin-b/render.php:88)
  - Impact: whichever loads later wins; the other's output is discarded.

## 2. State write conflicts (N findings)
- **`option:woocommerce_currency`**
  - A writes from: …
  - B writes from: …

## 3. Custom hook ownership overlap (N findings)
...

## 4. Integration surface (N findings — informational)
...

## Couldn't verify
- <pair> — callback body not resolvable from this codebase (string callback / vendored code at file:line); recommend manual inspection
```

If a category is empty, write `_None found._` rather than dropping the heading — the user wants to know what you checked.

## Pitfalls

- **Don't treat `shared_hooks` as a conflict list.** Most shared hooks are fine. Without priority overlap and call-site reading, the output is noise.
- **Don't form verdicts from tool output alone.** "Same hook, same priority" is a candidate, not a conflict. To call something a clobber, read the callback body. The MCP's job is to localize; yours is to judge.
- **Read the file.** You have `file:line` for every listener. If the question is "what does this callback do," open it — don't ask the user, don't guess, don't pad the report with "likely" / "probably" when the source is right there.
- **`filter_priority_conflicts` is filter-only.** Action-on-action priority collisions never appear in its results (it skips `hook_type === 'action'` server-side). Reach for `compare_hook` on the both-listen action bucket from Step 1 instead — see Step 2b.
- **Priority 10 collisions are weak signal on their own.** It's WP's default; many plugins land there by inertia, not intent. Don't lead the report with a priority-10 collision unless reading the callbacks confirms the collision matters.
- **`compare_hook` is per-hook.** Don't call it across the entire shared set up front; only call it where Step 2b actually needs it, otherwise you'll burn a lot of tool calls for nothing.
- **Severity is not from the tool.** The MCP gives you facts; you decide what's load-bearing. A `save_post` write-conflict on `_thumbnail_id` is severe; a debug-only listener clobbering `__debug_meta` is not. Use the hook name, the target key, and what you saw in the source to judge.
- **The user usually wants the file:line.** Every finding should carry the source location for both sides so they can jump straight to the code. The tool results already include this; don't drop it on the way to the report.
