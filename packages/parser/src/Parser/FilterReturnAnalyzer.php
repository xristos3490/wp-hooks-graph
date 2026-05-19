<?php

declare(strict_types=1);

namespace HooksGraph\Parser;

/**
 * Classifies what a filter callback does to / with its first parameter ($arg0).
 *
 * Produces a `filter_behavior` sub-object:
 *   - return_origin: input_unchanged | input_mutated | derived | replaced | conditional | unknown
 *   - mutates_input: bool
 *   - modified_paths: list of normalised mutation paths rooted at "arg0"
 *
 * Walks all tokens at any control-flow nesting (if, try, while, …) but skips
 * the bodies of nested closures / arrow functions.
 *
 * Mutation rule (intentionally strict, structural — not flow-sensitive):
 *   A statement mutates the input only when its LHS chain is rooted directly
 *   at the parameter variable. Aliases (`$out = $v`) do not propagate mutation
 *   tracking, because we don't model PHP's value/reference semantics.
 *
 * Return-origin classification uses a two-set alias model:
 *   - `alias`:   variables currently bound to the input value itself
 *   - `derived`: variables computed from the input
 * Reassignment with a derivation moves the var from alias → derived; with an
 * unrelated value, the var drops out of both sets.
 */
final class FilterReturnAnalyzer
{
    /**
     * @param array<int,mixed> $bodyTokens
     * @return array{return_origin:string, mutates_input:bool, modified_paths:list<string>}
     */
    public static function analyze(array $bodyTokens, ?string $firstParamName): array
    {
        if ($firstParamName === null || $firstParamName === '') {
            return ['return_origin' => 'unknown', 'mutates_input' => false, 'modified_paths' => []];
        }

        $arg0 = ltrim($firstParamName, '$');

        $state = [
            'arg0'    => $arg0,
            'alias'   => [$arg0 => true],
            'derived' => [],
            'mutates' => false,
            'paths'   => [],
            'returns' => [],
            'unknown' => false,
        ];

        self::walk($bodyTokens, 0, count($bodyTokens), $state);

        $paths = array_values(array_unique($state['paths']));
        sort($paths);

        $hasFallthrough = !self::lastStatementIsReturn($bodyTokens);

        $returns = $state['returns'];
        if ($state['unknown']) {
            return [
                'return_origin'  => 'unknown',
                'mutates_input'  => $state['mutates'],
                'modified_paths' => $paths,
            ];
        }

        if (empty($returns)) {
            $returns = ['replaced'];
        } elseif ($hasFallthrough) {
            $returns[] = 'replaced';
        }

        if (in_array('unknown', $returns, true)) {
            $origin = 'unknown';
        } else {
            $unique = array_values(array_unique($returns));
            if (count($unique) === 1) {
                $origin = $unique[0];
            } else {
                $origin = 'conditional';
            }
        }

        if ($origin === 'input') {
            $origin = $state['mutates'] ? 'input_mutated' : 'input_unchanged';
        }

        return [
            'return_origin'  => $origin,
            'mutates_input'  => $state['mutates'],
            'modified_paths' => $paths,
        ];
    }

    private static function walk(array $tokens, int $i, int $n, array &$state): void
    {
        while ($i < $n) {
            $tok = $tokens[$i];

            if (is_array($tok)) {
                $tid = $tok[0];

                if ($tid === T_WHITESPACE || $tid === T_COMMENT || $tid === T_DOC_COMMENT) {
                    $i++;
                    continue;
                }

                if ($tid === T_FUNCTION) {
                    self::checkUseByRef($tokens, $i, $n, $state);
                    $i = self::skipClosureBody($tokens, $i, $n);
                    continue;
                }
                if (defined('T_FN') && $tid === T_FN) {
                    $i = self::skipArrowFnBody($tokens, $i, $n);
                    continue;
                }

                if ($tid === T_RETURN) {
                    $end = self::findSemicolonAtDepth($tokens, $i + 1, $n);
                    $exprTokens = array_slice($tokens, $i + 1, $end - $i - 1);
                    $state['returns'][] = self::classifyReturnExpr($exprTokens, $state);
                    $i = $end + 1;
                    continue;
                }

                if ($tid === T_UNSET) {
                    self::handleUnset($tokens, $i, $n, $state);
                    $i = self::findSemicolonAtDepth($tokens, $i + 1, $n) + 1;
                    continue;
                }

                if ($tid === T_INC || $tid === T_DEC) {
                    $j = self::skipWs($tokens, $i + 1, $n);
                    if ($j < $n && is_array($tokens[$j]) && $tokens[$j][0] === T_VARIABLE) {
                        self::handleIncDec($tokens, $j, $n, $state);
                    }
                    $i++;
                    continue;
                }

                if ($tid === T_VARIABLE) {
                    $i = self::handleVariable($tokens, $i, $n, $state);
                    continue;
                }
            }

            $i++;
        }
    }

