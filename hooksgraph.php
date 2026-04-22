#!/usr/bin/env php
<?php
/**
 * WordPress Hooks Graph — PHP CLI entry point.
 *
 * Scans one or more directories for PHP files, extracts WordPress hook calls
 * (do_action, add_action, apply_filters, add_filter), and writes a JSON graph
 * of hook relationships.
 */

declare(strict_types=1);

$autoload = __DIR__ . '/vendor/autoload.php';
if (!file_exists($autoload)) {
    fwrite(STDERR, "Missing dependencies. Run: composer install\n");
    exit(1);
}
require $autoload;

if (PHP_SAPI === 'cli' && !defined('HOOKS_GRAPH_TESTING')) {
    exit((new \HooksGraph\Cli\Runner())->run($argv));
}
