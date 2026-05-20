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

        $methodIndex = self::buildMethodIndex($tokens, $count);

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

            if ($id === T_NAMESPACE) {
                $j = self::skipWhitespace($tokens, $i + 1, $count);
                $nsName = '';
                while ($j < $count) {
                    $t = $tokens[$j];
                    if (!is_array($t)) {
                        break;
                    }
                    $tid = $t[0];
                    if ($tid === T_STRING || $tid === T_NS_SEPARATOR
                        || (defined('T_NAME_QUALIFIED') && $tid === T_NAME_QUALIFIED)
                    ) {
                        $nsName .= $t[1];
                        $j++;
                        continue;
                    }
                    if ($tid === T_WHITESPACE) {
                        $j++;
                        continue;
                    }
                    break;
                }
                if ($j < $count) {
                    $term = $tokens[$j];
                    if ($term === '{') {
                        $scope->pushNamespace($nsName, true);
                        // Resume so the next iteration sees `{` and calls openBrace().
                        $i = $j - 1;
                        continue;
                    }
                    if ($term === ';') {
                        $scope->pushNamespace($nsName, false);
                        $i = $j;
                        continue;
                    }
                }
                // Not a declaration (e.g. `namespace\foo()` relative call) — fall through.
                continue;
            }

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

            $callbackMeta = null;

            if ($edgeType === 'listens') {
                if (count($args) >= 2) {
                    $cb             = CallbackExtractor::extract($args[1], $scopeClass);
                    $callback       = $cb['callback'];
                    $callbackType   = $cb['callback_type'];
                    $callbackClass  = $cb['callback_class'];
                    $callbackMethod = $cb['callback_method'];

                    $body = self::resolveCallbackBody($args[1], $callbackType, $callbackClass, $callbackMethod, $methodIndex, $scopeClass);
                    if ($body !== null) {
                        $firstParam = $body['by_ref'] || $body['variadic'] ? null : $body['name'];
                        $callbackMeta = CallbackBodyAnalyzer::analyze($body['bodyTokens'], [
                            'hook_kind'   => $hookType,
                            'first_param' => $firstParam,
                        ]);
                    } elseif ($hookType === 'filter') {
                        // No body resolved but hook is a filter — still attach an unknown filter_behavior so consumers can rely on the key being present.
                        $callbackMeta = null;
                    }
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

            if ($callbackMeta !== null) {
                $results[count($results) - 1]['effects']     = $callbackMeta['effects'];
                $results[count($results) - 1]['targets']     = $callbackMeta['targets'];
                $results[count($results) - 1]['called_apis'] = $callbackMeta['called_apis'];
                if (isset($callbackMeta['filter_behavior'])) {
                    $results[count($results) - 1]['filter_behavior'] = $callbackMeta['filter_behavior'];
                }
            }

            $i = $j; // advance past closing ')'
        }

        return $results;
    }

    /**
     * Resolve the body tokens + first parameter for a callback expression, if possible.
     *
     * Supported callback shapes:
     *   - inline closure:           function ($x) { ... }
     *   - inline arrow function:    fn ($x) => ...
     *   - [$this, 'method'] / [self::class, 'method'] / ['ClassName', 'method'] / 'ClassName::method'
     *     when ClassName::method is declared in this same file.
     *
     * Returns null when the body can't be resolved in this file.
     *
     * @return ?array{bodyTokens:list<mixed>, name:?string, by_ref:bool, variadic:bool}
     */
    private static function resolveCallbackBody(array $callbackArg, ?string $callbackType, ?string $callbackClass, ?string $callbackMethod, array $methodIndex, ?string $scopeClass): ?array
    {
        $tokens = $callbackArg;
        $n = count($tokens);
        $i = self::skipWhitespace($tokens, 0, $n);
        if ($i >= $n) {
            return null;
        }
        $first = $tokens[$i];

        if (is_array($first) && $first[0] === T_FUNCTION) {
            return self::extractClosureBody($tokens, $i, $n);
        }
        if (is_array($first) && defined('T_FN') && $first[0] === T_FN) {
            return self::extractArrowBody($tokens, $i, $n);
        }

        if (($callbackType === 'method' || $callbackType === 'static_method') && $callbackMethod !== null) {
            $classCandidates = [];
            if ($callbackClass !== null && $callbackClass !== '') {
                $classCandidates[] = $callbackClass;
                $classCandidates[] = self::stripNamespace($callbackClass);
            }
            if ($scopeClass !== null && $scopeClass !== '') {
                $classCandidates[] = $scopeClass;
                $classCandidates[] = self::stripNamespace($scopeClass);
            }
            foreach ($classCandidates as $cls) {
                $key = $cls . '::' . $callbackMethod;
                if (isset($methodIndex[$key])) {
                    return $methodIndex[$key];
                }
            }
        }
        return null;
    }

    private static function stripNamespace(string $fqcn): string
    {
        $pos = strrpos($fqcn, '\\');
        return $pos === false ? $fqcn : substr($fqcn, $pos + 1);
    }

    /**
     * @return ?array{bodyTokens:list<mixed>, name:?string, by_ref:bool, variadic:bool}
     */
    private static function extractClosureBody(array $tokens, int $i, int $n): ?array
    {
        // i points at T_FUNCTION.
        $j = self::skipWhitespace($tokens, $i + 1, $n);
        // Optional return-by-ref `&` after function.
        if ($j < $n && is_string($tokens[$j]) && $tokens[$j] === '&') {
            $j = self::skipWhitespace($tokens, $j + 1, $n);
        }
        // Optional name (we shouldn't have one for a closure used as a callback expression).
        if ($j < $n && is_array($tokens[$j]) && $tokens[$j][0] === T_STRING) {
            $j = self::skipWhitespace($tokens, $j + 1, $n);
        }
        if ($j >= $n || !is_string($tokens[$j]) || $tokens[$j] !== '(') {
            return null;
        }
        $paramTokens = Tokens::between($tokens, $j);
        $param = self::parseFirstParam($paramTokens);
        $j++; // past ')'
        // Skip optional `use (...)` and return-type.
        while ($j < $n) {
            $t = $tokens[$j];
            if (is_string($t) && $t === '{') {
                break;
            }
            $j++;
        }
        if ($j >= $n) {
            return null;
        }
        // tokens[$j] === '{' — slice body between { and }.
        $close = self::matchBracketIndex($tokens, $j, $n, '{', '}');
        if ($close === -1) {
            return null;
        }
        $body = array_slice($tokens, $j + 1, $close - $j - 1);
        return [
            'bodyTokens' => $body,
            'name'       => $param['name'],
            'by_ref'     => $param['by_ref'],
            'variadic'   => $param['variadic'],
        ];
    }

    private static function extractArrowBody(array $tokens, int $i, int $n): ?array
    {
        // i points at T_FN.
        $j = self::skipWhitespace($tokens, $i + 1, $n);
        if ($j < $n && is_string($tokens[$j]) && $tokens[$j] === '&') {
            $j = self::skipWhitespace($tokens, $j + 1, $n);
        }
        if ($j >= $n || !is_string($tokens[$j]) || $tokens[$j] !== '(') {
            return null;
        }
        $paramTokens = Tokens::between($tokens, $j);
        $param = self::parseFirstParam($paramTokens);
        $j++; // past ')'
        // Find T_DOUBLE_ARROW.
        while ($j < $n && !(is_array($tokens[$j]) && $tokens[$j][0] === T_DOUBLE_ARROW)) {
            $j++;
        }
        if ($j >= $n) {
            return null;
        }
        $j++;
        // Body is the expression up to end of callbackArg tokens. Since callbackArg is one comma-split arg,
        // the entire remainder belongs to the arrow expression.
        $bodyExpr = array_slice($tokens, $j);
        // Synthesize as `return <expr>;` so the analyzers (esp. FilterReturnAnalyzer) treat it as a return.
        $body = [];
        $body[] = [T_RETURN, 'return', 1];
        $body[] = [T_WHITESPACE, ' ', 1];
        foreach ($bodyExpr as $t) {
            $body[] = $t;
        }
        $body[] = ';';
        return [
            'bodyTokens' => $body,
            'name'       => $param['name'],
            'by_ref'     => $param['by_ref'],
            'variadic'   => $param['variadic'],
        ];
    }

    /**
     * @return array{name:?string, by_ref:bool, variadic:bool}
     */
    private static function parseFirstParam(array $paramListTokens): array
    {
        $args = Tokens::splitArgs($paramListTokens);
        if (empty($args)) {
            return ['name' => null, 'by_ref' => false, 'variadic' => false];
        }
        $first = $args[0];
        $byRef = false;
        $variadic = false;
        $name = null;
        $sawType = false;
        foreach ($first as $t) {
            if (is_array($t)) {
                $tid = $t[0];
                if ($tid === T_WHITESPACE || $tid === T_COMMENT || $tid === T_DOC_COMMENT) continue;
                if (defined('T_ELLIPSIS') && $tid === T_ELLIPSIS) {
                    $variadic = true;
                    continue;
                }
                if ((defined('T_AMPERSAND_FOLLOWED_BY_VAR_OR_VARARG') && $tid === T_AMPERSAND_FOLLOWED_BY_VAR_OR_VARARG)
                    || (defined('T_AMPERSAND_NOT_FOLLOWED_BY_VAR_OR_VARARG') && $tid === T_AMPERSAND_NOT_FOLLOWED_BY_VAR_OR_VARARG)) {
                    $byRef = true;
                    continue;
                }
                if ($tid === T_VARIABLE) {
                    $name = ltrim($t[1], '$');
                    break;
                }
                // Type hint tokens (T_STRING, T_NAME_QUALIFIED, T_ARRAY, T_CALLABLE, etc.) — just consume.
                continue;
            }
            if (is_string($t)) {
                if ($t === '&') {
                    $byRef = true;
                }
            }
        }
        return ['name' => $name, 'by_ref' => $byRef, 'variadic' => $variadic];
    }

    private static function matchBracketIndex(array $tokens, int $i, int $n, string $open, string $close): int
    {
        $depth = 0;
        while ($i < $n) {
            $t = $tokens[$i];
            if (is_string($t)) {
                if ($t === $open) {
                    $depth++;
                } elseif ($t === $close) {
                    $depth--;
                    if ($depth === 0) {
                        return $i;
                    }
                }
            }
            $i++;
        }
        return -1;
    }

    /**
     * Build a one-pass index of `ClassName::method` → body tokens + first param.
     *
     * Tracks namespace + class scope and records every method declared inside a class.
     *
     * @return array<string, array{bodyTokens:list<mixed>, name:?string, by_ref:bool, variadic:bool}>
     */
    private static function buildMethodIndex(array $tokens, int $count): array
    {
        $index = [];
        $namespace = '';
        $classStack = []; // list<array{name:string, depth:int}>
        $braceDepth = 0;

        for ($i = 0; $i < $count; $i++) {
            $t = $tokens[$i];
            if (is_string($t)) {
                if ($t === '{') {
                    $braceDepth++;
                } elseif ($t === '}') {
                    $braceDepth--;
                    while (!empty($classStack) && end($classStack)['depth'] >= $braceDepth) {
                        array_pop($classStack);
                    }
                }
                continue;
            }
            $tid = $t[0];

            if ($tid === T_NAMESPACE) {
                $j = self::skipWhitespace($tokens, $i + 1, $count);
                $ns = '';
                while ($j < $count && is_array($tokens[$j])) {
                    $nid = $tokens[$j][0];
                    if ($nid === T_STRING || $nid === T_NS_SEPARATOR
                        || (defined('T_NAME_QUALIFIED') && $nid === T_NAME_QUALIFIED)) {
                        $ns .= $tokens[$j][1];
                        $j++;
                        continue;
                    }
                    if ($nid === T_WHITESPACE) {
                        $j++;
                        continue;
                    }
                    break;
                }
                $namespace = $ns;
                continue;
            }

            if ($tid === T_CLASS) {
                $j = self::skipWhitespace($tokens, $i + 1, $count);
                if ($j < $count && is_array($tokens[$j]) && $tokens[$j][0] === T_STRING) {
                    $className = $tokens[$j][1];
                    // Locate the class's opening `{`.
                    $k = $j + 1;
                    while ($k < $count && !(is_string($tokens[$k]) && $tokens[$k] === '{')) {
                        $k++;
                    }
                    $classStack[] = ['name' => $className, 'depth' => $braceDepth];
                }
                continue;
            }

            if ($tid === T_FUNCTION && !empty($classStack)) {
                // Only count if this T_FUNCTION is at class brace depth (i.e., a method declaration, not nested closure).
                $current = end($classStack);
                if ($braceDepth !== $current['depth'] + 1) {
                    continue;
                }
                $j = self::skipWhitespace($tokens, $i + 1, $count);
                if ($j < $count && is_string($tokens[$j]) && $tokens[$j] === '&') {
                    $j = self::skipWhitespace($tokens, $j + 1, $count);
                }
                if ($j >= $count || !is_array($tokens[$j]) || $tokens[$j][0] !== T_STRING) {
                    continue;
                }
                $methodName = $tokens[$j][1];
                $j = self::skipWhitespace($tokens, $j + 1, $count);
                if ($j >= $count || !is_string($tokens[$j]) || $tokens[$j] !== '(') {
                    continue;
                }
                $paramTokens = Tokens::between($tokens, $j);
                $param = self::parseFirstParam($paramTokens);
                $j++; // past ')'
                while ($j < $count) {
                    $tt = $tokens[$j];
                    if (is_string($tt) && ($tt === '{' || $tt === ';')) {
                        break;
                    }
                    $j++;
                }
                if ($j >= $count || $tokens[$j] === ';') {
                    continue;
                }
                $close = self::matchBracketIndex($tokens, $j, $count, '{', '}');
                if ($close === -1) {
                    continue;
                }
                $body = array_slice($tokens, $j + 1, $close - $j - 1);

                $fqcn = $namespace === '' ? $current['name'] : $namespace . '\\' . $current['name'];
                $entry = [
                    'bodyTokens' => $body,
                    'name'       => $param['name'],
                    'by_ref'     => $param['by_ref'],
                    'variadic'   => $param['variadic'],
                ];
                $index[$fqcn . '::' . $methodName]          = $entry;
                $index[$current['name'] . '::' . $methodName] = $entry;
            }
        }

        return $index;
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