    private static function classifyReturnExpr(array $exprTokens, array $state): string
    {
        $stripped = self::stripTrivial($exprTokens);

        if (empty($stripped)) {
            return 'replaced';
        }

        // Variable-variable: `$$foo`.
        for ($k = 0; $k < count($stripped) - 1; $k++) {
            $a = $stripped[$k];
            $b = $stripped[$k + 1];
            if (is_string($a) && $a === '$' && is_array($b) && $b[0] === T_VARIABLE) {
                return 'unknown';
            }
        }

        if (count($stripped) === 1 && is_array($stripped[0]) && $stripped[0][0] === T_VARIABLE) {
            $name = ltrim($stripped[0][1], '$');
            if (isset($state['alias'][$name])) {
                return 'input';
            }
            if (isset($state['derived'][$name])) {
                return 'derived';
            }
            return 'replaced';
        }

        if (self::exprMentionsTracked($exprTokens, $state)) {
            return 'derived';
        }
        return 'replaced';
    }

    private static function exprMentionsTracked(array $tokens, array $state): bool
    {
        foreach ($tokens as $t) {
            if (is_array($t) && $t[0] === T_VARIABLE) {
                $name = ltrim($t[1], '$');
                if (isset($state['alias'][$name]) || isset($state['derived'][$name])) {
                    return true;
                }
            }
        }
        return false;
    }

    private static function handleVariable(array $tokens, int $i, int $n, array &$state): int
    {
        $rootName = ltrim($tokens[$i][1], '$');

        $chain = self::readChainSegments($tokens, $i + 1, $n);
        $j = $chain['endIdx'];

        $next = self::skipWs($tokens, $j, $n);
        $isAssign = false;
        $isCompoundAssign = false;
        $isIncDec = false;
        if ($next < $n) {
            $t = $tokens[$next];
            if (is_string($t) && $t === '=') {
                $isAssign = true;
            } elseif (is_array($t)) {
                $tid = $t[0];
                if ($tid === T_PLUS_EQUAL || $tid === T_MINUS_EQUAL || $tid === T_MUL_EQUAL
                    || $tid === T_DIV_EQUAL || $tid === T_CONCAT_EQUAL || $tid === T_MOD_EQUAL
                    || $tid === T_AND_EQUAL || $tid === T_OR_EQUAL || $tid === T_XOR_EQUAL
                    || $tid === T_SL_EQUAL || $tid === T_SR_EQUAL || $tid === T_POW_EQUAL
                    || (defined('T_COALESCE_EQUAL') && $tid === T_COALESCE_EQUAL)) {
                    $isCompoundAssign = true;
                } elseif ($tid === T_INC || $tid === T_DEC) {
                    $isIncDec = true;
                }
            }
        }

        $isArg0Root = ($rootName === $state['arg0']);

        // Mutation: structural, only on the literal arg0 root.
        if ($isArg0Root && ($isAssign || $isCompoundAssign)) {
            if (!empty($chain['segments'])) {
                $state['mutates'] = true;
                $state['paths'][] = self::formatModifiedPath($chain['segments']);
            } else {
                // Bare reassign of the param itself.
                $state['mutates'] = true;
            }
        }
        if ($isArg0Root && $isIncDec) {
            $state['mutates'] = true;
            if (!empty($chain['segments'])) {
                $state['paths'][] = self::formatModifiedPath($chain['segments']);
            }
        }

        // Bare reassignment: update alias/derived sets.
        if ($isAssign && empty($chain['segments'])) {
            $semi = self::findSemicolonAtDepth($tokens, $next + 1, $n);
            $rhsTokens = array_slice($tokens, $next + 1, $semi - $next - 1);

            // Side-effect: scan RHS for nested closures with `use (&$arg0)`.
            self::scanRhsForByrefUse($rhsTokens, $state);

            $rhsStripped = self::stripTrivial($rhsTokens);
            $isExactAlias = false;
            $mentionsTracked = false;
            if (count($rhsStripped) === 1 && is_array($rhsStripped[0]) && $rhsStripped[0][0] === T_VARIABLE) {
                $name = ltrim($rhsStripped[0][1], '$');
                if (isset($state['alias'][$name])) {
                    $isExactAlias = true;
                }
                if (isset($state['alias'][$name]) || isset($state['derived'][$name])) {
                    $mentionsTracked = true;
                }
            } else {
                $mentionsTracked = self::exprMentionsTracked($rhsTokens, $state);
            }

            if ($isExactAlias) {
                $state['alias'][$rootName]   = true;
                $state['derived'][$rootName] = true;
            } elseif ($mentionsTracked) {
                unset($state['alias'][$rootName]);
                $state['derived'][$rootName] = true;
            } else {
                unset($state['alias'][$rootName]);
                unset($state['derived'][$rootName]);
            }

            return $semi + 1;
        }

        if ($isAssign || $isCompoundAssign) {
            // chain assignment: advance past `;`.
            $semi = self::findSemicolonAtDepth($tokens, $next + 1, $n);
            return $semi < $n ? $semi + 1 : $n;
        }
        if ($isIncDec) {
            return $next + 1;
        }

        if ($chain['methodArgStart'] !== null) {
            $closeIdx = self::matchBracket($tokens, $chain['methodArgStart'], $n, '(', ')');
            if ($closeIdx !== -1) {
                return $closeIdx + 1;
            }
        }
        return $j;
    }

