<?php

declare(strict_types=1);

namespace HooksGraph\Parser;

/**
 * Tokenizes a PHP file and extracts WordPress hook calls.
 */
final class FileParser
{
    /**
     * Maps hook-function name to edge type.
     */
    public const HOOK_FUNCTIONS = [
        'do_action'               => 'fires',
        'do_action_ref_array'     => 'fires',
        'apply_filters'           => 'fires',
        'apply_filters_ref_array' => 'fires',
        'add_action'              => 'listens',
        'add_filter'              => 'listens',
    ];

    public const ACTION_FUNCTIONS = ['do_action', 'do_action_ref_array', 'add_action'];

    /**
     * Parse a PHP file and return the list of hook calls found.
     *
     * Each entry is an associative array with the shape documented in README.md
     * (func, edge_type, hook_type, hook_name, dynamic, raw_expression, callback,
     * callback_type, callback_class, callback_method, priority, file, line,
     * source, scope_class, scope_function, doc_comment).
     *
     * @return list<array<string, mixed>>
     */
    public static function parse(string $filepath, ?string $sourceLabel = null): array
    {
        $code = @file_get_contents($filepath);
        if ($code === false) {
            fwrite(STDERR, "  Warning: cannot read $filepath\n");
            return [];
        }

        $tokens = @token_get_all($code);
        if (!is_array($tokens)) {
            return [];
        }

        $scope   = new ScopeTracker();
        $results = [];
        $count   = count($tokens);

        for ($i = 0; $i < $count; $i++) {
            $token = $tokens[$i];

            if (is_string($token)) {
                if ($token === '{') {
                    $scope->openBrace();
                } elseif ($token === '}') {
                    $scope->closeBrace();
                }
                continue;
            }

            [$id, $text, $line] = $token;

            if ($id === T_CLASS) {
                $j = self::skipWhitespace($tokens, $i + 1, $count);
                if ($j < $count && is_array($tokens[$j]) && $tokens[$j][0] === T_STRING) {
                    $scope->pushClass($tokens[$j][1]);
                }
                continue;
            }

            if ($id === T_FUNCTION) {
                $j = self::skipWhitespace($tokens, $i + 1, $count);
                if ($j < $count && is_array($tokens[$j]) && $tokens[$j][0] === T_STRING) {
                    $scope->pushFunction($tokens[$j][1]);
                } else {
                    $scope->pushAnonymous();
                }
                continue;
            }

            if ($id !== T_STRING || !isset(self::HOOK_FUNCTIONS[$text])) {
                continue;
            }

            // Reject method / static / nullsafe calls: $obj->do_action(...), Foo::do_action(...).
            $prev = self::previousNonWhitespace($tokens, $i - 1);
            if ($prev !== null && is_array($tokens[$prev])) {
                $pid = $tokens[$prev][0];
                if ($pid === T_OBJECT_OPERATOR || $pid === T_DOUBLE_COLON
                    || (defined('T_NULLSAFE_OBJECT_OPERATOR') && $pid === T_NULLSAFE_OBJECT_OPERATOR)) {
                    continue;
                }
            }

            $funcName = $text;
            $callLine = $line;

            $j = self::skipWhitespace($tokens, $i + 1, $count);
            if ($j >= $count || $tokens[$j] !== '(') {
                continue;
            }

            $argTokens = Tokens::between($tokens, $j);
            $args      = Tokens::splitArgs($argTokens);
            if (empty($args)) {
                continue;
            }

            $scopeClass    = $scope->currentClass();
            $scopeFunction = $scope->currentFunction();

            $edgeType = self::HOOK_FUNCTIONS[$funcName];
            $hookType = in_array($funcName, self::ACTION_FUNCTIONS, true) ? 'action' : 'filter';

            [$hookName, $dynamic, $rawExpr] = HookNameExtractor::extract($args[0]);

            $callback       = null;
            $callbackType   = null;
            $callbackClass  = null;
            $callbackMethod = null;
            $priority       = 10;

            if ($edgeType === 'listens') {
                if (count($args) >= 2) {
                    $cb             = CallbackExtractor::extract($args[1], $scopeClass);
                    $callback       = $cb['callback'];
                    $callbackType   = $cb['callback_type'];
                    $callbackClass  = $cb['callback_class'];
                    $callbackMethod = $cb['callback_method'];
                }
                if (count($args) >= 3) {
                    $priority = self::extractPriority($args[2]);
                }
            }

            $results[] = [
                'func'            => $funcName,
                'edge_type'       => $edgeType,
                'hook_type'       => $hookType,
                'hook_name'       => $hookName,
                'dynamic'         => $dynamic,
                'raw_expression'  => $rawExpr,
                'callback'        => $callback,
                'callback_type'   => $callbackType,
                'callback_class'  => $callbackClass,
                'callback_method' => $callbackMethod,
                'priority'        => $priority,
                'file'            => $filepath,
                'line'            => $callLine,
                'source'          => $sourceLabel,
                'scope_class'     => $scopeClass,
                'scope_function'  => $scopeFunction,
                'doc_comment'     => DocCommentExtractor::find($tokens, $i),
            ];

            $i = $j; // advance past closing ')'
        }

        return $results;
    }

    private static function extractPriority(array $argTokens): int
    {
        $tokens = Tokens::stripWhitespace($argTokens);
        if (!empty($tokens) && is_array($tokens[0]) && $tokens[0][0] === T_LNUMBER) {
            return (int) $tokens[0][1];
        }
        return 10;
    }

    private static function skipWhitespace(array $tokens, int $from, int $count): int
    {
        while ($from < $count && is_array($tokens[$from]) && $tokens[$from][0] === T_WHITESPACE) {
            $from++;
        }
        return $from;
    }

    private static function previousNonWhitespace(array $tokens, int $from): ?int
    {
        while ($from >= 0 && is_array($tokens[$from]) && $tokens[$from][0] === T_WHITESPACE) {
            $from--;
        }
        return $from >= 0 ? $from : null;
    }
}
