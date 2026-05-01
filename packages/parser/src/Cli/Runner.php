<?php

declare(strict_types=1);

namespace HooksGraph\Cli;

use HooksGraph\Discovery\PhpFileFinder;
use HooksGraph\Graph\Builder;
use HooksGraph\Graph\OverlapFilter;
use HooksGraph\Parser\FileParser;
use Throwable;

/**
 * Orchestrates a CLI parse run: argument parsing, file discovery, parsing, graph
 * building, summary rendering, and writing the output JSON.
 */
final class Runner
{
    private string $storageDir;

    public function __construct(?string $storageDir = null)
    {
        $this->storageDir = $storageDir ?? self::defaultStorageDir();
    }

    /**
     * The Node CLI shim sets HOOKSGRAPH_OUTPUT_DIR per subcommand
     * (`parsed/` for `parse`, `codebases/` for `parse-codebase`). Keeping the
     * routing decision in Node means this layer stays subcommand-agnostic.
     * The cwd-relative fallback is a safety net for direct `php hooksgraph.php`
     * invocations without the shim.
     */
    private static function defaultStorageDir(): string
    {
        $env = getenv('HOOKSGRAPH_OUTPUT_DIR');
        if (is_string($env) && $env !== '') {
            return $env;
        }
        $cwd = getcwd();
        return ($cwd !== false ? $cwd : '.') . '/storage';
    }

