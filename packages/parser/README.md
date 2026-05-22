# `hooksgraph/hooks-parser`

PHP library that parses WordPress source for hook relationships
(`do_action` / `add_action` / `apply_filters` / `add_filter`) and emits a JSON graph.
Token-based static analysis — no WordPress runtime, no database, no autoloading.

This package powers the [`@hooksgraph/hooksgraph`](../cli/) CLI and the in-monorepo
[WordPress plugin](../plugin/). For the end-user CLI experience, see the
[repo root README](../../README.md).

## Requirements

- PHP 8.2+

## Install (standalone)

```sh
composer install --working-dir=packages/parser
```

This package has no runtime composer dependencies — the install only generates the
PSR-4 autoloader.

## Use as a library

```php
require __DIR__ . '/packages/parser/vendor/autoload.php';

use HooksGraph\Discovery\PhpFileFinder;
use HooksGraph\Graph\Builder;
use HooksGraph\Parser\FileParser;

$dir   = '/path/to/wordpress';
$files = PhpFileFinder::find($dir, $excludeDirs = []);
$calls = [];
foreach ($files as $file) {
    $calls = array_merge($calls, FileParser::parse($file, basename($dir)));
}
$graph = (new Builder())->build($calls, [$dir], count($files));
file_put_contents('hooks.json', json_encode($graph));
```

`Cli\Runner` is the interactive entry point (used by the `hooksgraph` Node shim) — it
prints progress and a summary to the terminal. **For library / plugin embedding, call
the lower-level `Discovery` / `Parser` / `Graph` classes directly**, as in the snippet
above. Routing your code through `Runner` would dump ANSI escapes into your output.

## Use as a CLI

```sh
php packages/parser/hooksgraph.php /path/to/wordpress
```

The `hooksgraph` Node shim ([`packages/cli/`](../cli/)) is the recommended entry point —
it handles storage routing (`~/.hooksgraph/parsed/`, `~/.hooksgraph/codebases/`), serves
the viewer, and opens a browser. The bare PHP entry above writes to `./storage/` by
default.

## Serve the viewer

`server.php` is a `php -S` router that serves a parsed JSON at `/hooks.json` and falls
through to the built-in static-file server. The Node shim wires this together:

```sh
HOOKS_JSON=/abs/path/to/hooks.json php -S 127.0.0.1:8080 -t /path/to/viewer/dist \
  packages/parser/server.php
```

## Tests

```sh
pnpm test:parser     # or: vendor/bin/phpunit
```

PHPUnit 11, no WordPress bootstrap. See
[`tests/Support/ParsesSource.php`](tests/Support/ParsesSource.php) for the shared trait
that runs assertions against the real token walker.

## Hooks captured

| Function                                 | edge_type | hook_type |
| ---------------------------------------- | --------- | --------- |
| `do_action`, `do_action_ref_array`       | `fires`   | `action`  |
| `apply_filters`, `apply_filters_ref_array` | `fires`   | `filter`  |
| `add_action`                             | `listens` | `action`  |
| `add_filter`                             | `listens` | `filter`  |

## More

- Architecture, invariants, gotchas: [`AGENTS.md`](AGENTS.md)
- Repo-level pitch & commands: [`../../README.md`](../../README.md)
- CLI shim that wraps this package: [`../cli/README.md`](../cli/README.md)
