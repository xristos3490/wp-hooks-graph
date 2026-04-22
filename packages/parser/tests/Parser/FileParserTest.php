<?php

declare(strict_types=1);

namespace HooksGraph\Tests\Parser;

use HooksGraph\Tests\Support\ParsesSource;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\TestCase;
use HooksGraph\Parser\FileParser;
use HooksGraph\Parser\CallbackExtractor;
use HooksGraph\Parser\HookNameExtractor;
use HooksGraph\Parser\DocCommentExtractor;
use HooksGraph\Parser\ScopeTracker;
use HooksGraph\Parser\Tokens;

#[CoversClass(FileParser::class)]
#[CoversClass(CallbackExtractor::class)]
#[CoversClass(HookNameExtractor::class)]
#[CoversClass(DocCommentExtractor::class)]
#[CoversClass(ScopeTracker::class)]
#[CoversClass(Tokens::class)]
final class FileParserTest extends TestCase
{
    use ParsesSource;

    // ── Basic hook detection ────────────────────────────────────

    public function test_single_do_action_literal(): void
    {
        $r = $this->parseSource('<?php do_action("init");');
        $this->assertCount(1, $r);
        $this->assertSame('do_action', $r[0]['func']);
        $this->assertSame('fires',     $r[0]['edge_type']);
        $this->assertSame('action',    $r[0]['hook_type']);
        $this->assertSame('init',      $r[0]['hook_name']);
        $this->assertFalse($r[0]['dynamic']);
    }

    public function test_single_apply_filters_literal(): void
    {
        $r = $this->parseSource('<?php apply_filters("the_title", $t);');
        $this->assertCount(1, $r);
        $this->assertSame('filter', $r[0]['hook_type']);
        $this->assertSame('fires',  $r[0]['edge_type']);
    }

    public function test_add_action_registers_listener(): void
    {
        $r = $this->parseSource('<?php add_action("init", "my_init");');
        $this->assertCount(1, $r);
        $this->assertSame('listens',  $r[0]['edge_type']);
        $this->assertSame('action',   $r[0]['hook_type']);
        $this->assertSame('my_init',  $r[0]['callback']);
        $this->assertSame('function', $r[0]['callback_type']);
    }

    public function test_add_filter_registers_filter_listener(): void
    {
        $r = $this->parseSource('<?php add_filter("the_title", "my_cb");');
        $this->assertSame('listens', $r[0]['edge_type']);
        $this->assertSame('filter',  $r[0]['hook_type']);
    }

    public function test_do_action_ref_array_is_an_action(): void
    {
        $r = $this->parseSource('<?php do_action_ref_array("init", array($a));');
        $this->assertSame('action', $r[0]['hook_type']);
        $this->assertSame('fires',  $r[0]['edge_type']);
    }

    public function test_apply_filters_ref_array_is_a_filter(): void
    {
        $r = $this->parseSource('<?php apply_filters_ref_array("init", array($a));');
        $this->assertSame('filter', $r[0]['hook_type']);
    }

    public function test_multiple_hooks_in_one_file(): void
    {
        $r = $this->parseSource('<?php do_action("a"); do_action("b"); add_filter("c", "cb");');
        $this->assertCount(3, $r);
    }

    public function test_empty_file_returns_no_hooks(): void
    {
        $r = $this->parseSource('<?php ');
        $this->assertCount(0, $r);
    }

    // ── Non-hook call rejection ─────────────────────────────────

    public function test_method_call_is_not_a_hook(): void
    {
        $r = $this->parseSource('<?php $obj->do_action("init");');
        $this->assertCount(0, $r);
    }

    public function test_static_call_is_not_a_hook(): void
    {
        $r = $this->parseSource('<?php Foo::do_action("init");');
        $this->assertCount(0, $r);
    }

    public function test_nullsafe_call_is_not_a_hook(): void
    {
        $r = $this->parseSource('<?php $obj?->do_action("init");');
        $this->assertCount(0, $r);
    }

