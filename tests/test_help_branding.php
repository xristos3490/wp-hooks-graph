<?php
/**
 * Tests for help-text branding via HOOKSGRAPH_INVOKED_AS.
 *
 * The PHP parser's help text is the single source of truth for parser flags.
 * When invoked through the `hooksgraph parse` dispatcher, the env var is set
 * so the Usage / Examples / Viewing-results blocks rebrand; when unset, the
 * original `php hooks_graph.php` presentation is preserved.
 */

// ── Default (env unset): current PHP-centric presentation ──

test('help: unset env keeps php hooks_graph.php branding', function () {
    putenv('HOOKSGRAPH_INVOKED_AS');
    $help = build_help_text();
    assert_contains('Usage: php hooks_graph.php [options] DIR [DIR...]', $help);
    assert_contains('php hooks_graph.php ~/Code/wordpress', $help);
    assert_contains('bin/hooksgraph DIR', $help);
    assert_contains('npm run serve -- PATH.json', $help);
});

// ── Rebranded (env="hooksgraph parse") ──

test('help: env rewrites Usage line to hooksgraph parse', function () {
    putenv('HOOKSGRAPH_INVOKED_AS=hooksgraph parse');
    try {
        $help = build_help_text();
        assert_contains('Usage: hooksgraph parse [options] DIR [DIR...]', $help);
    } finally {
        putenv('HOOKSGRAPH_INVOKED_AS');
    }
});

test('help: env removes php hooks_graph.php references entirely', function () {
    putenv('HOOKSGRAPH_INVOKED_AS=hooksgraph parse');
    try {
        $help = build_help_text();
        assert_false(strpos($help, 'php hooks_graph.php') !== false,
            'expected no "php hooks_graph.php" references, got: ' . $help);
    } finally {
        putenv('HOOKSGRAPH_INVOKED_AS');
    }
});

test('help: env rewrites Examples block to hooksgraph parse', function () {
    putenv('HOOKSGRAPH_INVOKED_AS=hooksgraph parse');
    try {
        $help = build_help_text();
        assert_contains('hooksgraph parse ~/Code/wordpress', $help);
        assert_contains('hooksgraph parse ~/Code/wordpress ~/Code/my-plugin --overlap-only', $help);
    } finally {
        putenv('HOOKSGRAPH_INVOKED_AS');
    }
});

test('help: env rewrites Viewing results block to subcommand form', function () {
    putenv('HOOKSGRAPH_INVOKED_AS=hooksgraph parse');
    try {
        $help = build_help_text();
        assert_contains('hooksgraph <dir>', $help);
        assert_contains('hooksgraph serve PATH.json', $help);
        assert_false(strpos($help, 'bin/hooksgraph DIR') !== false,
            'expected no "bin/hooksgraph DIR" in rebranded help');
        assert_false(strpos($help, 'npm run serve') !== false,
            'expected no "npm run serve" in rebranded help');
    } finally {
        putenv('HOOKSGRAPH_INVOKED_AS');
    }
});
