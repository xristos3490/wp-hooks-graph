# HooksGraph Theme (`packages/theme/`)

Thin WordPress classic-theme wrapper around the `@hooksgraph/viewer` React app. The theme exists only to host the viewer inside a WordPress install — all rendering logic lives in `packages/viewer/`.

## Deployment

**Preferred: deploy the static viewer build, not the theme.**

`packages/viewer/dist/` (output of `pnpm build:viewer`) is a fully self-contained static bundle. Drop it on any static host (GitHub Pages, Netlify, S3, an Nginx box) and ship the parsed `hooks.json` alongside it. No PHP, no WordPress, no theme required.

Use the theme only when the viewer must live inside an existing WordPress site (multisite, shared auth, embedded inside other WP content). For everything else, static hosting is simpler, cheaper, and faster.

## Build

From the repository root:

```sh
pnpm install
pnpm build:theme
```

Runs the viewer build (`pnpm -F @hooksgraph/viewer build`) and copies the resulting JS/CSS into `packages/theme/assets/`, then writes an `assets/manifest.json` mapping logical names to hashed filenames so `functions.php` can enqueue them at runtime.

## Install

Symlink (or copy) the theme directory into a WordPress install:

```sh
ln -s "$PWD/packages/theme" /path/to/wordpress/wp-content/themes/hooksgraph
```

Then in WP Admin: **Appearance → Themes → Hooks Graph → Activate**, and visit the site root.

## Provide the data

`packages/theme/hooks.json` ships **empty**. The viewer renders its empty state (upload / demo prompt) until you replace it with a real graph:

```sh
hooksgraph parse /path/to/wordpress -o packages/theme/hooks.json
# or
hooksgraph parse-codebase /path/to/wordpress
```

To enable the "Load demo" button on the empty state, drop a `demo.json` next to `hooks.json`. If the file is absent, the theme tells the viewer to suppress the demo probe (`window.HOOKSGRAPH_DEMO_URL = null`).

## How it works

- `front-page.php` is a hardcoded classic template: `<!DOCTYPE html>` shell, `wp_head()` / `wp_footer()`, `<div id="root">` mount point.
- `functions.php` reads `assets/manifest.json`, enqueues the built bundle, and injects `window.HOOKSGRAPH_JSON_URL` (and `HOOKSGRAPH_DEMO_URL`) via `wp_add_inline_script`. `wp_script_attributes` / `wp_inline_script_attributes` filters mark the viewer bundle and its inline bootstrap as `type="module"` since the Vite output is an ES module.
- The viewer (`packages/viewer/src/hooks/useGraphData.js`) reads those globals via `resolveDataUrls()` and falls back to relative paths when they are absent (preserving the CLI/server flow).

No template hierarchy, no theme options, no PHP business logic. The theme is a bootstrap shim around the viewer bundle.