    /**
     * @param list<string> $argv
     */
    public function run(array $argv): int
    {
        $args = Arguments::parse($argv);

        if ($args['help']) {
            echo Help::text();
            return 0;
        }

        if (empty($args['dirs'])) {
            fwrite(STDERR, "Error: at least one directory is required. Use -h for help.\n");
            return 1;
        }

        // In --print-path mode the pretty UI must go to stderr so stdout carries
        // only the final output path; all echo/printf is redirected to STDERR.
        if ($args['print_path']) {
            ob_start(static function (string $buffer) {
                fwrite(STDERR, $buffer);
                return '';
            });
        }

        $console = new Console($args['print_path'] ? STDERR : STDOUT);

        $excludeDirs = Arguments::splitList($args['exclude']);

        $dirs = [];
        foreach ($args['dirs'] as $d) {
            if (strpos($d, '~') === 0) {
                $d = getenv('HOME') . substr($d, 1);
            }
            $dirs[] = realpath($d) ?: $d;
        }

        $output = $args['output'];
        if ($output === null) {
            $names    = array_map(static fn ($d) => basename(rtrim($d, DIRECTORY_SEPARATOR)), $dirs);
            $filename = implode('-', $names) . '.json';
            $output   = rtrim($this->storageDir, DIRECTORY_SEPARATOR) . "/{$filename}";
        }

        foreach ($dirs as $d) {
            if (!is_dir($d)) {
                fwrite(STDERR, "Error: $d is not a directory\n");
                return 1;
            }
        }

        if (!empty($excludeDirs)) {
            echo 'Excluding folders: ' . $console->style(implode(', ', $excludeDirs), Console::YELLOW) . "\n";
        }
        echo $console->style('Scanning for PHP files...', Console::BOLD) . "\n";

        $allFiles = [];
        foreach ($dirs as $d) {
            $files = PhpFileFinder::find($d, $excludeDirs);
            $label = basename(rtrim($d, DIRECTORY_SEPARATOR));
            foreach ($files as $f) {
                $allFiles[] = ['file' => $f, 'dir' => $d, 'label' => $label];
            }
            echo '  ' . $console->style($label, Console::BOLD)
                . ' ' . $console->style("\xe2\x94\x80", Console::DIM)
                . ' ' . $console->style(count($files) . ' files', Console::DIM) . "\n";
        }

        $total = count($allFiles);
        if ($total === 0) {
            echo "No PHP files found.\n";
            return 0;
        }

        echo "\n" . $console->style("Parsing $total files...", Console::BOLD) . "\n";
        $start = microtime(true);

        $allCalls = [];
        $errors   = 0;

        foreach ($allFiles as $idx => $entry) {
            $i       = $idx + 1;
            $elapsed = microtime(true) - $start;
            $rate    = $elapsed > 0 ? $i / $elapsed : 0;
            if ($i % 50 === 0 || $i === $total) {
                $console->progressBar($i, $total, $rate);
            }
            try {
                $calls    = FileParser::parse($entry['file'], $entry['label']);
                $allCalls = array_merge($allCalls, $calls);
            } catch (Throwable $e) {
                $errors++;
                fwrite(STDERR, "\n  " . $console->style('Warning:', Console::YELLOW)
                    . " failed to parse {$entry['file']}: {$e->getMessage()}\n");
            }
        }

        $elapsed = microtime(true) - $start;
        echo str_repeat(' ', 60) . "\r";
        echo '  ' . $console->style(sprintf('Parsed %d files in %.1fs', $total, $elapsed), Console::GREEN) . "\n";

        echo "\n" . $console->style('Building graph...', Console::BOLD) . "\n";
        $graph = (new Builder())->build($allCalls, $dirs, $total);

        if ($args['overlap_only']) {
            $graph = OverlapFilter::apply($graph);
            echo "  Filtered to hooks shared across 2+ repos\n";
        }

        $outputDir = dirname($output);
        if (!is_dir($outputDir)) {
            mkdir($outputDir, 0755, true);
            fwrite(STDERR, "Created output directory: {$outputDir}\n");
        }
        file_put_contents($output, json_encode($graph, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        $this->renderSummary($console, $graph, $output, $errors);

        if ($args['print_path']) {
            ob_end_flush();
            $abs = realpath($output);
            echo ($abs !== false ? $abs : $output) . "\n";
        }

        return 0;
    }

    private function renderSummary(Console $console, array $graph, string $output, int $errors): void
    {
        $meta        = $graph['metadata'];
        $hookNodes   = array_filter($graph['nodes'], static fn ($n) => $n['type'] === 'hook');
        $fileNodes   = array_filter($graph['nodes'], static fn ($n) => $n['type'] === 'file');
        $actionHooks = array_filter($hookNodes, static fn ($n) => $n['hook_type'] === 'action');
        $filterHooks = array_filter($hookNodes, static fn ($n) => $n['hook_type'] === 'filter');

        $hotspots = array_values($hookNodes);
        usort($hotspots, static fn ($a, $b) => ($b['fire_count'] + $b['listen_count']) - ($a['fire_count'] + $a['listen_count']));
        $hotspots = array_slice($hotspots, 0, 5);

        $console->section('Scan');
        $console->row('Files scanned', $meta['total_files']);
        $console->row('Files with hooks', count($fileNodes));
        if ($errors) {
            echo $console->style('  Parse errors    ', Console::DIM)
                . $console->style(sprintf('%5d', $errors), Console::BOLD, Console::YELLOW) . "\n";
        }

        $sep = $console->style("\xe2\x94\x82", Console::DIM);
        $console->section('Hooks');
        $extras = "$sep  Actions " . $console->style((string) count($actionHooks), Console::BOLD)
            . "  $sep  Filters " . $console->style((string) count($filterHooks), Console::BOLD);
        $console->row('Total hooks',   $meta['total_hooks'], $extras);
        $console->row('Dynamic hooks', $meta['dynamic_hooks']);
        $console->row('Total edges',   count($graph['edges']));
        if (!empty($meta['overlap_filter'])) {
            $console->row('Overlap filter',   'on');
            $console->row('Pre-filter hooks', $meta['pre_filter_total_hooks']);
        }

        if (!empty($hotspots)) {
            $console->section('Top Hooks');
            foreach ($hotspots as $h) {
                $conn = $h['fire_count'] + $h['listen_count'];
                $name = $h['name'];
                if (strlen($name) > 32) {
                    $name = substr($name, 0, 30) . '..';
                }
                $fires   = $console->style("{$h['fire_count']} fires", Console::DIM);
                $listens = $console->style("{$h['listen_count']} listens", Console::DIM);
                printf("  %-34s%s  %s  %s  %s\n",
                    $name,
                    $console->style(sprintf('%4d', $conn), Console::BOLD),
                    $sep,
                    $fires,
                    $listens
                );
            }
        }

        $console->section('Output');
        echo '  ' . $console->style($output, Console::CYAN) . "\n";
    }
}
