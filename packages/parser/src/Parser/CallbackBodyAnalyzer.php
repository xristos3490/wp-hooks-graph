<?php

declare(strict_types=1);

namespace HooksGraph\Parser;

/**
 * Static analyzer over a slice of body tokens for a hook listener callback.
 *
 * Produces three arrays describing what the callback *does*:
 *   - effects:      closed-set tags rolled up from APIs/structures (WpApiMap::EFFECTS).
 *   - targets:      structured {kind, key, op, confidence} touch list.
 *   - called_apis:  recognised WP/PHP API call names found in the body.
 *
 * For filter listeners (context['hook_kind'] === 'filter'), delegates to
 * FilterReturnAnalyzer and attaches the result under filter_behavior.
 *
 * Nested closure / arrow-function bodies are not traversed — their effects
 * belong to the inner callback, not the outer.
 */
final class CallbackBodyAnalyzer
{
    /**
     * @param array<int,mixed>            $bodyTokens
     * @param array{hook_kind?:string,first_param?:?string} $context
     * @return array{effects:list<string>, targets:list<array<string,mixed>>, called_apis:list<string>, filter_behavior?:array<string,mixed>}
     */
    public static function analyze(array $bodyTokens, array $context = []): array
    {
        $effects    = [];
        $targets    = [];
        $calledApis = [];

        self::walk($bodyTokens, 0, count($bodyTokens), $effects, $targets, $calledApis);

        $effects    = self::dedupSort($effects);
        $calledApis = self::dedupSort($calledApis);
        $targets    = self::dedupTargets($targets);

        $out = [
            'effects'     => $effects,
            'targets'     => $targets,
            'called_apis' => $calledApis,
        ];

        if (($context['hook_kind'] ?? null) === 'filter') {
            $out['filter_behavior'] = FilterReturnAnalyzer::analyze($bodyTokens, $context['first_param'] ?? null);
        }

        return $out;
    }

    /**
     * @param list<string> $effects
     * @param list<array<string,mixed>> $targets
     * @param list<string> $calledApis
     */
    private static function walk(array $tokens, int $i, int $n, array &$effects, array &$targets, array &$calledApis): void
    {
        while ($i < $n) {
            $tok = $tokens[$i];

            if (is_array($tok)) {
                $tid = $tok[0];

                if ($tid === T_FUNCTION) {
                    $i = self::skipClosureBody($tokens, $i, $n);
                    continue;
                }
                if (defined('T_FN') && $tid === T_FN) {
                    $i = self::skipArrowFnBody($tokens, $i, $n);
                    continue;
                }

                if ($tid === T_ECHO || $tid === T_PRINT) {
                    $effects[] = 'output';
                    $i++;
                    continue;
                }

                if ($tid === T_UNSET) {
                    $i = self::handleUnset($tokens, $i, $n, $targets);
                    continue;
                }

                if ($tid === T_INC || $tid === T_DEC) {
                    // Prefix increment/decrement on a variable chain.
                    $j = self::skipWs($tokens, $i + 1, $n);
                    if ($j < $n && is_array($tokens[$j]) && $tokens[$j][0] === T_VARIABLE) {
                        $i = self::handleVariable($tokens, $j, $n, $effects, $targets, $calledApis, true);
                        continue;
                    }
                    $i++;
                    continue;
                }

                if ($tid === T_STRING || (defined('T_NAME_FULLY_QUALIFIED') && $tid === T_NAME_FULLY_QUALIFIED)) {
                    $name = $tid === T_STRING ? $tok[1] : ltrim($tok[1], '\\');
                    if ((strpos($name, '\\') === false) && self::isFunctionCallSite($tokens, $i)) {
                        $j = self::skipWs($tokens, $i + 1, $n);
                        if ($j < $n && is_string($tokens[$j]) && $tokens[$j] === '(') {
                            $argTokens = Tokens::between($tokens, $j);
                            $args      = Tokens::splitArgs($argTokens);
                            self::handleFunctionCall($name, $args, $effects, $targets, $calledApis);
                            $i = $j + 1;
                            continue;
                        }
                    }
                }

                if ($tid === T_VARIABLE) {
                    if (!self::isScopeQualified($tokens, $i)) {
                        $i = self::handleVariable($tokens, $i, $n, $effects, $targets, $calledApis, false);
                        continue;
                    }
                }
            }

            $i++;
        }
    }

