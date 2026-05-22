<?php

declare(strict_types=1);

namespace HooksGraph\Parser;

/**
 * Extracts callback metadata from the second argument of an add_action / add_filter call.
 */
final class CallbackExtractor
{
    /**
     * @return array{callback: ?string, callback_type: ?string, callback_class: ?string, callback_method: ?string}
     */
    public static function extract(array $argTokens, ?string $scopeClass = null): array
    {
        $tokens = Tokens::stripWhitespace($argTokens);
        if (empty($tokens)) {
            return self::empty();
        }

        $first = $tokens[0];

        // String literal: "fn" or "Foo::bar".
        if (count($tokens) === 1 && is_array($first) && $first[0] === T_CONSTANT_ENCAPSED_STRING) {
            $val = Tokens::stripQuotes($first[1]);
            if (strpos($val, '::') !== false) {
                [$cls, $method] = explode('::', $val, 2);
                return [
                    'callback'        => $val,
                    'callback_type'   => 'static_method',
                    'callback_class'  => $cls,
                    'callback_method' => $method,
                ];
            }
            return [
                'callback'        => $val,
                'callback_type'   => 'function',
                'callback_class'  => null,
                'callback_method' => $val,
            ];
        }

        // array(...) or [...]
        if ((is_array($first) && $first[0] === T_ARRAY) || (is_string($first) && $first === '[')) {
            return self::extractArray($tokens, $scopeClass);
        }

        // Closure.
        if (is_array($first) && $first[0] === T_FUNCTION) {
            return [
                'callback'        => Tokens::reconstruct($tokens),
                'callback_type'   => 'closure',
                'callback_class'  => null,
                'callback_method' => null,
            ];
        }

        // Arrow function (PHP 7.4+).
        if (is_array($first) && defined('T_FN') && $first[0] === T_FN) {
            return [
                'callback'        => Tokens::reconstruct($tokens),
                'callback_type'   => 'closure',
                'callback_class'  => null,
                'callback_method' => null,
            ];
        }

        // Variable.
        if (is_array($first) && $first[0] === T_VARIABLE) {
            return [
                'callback'        => $first[1],
                'callback_type'   => 'variable',
                'callback_class'  => null,
                'callback_method' => null,
            ];
        }

        return [
            'callback'        => Tokens::reconstruct($tokens),
            'callback_type'   => null,
            'callback_class'  => null,
            'callback_method' => null,
        ];
    }

    /**
     * Extract callback from array/short-array syntax: [Class, 'method'] or [$this, 'method'].
     */
    private static function extractArray(array $tokens, ?string $scopeClass): array
    {
        $isLong = is_array($tokens[0]) && $tokens[0][0] === T_ARRAY;
        $open   = $isLong ? '(' : '[';
        $close  = $isLong ? ')' : ']';

        $inner = [];
        $depth = 0;
        $start = -1;
        for ($i = 0, $c = count($tokens); $i < $c; $i++) {
            $ch = is_string($tokens[$i]) ? $tokens[$i] : null;
            if ($ch === $open) {
                if ($depth === 0) {
                    $start = $i + 1;
                }
                $depth++;
            }
            if ($ch === $close) {
                $depth--;
                if ($depth === 0) {
                    $inner = array_slice($tokens, $start, $i - $start);
                    break;
                }
            }
        }

        $elements = Tokens::splitArgs($inner);
        if (count($elements) !== 2) {
            return [
                'callback'        => Tokens::reconstruct($tokens),
                'callback_type'   => null,
                'callback_class'  => null,
                'callback_method' => null,
            ];
        }

        $firstEl  = Tokens::stripWhitespace($elements[0]);
        $secondEl = Tokens::stripWhitespace($elements[1]);

        $method = null;
        if (!empty($secondEl) && is_array($secondEl[0]) && $secondEl[0][0] === T_CONSTANT_ENCAPSED_STRING) {
            $method = Tokens::stripQuotes($secondEl[0][1]);
        }
        if ($method === null) {
            return [
                'callback'        => Tokens::reconstruct($tokens),
                'callback_type'   => null,
                'callback_class'  => null,
                'callback_method' => null,
            ];
        }

        if (empty($firstEl)) {
            return [
                'callback'        => "::$method",
                'callback_type'   => null,
                'callback_class'  => null,
                'callback_method' => $method,
            ];
        }

        $first = $firstEl[0];

        // $this.
        if (is_array($first) && $first[0] === T_VARIABLE && $first[1] === '$this') {
            $cls = $scopeClass ?: '$this';
            return [
                'callback'        => "$cls::$method",
                'callback_type'   => 'method',
                'callback_class'  => $scopeClass,
                'callback_method' => $method,
            ];
        }

        // self::class / static::class / ClassName::class
        $hasDcolon = false;
        $hasClass  = false;
        foreach ($firstEl as $t) {
            if (is_array($t) && $t[0] === T_DOUBLE_COLON) {
                $hasDcolon = true;
            }
            if (is_array($t) && $t[0] === T_CLASS) {
                $hasClass = true;
            }
        }
        if ($hasDcolon && $hasClass) {
            $firstText = is_array($first) ? $first[1] : $first;
            if (in_array($firstText, ['self', 'static', 'parent'], true)) {
                $cls = $scopeClass ?: $firstText;
                return [
                    'callback'        => "$cls::$method",
                    'callback_type'   => 'static_method',
                    'callback_class'  => $scopeClass,
                    'callback_method' => $method,
                ];
            }
            return [
                'callback'        => "$firstText::$method",
                'callback_type'   => 'static_method',
                'callback_class'  => $firstText,
                'callback_method' => $method,
            ];
        }

        // String class name: 'ClassName'
        if (is_array($first) && $first[0] === T_CONSTANT_ENCAPSED_STRING) {
            $cls = Tokens::stripQuotes($first[1]);
            return [
                'callback'        => "$cls::$method",
                'callback_type'   => 'static_method',
                'callback_class'  => $cls,
                'callback_method' => $method,
            ];
        }

        // __CLASS__ magic constant — resolves at compile time to the enclosing class.
        if (is_array($first) && $first[0] === T_CLASS_C) {
            $cls = $scopeClass ?: '__CLASS__';
            return [
                'callback'        => "$cls::$method",
                'callback_type'   => 'static_method',
                'callback_class'  => $scopeClass,
                'callback_method' => $method,
            ];
        }

        $raw = Tokens::reconstruct($firstEl);
        return [
            'callback'        => "$raw::$method",
            'callback_type'   => null,
            'callback_class'  => null,
            'callback_method' => $method,
        ];
    }

    private static function empty(): array
    {
        return [
            'callback'        => null,
            'callback_type'   => null,
            'callback_class'  => null,
            'callback_method' => null,
        ];
    }
}