    public function test_comments_are_ignored(): void
    {
        $r = $this->parseSource("<?php\n// do_action('fake');\n/* do_action('also_fake'); */");
        $this->assertCount(0, $r);
    }

    // ── Hook name extraction ────────────────────────────────────

    public function test_bare_variable_hook_name_is_dynamic(): void
    {
        $r = $this->parseSource('<?php do_action($hook);');
        $this->assertNull($r[0]['hook_name']);
        $this->assertTrue($r[0]['dynamic']);
    }

    public function test_concat_with_variable_produces_wildcard(): void
    {
        $r = $this->parseSource('<?php do_action("save_post_" . $type);');
        $this->assertSame('save_post_*', $r[0]['hook_name']);
        $this->assertTrue($r[0]['dynamic']);
    }

    public function test_concat_of_two_literals_is_not_dynamic(): void
    {
        $r = $this->parseSource('<?php do_action("save_" . "post");');
        $this->assertSame('save_post', $r[0]['hook_name']);
        $this->assertFalse($r[0]['dynamic']);
    }

    public function test_double_quoted_curly_interpolation_produces_wildcard(): void
    {
        $r = $this->parseSource('<?php do_action("save_post_{$type}");');
        $this->assertSame('save_post_*', $r[0]['hook_name']);
        $this->assertTrue($r[0]['dynamic']);
    }

    public function test_double_quoted_simple_interpolation_produces_wildcard(): void
    {
        $r = $this->parseSource('<?php do_action("update_option_theme_mods_$theme");');
        $this->assertSame('update_option_theme_mods_*', $r[0]['hook_name']);
        $this->assertTrue($r[0]['dynamic']);
    }

    public function test_curly_interpolation_with_object_property_produces_wildcard(): void
    {
        $r = $this->parseSource('<?php do_action("prefix_{$obj->prop}_suffix");');
        $this->assertSame('prefix_*_suffix', $r[0]['hook_name']);
        $this->assertTrue($r[0]['dynamic']);
    }

    public function test_dollar_curly_interpolation_produces_wildcard(): void
    {
        $r = $this->parseSource('<?php do_action("${var}_name");');
        $this->assertSame('*_name', $r[0]['hook_name']);
        $this->assertTrue($r[0]['dynamic']);
    }

    public function test_adjacent_interpolations_collapse_to_single_wildcard(): void
    {
        $r = $this->parseSource('<?php do_action("prefix_{$a}{$b}_suffix");');
        $this->assertSame('prefix_*_suffix', $r[0]['hook_name']);
        $this->assertTrue($r[0]['dynamic']);
    }

    public function test_interpolation_without_literal_anchor_is_fully_dynamic(): void
    {
        $r = $this->parseSource('<?php do_action("$a$b");');
        $this->assertNull($r[0]['hook_name']);
        $this->assertTrue($r[0]['dynamic']);
    }

    public function test_heredoc_with_interpolation_produces_wildcard(): void
    {
        $code = "<?php do_action(<<<EOT\nprefix_\$var\nEOT\n);";
        $r    = $this->parseSource($code);
        $this->assertSame('prefix_*', $r[0]['hook_name']);
        $this->assertTrue($r[0]['dynamic']);
    }

    public function test_nowdoc_is_literal(): void
    {
        $code = "<?php do_action(<<<'EOT'\nliteral_hook\nEOT\n);";
        $r    = $this->parseSource($code);
        $this->assertSame('literal_hook', $r[0]['hook_name']);
        $this->assertFalse($r[0]['dynamic']);
    }

    public function test_concat_mixing_interpolated_and_literal_strings(): void
    {
        $r = $this->parseSource('<?php do_action("a_$x" . "_middle_" . $b);');
        $this->assertSame('a_*_middle_*', $r[0]['hook_name']);
        $this->assertTrue($r[0]['dynamic']);
    }