    private static function handleIncDec(array $tokens, int $i, int $n, array &$state): void
    {
        $rootName = ltrim($tokens[$i][1], '$');
        if ($rootName !== $state['arg0']) {
            return;
        }
        $chain = self::readChainSegments($tokens, $i + 1, $n);
        $state['mutates'] = true;
        if (!empty($chain['segments'])) {
            $state['paths'][] = self::formatModifiedPath($chain['segments']);
        }
    }

    private static function handleUnset(array $tokens, int $i, int $n, array &$state): void
    {
        $j = self::skipWs($tokens, $i + 1, $n);
        if ($j >= $n || !is_string($tokens[$j]) || $tokens[$j] !== '(') {
            return;
        }
        $argTokens = Tokens::between($tokens, $j);
        $args = Tokens::splitArgs($argTokens);
        foreach ($args as $arg) {
            $stripped = self::stripTrivial($arg);
            if (empty($stripped) || !is_array($stripped[0]) || $stripped[0][0] !== T_VARIABLE) {
                continue;
            }
            $rootName = ltrim($stripped[0][1], '$');
            if ($rootName !== $state['arg0']) {
                continue;
            }
            $firstIdx = self::indexOfFirstVar($arg);
            $chain = self::readChainSegments($arg, $firstIdx + 1, count($arg));
            $state['mutates'] = true;
            if (!empty($chain['segments'])) {
                $state['paths'][] = self::formatModifiedPath($chain['segments']);
            }
        }
    }

    private static function scanRhsForByrefUse(array $rhsTokens, array &$state): void
    {
        $n = count($rhsTokens);
        for ($i = 0; $i < $n; $i++) {
            $t = $rhsTokens[$i];
            if (is_array($t) && $t[0] === T_FUNCTION) {
                self::checkUseByRef($rhsTokens, $i, $n, $state);
            }
        }
    }

