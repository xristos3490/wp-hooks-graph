---
name: triage-issue-conflicts
description: Strategy for triaging a WordPress issue/bug report against a list of active plugins by finding likely cross-plugin conflicts. Use whenever the user describes a site issue (bug, regression, broken feature, "X stopped working", "checkout is failing", "posts aren't saving", "REST endpoint returns wrong data") and provides — or can provide — the list of active plugins/themes, asking which plugins are conflicting or likely responsible. Trigger phrases include "which plugin is causing this", "find the conflict from this issue", "triage this bug across the active plugins", "narrow down the culprit", "audit the active plugins against this report", or any time the user pairs an issue description with a plugin list and wants you to localize the conflict. This skill orchestrates pairwise comparisons via the `find-conflicts` sibling skill — invoke that for each prioritized pair rather than re-implementing its strategy.
---

# Triaging an issue across active plugins

Given (1) a free-text issue description and (2) a list of active plugins, narrow down which plugin pairs are likely to be in conflict and run the `find-conflicts` strategy on the prioritized pairs. The goal is to spend MCP tool calls only on pairs that have a plausible reason to interact at the surface the issue describes.

## Why this skill exists

A site with 30 active plugins has 435 possible pairs. Running `find-conflicts` on all of them is wasteful and the output is unreadable. The issue description is a strong prior: a checkout bug only implicates plugins that touch order/cart/payment hooks; a "posts aren't saving" bug only implicates plugins that listen on `save_post` / `wp_insert_post` / REST post endpoints. This skill turns the issue text into a set of "smells" (concrete hook names, post types, REST namespaces, admin screens, option keys), uses the MCP to find which plugins exhibit each smell, and only then forms pairs.

The pairwise analysis itself is delegated to the `find-conflicts` skill — don't reimplement the five-category taxonomy here. This skill is the dispatcher; that one is the worker.

## Preflight

1. **All plugins parsed.** Call `list_codebases`. Every plugin in the active list must appear, matched by path or ID. If any are missing, stop and tell the user to run `hooksgraph parse-codebase` for each missing one — do not proceed with a partial set; a missing plugin is exactly the kind of thing that would have been the culprit.
2. **Issue text is concrete enough.** If the description is one line like "site is broken", ask one targeted clarifying question before continuing — you need at least one of: the user-facing symptom, the WordPress area (admin/frontend/REST/cron), or the rough feature (checkout, login, post editor, etc.). Without that, smell extraction returns the empty set and the whole skill degenerates to "run everything".

Pin the active-plugin codebase IDs as a list `P = [p1, p2, …, pN]` and use them verbatim for the rest of the run.

## Step 1 — Extract smells from the issue

Read the issue and pull out as many of these as apply. Each smell is a concrete, MCP-queryable handle.

- **Explicit hook names.** Anything matching `do_action`/`apply_filters`/`add_action`/`add_filter` syntax, or names with underscores that look like hooks (`woocommerce_checkout_process`, `save_post`, `the_content`).
- **Core WP surfaces.** Map symptom language to known hook clusters:
  - "checkout" / "payment" → `woocommerce_checkout_*`, `woocommerce_payment_*`, `woocommerce_order_status_*`
  - "post save" / "publish" → `save_post`, `save_post_<type>`, `wp_insert_post`, `transition_post_status`
  - "REST" / "API" → `rest_api_init`, `rest_pre_dispatch`, `rest_request_after_callbacks`, `rest_prepare_<type>`
  - "login" / "auth" → `wp_login`, `wp_authenticate`, `authenticate`, `wp_login_failed`
  - "admin screen" → `admin_init`, `admin_menu`, `current_screen`, `load-<page>`
  - "frontend render" / "broken layout" → `the_content`, `wp_head`, `wp_footer`, `template_include`, `body_class`
  - "cron" / "scheduled" → `cron_schedules`, `wp_scheduled_event`, named cron action
  - "email" → `wp_mail`, `wp_mail_from`, `wp_mail_content_type`
- **Post types / taxonomies.** Named entities (`product`, `shop_order`, `event`, `wpcm_player`) — these become smell suffixes on `save_post_<type>`, `manage_<type>_posts_columns`, `rest_prepare_<type>`, etc.
- **Option / meta keys.** If the issue mentions a setting or stored value (`woocommerce_currency`, `_price`, `_thumbnail_id`), keep it — it becomes a Step 3 target match.
- **REST routes / URL fragments.** A path like `/wp-json/wc/v3/orders` implies the `wc/v3` namespace and `orders` resource; the listening surface is `rest_api_init` callbacks registering that route.

Output the smell set to the user in one compact block before continuing. They'll often correct or extend it — that's faster than running the whole skill on a wrong prior.

## Step 2 — Rank plugins by smell match

For each plugin `p` in `P`, score it by how many smells it touches. Cheap MCP calls only — you're triaging, not analyzing yet.

