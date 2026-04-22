<?php

declare(strict_types=1);

namespace HooksGraph\Cli;

/**
 * Builds the `--help` text. When invoked through the `hooksgraph parse` dispatcher
 * the HOOKSGRAPH_INVOKED_AS env var rebrands the Usage / Examples / Viewing-results
 * blocks; with no env var, the original `php hooksgraph.php` presentation is kept.
 */
final class Help
{
    private const TEMPLATE = <<<'HELP'
Usage: php hooksgraph.php [options] DIR [DIR...]

Scan WordPress codebases and build a hook relationship graph.

Arguments:
  DIR                   One or more directories to scan for PHP files.

Options:
  -o, --output PATH     Output JSON file path
                        (default: ./storage/<dir-names>.json, relative to the
                        current working directory; override with the
                        HOOKSGRAPH_STORAGE env var).
  --overlap-only        Only output hooks present in 2+ scanned directories.
                        Useful for finding shared integration points between
                        a core codebase and plugins.
  --exclude a,b,c       Comma-separated list of patterns to exclude (in
                        addition to .gitignore). A simple pattern (no `/`)
                        matches if it is an exact path segment OR a substring
                        of the filename — so `tests` excludes any `tests/`
                        directory AND files like `tests-helper.php`, and
                        `test` excludes `xyz-test.php`. A nested pattern like
                        `packages/e2e-tests` only matches that exact sub-path.
  --print-path          Print only the absolute path to the written JSON on
                        stdout; route the pretty UI output to stderr. Used
                        by the `hooksgraph` launcher to capture the path.
  -h, --help            Show this help message.

Examples:
  php hooksgraph.php ~/Code/wordpress
  php hooksgraph.php ~/Code/wordpress ~/Code/my-plugin --overlap-only
  php hooksgraph.php ~/Code/wordpress --exclude vendor,tests,node_modules
  php hooksgraph.php ~/Code/wordpress -o storage/wp-core.json

Supported hook functions:
  do_action, do_action_ref_array          fires an action hook
  apply_filters, apply_filters_ref_array  fires a filter hook
  add_action                              listens to an action hook
  add_filter                              listens to a filter hook

Output format:
  The output JSON contains three top-level keys:

    nodes     Hook nodes (name, type, fire/listen counts, sources)
              and file nodes (path, source label).
    edges     Connections between files and hooks (type, line, callback).
    metadata  Scan summary (dirs, file count, hook count, timestamp).

Viewing results:
  bin/hooksgraph DIR              parse + serve + open the viewer in one step
  npm run serve -- PATH.json      serve the viewer against an already-parsed JSON
                                  (omit the path to use the most recent in storage/)

HELP;

    public static function text(): string
    {
        $invokedAs = getenv('HOOKSGRAPH_INVOKED_AS');
        if ($invokedAs === false || $invokedAs === '') {
            return self::TEMPLATE;
        }

        $replacements = [
            'Usage: php hooksgraph.php'        => "Usage: $invokedAs",
            'php hooksgraph.php '              => "$invokedAs ",
            'bin/hooksgraph DIR              ' => 'hooksgraph <dir>                ',
            'npm run serve -- PATH.json'       => 'hooksgraph serve PATH.json',
        ];
        return strtr(self::TEMPLATE, $replacements);
    }
}
