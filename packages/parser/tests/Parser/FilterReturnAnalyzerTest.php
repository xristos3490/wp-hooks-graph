<?php

declare(strict_types=1);

namespace HooksGraph\Tests\Parser;

use HooksGraph\Parser\FilterReturnAnalyzer;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\TestCase;

#[CoversClass(FilterReturnAnalyzer::class)]
final class FilterReturnAnalyzerTest extends TestCase
{
    private function bodyTokens(string $php): array
    {
        $tokens = token_get_all("<?php function __body(){ {$php} }");
        $start = null;
        $depth = 0;
        $end = null;
        for ($i = 0, $n = count($tokens); $i < $n; $i++) {
            $t = $tokens[$i];
            if (is_string($t) && $t === '{') {
                if ($start === null) {
                    $start = $i + 1;
                    $depth = 1;
                    continue;
                }
                $depth++;
            } elseif (is_string($t) && $t === '}') {
                $depth--;
                if ($depth === 0) {
                    $end = $i;
                    break;
                }
            }
        }
        return array_slice($tokens, $start, $end - $start);
    }

    private function analyze(string $php, ?string $param = 'v'): array
    {
        return FilterReturnAnalyzer::analyze($this->bodyTokens($php), $param);
    }

    // ── Parameter resolution ────────────────────────────────────────────

    public function test_no_param_is_unknown(): void
    {
        $r = $this->analyze('return 1;', null);
        $this->assertSame('unknown', $r['return_origin']);
    }

    // ── input_unchanged ─────────────────────────────────────────────────

    public function test_simple_passthrough(): void
    {
        $r = $this->analyze('return $v;');
        $this->assertSame('input_unchanged', $r['return_origin']);
        $this->assertFalse($r['mutates_input']);
        $this->assertSame([], $r['modified_paths']);
    }

    public function test_passthrough_with_side_effects(): void
    {
        $r = $this->analyze('do_action("x"); return $v;');
        $this->assertSame('input_unchanged', $r['return_origin']);
    }

    public function test_multiple_return_v_branches_unchanged(): void
    {
        // Pin: identical input returns at the very end keep input_unchanged.
        $r = $this->analyze('if ($x) { /* noop */ } return $v;');
        $this->assertSame('input_unchanged', $r['return_origin']);
    }

    // ── input_mutated ───────────────────────────────────────────────────

    public function test_array_write_then_return(): void
    {
        $r = $this->analyze('$v["x"] = 1; return $v;');
        $this->assertSame('input_mutated', $r['return_origin']);
        $this->assertTrue($r['mutates_input']);
        $this->assertSame(['arg0[x]'], $r['modified_paths']);
    }

    public function test_property_write_then_return(): void
    {
        $r = $this->analyze('$v->prop = 1; return $v;');
        $this->assertSame('input_mutated', $r['return_origin']);
        $this->assertSame(['arg0->prop'], $r['modified_paths']);
    }

    public function test_append_then_return(): void
    {
        $r = $this->analyze('$v[] = "new"; return $v;');
        $this->assertSame('input_mutated', $r['return_origin']);
        $this->assertSame(['arg0[]'], $r['modified_paths']);
    }

    public function test_unset_then_return(): void
    {
        $r = $this->analyze('unset($v["x"]); return $v;');
        $this->assertSame('input_mutated', $r['return_origin']);
        $this->assertSame(['arg0[x]'], $r['modified_paths']);
    }

    public function test_postfix_inc_chain(): void
    {
        $r = $this->analyze('$v["x"]++; return $v;');
        $this->assertSame('input_mutated', $r['return_origin']);
        $this->assertContains('arg0[x]', $r['modified_paths']);
    }

    public function test_prefix_inc_chain(): void
    {
        $r = $this->analyze('++$v->count; return $v;');
        $this->assertSame('input_mutated', $r['return_origin']);
        $this->assertContains('arg0->count', $r['modified_paths']);
    }

    // ── derived ─────────────────────────────────────────────────────────

    public function test_chain_extract_return(): void
    {
        $r = $this->analyze('return $v["x"];');
        $this->assertSame('derived', $r['return_origin']);
    }

    public function test_expression_mention(): void
    {
        $r = $this->analyze('return $v . "_x";');
        $this->assertSame('derived', $r['return_origin']);
    }

    public function test_local_var_derivation(): void
    {
        $r = $this->analyze('$out = transform($v); return $out;');
        $this->assertSame('derived', $r['return_origin']);
    }

    public function test_derived_via_function_call(): void
    {
        $r = $this->analyze('return array_merge($v, ["x" => 1]);');
        $this->assertSame('derived', $r['return_origin']);
    }

