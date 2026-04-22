<?php

declare(strict_types=1);

namespace HooksGraph\Parser;

/**
 * Extracts a hook's name from the first-argument token list of a hook function call.
 *
 * Dynamic names with a literal prefix/suffix are returned as a wildcard pattern
 * (e.g. "update_option_theme_mods_*"). Fully dynamic names yield a null name.
 */
final class HookNameExtractor
{
    /**
     * @return array{0: ?string, 1: bool, 2: ?string} [name, dynamic, rawExpression]
     */
    public static function extract(array $argTokens): array
    {
        $tokens = Tokens::stripWhitespace($argTokens);
        if (empty($tokens)) {
            return [null, true, null];
        }

        // Single string literal (single- or double-quoted, no interpolation).
        if (count($tokens) === 1 && is_array($tokens[0]) && $tokens[0][0] === T_CONSTANT_ENCAPSED_STRING) {
            return [Tokens::stripQuotes($tokens[0][1]), false, null];
        }

        $raw      = Tokens::reconstruct($tokens);
        $segments = Tokens::splitConcat($tokens);

        $nameParts  = [];
        $hasDynamic = false;

        foreach ($segments as $seg) {
            $seg = Tokens::stripWhitespace($seg);
            if (empty($seg)) {
                continue;
            }

            // Literal string segment.
            if (count($seg) === 1 && is_array($seg[0]) && $seg[0][0] === T_CONSTANT_ENCAPSED_STRING) {
                $nameParts[] = Tokens::stripQuotes($seg[0][1]);
                continue;
            }

            // Heredoc / nowdoc segment.
            if (is_array($seg[0]) && $seg[0][0] === T_START_HEREDOC) {
                $last = end($seg);
                if (is_array($last) && $last[0] === T_END_HEREDOC) {
                    [$sub, $subDyn] = self::extractInterpolatedParts($seg);
                    foreach ($sub as $p) {
                        $nameParts[] = $p;
                    }
                    $hasDynamic = $hasDynamic || $subDyn;
                    continue;
                }
            }

            // Double-quoted interpolated segment.
            if (is_string($seg[0]) && $seg[0] === '"'
                && is_string(end($seg)) && end($seg) === '"') {
                [$sub, $subDyn] = self::extractInterpolatedParts($seg);
                foreach ($sub as $p) {
                    $nameParts[] = $p;
                }
                $hasDynamic = $hasDynamic || $subDyn;
                continue;
            }

            // Variable, function call, constant, or other opaque expression.
            $nameParts[] = '*';
            $hasDynamic  = true;
        }

        // Hook names never span lines; trim stray whitespace (common in heredocs).
        $name = trim(self::collapseWildcards($nameParts));

        // No usable literal anchor → treat as fully dynamic.
        if ($name === '' || !preg_match('/[^*]/', $name)) {
            return [null, true, $raw];
        }

        return [$name, $hasDynamic, $hasDynamic ? $raw : null];
    }

    /**
     * Walk the tokens of a "..." string or heredoc/nowdoc and return
     * [nameParts, hasDynamic] where each dynamic interpolation is a '*'.
     *
     * @return array{0: array<string>, 1: bool}
     */
    private static function extractInterpolatedParts(array $tokens): array
    {
        $parts      = [];
        $hasDynamic = false;
        $depth      = 0;
        $addStar    = function () use (&$parts, &$hasDynamic) {
            $parts[]    = '*';
            $hasDynamic = true;
        };
        foreach ($tokens as $t) {
            if (is_array($t)) {
                $type = $t[0];
                if ($type === T_START_HEREDOC || $type === T_END_HEREDOC) {
                    continue;
                }
                if ($type === T_ENCAPSED_AND_WHITESPACE) {
                    if ($depth === 0) {
                        $parts[] = $t[1];
                    }
                    continue;
                }
                if ($type === T_CURLY_OPEN || $type === T_DOLLAR_OPEN_CURLY_BRACES) {
                    if ($depth === 0) {
                        $addStar();
                    }
                    $depth++;
                    continue;
                }
                if ($depth === 0) {
                    $addStar();
                }
                continue;
            }
            if ($t === '"') {
                continue;
            }
            if ($t === '{') {
                if ($depth === 0) {
                    $addStar();
                }
                $depth++;
                continue;
            }
            if ($t === '}') {
                if ($depth > 0) {
                    $depth--;
                }
                continue;
            }
            if ($depth === 0) {
                $addStar();
            }
        }
        return [$parts, $hasDynamic];
    }

    /**
     * Coalesce adjacent '*' markers and concatenate the parts into a name.
     */
    private static function collapseWildcards(array $parts): string
    {
        $out      = [];
        $lastStar = false;
        foreach ($parts as $p) {
            if ($p === '*') {
                if (!$lastStar) {
                    $out[]    = '*';
                    $lastStar = true;
                }
            } elseif ($p !== '') {
                $out[]    = $p;
                $lastStar = false;
            }
        }
        return implode('', $out);
    }
}
