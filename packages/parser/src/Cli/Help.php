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
                        (default: %DEFAULT_DIR%/<dir-names>.json).
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

Environment:
  HOOKSGRAPH_PARSED_DIR     Override the dir used by `hooksgraph parse` and
                            the default `hooksgraph <dir>` shortcut
                            (defaults to ~/.hooksgraph/parsed/).
  HOOKSGRAPH_CODEBASES_DIR  Override the dir used by `hooksgraph
                            parse-codebase` and read by the MCP server
                            (defaults to ~/.hooksgraph/codebases/).

Examples:
  php hooksgraph.php ~/Code/wordpress
  php hooksgraph.php ~/Code/wordpress ~/Code/my-plugin --overlap-only
  php hooksgraph.php ~/Code/wordpress --exclude vendor,tests,node_modules
  php hooksgraph.php ~/Code/wordpress -o %DEFAULT_DIR%/wp-core.json

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
                                  (omit the path to use the most recent in
                                  ~/.hooksgraph/parsed/)

HELP;

    public static function text(): string
    {
        $defaultDir = self::resolveDefaultDir();
        $template   = strtr(self::TEMPLATE, ['%DEFAULT_DIR%' => $defaultDir]);

        $invokedAs = getenv('HOOKSGRAPH_INVOKED_AS');
        if ($invokedAs === false || $invokedAs === '') {
            return $template;
        }

        $replacements = [
            'Usage: php hooksgraph.php'        => "Usage: $invokedAs",
            'php hooksgraph.php '              => "$invokedAs ",
            'bin/hooksgraph DIR              ' => 'hooksgraph <dir>                ',
            'npm run serve -- PATH.json'       => 'hooksgraph serve PATH.json',
        ];
        return strtr($template, $replacements);
    }

    private static function resolveDefaultDir(): string
    {
        $env = getenv('HOOKSGRAPH_OUTPUT_DIR');
        if (is_string($env) && $env !== '') {
            return $env;
        }
        return './storage';
    }
}
