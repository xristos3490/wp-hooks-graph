<?php
/**
 * Tests for path_matches_excludes() in hooks_graph.php.
 */

test('exclude: empty list never matches', function () {
    assert_false(path_matches_excludes('foo/tests/bar.php', []));
});

test('exclude: single folder name matches nested dir', function () {
    assert_true(path_matches_excludes('foo/tests/bar.php', ['tests']));
});

test('exclude: single folder name matches top-level dir', function () {
    assert_true(path_matches_excludes('tests/bar.php', ['tests']));
});

test('exclude: partial folder name does NOT match', function () {
    assert_false(path_matches_excludes('tests-helper.php', ['tests']));
    assert_false(path_matches_excludes('my-tests/bar.php', ['tests']));
    assert_false(path_matches_excludes('tests-suite/bar.php', ['tests']));
});

test('exclude: nested path pattern matches exact sub-path', function () {
    assert_true(path_matches_excludes('packages/e2e-tests/foo.php', ['packages/e2e-tests']));
    assert_true(path_matches_excludes('a/b/packages/e2e-tests/foo.php', ['packages/e2e-tests']));
});

test('exclude: nested path pattern rejects sibling with shared prefix', function () {
    assert_false(path_matches_excludes('packages/e2e-tests-utils/foo.php', ['packages/e2e-tests']));
});

test('exclude: multiple patterns — any match wins', function () {
    $excludes = ['vendor', 'packages/e2e-tests'];
    assert_true(path_matches_excludes('x/vendor/y.php',               $excludes));
    assert_true(path_matches_excludes('packages/e2e-tests/y.php',     $excludes));
    assert_false(path_matches_excludes('packages/other/y.php',        $excludes));
});

test('exclude: leading/trailing slashes in pattern are ignored', function () {
    assert_true(path_matches_excludes('foo/tests/bar.php', ['/tests/']));
    assert_true(path_matches_excludes('packages/e2e-tests/x.php', ['/packages/e2e-tests/']));
});

test('exclude: empty-string pattern is a no-op', function () {
    assert_false(path_matches_excludes('tests/bar.php', ['']));
});

test('exclude: backslash-separated rel paths are normalized', function () {
    assert_true(path_matches_excludes('foo\\tests\\bar.php', ['tests']));
    assert_true(path_matches_excludes('a\\packages\\e2e-tests\\x.php', ['packages/e2e-tests']));
});
