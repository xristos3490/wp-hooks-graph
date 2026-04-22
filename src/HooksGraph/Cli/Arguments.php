<?php

declare(strict_types=1);

namespace HooksGraph\Cli;

/**
 * Parses the CLI argv for the hooks-graph parser.
 *
 * Long options accept both `--flag value` and `--flag=value` forms.
 */
final class Arguments
{
    /**
     * @param list<string> $argv
     * @return array{dirs: list<string>, output: ?string, overlap_only: bool, exclude: string, print_path: bool, help: bool}
     */
    public static function parse(array $argv): array
    {
        $args = [
            'dirs'         => [],
            'output'       => null,
            'overlap_only' => false,
            'exclude'      => '',
            'print_path'   => false,
            'help'         => false,
        ];
        $n = count($argv);
        for ($i = 1; $i < $n; $i++) {
            $tok    = $argv[$i];
            $inline = null;
            if (strlen($tok) > 2 && substr($tok, 0, 2) === '--' && ($eq = strpos($tok, '=')) !== false) {
                $inline = substr($tok, $eq + 1);
                $tok    = substr($tok, 0, $eq);
            }
            $takeValue = static function () use (&$i, $argv, $n, $inline): ?string {
                if ($inline !== null) {
                    return $inline;
                }
                if ($i + 1 < $n) {
                    return $argv[++$i];
                }
                return null;
            };
            switch ($tok) {
                case '-o':
                case '--output':
                    $v = $takeValue();
                    if ($v !== null) {
                        $args['output'] = $v;
                    }
                    break;
                case '--overlap-only':
                    $args['overlap_only'] = true;
                    break;
                case '--exclude':
                    $v = $takeValue();
                    if ($v !== null) {
                        $args['exclude'] = $v;
                    }
                    break;
                case '--print-path':
                    $args['print_path'] = true;
                    break;
                case '-h':
                case '--help':
                    $args['help'] = true;
                    break;
                default:
                    if ($tok[0] !== '-') {
                        $args['dirs'][] = $tok;
                    }
                    break;
            }
        }
        return $args;
    }

    /**
     * Split a comma-separated list and trim each value; blank entries are dropped.
     *
     * @return list<string>
     */
    public static function splitList(string $raw): array
    {
        if ($raw === '') {
            return [];
        }
        $out = [];
        foreach (explode(',', $raw) as $name) {
            $name = trim($name);
            if ($name !== '') {
                $out[] = $name;
            }
        }
        return $out;
    }
}