    /**
     * Detect `function (...) { ... }`. Returns index AFTER closing `}` of body.
     */
    private static function skipClosureBody(array $tokens, int $i, int $n): int
    {
        // i points at T_FUNCTION
        // Find first '{' at depth 0 from here (skipping over '(' parens once we hit them).
        $j = $i + 1;
        // Skip past the parameter list `(...)`.
        $j = self::skipWs($tokens, $j, $n);
        if ($j < $n && is_string($tokens[$j]) && $tokens[$j] === '(') {
            $j = self::matchBracket($tokens, $j, $n, '(', ')');
            if ($j === -1) {
                return $n;
            }
            $j++;
        }
        // Skip optional `use (...)` clause and return type hints up to `{` or `;`.
        while ($j < $n) {
            $t = $tokens[$j];
            if (is_string($t)) {
                if ($t === '{') {
                    $end = self::matchBracket($tokens, $j, $n, '{', '}');
                    return $end === -1 ? $n : $end + 1;
                }
                if ($t === ';') {
                    // No body (declared abstract — shouldn't happen in callback context).
                    return $j + 1;
                }
            }
            $j++;
        }
        return $n;
    }

    private static function skipArrowFnBody(array $tokens, int $i, int $n): int
    {
        // T_FN, then (...), then T_DOUBLE_ARROW, then expression up to ',' / ';' / ')' at depth 0.
        $j = self::skipWs($tokens, $i + 1, $n);
        if ($j < $n && is_string($tokens[$j]) && $tokens[$j] === '(') {
            $j = self::matchBracket($tokens, $j, $n, '(', ')');
            if ($j === -1) {
                return $n;
            }
            $j++;
        }
        // Find T_DOUBLE_ARROW.
        while ($j < $n && !(is_array($tokens[$j]) && $tokens[$j][0] === T_DOUBLE_ARROW)) {
            $j++;
        }
        if ($j >= $n) {
            return $n;
        }
        $j++;
        $depth = 0;
        while ($j < $n) {
            $t = $tokens[$j];
            if (is_string($t)) {
                if ($t === '(' || $t === '[' || $t === '{') {
                    $depth++;
                } elseif ($t === ')' || $t === ']' || $t === '}') {
                    if ($depth === 0) {
                        return $j;
                    }
                    $depth--;
                } elseif (($t === ',' || $t === ';') && $depth === 0) {
                    return $j;
                }
            }
            $j++;
        }
        return $n;
    }