    private static function checkUseByRef(array $tokens, int $i, int $n, array &$state): void
    {
        $j = self::skipWs($tokens, $i + 1, $n);
        if ($j < $n && is_string($tokens[$j]) && $tokens[$j] === '&') {
            $j = self::skipWs($tokens, $j + 1, $n);
        }
        if ($j < $n && is_array($tokens[$j]) && $tokens[$j][0] === T_STRING) {
            $j = self::skipWs($tokens, $j + 1, $n);
        }
        if ($j >= $n || !is_string($tokens[$j]) || $tokens[$j] !== '(') {
            return;
        }
        $j = self::matchBracket($tokens, $j, $n, '(', ')');
        if ($j === -1) return;
        $j++;
        $j = self::skipWs($tokens, $j, $n);
        if ($j >= $n || !is_array($tokens[$j]) || $tokens[$j][0] !== T_USE) {
            return;
        }
        $j = self::skipWs($tokens, $j + 1, $n);
        if ($j >= $n || !is_string($tokens[$j]) || $tokens[$j] !== '(') {
            return;
        }
        $useTokens = Tokens::between($tokens, $j);
        $useArgs = Tokens::splitArgs($useTokens);
        foreach ($useArgs as $arg) {
            $stripped = self::stripTrivial($arg);
            $byRef = false;
            $varName = null;
            foreach ($stripped as $t) {
                if (is_string($t) && $t === '&') {
                    $byRef = true;
                } elseif (is_array($t)) {
                    if (defined('T_AMPERSAND_FOLLOWED_BY_VAR_OR_VARARG') && $t[0] === T_AMPERSAND_FOLLOWED_BY_VAR_OR_VARARG) {
                        $byRef = true;
                        continue;
                    }
                    if (defined('T_AMPERSAND_NOT_FOLLOWED_BY_VAR_OR_VARARG') && $t[0] === T_AMPERSAND_NOT_FOLLOWED_BY_VAR_OR_VARARG) {
                        $byRef = true;
                        continue;
                    }
                    if ($t[0] === T_VARIABLE) {
                        $varName = ltrim($t[1], '$');
                        break;
                    }
                }
            }
            if ($byRef && $varName === $state['arg0']) {
                $state['unknown'] = true;
            }
        }
    }

    /**
     * @return array{segments:list<array{kind:string,value:string}>, methodArgStart:?int, endIdx:int}
     */
    private static function readChainSegments(array $tokens, int $i, int $n): array
    {
        $segments = [];
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
                $m = self::skipWs($tokens, $j + 1, $n);
                if ($m < $n && is_array($tokens[$m]) && $tokens[$m][0] === T_STRING) {
                    $p = self::skipWs($tokens, $m + 1, $n);
                    if ($p < $n && is_string($tokens[$p]) && $tokens[$p] === '(') {
                        $methodArgStart = $p;
                        $i = $m + 1;
                        break;
                    }
                    $segments[] = ['kind' => 'prop', 'value' => $tokens[$m][1]];
                    $i = $m + 1;
                    continue;
                }
                $i = $j;
                break;
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
        return ['segments' => $segments, 'methodArgStart' => $methodArgStart, 'endIdx' => $i];
    }