- **Hook-name smells** → for each smell `h`, call `find_hook(hook=h, codebase=p)`. A match (firer or listener) scores 1 for that smell.
- **Hotspot smells** (when the issue is vague but localized to a surface, e.g. "frontend rendering is slow"): call `hotspots(codebase=p)` and check whether any top-10 hotspot name overlaps the smell set.
- **Target smells** (option/meta keys) → call `search_callbacks(codebase=p, query=<key>)` with the key as a substring; score 1 if any callback writes that target.
- **REST smells** → call `search_callbacks(codebase=p, query="rest_api_init")` and look at the registered route strings in the surrounding listener locations; this is imprecise — accept false positives at this stage.

A plugin's score is the count of distinct smells it matched. Drop plugins with score 0 from further analysis (they have no surface touching the issue area).

## Step 3 — Form pairs

Pair every surviving plugin with every other surviving plugin (`C(K, 2)` pairs where `K` is the survivor count). Rank pairs by the **sum of their smell scores**, breaking ties by **smell overlap** — pairs where both plugins matched the *same* smells are more interesting than pairs that matched disjoint smells (disjoint matches mean the plugins are operating on different surfaces and probably don't collide).

Cap the run at a sensible number — default to the top 10 pairs, or fewer if the score distribution falls off sharply (e.g., a clear top 3 with everything else at score 1 each). Tell the user what cap you're applying and why; let them override.

If `K = 1` (only one plugin matches), there's no pair to compare. Stop and report: "Only `<plugin>` touches the issue surface; this is a single-plugin bug, not a conflict. Investigate that plugin directly." Don't force pair analysis just to have output.

## Step 4 — Run `find-conflicts` per pair

For each prioritized pair `(A, B)`, invoke the `find-conflicts` skill with `A` and `B` as the two codebases. That skill owns the five-category taxonomy and the report shape; you're calling it as a subroutine.

Collect each pair's report. **Filter each report to findings that intersect the smell set** before aggregating — a generic priority collision on `wp_head` is not relevant to a checkout bug, even if the pair has it. Concretely:

- For category 1 (priority collisions): keep findings whose hook name is in the smell set, or whose hook name's prefix matches a smell cluster (e.g., `woocommerce_checkout_*` matches the "checkout" cluster).
- For category 2 (state writes): keep findings whose written key is in the smell set, or whose `kind:key` was named in the issue.
- Drop categories 3 and 4 unless the user asked for the integration surface — they're rarely the answer to a "what's broken" question.

If filtering empties a pair's report entirely, note the pair as "checked, no issue-relevant findings" — don't omit it silently; the user wants to see what you ruled out.

When a finding's severity hinges on what a callback actually does, open the file at the `file:line` the tools returned and read the body — both in this skill and the one it delegates to. The MCP localizes; you judge.

## Step 5 — Aggregate and report

Produce a single triage report:

```
# Issue triage: <one-line issue summary>

## Smells extracted
<bullet list of smells, grouped by type>

## Plugin relevance scores
| Plugin | Score | Matched smells |
| ... | ... | ... |

## Pairs analyzed (top N of M total)
### 1. <plugin-a> ↔ <plugin-b> (combined score: X, shared smells: …)
<filtered findings from find-conflicts, ordered by category>

### 2. <plugin-c> ↔ <plugin-d> …

## Pairs checked with no issue-relevant findings
- <pair> — checked categories 1/2/3, nothing matched smells

## Pairs not analyzed
- <list of pairs below the cap, with their scores>

## Next steps
<1–3 sentences: which finding is the most likely culprit, what to verify next>
```

The "next steps" line matters — the user came here to localize a bug, not to read a matrix. Pick the single most plausible finding and say why. If the top finding is a confirmed filter clobber (both callbacks fully replace the input) on a hook in the smell set, that's almost always the answer; say so.

## Pitfalls

- **Don't skip preflight on the plugin list.** A missing parsed codebase silently drops a plugin from consideration, and the bug-causing plugin is exactly the one the user forgot to parse.
- **Don't run `find-conflicts` on every pair.** That defeats the purpose of this skill. If you find yourself about to launch >15 pairwise runs, your smell extraction is too broad — go back to Step 1 and tighten it.
- **Smell extraction is not keyword bingo.** "Slow" is not a smell. "Slow on the cart page" → smells: `woocommerce_cart_*`, `template_include`, `wp_footer`. Reach for the WP-side handle, not the user-side complaint.
- **Disjoint smell matches are uninteresting.** If A matches "checkout" smells and B matches "email" smells, the pair is low-value even if both scored high individually. The interesting pairs are the ones operating on the same surface.
- **Report what you didn't check.** Pairs below the cap should be listed by name. The user may recognize one and ask you to analyze it specifically — give them that hook.
- **Single-plugin bugs are real.** If only one plugin matches the smells, say so and stop. Forcing pairwise analysis on a single-plugin bug wastes time and produces misleading "conflicts" that are just within-plugin interactions.