    private static function matchBracket(array $tokens, int $i, int $n, string $open, string $close): int
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
     * True if T_STRING at $i is a free function call site (not preceded by `->`, `::`, `function`,
     * `\`-followed-by-namespace-prefix, etc.).
     */
    private static function isFunctionCallSite(array $tokens, int $i): bool
    {
        $prev = self::prevNonWs($tokens, $i - 1);
        if ($prev === null) {
            return true;
        }
        $pt = $tokens[$prev];
        if (is_array($pt)) {
            $pid = $pt[0];
            if ($pid === T_OBJECT_OPERATOR || $pid === T_DOUBLE_COLON || $pid === T_FUNCTION
                || $pid === T_NEW || $pid === T_CLASS || $pid === T_INTERFACE || $pid === T_TRAIT
                || $pid === T_USE || $pid === T_NAMESPACE || $pid === T_GOTO
                || (defined('T_NULLSAFE_OBJECT_OPERATOR') && $pid === T_NULLSAFE_OBJECT_OPERATOR)) {
                return false;
            }
            if ($pid === T_STRING || (defined('T_NAME_QUALIFIED') && $pid === T_NAME_QUALIFIED)) {
                // A namespace prefix or label — reject.
                return false;
            }
            if ($pid === T_NS_SEPARATOR) {
                // `\foo()` is fully-qualified call. Check the token BEFORE the `\`.
                $pp = self::prevNonWs($tokens, $prev - 1);
                if ($pp !== null && is_array($tokens[$pp])
                    && ($tokens[$pp][0] === T_STRING || (defined('T_NAME_QUALIFIED') && $tokens[$pp][0] === T_NAME_QUALIFIED))) {
                    return false;
                }
                return true;
            }
        }
        return true;
    }

    private static function isScopeQualified(array $tokens, int $i): bool
    {
        $prev = self::prevNonWs($tokens, $i - 1);
        if ($prev === null) {
            return false;
        }
        $pt = $tokens[$prev];
        if (is_array($pt) && $pt[0] === T_DOUBLE_COLON) {
            return true; // Foo::$bar — skip
        }
        return false;
    }

    /**
     * @param list<list<mixed>> $args
     * @param list<string> $effects
     * @param list<array<string,mixed>> $targets
     * @param list<string> $calledApis
     */
    private static function handleFunctionCall(string $name, array $args, array &$effects, array &$targets, array &$calledApis): void
    {
        $map = WpApiMap::functions();
        if (!isset($map[$name])) {
            return;
        }
        $entry = $map[$name];
        $calledApis[] = $name;

        if ($entry['effect'] !== null) {
            $effects[] = $entry['effect'];
        }

        if ($entry['kind'] === null || $entry['op'] === null) {
            return;
        }
        $idx = $entry['key_arg_index'];
        if ($idx < 0 || $idx >= count($args)) {
            return;
        }
        $literal = self::extractStringLiteral($args[$idx]);
        if ($literal === null) {
            return;
        }
        $targets[] = [
            'kind'       => $entry['kind'],
            'key'        => $literal,
            'op'         => $entry['op'],
            'confidence' => 'literal',
        ];
    }

    /**
     * @return ?string Literal value (quotes stripped) or null if not a single string literal.
     */
    private static function extractStringLiteral(array $argTokens): ?string
    {
        $stripped = Tokens::stripWhitespace($argTokens);
        if (count($stripped) !== 1) {
            return null;
        }
        $t = $stripped[0];
        if (!is_array($t) || $t[0] !== T_CONSTANT_ENCAPSED_STRING) {
            return null;
        }
        return Tokens::stripQuotes($t[1]);
    }

    /**
     * Parse a $var ...chain... at position $i, emit appropriate targets, return next index.
     *
     * @param list<string> $effects
     * @param list<array<string,mixed>> $targets
     * @param list<string> $calledApis
     */
    private static function handleVariable(array $tokens, int $i, int $n, array &$effects, array &$targets, array &$calledApis, bool $forceWrite): int
    {
        $chain = self::readChain($tokens, $i, $n);
        $afterIdx = $chain['endIdx'];

        // Determine write/read.
        $isWrite = $forceWrite;
        if (!$isWrite) {
            $next = self::skipWs($tokens, $afterIdx, $n);
            if ($next < $n) {
                $t = $tokens[$next];
                if (is_string($t) && $t === '=') {
                    // Must not be '==' or '=>'.
                    $nn = $next + 1;
                    $isWrite = true;
                }
                if (is_array($t)) {
                    $tid = $t[0];
                    if ($tid === T_PLUS_EQUAL || $tid === T_MINUS_EQUAL || $tid === T_MUL_EQUAL
                        || $tid === T_DIV_EQUAL || $tid === T_CONCAT_EQUAL || $tid === T_MOD_EQUAL
                        || $tid === T_AND_EQUAL || $tid === T_OR_EQUAL || $tid === T_XOR_EQUAL
                        || $tid === T_SL_EQUAL || $tid === T_SR_EQUAL || $tid === T_POW_EQUAL
                        || (defined('T_COALESCE_EQUAL') && $tid === T_COALESCE_EQUAL)) {
                        $isWrite = true;
                    } elseif ($tid === T_INC || $tid === T_DEC) {
                        $isWrite = true;
                    }
                }
            }
        }
        $op = $isWrite ? 'write' : 'read';

        $root = ltrim($chain['rootName'], '$');

        // Handle method call on $wpdb (`$wpdb->method(...)`).
        if ($chain['methodName'] !== null && WpApiMap::isGlobal($root) && $root === 'wpdb') {
            $wpdbMethods = WpApiMap::wpdbMethods();
            $mname = $chain['methodName'];
            if (isset($wpdbMethods[$mname])) {
                $entry = $wpdbMethods[$mname];
                $effects[] = $entry['effect'];
                $calledApis[] = '$wpdb->' . $mname;
                // Maybe emit db_table target.
                if ($entry['kind'] !== null && $entry['op'] !== null && $entry['key_arg_index'] >= 0) {
                    $argTokens = Tokens::between($tokens, $chain['methodArgStart']);
                    $args = Tokens::splitArgs($argTokens);
                    if (isset($args[$entry['key_arg_index']])) {
                        $lit = self::extractStringLiteral($args[$entry['key_arg_index']]);
                        if ($lit !== null) {
                            $targets[] = [
                                'kind'       => $entry['kind'],
                                'key'        => $lit,
                                'op'         => $entry['op'],
                                'confidence' => 'literal',
                            ];
                        }
                    }
                }
            }
        }

        // Emit primary target.
        if ($root === 'GLOBALS' && count($chain['segments']) >= 1 && $chain['segments'][0]['kind'] === 'index') {
            $key = $chain['segments'][0]['value'];
            if (WpApiMap::isGlobal($key) || $key !== '') {
                $targets[] = [
                    'kind'       => 'global',
                    'key'        => $key,
                    'op'         => 'read', // $GLOBALS['x'] usage; LHS-write semantics deferred.
                    'confidence' => 'literal',
                ];
            }
        } elseif (WpApiMap::isSuperglobal($root)) {
            // _GET, _POST, etc. — special dotted key.
            $key = $root;
            if (!empty($chain['segments'])) {
                $first = $chain['segments'][0];
                if ($first['kind'] === 'index' && $first['value'] !== '') {
                    $key = $root . '.' . $first['value'];
                }
            }
            $targets[] = [
                'kind'       => 'superglobal',
                'key'        => $key,
                'op'         => 'read',
                'confidence' => 'literal',
            ];
        } elseif (WpApiMap::isGlobal($root)) {
            $targets[] = [
                'kind'       => 'global',
                'key'        => $root,
                'op'         => 'read',
                'confidence' => 'literal',
            ];
        } elseif (!empty($chain['segments']) && $chain['methodName'] === null) {
            // Chain target (only when at least one property/array access exists AND not a method call).
            $key = self::formatChainKey($root, $chain['segments']);
            $targets[] = [
                'kind'       => 'chain',
                'key'        => $key,
                'op'         => $op,
                'confidence' => 'syntactic',
            ];
        }

        // If method call: advance past `(...)`.
        if ($chain['methodName'] !== null) {
            $argStart = $chain['methodArgStart'];
            $argTokens = Tokens::between($tokens, $argStart);
            // $argStart now points at closing ')'.
            return $argStart + 1;
        }

        return $afterIdx;
    }

    /**
     * @return array{rootName:string, segments:list<array{kind:string,value:string}>, methodName:?string, methodArgStart:?int, endIdx:int}
     */
    private static function readChain(array $tokens, int $i, int $n): array
    {
        $root = $tokens[$i][1]; // e.g. '$wpdb'
        $i++;
        $segments = [];
        $methodName = null;
        $methodArgStart = null;

        while ($i < $n) {
            $j = self::skipWs($tokens, $i, $n);
            if ($j >= $n) {
                $i = $j;
                break;
            }
            $t = $tokens[$j];

            if (is_array($t) && ($t[0] === T_OBJECT_OPERATOR
                || (defined('T_NULLSAFE_OBJECT_OPERATOR') && $t[0] === T_NULLSAFE_OBJECT_OPERATOR))) {
                $k = self::skipWs($tokens, $j + 1, $n);
                if ($k >= $n || !is_array($tokens[$k]) || $tokens[$k][0] !== T_STRING) {
                    $i = $j;
                    break;
                }
                $name = $tokens[$k][1];
                $m = self::skipWs($tokens, $k + 1, $n);
                if ($m < $n && is_string($tokens[$m]) && $tokens[$m] === '(') {
                    $methodName = $name;
                    $methodArgStart = $m;
                    $i = $k + 1;
                    break;
                }
                $segments[] = ['kind' => 'prop', 'value' => $name];
                $i = $k + 1;
                continue;
            }

            if (is_string($t) && $t === '[') {
                $closeIdx = self::matchBracket($tokens, $j, $n, '[', ']');
                if ($closeIdx === -1) {
                    $i = $j;
                    break;
                }
                $inner = array_slice($tokens, $j + 1, $closeIdx - $j - 1);
                $segments[] = self::classifyKey($inner);
                $i = $closeIdx + 1;
                continue;
            }

            break;
        }

        return [
            'rootName'       => $root,
            'segments'       => $segments,
            'methodName'     => $methodName,
            'methodArgStart' => $methodArgStart,
            'endIdx'         => $i,
        ];
    }

    /**
     * @return array{kind:string,value:string}
     */
    private static function classifyKey(array $inner): array
    {
        $stripped = Tokens::stripWhitespace($inner);
        if (empty($stripped)) {
            return ['kind' => 'index', 'value' => ''];
        }
        if (count($stripped) === 1) {
            $t = $stripped[0];
            if (is_array($t)) {
                if ($t[0] === T_CONSTANT_ENCAPSED_STRING) {
                    return ['kind' => 'index', 'value' => Tokens::stripQuotes($t[1])];
                }
                if ($t[0] === T_LNUMBER || $t[0] === T_DNUMBER) {
                    return ['kind' => 'index', 'value' => $t[1]];
                }
            }
        }
        return ['kind' => 'index_dyn', 'value' => '*'];
    }

    private static function formatChainKey(string $rootDollar, array $segments): string
    {
        $root = ltrim($rootDollar, '$');
        $out = $root;
        foreach ($segments as $seg) {
            if ($seg['kind'] === 'prop') {
                $out .= '.' . $seg['value'];
            } else {
                $out .= '[' . $seg['value'] . ']';
            }
        }
        return $out;
    }

    private static function handleUnset(array $tokens, int $i, int $n, array &$targets): int
    {
        // T_UNSET, ws, '(' args ')'
        $j = self::skipWs($tokens, $i + 1, $n);
        if ($j >= $n || !is_string($tokens[$j]) || $tokens[$j] !== '(') {
            return $i + 1;
        }
        $argTokens = Tokens::between($tokens, $j);
        $args = Tokens::splitArgs($argTokens);
        foreach ($args as $arg) {
            $stripped = Tokens::stripWhitespace($arg);
            if (empty($stripped) || !is_array($stripped[0]) || $stripped[0][0] !== T_VARIABLE) {
                continue;
            }
            // Re-parse this arg as a chain.
            $chain = self::readChain($arg, self::indexOfFirstVar($arg), count($arg));
            $root = ltrim($chain['rootName'], '$');
            if (!empty($chain['segments']) && $chain['methodName'] === null
                && !WpApiMap::isSuperglobal($root) && !WpApiMap::isGlobal($root) && $root !== 'GLOBALS') {
                $targets[] = [
                    'kind'       => 'chain',
                    'key'        => self::formatChainKey($root, $chain['segments']),
                    'op'         => 'write',
                    'confidence' => 'syntactic',
                ];
            }
        }
        return $j + 1;
    }

    private static function indexOfFirstVar(array $tokens): int
    {
        foreach ($tokens as $idx => $t) {
            if (is_array($t) && $t[0] === T_VARIABLE) {
                return $idx;
            }
        }
        return 0;
    }

    private static function skipWs(array $tokens, int $i, int $n): int
    {
        while ($i < $n && is_array($tokens[$i]) && $tokens[$i][0] === T_WHITESPACE) {
            $i++;
        }
        return $i;
    }

    private static function prevNonWs(array $tokens, int $i): ?int
    {
        while ($i >= 0 && is_array($tokens[$i]) && $tokens[$i][0] === T_WHITESPACE) {
            $i--;
        }
        return $i >= 0 ? $i : null;
    }

    private static function dedupSort(array $list): array
    {
        $list = array_values(array_unique($list));
        sort($list);
        return $list;
    }

    /**
     * Dedup by (kind,key,op); preserve a deterministic order.
     */
    private static function dedupTargets(array $targets): array
    {
        $seen = [];
        $out  = [];
        foreach ($targets as $t) {
            $sig = $t['kind'] . '|' . $t['key'] . '|' . $t['op'];
            if (isset($seen[$sig])) {
                continue;
            }
            $seen[$sig] = true;
            $out[] = $t;
        }
        usort($out, static function ($a, $b) {
            return strcmp($a['kind'] . '|' . $a['key'] . '|' . $a['op'], $b['kind'] . '|' . $b['key'] . '|' . $b['op']);
        });
        return $out;
    }
}
