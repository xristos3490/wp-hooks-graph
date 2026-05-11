<?php

declare(strict_types=1);

namespace HooksGraph\Tests\Parser;

use HooksGraph\Parser\CallbackBodyAnalyzer;
use HooksGraph\Parser\FilterReturnAnalyzer;
use HooksGraph\Parser\WpApiMap;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

#[CoversClass(CallbackBodyAnalyzer::class)]
#[CoversClass(WpApiMap::class)]
#[CoversClass(FilterReturnAnalyzer::class)]
final class CallbackBodyAnalyzerTest extends TestCase
{
    /**
     * Tokenise a PHP body snippet (without enclosing braces) into the token slice
     * that CallbackBodyAnalyzer expects.
     */
    private function bodyTokens(string $php): array
    {
        // Wrap in a sentinel function so token_get_all sees a proper file, then
        // slice between the braces.
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

    private function analyze(string $php, array $context = []): array
    {
        return CallbackBodyAnalyzer::analyze($this->bodyTokens($php), $context);
    }

    // ── WP API literal extraction ───────────────────────────────────────

    public function test_get_option_literal(): void
    {
        $r = $this->analyze('get_option("foo");');
        $this->assertContains('reads_option', $r['effects']);
        $this->assertContainsTarget($r['targets'], 'option', 'foo', 'read');
    }

    public function test_update_option_literal(): void
    {
        $r = $this->analyze('update_option("foo", $v);');
        $this->assertContains('writes_option', $r['effects']);
        $this->assertContainsTarget($r['targets'], 'option', 'foo', 'write');
    }

    public function test_delete_option_folds_into_writes_option(): void
    {
        // Pin: delete_option emits writes_option effect (not a separate reads/deletes tag).
        $r = $this->analyze('delete_option("foo");');
        $this->assertContains('writes_option', $r['effects']);
        $this->assertContainsTarget($r['targets'], 'option', 'foo', 'write');
    }

    public function test_get_post_meta_key_is_second_arg(): void
    {
        $r = $this->analyze('get_post_meta($id, "_price", true);');
        $this->assertContains('reads_post_meta', $r['effects']);
        $this->assertContainsTarget($r['targets'], 'post_meta', '_price', 'read');
    }

    public function test_update_user_meta(): void
    {
        $r = $this->analyze('update_user_meta($id, "name", $v);');
        $this->assertContainsTarget($r['targets'], 'user_meta', 'name', 'write');
    }

    public function test_update_term_meta(): void
    {
        $r = $this->analyze('update_term_meta($id, "color", $v);');
        $this->assertContainsTarget($r['targets'], 'term_meta', 'color', 'write');
    }

    public function test_set_transient(): void
    {
        $r = $this->analyze('set_transient("k", $v, 60);');
        $this->assertContains('writes_transient', $r['effects']);
        $this->assertContainsTarget($r['targets'], 'transient', 'k', 'write');
    }

    public function test_delete_transient(): void
    {
        $r = $this->analyze('delete_transient("k");');
        $this->assertContainsTarget($r['targets'], 'transient', 'k', 'write');
    }

    public function test_current_user_can_emits_target_but_no_effect(): void
    {
        // Pin: capability checks emit a target but no effect tag.
        $r = $this->analyze('current_user_can("manage_options");');
        $this->assertNotContains('reads_option', $r['effects']);
        $this->assertContainsTarget($r['targets'], 'capability', 'manage_options', 'check');
    }

    public function test_do_action_inside_callback_body(): void
    {
        $r = $this->analyze('do_action("x");');
        $this->assertContains('fires_hook', $r['effects']);
        $this->assertContainsTarget($r['targets'], 'hook_fire', 'x', 'fire');
    }

    public function test_apply_filters_inside_callback_body(): void
    {
        $r = $this->analyze('apply_filters("x", $v);');
        $this->assertContains('fires_hook', $r['effects']);
        $this->assertContainsTarget($r['targets'], 'hook_fire', 'x', 'fire');
    }

    public function test_wp_remote_get_emits_io_http(): void
    {
        $r = $this->analyze('wp_remote_get("https://example.com");');
        $this->assertContains('io_http', $r['effects']);
    }

    public function test_wp_mail_emits_io_mail(): void
    {
        $r = $this->analyze('wp_mail($to, $subject, $body);');
        $this->assertContains('io_mail', $r['effects']);
    }

    public function test_wp_redirect_emits_redirect(): void
    {
        $r = $this->analyze('wp_redirect($url);');
        $this->assertContains('redirect', $r['effects']);
    }

    public function test_wp_send_json_emits_output(): void
    {
        $r = $this->analyze('wp_send_json(["ok" => true]);');
        $this->assertContains('output', $r['effects']);
    }

    public function test_echo_emits_output(): void
    {
        $r = $this->analyze('echo "hi";');
        $this->assertContains('output', $r['effects']);
    }

    public function test_file_put_contents_emits_io_fs(): void
    {
        $r = $this->analyze('file_put_contents($path, $data);');
        $this->assertContains('io_fs', $r['effects']);
    }

    public function test_wp_cache_get_emits_cache_read(): void
    {
        $r = $this->analyze('wp_cache_get("k", "g");');
        $this->assertContains('cache_read', $r['effects']);
    }

    public function test_wp_cache_set_emits_cache_write(): void
    {
        $r = $this->analyze('wp_cache_set("k", $v);');
        $this->assertContains('cache_write', $r['effects']);
    }

    // ── Dynamic-key fallback ────────────────────────────────────────────

    public function test_dynamic_option_key_emits_effect_without_target(): void
    {
        $r = $this->analyze('update_option($key, 1);');
        $this->assertContains('writes_option', $r['effects']);
        foreach ($r['targets'] as $t) {
            $this->assertNotSame('option', $t['kind']);
        }
    }

    public function test_interpolated_option_key_emits_effect_without_target(): void
    {
        $r = $this->analyze('update_option("prefix_$x", 1);');
        $this->assertContains('writes_option', $r['effects']);
        foreach ($r['targets'] as $t) {
            $this->assertNotSame('option', $t['kind']);
        }
    }

    public function test_dynamic_post_meta_key_emits_effect_without_target(): void
    {
        $r = $this->analyze('get_post_meta($id, $key, true);');
        $this->assertContains('reads_post_meta', $r['effects']);
        foreach ($r['targets'] as $t) {
            $this->assertNotSame('post_meta', $t['kind']);
        }
    }

    // ── Namespacing / resolution edges ──────────────────────────────────

    public function test_leading_backslash_tolerated(): void
    {
        $r = $this->analyze('\get_option("foo");');
        $this->assertContainsTarget($r['targets'], 'option', 'foo', 'read');
    }

    public function test_namespaced_function_not_matched(): void
    {
        $r = $this->analyze('\MyNs\get_option("foo");');
        $this->assertEmpty($r['effects']);
        $this->assertEmpty(array_filter($r['targets'], fn ($t) => $t['kind'] === 'option'));
    }

    public function test_static_method_not_matched_as_global_function(): void
    {
        $r = $this->analyze('Foo::get_option("foo");');
        $this->assertEmpty($r['effects']);
    }

    // ── Chain extraction ────────────────────────────────────────────────

    public function test_chain_object_property_read(): void
    {
        $r = $this->analyze('$x = $product->price;');
        $this->assertContainsTarget($r['targets'], 'chain', 'product.price', 'read');
    }

    public function test_chain_array_index_read(): void
    {
        $r = $this->analyze('$x = $cart["total"];');
        $this->assertContainsTarget($r['targets'], 'chain', 'cart[total]', 'read');
    }

    public function test_chain_array_index_write(): void
    {
        $r = $this->analyze('$cart["total"] = 10;');
        $this->assertContainsTarget($r['targets'], 'chain', 'cart[total]', 'write');
    }

    public function test_chain_deep_property(): void
    {
        $r = $this->analyze('$y = $obj->a->b->c;');
        $this->assertContainsTarget($r['targets'], 'chain', 'obj.a.b.c', 'read');
    }

    public function test_chain_nested_array(): void
    {
        $r = $this->analyze('$y = $arr["x"]["y"];');
        $this->assertContainsTarget($r['targets'], 'chain', 'arr[x][y]', 'read');
    }

    public function test_chain_empty_index_append_write(): void
    {
        $r = $this->analyze('$arr[] = 1;');
        $this->assertContainsTarget($r['targets'], 'chain', 'arr[]', 'write');
    }

    public function test_chain_unset_is_write(): void
    {
        $r = $this->analyze('unset($cart["total"]);');
        $this->assertContainsTarget($r['targets'], 'chain', 'cart[total]', 'write');
    }

    public function test_chain_prefix_inc_is_write(): void
    {
        $r = $this->analyze('++$counter->value;');
        $this->assertContainsTarget($r['targets'], 'chain', 'counter.value', 'write');
    }

    public function test_method_call_does_not_produce_chain(): void
    {
        // Pin: method calls ($x->foo()) never produce chains; only properties / array keys do.
        $r = $this->analyze('$x->foo();');
        foreach ($r['targets'] as $t) {
            $this->assertNotSame('chain', $t['kind'], 'unexpected chain: ' . $t['key']);
        }
        $this->assertSame([], $r['targets']);
    }

    public function test_static_property_skipped_in_v1(): void
    {
        // Pin: Foo::$bar (static property) is not extracted as a chain in v1.
        $r = $this->analyze('$x = Foo::$bar;');
        foreach ($r['targets'] as $t) {
            $this->assertNotSame('chain', $t['kind']);
        }
        $this->assertTrue(true);
    }

    // ── Effect rollup ───────────────────────────────────────────────────

    public function test_effects_deduplicated(): void
    {
        $r = $this->analyze('get_option("a"); get_option("b"); get_option("c");');
        $count = 0;
        foreach ($r['effects'] as $e) {
            if ($e === 'reads_option') $count++;
        }
        $this->assertSame(1, $count);
    }

    public function test_effects_sorted_deterministically(): void
    {
        $r = $this->analyze('update_option("x", 1); get_option("y");');
        $sorted = $r['effects'];
        $copy = $sorted;
        sort($copy);
        $this->assertSame($copy, $sorted);
    }

    public function test_called_apis_deduplicated(): void
    {
        $r = $this->analyze('get_option("a"); get_option("b");');
        $hits = array_filter($r['called_apis'], fn ($n) => $n === 'get_option');
        $this->assertCount(1, $hits);
    }

    // ── Globals / superglobals ──────────────────────────────────────────

    public function test_wpdb_global_use(): void
    {
        $r = $this->analyze('$x = $wpdb->prefix;');
        $this->assertContainsTarget($r['targets'], 'global', 'wpdb', 'read');
    }

    public function test_globals_subscript_normalises(): void
    {
        $r = $this->analyze('$x = $GLOBALS["wpdb"];');
        $this->assertContainsTarget($r['targets'], 'global', 'wpdb', 'read');
    }

    public function test_superglobal_get_with_index(): void
    {
        $r = $this->analyze('$a = $_GET["action"];');
        $this->assertContainsTarget($r['targets'], 'superglobal', '_GET.action', 'read');
    }

    public function test_superglobal_post_whole(): void
    {
        $r = $this->analyze('$a = $_POST;');
        $this->assertContainsTarget($r['targets'], 'superglobal', '_POST', 'read');
    }

    public function test_wpdb_query_method_emits_writes_db(): void
    {
        // Pin: $wpdb->query($sql) → writes_db, no target (dynamic SQL).
        $r = $this->analyze('$wpdb->query($sql);');
        $this->assertContains('writes_db', $r['effects']);
    }

    public function test_wpdb_insert_with_literal_table(): void
    {
        $r = $this->analyze('$wpdb->insert("my_table", ["a" => 1]);');
        $this->assertContains('writes_db', $r['effects']);
        $this->assertContainsTarget($r['targets'], 'db_table', 'my_table', 'write');
    }

    public function test_wpdb_get_var_emits_reads_db(): void
    {
        $r = $this->analyze('$x = $wpdb->get_var("SELECT 1");');
        $this->assertContains('reads_db', $r['effects']);
    }

    // ── Nested closure isolation ────────────────────────────────────────

    public function test_nested_closure_effects_not_counted(): void
    {
        // Pin: WP API calls inside a nested closure within the body are NOT counted
        // toward the outer callback's effects.
        $r = $this->analyze('add_action("x", function() { update_option("inner", 1); });');
        $this->assertNotContains('writes_option', $r['effects']);
    }

    public function test_nested_arrow_fn_effects_not_counted(): void
    {
        $r = $this->analyze('$f = fn() => update_option("inner", 1);');
        $this->assertNotContains('writes_option', $r['effects']);
    }

    // ── Boundary cases ──────────────────────────────────────────────────

    public function test_empty_body(): void
    {
        $r = $this->analyze('');
        $this->assertSame([], $r['effects']);
        $this->assertSame([], $r['targets']);
        $this->assertSame([], $r['called_apis']);
    }

    public function test_comments_only_body(): void
    {
        $r = $this->analyze('// just a comment');
        $this->assertSame([], $r['effects']);
        $this->assertSame([], $r['targets']);
    }

    // ── Filter behavior attachment ──────────────────────────────────────

    public function test_filter_behavior_attached_for_filter_context(): void
    {
        $r = $this->analyze('return $v;', ['hook_kind' => 'filter', 'first_param' => 'v']);
        $this->assertArrayHasKey('filter_behavior', $r);
        $this->assertSame('input_unchanged', $r['filter_behavior']['return_origin']);
    }

    public function test_filter_behavior_absent_for_action_context(): void
    {
        $r = $this->analyze('echo "x";', ['hook_kind' => 'action', 'first_param' => null]);
        $this->assertArrayNotHasKey('filter_behavior', $r);
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    private function assertContainsTarget(array $targets, string $kind, string $key, string $op): void
    {
        foreach ($targets as $t) {
            if ($t['kind'] === $kind && $t['key'] === $key && $t['op'] === $op) {
                $this->assertTrue(true);
                return;
            }
        }
        $this->fail("No target matches kind={$kind} key={$key} op={$op}. Got: " . var_export($targets, true));
    }
}
