# HooksGraph Plugin (`packages/plugin/`)

WordPress plugin shell that wraps the in-monorepo parser and exposes a Tools-menu admin page for triggering parses against installed plugins. Currently scaffolding — the build pipeline (strauss + wp-scripts + zip) is a follow-up spec.

## Layout

```
hooksgraph.php          Plugin bootstrap. Defines HOOKSGRAPH_* constants, loads the
                        parser autoloader (plugin vendor → falls back to ../parser/vendor
                        for monorepo dev), requires every includes/class-*.php file,
                        and wires the runtime on `plugins_loaded`.
includes/               PHP runtime, namespace HooksGraph\Plugin\.
  class-storage.php       Filesystem layout under wp-content/hooksgraph/, status
                          classifier (parsed | stale | needs_parsing), per-plugin
                          settings persisted in the `hooksgraph_plugin_settings` option.
  class-parser-service.php In-process wrapper around HooksGraph\Discovery / Parser /
                          Graph. Bypasses Cli\Runner (which is interactive).
  class-cron.php          One-shot WP-Cron events keyed by plugin basename. Hook:
                          `hooksgraph_parse_plugin`. UI uses `wp_next_scheduled()` to
                          render a "Scheduled" pill.
  class-rest-controller.php Extends `WP_REST_Controller` under the
                          `hooksgraph/v1` namespace. All routes require
                          `manage_options`. Routes:
                            GET  /plugins             → list active plugins (joined row shape, X-WP-Total* headers)
                            GET  /plugins/{id}        → single record (id is plugin key, e.g. akismet/akismet)
                            POST /parse-plugin        → schedules a parse via Cron
                            GET  /parse-download      → streams the parsed JSON for a plugin
                            POST /ai/list-codebases   → single-turn AI Client loop over hooksgraph abilities
  class-admin-page.php    Registers the Tools → HooksGraph submenu and enqueues
                          build/index.{js,css} on that screen only.
src/                    React admin UI (wp-scripts entry).
  index.js                Mount point. Calls `registerEntities()` before render.
  app.jsx                 Top-level layout; mounts `<ActivePluginsStage>`.
  schedule-parse-modal.jsx Modal for entering exclude patterns before scheduling.
  data/
    register-entities.js  Guarded `addEntities([PLUGIN_ENTITY])` against `coreStore`.
  routes/active-plugins/  CIAB-style route folder for the active-plugins list.
    entity.js               `PLUGIN_ENTITY` (`hooksgraph:plugin`) descriptor + `_fields` const.
    view-utils.js           `DEFAULT_VIEW` + `getDefaultView()` + `viewToQuery()`.
    use-plugin-fields.js    `usePluginFields()` → DataViews `Field[]` (replaces old `fields.js`).
    use-plugin-actions.js   `usePluginActions({ onScheduleSingle, refreshList })` → action defs.
    stage.jsx               Wiring: `useEntityRecords` → DataViews + tabs + ScheduleParseModal.
  style.scss              Plugin-scoped styles.
build/                  wp-scripts output. Not checked in.
composer.json           type: wordpress-plugin. Requires hooksgraph/hooks-parser via
                        the path repo (../parser).
package.json            @hooksgraph/plugin (private). wp-scripts + @wordpress/* deps.
```

## Commands

Run from the **monorepo root** (workspace-aware) unless noted otherwise.

| Command                              | Description                                                      |
| ------------------------------------ | ---------------------------------------------------------------- |
| `pnpm -F @hooksgraph/plugin start`   | wp-scripts dev build (watch) → `build/`                          |
| `pnpm -F @hooksgraph/plugin build`   | wp-scripts production build → `build/`                           |
| `pnpm -F @hooksgraph/plugin format`  | Prettier via wp-scripts                                          |
| `pnpm -F @hooksgraph/plugin lint:js` | ESLint via wp-scripts                                            |
| `pnpm build:plugin`                  | Placeholder; the strauss + zip release pipeline is not built yet |

`composer install` inside `packages/plugin/` resolves the parser through the local path repo; the bootstrap autoloader prefers `vendor/autoload.php` here and falls back to `../parser/vendor/autoload.php` so dev installs that skip the plugin-local vendor still work.

## Architecture notes