    public function test_concat_with_consecutive_dynamic_parts_coalesces_wildcards(): void
    {
        $r = $this->parseSource('<?php do_action("prefix_" . $x . $y . "_suffix");');
        $this->assertSame('prefix_*_suffix', $r[0]['hook_name']);
        $this->assertTrue($r[0]['dynamic']);
    }

    public function test_function_call_hook_name_is_fully_dynamic(): void
    {
        $r = $this->parseSource('<?php do_action(get_hook_name());');
        $this->assertNull($r[0]['hook_name']);
        $this->assertTrue($r[0]['dynamic']);
    }

    public function test_leading_curly_interpolation_does_not_swallow_following_args(): void
    {
        // Regression: the `}` inside "{$var}..." is a plain string char; splitArgs
        // must stay string-aware or it would push depth negative and glue all four
        // arguments into the first one.
        $r = $this->parseSource('<?php add_filter( "{$template_type}_template", "gutenberg_get_template", 0, 3 );');
        $this->assertSame('*_template', $r[0]['hook_name']);
        $this->assertTrue($r[0]['dynamic']);
        $this->assertSame('gutenberg_get_template', $r[0]['callback']);
        $this->assertSame(0, $r[0]['priority']);
    }

    // ── Priority ────────────────────────────────────────────────

    public function test_priority_defaults_to_ten(): void
    {
        $r = $this->parseSource('<?php add_action("init", "cb");');
        $this->assertSame(10, $r[0]['priority']);
    }

    public function test_explicit_priority_is_captured(): void
    {
        $r = $this->parseSource('<?php add_filter("x", "cb", 20);');
        $this->assertSame(20, $r[0]['priority']);
    }

    // ── Callback extraction ─────────────────────────────────────

    public function test_callback_function_name_string(): void
    {
        $r = $this->parseSource('<?php add_action("init", "my_cb");');
        $this->assertSame('my_cb',    $r[0]['callback']);
        $this->assertSame('function', $r[0]['callback_type']);
        $this->assertSame('my_cb',    $r[0]['callback_method']);
        $this->assertNull($r[0]['callback_class']);
    }

    public function test_callback_class_method_string(): void
    {
        $r = $this->parseSource('<?php add_action("init", "Foo::bar");');
        $this->assertSame('Foo::bar',      $r[0]['callback']);
        $this->assertSame('static_method', $r[0]['callback_type']);
        $this->assertSame('Foo',           $r[0]['callback_class']);
        $this->assertSame('bar',           $r[0]['callback_method']);
    }

    public function test_callback_array_long_syntax(): void
    {
        $r = $this->parseSource('<?php add_action("init", array("Foo", "bar"));');
        $this->assertSame('Foo::bar',      $r[0]['callback']);
        $this->assertSame('static_method', $r[0]['callback_type']);
        $this->assertSame('Foo',           $r[0]['callback_class']);
        $this->assertSame('bar',           $r[0]['callback_method']);
    }

    public function test_callback_array_short_syntax(): void
    {
        $r = $this->parseSource('<?php add_action("init", ["Foo", "bar"]);');
        $this->assertSame('Foo::bar', $r[0]['callback']);
        $this->assertSame('Foo',      $r[0]['callback_class']);
    }

    public function test_callback_this_resolves_to_scope_class(): void
    {
        $code = '<?php class Foo { public function reg() { add_action("init", [$this, "bar"]); } }';
        $r    = $this->parseSource($code);
        $this->assertSame('Foo::bar', $r[0]['callback']);
        $this->assertSame('method',   $r[0]['callback_type']);
        $this->assertSame('Foo',      $r[0]['callback_class']);
        $this->assertSame('bar',      $r[0]['callback_method']);
    }

