<?php

declare(strict_types=1);

namespace HooksGraph\Parser;

/**
 * Extracts the comment immediately preceding a hook call, if any.
 */
final class DocCommentExtractor
{
    /**
     * Walk backwards from the hook position through whitespace; return the cleaned text
     * of a doc- or line-comment that ends on the line immediately before the hook call.
     */
    public static function find(array $allTokens, int $hookPos): ?string
    {
        $hookLine = is_array($allTokens[$hookPos]) ? $allTokens[$hookPos][2] : null;
        if ($hookLine === null) {
            return null;
        }

        for ($i = $hookPos - 1; $i >= 0; $i--) {
            $t = $allTokens[$i];
            if (!is_array($t)) {
                continue;
            }
            if ($t[0] === T_WHITESPACE) {
                continue;
            }
            if ($t[0] === T_COMMENT || $t[0] === T_DOC_COMMENT) {
                $start = $t[2];
                $lines = substr_count($t[1], "\n");
                $end   = $start + $lines;
                if ($hookLine - $end === 1) {
                    return self::clean($t[1]);
                }
            }
            break;
        }
        return null;
    }

    private static function clean(string $raw): string
    {
        if (strpos($raw, '//') === 0) {
            return trim(substr($raw, 2));
        }
        if (strpos($raw, '/*') === 0 && substr($raw, -2) === '*/') {
            $inner   = trim(substr($raw, 2, -2));
            $lines   = explode("\n", $inner);
            $cleaned = [];
            foreach ($lines as $line) {
                $line = trim($line);
                if (isset($line[0]) && $line[0] === '*') {
                    $line = trim(substr($line, 1));
                }
                $cleaned[] = $line;
            }
            return trim(implode("\n", $cleaned));
        }
        return trim($raw);
    }
}