    /**
     * Walk the body once to find the last top-level (brace-depth 0) statement
     * and decide if it's `return …;` — meaning the function can't fall through.
     */
    private static function lastStatementIsReturn(array $tokens): bool
    {
        $n = count($tokens);
        $lastIsReturn = false;
        $braceDepth = 0;
        $i = 0;
        $stmtStartAtDepth0 = 0;
        while ($i < $n) {
            $t = $tokens[$i];
            if (is_array($t)) {
                $tid = $t[0];
                if ($tid === T_FUNCTION) {
                    $i = self::skipClosureBody($tokens, $i, $n);
                    continue;
                }
                if (defined('T_FN') && $tid === T_FN) {
                    $i = self::skipArrowFnBody($tokens, $i, $n);
                    continue;
                }
                if ($braceDepth === 0 && $tid === T_RETURN) {
                    $lastIsReturn = true;
                    $end = self::findSemicolonAtDepth($tokens, $i + 1, $n);
                    $i = $end + 1;
                    $stmtStartAtDepth0 = $i;
                    continue;
                }
                if ($braceDepth === 0 && $tid !== T_WHITESPACE && $tid !== T_COMMENT && $tid !== T_DOC_COMMENT) {
                    $lastIsReturn = false;
                }
            } elseif (is_string($t)) {
                if ($t === '{') $braceDepth++;
                elseif ($t === '}') $braceDepth--;
                elseif ($braceDepth === 0 && $t === ';') {
                    // Statement boundary; do not flip the flag — flag reflects "did we see a non-return statement?".
                }
            }
            $i++;
        }
        return $lastIsReturn;
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

    private static function findSemicolonAtDepth(array $tokens, int $i, int $n): int
    {
        $depth = 0;
        while ($i < $n) {
            $t = $tokens[$i];
            if (is_string($t)) {
                if ($t === '{' || $t === '(' || $t === '[') {
                    $depth++;
                } elseif ($t === '}' || $t === ')' || $t === ']') {
                    $depth--;
                } elseif ($t === ';' && $depth === 0) {
                    return $i;
                }
            }
            $i++;
        }
        return $n - 1;
    }

    private static function matchBracket(array $tokens, int $i, int $n, string $open, string $close): int
    {
        $depth = 0;
        while ($i < $n) {
            $t = $tokens[$i];
            if (is_string($t)) {
                if ($t === $open) $depth++;
                elseif ($t === $close) {
                    $depth--;
                    if ($depth === 0) return $i;
                }
            }
            $i++;
        }
        return -1;
    }

    private static function skipWs(array $tokens, int $i, int $n): int
    {
        while ($i < $n && is_array($tokens[$i])
            && ($tokens[$i][0] === T_WHITESPACE || $tokens[$i][0] === T_COMMENT || $tokens[$i][0] === T_DOC_COMMENT)) {
            $i++;
        }
        return $i;
    }

    private static function stripTrivial(array $tokens): array
    {
        return array_values(array_filter($tokens, static function ($t) {
            if (!is_array($t)) return true;
            $id = $t[0];
            return $id !== T_WHITESPACE && $id !== T_COMMENT && $id !== T_DOC_COMMENT;
        }));
    }

    private static function skipClosureBody(array $tokens, int $i, int $n): int
    {
        $j = $i + 1;
        $j = self::skipWs($tokens, $j, $n);
        if ($j < $n && is_string($tokens[$j]) && $tokens[$j] === '&') {
            $j = self::skipWs($tokens, $j + 1, $n);
        }
        if ($j < $n && is_array($tokens[$j]) && $tokens[$j][0] === T_STRING) {
            $j = self::skipWs($tokens, $j + 1, $n);
        }
        if ($j < $n && is_string($tokens[$j]) && $tokens[$j] === '(') {
            $j = self::matchBracket($tokens, $j, $n, '(', ')');
            if ($j === -1) return $n;
            $j++;
        }
        while ($j < $n) {
            $t = $tokens[$j];
            if (is_string($t)) {
                if ($t === '{') {
                    $end = self::matchBracket($tokens, $j, $n, '{', '}');
                    return $end === -1 ? $n : $end + 1;
                }
                if ($t === ';') return $j + 1;
            }
            $j++;
        }
        return $n;
    }

    private static function skipArrowFnBody(array $tokens, int $i, int $n): int
    {
        $j = self::skipWs($tokens, $i + 1, $n);
        if ($j < $n && is_string($tokens[$j]) && $tokens[$j] === '(') {
            $j = self::matchBracket($tokens, $j, $n, '(', ')');
            if ($j === -1) return $n;
            $j++;
        }
        while ($j < $n && !(is_array($tokens[$j]) && $tokens[$j][0] === T_DOUBLE_ARROW)) {
            $j++;
        }
        if ($j >= $n) return $n;
        $j++;
        $depth = 0;
        while ($j < $n) {
            $t = $tokens[$j];
            if (is_string($t)) {
                if ($t === '(' || $t === '[' || $t === '{') $depth++;
                elseif ($t === ')' || $t === ']' || $t === '}') {
                    if ($depth === 0) return $j;
                    $depth--;
                } elseif (($t === ',' || $t === ';') && $depth === 0) {
                    return $j;
                }
            }
            $j++;
        }
        return $n;
    }

    private static function classifyKey(array $inner): array
    {
        $stripped = self::stripTrivial($inner);
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

    private static function formatModifiedPath(array $segments): string
    {
        $out = 'arg0';
        foreach ($segments as $seg) {
            if ($seg['kind'] === 'prop') {
                $out .= '->' . $seg['value'];
            } else {
                $out .= '[' . $seg['value'] . ']';
            }
        }
        return $out;
    }
}