    public function test_callback_self_class_uses_scope_class(): void
    {
        $code = '<?php class Foo { public function reg() { add_action("init", [self::class, "bar"]); } }';
        $r    = $this->parseSource($code);
        $this->assertSame('Foo::bar',      $r[0]['callback']);
        $this->assertSame('static_method', $r[0]['callback_type']);
    }

    public function test_callback_class_name_class_literal(): void
    {
        $r = $this->parseSource('<?php add_action("init", [Foo::class, "bar"]);');
        $this->assertSame('Foo::bar',      $r[0]['callback']);
        $this->assertSame('static_method', $r[0]['callback_type']);
        $this->assertSame('Foo',           $r[0]['callback_class']);
    }

    public function test_callback_closure(): void
    {
        $r = $this->parseSource('<?php add_action("init", function () { return 1; });');
        $this->assertSame('closure', $r[0]['callback_type']);
    }

    public function test_callback_arrow_function(): void
    {
        $r = $this->parseSource('<?php add_action("init", fn() => 1);');
        $this->assertSame('closure', $r[0]['callback_type']);
    }

    public function test_callback_plain_variable(): void
    {
        $r = $this->parseSource('<?php add_action("init", $cb);');
        $this->assertSame('$cb',      $r[0]['callback']);
        $this->assertSame('variable', $r[0]['callback_type']);
    }

    // ── Scope tracking ──────────────────────────────────────────

    public function test_scope_hook_at_top_level_has_null_scope(): void
    {
        $r = $this->parseSource('<?php do_action("init");');
        $this->assertNull($r[0]['scope_class']);
        $this->assertNull($r[0]['scope_function']);
    }

    public function test_scope_hook_inside_top_level_function(): void
    {
        $r = $this->parseSource('<?php function top() { do_action("init"); }');
        $this->assertNull($r[0]['scope_class']);
        $this->assertSame('top', $r[0]['scope_function']);
    }

    public function test_scope_hook_inside_class_method(): void
    {
        $code = '<?php class Foo { public function bar() { do_action("init"); } }';
        $r    = $this->parseSource($code);
        $this->assertSame('Foo', $r[0]['scope_class']);
        $this->assertSame('bar', $r[0]['scope_function']);
    }

    public function test_scope_class_cleared_after_closing_brace(): void
    {
        $code = '<?php class Foo { public function bar() { do_action("a"); } } do_action("b");';
        $r    = $this->parseSource($code);
        $this->assertCount(2, $r);
        $this->assertSame('Foo', $r[0]['scope_class']);
        $this->assertNull($r[1]['scope_class']);
        $this->assertNull($r[1]['scope_function']);
    }

    // ── Doc comments ────────────────────────────────────────────

    public function test_doc_comment_adjacent_block_comment_is_captured(): void
    {
        $code = "<?php\n/**\n * Fires on init.\n */\ndo_action('init');";
        $r    = $this->parseSource($code);
        $this->assertStringContainsString('Fires on init.', $r[0]['doc_comment']);
    }

    public function test_doc_comment_blank_line_gap_breaks_association(): void
    {
        $code = "<?php\n/**\n * unrelated\n */\n\ndo_action('init');";
        $r    = $this->parseSource($code);
        $this->assertNull($r[0]['doc_comment']);
    }

    public function test_doc_comment_line_comment_is_captured(): void
    {
        $code = "<?php\n// single line note\ndo_action('init');";
        $r    = $this->parseSource($code);
        $this->assertSame('single line note', $r[0]['doc_comment']);
    }

    // ── Metadata plumbing ───────────────────────────────────────

    public function test_metadata_source_label_is_set(): void
    {
        $r = $this->parseSource('<?php do_action("x");', 'wp-core');
        $this->assertSame('wp-core', $r[0]['source']);
    }

    public function test_metadata_line_numbers_are_one_indexed(): void
    {
        $r = $this->parseSource("<?php\n\ndo_action('init');");
        $this->assertSame(3, $r[0]['line']);
    }
}
