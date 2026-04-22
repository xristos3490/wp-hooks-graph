<?php

declare(strict_types=1);

namespace HooksGraph\Discovery;

/**
 * Matches a relative path against a user-supplied exclude-pattern list.
 *
 * A simple pattern (no `/`) matches when it's an exact path segment OR a
 * substring of the basename — so "tests" matches `foo/tests/bar.php` AND
 * `tests-helper.php`, and "test" matches `xyz-test.php`.
 *
 * A path pattern (contains `/`, e.g. "packages/e2e-tests") matches only as an
 * exact sub-path — `packages/e2e-tests/foo.php` matches but
 * `packages/e2e-tests-utils/foo.php` does not.
 */
final class ExcludeMatcher
{
    /**
     * @param list<string> $patterns
     */
    public static function matches(string $rel, array $patterns): bool
    {
        if (empty($patterns)) {
            return false;
        }
        $relFwd   = trim(str_replace('\\', '/', $rel), '/');
        $norm     = '/' . $relFwd . '/';
        $basename = basename($relFwd);
        foreach ($patterns as $pat) {
            $p = trim(str_replace('\\', '/', $pat), '/');
            if ($p === '') {
                continue;
            }
            if (strpos($norm, '/' . $p . '/') !== false) {
                return true;
            }
            if (strpos($p, '/') === false && $basename !== '' && strpos($basename, $p) !== false) {
                return true;
            }
        }
        return false;
    }
}