    public function test_self_reassignment_from_derivation_stays_derived(): void
    {
        // Pin: $v = $v . 'x'; return $v; is derived (not replaced).
        $r = $this->analyze('$v = $v . "x"; return $v;');
        $this->assertSame('derived', $r['return_origin']);
    }

    // ── replaced ────────────────────────────────────────────────────────

    public function test_return_false(): void
    {
        $r = $this->analyze('return false;');
        $this->assertSame('replaced', $r['return_origin']);
    }

    public function test_return_static_string(): void
    {
        $r = $this->analyze('return "static";');
        $this->assertSame('replaced', $r['return_origin']);
    }

    public function test_unrelated_local_var(): void
    {
        $r = $this->analyze('$x = "other"; return $x;');
        $this->assertSame('replaced', $r['return_origin']);
    }

    public function test_v_reassigned_to_unrelated_then_returned(): void
    {
        // Pin: $v = 'new'; return $v; → replaced.
        $r = $this->analyze('$v = "new"; return $v;');
        $this->assertSame('replaced', $r['return_origin']);
    }

    public function test_no_explicit_return_is_replaced(): void
    {
        $r = $this->analyze('$x = 1;');
        $this->assertSame('replaced', $r['return_origin']);
    }

    // ── conditional ─────────────────────────────────────────────────────

    public function test_passthrough_plus_replaced(): void
    {
        $r = $this->analyze('if ($x) return false; return $v;');
        $this->assertSame('conditional', $r['return_origin']);
    }

    public function test_input_plus_replaced(): void
    {
        $r = $this->analyze('if ($x) return $v; return $other;');
        $this->assertSame('conditional', $r['return_origin']);
    }

    public function test_input_plus_derived(): void
    {
        // Pin: input vs derived in different branches is still conditional.
        $r = $this->analyze('if ($x) return $v; return $v["a"];');
        $this->assertSame('conditional', $r['return_origin']);
    }

    // ── unknown ─────────────────────────────────────────────────────────

    public function test_variable_variable(): void
    {
        $r = $this->analyze('$name = "v"; return $$name;');
        $this->assertSame('unknown', $r['return_origin']);
    }

    public function test_nested_closure_with_byref_use_marks_unknown(): void
    {
        $r = $this->analyze('$f = function() use (&$v) { $v = 1; }; $f(); return $v;');
        $this->assertSame('unknown', $r['return_origin']);
    }

    // ── mutates_input orthogonal ───────────────────────────────────────

    public function test_mutates_input_true_with_derived_return(): void
    {
        $r = $this->analyze('$v["x"] = 1; return $v["x"];');
        $this->assertTrue($r['mutates_input']);
        $this->assertSame('derived', $r['return_origin']);
    }

    public function test_mutates_input_false_for_indirect_alias(): void
    {
        // Pin: token-level analysis does not model PHP object-reference semantics.
        $r = $this->analyze('$out = $v; $out["x"] = 1; return $out;');
        $this->assertFalse($r['mutates_input']);
    }

    public function test_mutates_input_true_after_v_reassigned(): void
    {
        // Pin: LHS-root match is structural, not flow-sensitive.
        $r = $this->analyze('$v = "new"; $v["x"] = 1;');
        $this->assertTrue($r['mutates_input']);
    }

    // ── modified_paths ──────────────────────────────────────────────────

    public function test_modified_paths_normalised_to_arg0_regardless_of_name(): void
    {
        $r = $this->analyze('$cart["total"] = 1;', 'cart');
        $this->assertSame(['arg0[total]'], $r['modified_paths']);
    }

    public function test_modified_paths_nested(): void
    {
        $r = $this->analyze('$v["a"]["b"] = 1; return $v;');
        $this->assertSame(['arg0[a][b]'], $r['modified_paths']);
    }

    public function test_modified_paths_dynamic_key_normalised(): void
    {
        // Pin: $v[$key] = 1; → arg0[*]
        $r = $this->analyze('$v[$key] = 1; return $v;');
        $this->assertSame(['arg0[*]'], $r['modified_paths']);
    }

    public function test_modified_paths_dedup(): void
    {
        $r = $this->analyze('$v["x"] = 1; $v["x"] = 2; return $v;');
        $this->assertSame(['arg0[x]'], $r['modified_paths']);
    }

    // ── Nested closure non-traversal ───────────────────────────────────

    public function test_nested_closure_returns_not_counted(): void
    {
        // Pin: inner closure's return false is not counted toward outer.
        $r = $this->analyze('add_filter("x", function($w) { return false; }); return $v;');
        $this->assertSame('input_unchanged', $r['return_origin']);
    }

    // ── try/catch/finally ──────────────────────────────────────────────

    public function test_try_catch_returns_conditional(): void
    {
        $r = $this->analyze('try { return $v; } catch (\Exception $e) { return false; }');
        $this->assertSame('conditional', $r['return_origin']);
    }
}
