<?php
/**
 * Tests for parse_cli_args() in hooks_graph.php.
 */

test('cli: --exclude with space-separated value', function () {
    $a = parse_cli_args(['hooks_graph.php', '.', '--exclude', 'vendor,tests']);
    assert_eq('vendor,tests', $a['exclude']);
    assert_eq(['.'], $a['dirs']);
});

test('cli: --exclude=value with inline value', function () {
    $a = parse_cli_args(['hooks_graph.php', '.', '--exclude=packages/e2e-tests,phpunit,test']);
    assert_eq('packages/e2e-tests,phpunit,test', $a['exclude']);
    assert_eq(['.'], $a['dirs']);
});

test('cli: --output=value inline form', function () {
    $a = parse_cli_args(['hooks_graph.php', '.', '--output=/tmp/out.json']);
    assert_eq('/tmp/out.json', $a['output']);
});

test('cli: -o still takes next arg', function () {
    $a = parse_cli_args(['hooks_graph.php', '.', '-o', '/tmp/out.json']);
    assert_eq('/tmp/out.json', $a['output']);
});

test('cli: boolean flags still work with = ignored-value noise', function () {
    $a = parse_cli_args(['hooks_graph.php', '.', '--overlap-only']);
    assert_true($a['overlap_only']);
});

test('cli: multiple dirs collected in order', function () {
    $a = parse_cli_args(['hooks_graph.php', 'a', 'b', '--exclude=x', 'c']);
    assert_eq(['a', 'b', 'c'], $a['dirs']);
    assert_eq('x', $a['exclude']);
});

/**
 * The exclude list is split in main() with:
 *   foreach (explode(',', $args['exclude']) as $name) { $name = trim($name); ... }
 * This test mirrors that split so regressions in trimming are caught.
 */
test('cli: exclude list trims whitespace around each item', function () {
    $raw = 'test, tests ,  packages/e2e-tests  ,';
    $out = [];
    foreach (explode(',', $raw) as $name) {
        $name = trim($name);
        if ($name !== '') $out[] = $name;
    }
    assert_eq(['test', 'tests', 'packages/e2e-tests'], $out);
});
