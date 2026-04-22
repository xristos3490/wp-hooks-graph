<?php

declare(strict_types=1);

namespace HooksGraph\Parser;

/**
 * Pure helpers for working with token_get_all() output.
 */
final class Tokens
{
    public static function stripQuotes(string $str): string
    {
        if (strlen($str) < 2) {
            return $str;
        }
        $f = $str[0];
        $l = $str[strlen($str) - 1];
        if (($f === "'" && $l === "'") || ($f === '"' && $l === '"')) {
            return substr($str, 1, -1);
        }
        return $str;
    }

    public static function reconstruct(array $tokens): string
    {
        $out = '';
        foreach ($tokens as $t) {
            $out .= is_array($t) ? $t[1] : $t;
        }
        return $out;
    }

    public static function stripWhitespace(array $tokens): array
    {
        return array_values(array_filter($tokens, static function ($t) {
            return !(is_array($t) && $t[0] === T_WHITESPACE);
        }));
    }

    /**
     * Extract tokens between a matched pair of parentheses.
     *
     * $pos must point to the opening '('. On return $pos points to the closing ')'.
     */
    public static function between(array &$all, int &$pos): array
    {
        $depth  = 1;
        $pos++;
        $result = [];
        $count  = count($all);
        while ($pos < $count && $depth > 0) {
            $t    = $all[$pos];
            $char = is_string($t) ? $t : null;
            if ($char === '(') {
                $depth++;
            }
            if ($char === ')') {
                $depth--;
                if ($depth === 0) {
                    break;
                }
            }
            $result[] = $t;
            $pos++;
        }
        return $result;
    }

    /**
     * Split a flat token list by top-level commas (respecting (), [], {} nesting).
     *
     * Tracks double-quoted and heredoc/nowdoc string context so braces and commas
     * that appear inside string literals don't affect nesting depth — e.g. the
     * closing '}' of "{$var}" is a plain string char and would otherwise push
     * depth negative and swallow the following argument separator.
     */
    public static function splitArgs(array $tokens): array
    {
        $args    = [];
        $current = [];
        $depth   = 0;
        $inDq    = false;
        $inHere  = false;
        foreach ($tokens as $t) {
            if (is_array($t)) {
                if ($t[0] === T_START_HEREDOC) {
                    $inHere = true;
                } elseif ($t[0] === T_END_HEREDOC) {
                    $inHere = false;
                }
                $current[] = $t;
                continue;
            }
            if ($t === '"' && !$inHere) {
                $inDq      = !$inDq;
                $current[] = $t;
                continue;
            }
            if (!$inDq && !$inHere) {
                if ($t === '(' || $t === '[' || $t === '{') {
                    $depth++;
                } elseif ($t === ')' || $t === ']' || $t === '}') {
                    $depth--;
                }
                if ($t === ',' && $depth === 0) {
                    $args[]  = $current;
                    $current = [];
                    continue;
                }
            }
            $current[] = $t;
        }
        if (!empty($current)) {
            $args[] = $current;
        }
        return $args;
    }

    /**
     * Split a token list on top-level '.' concatenation operators.
     *
     * Tracks double-quoted and heredoc string context so '.' inside
     * "..." or <<<EOT ... EOT is treated as literal content, not concat.
     */
    public static function splitConcat(array $tokens): array
    {
        $parts   = [];
        $current = [];
        $depth   = 0;
        $inDq    = false;
        $inHere  = false;
        foreach ($tokens as $t) {
            if (is_array($t)) {
                if ($t[0] === T_START_HEREDOC) {
                    $inHere = true;
                } elseif ($t[0] === T_END_HEREDOC) {
                    $inHere = false;
                }
                $current[] = $t;
                continue;
            }
            if ($t === '"' && !$inHere) {
                $inDq      = !$inDq;
                $current[] = $t;
                continue;
            }
            if (!$inDq && !$inHere) {
                if ($depth === 0 && $t === '.') {
                    if (!empty($current)) {
                        $parts[] = $current;
                    }
                    $current = [];
                    continue;
                }
                if ($t === '(' || $t === '[') {
                    $depth++;
                } elseif ($t === ')' || $t === ']') {
                    $depth--;
                }
            }
            $current[] = $t;
        }
        if (!empty($current)) {
            $parts[] = $current;
        }
        return $parts;
    }
}
