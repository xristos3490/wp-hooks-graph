# @hooksgraph/theme

WordPress classic theme that renders the [Hooks Graph viewer](../viewer/) on the front page from a bundled `hooks.json`.

## When to use this

**Preferred: deploy the static viewer build instead.** [`packages/viewer/dist/`](../viewer/) is a fully self-contained static bundle — drop it on any static host with a parsed `hooks.json` alongside. No PHP, no WordPress required.

Use this theme when the viewer needs to live **inside** an existing WordPress install: multisite, shared auth, embedded under your own domain, or alongside other WP content.

## Build

From the monorepo root:

```sh
pnpm install
pnpm build:theme
```

Runs the viewer build and copies the resulting JS/CSS into `packages/theme/assets/`, then writes `assets/manifest.json` mapping logical names to hashed filenames so `functions.php` can enqueue them at runtime.

## Install

Symlink (or copy) the theme directory into a WordPress install, then activate it:

```sh
ln -s "$PWD/packages/theme" /path/to/wordpress/wp-content/themes/hooksgraph
```

In WP Admin: **Appearance → Themes → Hooks Graph → Activate**, then visit the site root.

## Provide the data

`packages/theme/hooks.json` ships **empty**. The viewer renders its empty state (upload / demo prompt) until you replace it with a real graph:

```sh
hooksgraph parse /path/to/wordpress -o packages/theme/hooks.json
```

To enable the "Load demo" button, drop a `demo.json` next to `hooks.json`. If absent, the theme tells the viewer to suppress the demo probe (`window.HOOKSGRAPH_DEMO_URL = null`).

## How it works

- `front-page.php` is a hardcoded classic template — DOCTYPE shell, `wp_head()` / `wp_footer()`, `<div id="root">` mount point.
- `functions.php` reads `assets/manifest.json`, enqueues the hashed bundle, injects `window.HOOKSGRAPH_JSON_URL` / `HOOKSGRAPH_DEMO_URL` via `wp_add_inline_script`, and marks the bundle `type="module"`.
- The viewer (`packages/viewer/src/hooks/useGraphData.js`) reads those globals and falls back to relative paths when absent (preserving the CLI/server flow).

No template hierarchy, no theme options, no PHP business logic. The theme is a bootstrap shim around the viewer bundle.

## More

- Theme-specific architecture notes and gotchas: [`CLAUDE.md`](./CLAUDE.md).
- Viewer internals: [`../viewer/`](../viewer/).
- Repo overview: [`../../README.md`](../../README.md).