- **Single bootstrap**, no class-plugin / kernel object. `hooksgraph.php` instantiates `Storage`, `Parser_Service`, `Cron`, `Admin_Page`, and `Rest_Controller` on `plugins_loaded` and calls `register()` on those that need to attach hooks.
- **Plugin keys** match WP core's REST shape: `akismet/akismet` (no `.php`) for foldered plugins, `hello` for single-file ones. `Storage::filename()` uses `basename( $plugin_relative )` + version, so output files look like `akismet-5.3.1.json`.
- **Output dir** is `wp-content/hooksgraph/`. `Storage::ensure_dir()` writes a defensive `index.php` to block directory listing.
- **Status classifier** in `Storage::status_for()` is filename-based: exact `<basename>-<version>.json` → `parsed`; any other `<basename>-*.json` → `stale`; nothing → `needs_parsing`. The REST layer overlays a fourth value `scheduled` when a Cron event is pending.
- **Parsing in-process** uses `FileParser::parse()` per file with `array_merge` of the call records, then `Builder::build()` produces the graph. Per-file failures are logged via `error_log()` and skipped — they don't abort the run.
- **REST permission** is uniformly `current_user_can( 'manage_options' )`. `sanitize_plugin()` enforces `^[a-zA-Z0-9._-]+(?:/[a-zA-Z0-9._-]+)?$`; anything else is rejected.
- **Schedule semantics**: `Cron::schedule()` returns one of `Cron::SCHEDULE_NEW` / `SCHEDULE_EXISTING` / `SCHEDULE_FAILED`. The REST endpoint maps `SCHEDULE_FAILED` to a 500 `WP_Error` and otherwise responds 202 with `scheduled => true` plus `newly` distinguishing new vs already-pending.
- **Cron callback re-reads version** from `get_plugins()` — the queued job carries only the plugin key, so a plugin update between schedule and run is fine.
- **React UI** is mounted at `#hooksgraph-admin-root` on the Tools → HooksGraph screen. Data layer is `@wordpress/core-data`: `useEntityRecords( 'hooksgraph', 'plugin', QUERY )` against `/hooksgraph/v1/plugins`. The server does the active-plugin + parse-state join, so the client makes one request per resolution. Mutations (`POST /parse-plugin`, bulk downloads) call `invalidateResolution( 'getEntityRecords', [ 'hooksgraph', 'plugin', QUERY ] )` for a surgical refetch instead of refetching everything.
- **Entity registration** lives in `src/data/register-entities.js` and is called from `src/index.js` before `createRoot`. Adding a new entity = extend that file. The `hooksgraph` kind is just a namespace string in core-data; no extra wiring is needed.
- **Status map caching**: `Storage::status_map_for( $keys, $versions, $cron )` does one `glob()` of the storage dir + a single bulk read of `hooksgraph_plugin_settings`, and is wrapped in the `hooksgraph_plugin_status_map` transient (60s TTL). `Cron::schedule()` and the `finally` block of `Cron::run()` call `Storage::invalidate_status_map()` so the UI sees `scheduled → parsed` transitions immediately rather than after the TTL.

## Code style

- PHP: namespaced `HooksGraph\Plugin\`, `declare(strict_types=1)`, `final` classes, constructor property promotion. Every includes/class-\*.php starts with `defined( 'ABSPATH' ) || exit;`.
- Class files are named `class-<kebab-name>.php` (WordPress convention) but the classes inside use `Snake_Case` (`Parser_Service`, `Rest_Controller`) — match the existing pattern when adding new ones.
- JS/JSX: ES modules, function components, follow `@wordpress/eslint-plugin` rules baked into wp-scripts.
- Strings are translatable via `__()` / `_x()` with the `hooksgraph` text domain. PHP and JS both use it.
- UI: prefer `@wordpress/dataviews` primitives (DataViews, DataForm) for tables and forms; see the project-level memory note about not mixing in `@wordpress/ui` / `@wordpress/components` composition for sidebar cards.

## Gotchas

- The plugin's autoloader prefers `vendor/autoload.php` here, but tests and dev may not have it. The fallback to `../parser/vendor/autoload.php` is intentional — don't remove it without first wiring the strauss build that bundles a prefixed copy.
- Two parser-call surfaces exist: `Cli\Runner` (stdout/stderr, used by the `hooksgraph` CLI) and the lower-level `Discovery`/`Parser`/`Graph` classes (used here). Don't route plugin code through `Runner`; it would print to the response stream.
- The admin asset enqueue checks `'tools_page_' . HOOKSGRAPH_ADMIN_PAGE_SLUG`. If the menu is moved off Tools, this string changes — keep it in sync with `register_menu()`.
- WP-Cron callbacks don't bootstrap wp-admin. `Cron::run()` and `Rest_Controller::active_plugin_keys()` both `require_once ABSPATH . 'wp-admin/includes/plugin.php'` before calling `get_plugins()` — keep this guarded.
- The `hooksgraph_plugin_settings` option is autoloaded `false` (3rd arg to `update_option`). The data lives in a single keyed array; don't switch to per-plugin options without a migration.
- The REST namespace is `hooksgraph/v1`. Do **not** extend `/wp/v2/plugins` — see the comment block at the top of `class-rest-controller.php`. The previous attempt to expose a plugin file path via `/wp/v2/plugins` was reverted (commit 8699f1e).
- `Storage::prune_older()` is called after each successful parse and unlinks every `<basename>-*.json` that doesn't match the current filename. If you add multi-version retention, change this logic — don't add a sibling cleanup pass.

## Testing

There is no plugin-specific test suite yet. The parser library it depends on is covered by PHPUnit under `packages/parser/tests/` (`pnpm test:php`). When adding plugin tests, add a new testsuite to `phpunit.xml` rather than reusing `parser` — these classes need a WordPress bootstrap (Brain Monkey or wp-phpunit), which the parser tests deliberately avoid.
