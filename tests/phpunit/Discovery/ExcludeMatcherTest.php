<?php

declare(strict_types=1);

namespace HooksGraph\Tests\Discovery;

use HooksGraph\Discovery\ExcludeMatcher;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\TestCase;

#[CoversClass(ExcludeMatcher::class)]
final class ExcludeMatcherTest extends TestCase
{
    public function test_empty_list_never_matches(): void
    {
        $this->assertFalse(ExcludeMatcher::matches('foo/tests/bar.php', []));
    }

    public function test_folder_name_matches_nested_dir(): void
    {
        $this->assertTrue(ExcludeMatcher::matches('foo/tests/bar.php', ['tests']));
    }

    public function test_folder_name_matches_top_level_dir(): void
    {
        $this->assertTrue(ExcludeMatcher::matches('tests/bar.php', ['tests']));
    }

    public function test_simple_pattern_matches_filename_substring(): void
    {
        $this->assertTrue(ExcludeMatcher::matches('tests-helper.php', ['tests']));
        $this->assertTrue(ExcludeMatcher::matches('xyz-test.php',     ['test']));
        $this->assertTrue(ExcludeMatcher::matches('src/foo-test.php', ['test']));
    }

    public function test_simple_pattern_does_not_match_mid_path_folder_substring(): void
    {
        $this->assertFalse(ExcludeMatcher::matches('my-tests/bar.php',    ['tests']));
        $this->assertFalse(ExcludeMatcher::matches('tests-suite/bar.php', ['tests']));
    }

    public function test_nested_path_pattern_matches_exact_sub_path(): void
    {
        $this->assertTrue(ExcludeMatcher::matches('packages/e2e-tests/foo.php',     ['packages/e2e-tests']));
        $this->assertTrue(ExcludeMatcher::matches('a/b/packages/e2e-tests/foo.php', ['packages/e2e-tests']));
    }

    public function test_nested_path_pattern_rejects_sibling_with_shared_prefix(): void
    {
        $this->assertFalse(ExcludeMatcher::matches('packages/e2e-tests-utils/foo.php', ['packages/e2e-tests']));
    }

    public function test_multiple_patterns_any_match_wins(): void
    {
        $excludes = ['vendor', 'packages/e2e-tests'];
        $this->assertTrue(ExcludeMatcher::matches('x/vendor/y.php',           $excludes));
        $this->assertTrue(ExcludeMatcher::matches('packages/e2e-tests/y.php', $excludes));
        $this->assertFalse(ExcludeMatcher::matches('packages/other/y.php',    $excludes));
    }

    public function test_leading_trailing_slashes_in_pattern_are_ignored(): void
    {
        $this->assertTrue(ExcludeMatcher::matches('foo/tests/bar.php',        ['/tests/']));
        $this->assertTrue(ExcludeMatcher::matches('packages/e2e-tests/x.php', ['/packages/e2e-tests/']));
    }

    public function test_empty_pattern_is_a_noop(): void
    {
        $this->assertFalse(ExcludeMatcher::matches('tests/bar.php', ['']));
    }

    public function test_backslash_separated_rel_paths_are_normalized(): void
    {
        $this->assertTrue(ExcludeMatcher::matches('foo\\tests\\bar.php',            ['tests']));
        $this->assertTrue(ExcludeMatcher::matches('a\\packages\\e2e-tests\\x.php',  ['packages/e2e-tests']));
    }

    public function test_patterns_with_dashes_and_dots_match_literally(): void
    {
        $this->assertTrue(ExcludeMatcher::matches('src/foo-test.php',  ['-test']));
        $this->assertTrue(ExcludeMatcher::matches('src/foo.test.php', ['.test']));
        $this->assertFalse(ExcludeMatcher::matches('src/test.php',    ['-test']));
        $this->assertFalse(ExcludeMatcher::matches('src/test.php',    ['.test']));
    }
}
