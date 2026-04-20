<?php
/**
 * Zero-dependency PHP test runner for hooks_graph.php.
 *
 * Usage: php tests/run.php
 *
 * Test files are any tests/test_*.php discovered at runtime. Each file calls
 * `test('name', fn)` to register cases; the runner executes them and reports.
 */

define('HOOKS_GRAPH_TESTING', true);
require_once __DIR__ . '/../hooks_graph.php';

$GLOBALS['_tests'] = [];

// ── Assertion helpers ───────────────────────────────────────

class AssertionFailed extends Exception {}

function test($name, $fn) {
    $GLOBALS['_tests'][] = ['name' => $name, 'fn' => $fn];
}

function _dump($v) {
    return is_string($v) ? "'" . $v . "'" : var_export($v, true);
}

function assert_eq($expected, $actual, $msg = '') {
    if ($expected === $actual) return;
    $e = _dump($expected);
    $a = _dump($actual);
    throw new AssertionFailed(
        "assert_eq failed" . ($msg ? " ($msg)" : '') . "\n      expected: $e\n      actual:   $a"
    );
}

function assert_null($v, $msg = '') {
    if ($v === null) return;
    throw new AssertionFailed(
        "assert_null failed" . ($msg ? " ($msg)" : '') . ": got " . _dump($v)
    );
}

function assert_true($cond, $msg = '') {
    if ($cond === true) return;
    throw new AssertionFailed(
        "assert_true failed" . ($msg ? " ($msg)" : '') . ": got " . _dump($cond)
    );
}

function assert_false($cond, $msg = '') {
    if ($cond === false) return;
    throw new AssertionFailed(
        "assert_false failed" . ($msg ? " ($msg)" : '') . ": got " . _dump($cond)
    );
}

function assert_count($n, $arr, $msg = '') {
    $actual = is_countable($arr) ? count($arr) : -1;
    if ($actual === $n) return;
    throw new AssertionFailed(
        "assert_count failed" . ($msg ? " ($msg)" : '') . ": expected $n, got $actual"
    );
}

function assert_contains($needle, $haystack, $msg = '') {
    if (is_array($haystack) && in_array($needle, $haystack, true)) return;
    if (is_string($haystack) && strpos($haystack, $needle) !== false) return;
    throw new AssertionFailed(
        "assert_contains failed" . ($msg ? " ($msg)" : '') . ": " . _dump($needle)
            . " not in " . _dump($haystack)
    );
}

// ── Parse helper ────────────────────────────────────────────

/**
 * Write $code to a temp file and run the parser against it.
 * Returns the list of hook calls.
 */
function parse_source($code, $source_label = 'test') {
    $path = tempnam(sys_get_temp_dir(), 'hg_test_');
    file_put_contents($path, $code);
    try {
        return parse_php_file($path, $source_label);
    } finally {
        @unlink($path);
    }
}

// ── Load test files ─────────────────────────────────────────

foreach (glob(__DIR__ . '/test_*.php') as $file) {
    require_once $file;
}

// ── Run ─────────────────────────────────────────────────────

$is_tty  = function_exists('posix_isatty') ? @posix_isatty(STDOUT) : false;
$green   = $is_tty ? "\033[32m" : '';
$red     = $is_tty ? "\033[31m" : '';
$dim     = $is_tty ? "\033[2m"  : '';
$reset   = $is_tty ? "\033[0m"  : '';

$passed = 0;
$failed = 0;
$start  = microtime(true);

foreach ($GLOBALS['_tests'] as $t) {
    try {
        ($t['fn'])();
        $passed++;
        echo "  {$green}PASS{$reset}  {$t['name']}\n";
    } catch (Throwable $e) {
        $failed++;
        echo "  {$red}FAIL{$reset}  {$t['name']}\n";
        echo "    " . str_replace("\n", "\n    ", $e->getMessage()) . "\n";
        if (!($e instanceof AssertionFailed)) {
            echo "    {$dim}at " . $e->getFile() . ":" . $e->getLine() . "{$reset}\n";
        }
    }
}

$elapsed = microtime(true) - $start;
$total   = $passed + $failed;

echo "\n";
if ($failed === 0) {
    echo "{$green}{$passed} passed{$reset}, 0 failed out of $total tests"
         . sprintf(" (%.2fs)", $elapsed) . "\n";
    exit(0);
}
echo "{$red}{$failed} failed{$reset}, $passed passed out of $total tests"
     . sprintf(" (%.2fs)", $elapsed) . "\n";
exit(1);
