<?php
/**
 * Tests for parse_php_file() in hooks_graph.php.
 * Covers hook detection, callback extraction, scope tracking, dynamic names,
 * doc comments, and rejection of non-hook calls.
 */

// ── Basic hook detection ────────────────────────────────────

test('parser: single do_action literal', function () {
    $r = parse_source('<?php do_action("init");');
    assert_count(1, $r);
    assert_eq('do_action', $r[0]['func']);
    assert_eq('fires',     $r[0]['edge_type']);
    assert_eq('action',    $r[0]['hook_type']);
    assert_eq('init',      $r[0]['hook_name']);
    assert_false($r[0]['dynamic']);
});

test('parser: single apply_filters literal', function () {
    $r = parse_source('<?php apply_filters("the_title", $t);');
    assert_count(1, $r);
    assert_eq('filter', $r[0]['hook_type']);
    assert_eq('fires',  $r[0]['edge_type']);
});

test('parser: add_action registers listener', function () {
    $r = parse_source('<?php add_action("init", "my_init");');
    assert_count(1, $r);
    assert_eq('listens',  $r[0]['edge_type']);
    assert_eq('action',   $r[0]['hook_type']);
    assert_eq('my_init',  $r[0]['callback']);
    assert_eq('function', $r[0]['callback_type']);
});

test('parser: add_filter registers filter listener', function () {
    $r = parse_source('<?php add_filter("the_title", "my_cb");');
    assert_eq('listens', $r[0]['edge_type']);
    assert_eq('filter',  $r[0]['hook_type']);
});

test('parser: do_action_ref_array is an action', function () {
    $r = parse_source('<?php do_action_ref_array("init", array($a));');
    assert_eq('action', $r[0]['hook_type']);
    assert_eq('fires',  $r[0]['edge_type']);
});

test('parser: apply_filters_ref_array is a filter', function () {
    $r = parse_source('<?php apply_filters_ref_array("init", array($a));');
    assert_eq('filter', $r[0]['hook_type']);
});

test('parser: multiple hooks in one file', function () {
    $r = parse_source('<?php do_action("a"); do_action("b"); add_filter("c", "cb");');
    assert_count(3, $r);
});

test('parser: empty file returns no hooks', function () {
    $r = parse_source('<?php ');
    assert_count(0, $r);
});

// ── Non-hook call rejection ─────────────────────────────────

test('parser: method call $obj->do_action is not a hook', function () {
    $r = parse_source('<?php $obj->do_action("init");');
    assert_count(0, $r);
});

test('parser: static call Foo::do_action is not a hook', function () {
    $r = parse_source('<?php Foo::do_action("init");');
    assert_count(0, $r);
});

test('parser: nullsafe $obj?->do_action is not a hook', function () {
    $r = parse_source('<?php $obj?->do_action("init");');
    assert_count(0, $r);
});

test('parser: comments mentioning do_action are ignored', function () {
    $r = parse_source("<?php\n// do_action('fake');\n/* do_action('also_fake'); */");
    assert_count(0, $r);
});

// ── Hook name extraction ────────────────────────────────────

test('parser: bare variable hook name is dynamic', function () {
    $r = parse_source('<?php do_action($hook);');
    assert_null($r[0]['hook_name']);
    assert_true($r[0]['dynamic']);
});

test('parser: concat with variable produces wildcard', function () {
    $r = parse_source('<?php do_action("save_post_" . $type);');
    assert_eq('save_post_*', $r[0]['hook_name']);
    assert_true($r[0]['dynamic']);
});

test('parser: concat of two literals is not dynamic', function () {
    $r = parse_source('<?php do_action("save_" . "post");');
    assert_eq('save_post', $r[0]['hook_name']);
    assert_false($r[0]['dynamic']);
});

test('parser: double-quoted curly interpolation produces wildcard', function () {
    $r = parse_source('<?php do_action("save_post_{$type}");');
    assert_eq('save_post_*', $r[0]['hook_name']);
    assert_true($r[0]['dynamic']);
});

test('parser: double-quoted simple interpolation produces wildcard', function () {
    $r = parse_source('<?php do_action("update_option_theme_mods_$theme");');
    assert_eq('update_option_theme_mods_*', $r[0]['hook_name']);
    assert_true($r[0]['dynamic']);
});

test('parser: curly interpolation with object property produces wildcard', function () {
    $r = parse_source('<?php do_action("prefix_{$obj->prop}_suffix");');
    assert_eq('prefix_*_suffix', $r[0]['hook_name']);
    assert_true($r[0]['dynamic']);
});

test('parser: dollar-curly interpolation produces wildcard', function () {
    $r = parse_source('<?php do_action("${var}_name");');
    assert_eq('*_name', $r[0]['hook_name']);
    assert_true($r[0]['dynamic']);
});

test('parser: adjacent interpolations collapse to single wildcard', function () {
    $r = parse_source('<?php do_action("prefix_{$a}{$b}_suffix");');
    assert_eq('prefix_*_suffix', $r[0]['hook_name']);
    assert_true($r[0]['dynamic']);
});

test('parser: interpolation with no literal anchor is fully dynamic', function () {
    $r = parse_source('<?php do_action("$a$b");');
    assert_null($r[0]['hook_name']);
    assert_true($r[0]['dynamic']);
});

test('parser: heredoc with interpolation produces wildcard', function () {
    $code = "<?php do_action(<<<EOT\nprefix_\$var\nEOT\n);";
    $r = parse_source($code);
    assert_eq('prefix_*', $r[0]['hook_name']);
    assert_true($r[0]['dynamic']);
});

test('parser: nowdoc is literal (no interpolation)', function () {
    $code = "<?php do_action(<<<'EOT'\nliteral_hook\nEOT\n);";
    $r = parse_source($code);
    assert_eq('literal_hook', $r[0]['hook_name']);
    assert_false($r[0]['dynamic']);
});

test('parser: concat mixing interpolated and literal strings', function () {
    $r = parse_source('<?php do_action("a_$x" . "_middle_" . $b);');
    assert_eq('a_*_middle_*', $r[0]['hook_name']);
    assert_true($r[0]['dynamic']);
});

test('parser: concat with consecutive dynamic parts coalesces wildcards', function () {
    $r = parse_source('<?php do_action("prefix_" . $x . $y . "_suffix");');
    assert_eq('prefix_*_suffix', $r[0]['hook_name']);
    assert_true($r[0]['dynamic']);
});

test('parser: function call hook name is fully dynamic', function () {
    $r = parse_source('<?php do_action(get_hook_name());');
    assert_null($r[0]['hook_name']);
    assert_true($r[0]['dynamic']);
});

test('parser: leading curly interpolation does not swallow following args', function () {
    // Regression: the `}` inside "{$var}..." is a plain string char; split_args
    // must stay string-aware or it would push depth negative and glue all four
    // arguments into the first one.
    $r = parse_source('<?php add_filter( "{$template_type}_template", "gutenberg_get_template", 0, 3 );');
    assert_eq('*_template', $r[0]['hook_name']);
    assert_true($r[0]['dynamic']);
    assert_eq('gutenberg_get_template', $r[0]['callback']);
    assert_eq(0, $r[0]['priority']);
});

// ── Priority ────────────────────────────────────────────────

test('parser: priority defaults to 10', function () {
    $r = parse_source('<?php add_action("init", "cb");');
    assert_eq(10, $r[0]['priority']);
});

test('parser: explicit priority is captured', function () {
    $r = parse_source('<?php add_filter("x", "cb", 20);');
    assert_eq(20, $r[0]['priority']);
});

// ── Callback extraction ─────────────────────────────────────

test('callback: function name string', function () {
    $r = parse_source('<?php add_action("init", "my_cb");');
    assert_eq('my_cb',    $r[0]['callback']);
    assert_eq('function', $r[0]['callback_type']);
    assert_eq('my_cb',    $r[0]['callback_method']);
    assert_null($r[0]['callback_class']);
});

test('callback: Class::method string', function () {
    $r = parse_source('<?php add_action("init", "Foo::bar");');
    assert_eq('Foo::bar',      $r[0]['callback']);
    assert_eq('static_method', $r[0]['callback_type']);
    assert_eq('Foo',           $r[0]['callback_class']);
    assert_eq('bar',           $r[0]['callback_method']);
});

test('callback: array(ClassName, method) long syntax', function () {
    $r = parse_source('<?php add_action("init", array("Foo", "bar"));');
    assert_eq('Foo::bar',      $r[0]['callback']);
    assert_eq('static_method', $r[0]['callback_type']);
    assert_eq('Foo',           $r[0]['callback_class']);
    assert_eq('bar',           $r[0]['callback_method']);
});

test('callback: [ClassName, method] short syntax', function () {
    $r = parse_source('<?php add_action("init", ["Foo", "bar"]);');
    assert_eq('Foo::bar', $r[0]['callback']);
    assert_eq('Foo',      $r[0]['callback_class']);
});

test('callback: [$this, method] resolves to scope class', function () {
    $code = '<?php class Foo { public function reg() { add_action("init", [$this, "bar"]); } }';
    $r = parse_source($code);
    assert_eq('Foo::bar', $r[0]['callback']);
    assert_eq('method',   $r[0]['callback_type']);
    assert_eq('Foo',      $r[0]['callback_class']);
    assert_eq('bar',      $r[0]['callback_method']);
});

test('callback: [self::class, method] uses scope class', function () {
    $code = '<?php class Foo { public function reg() { add_action("init", [self::class, "bar"]); } }';
    $r = parse_source($code);
    assert_eq('Foo::bar',      $r[0]['callback']);
    assert_eq('static_method', $r[0]['callback_type']);
});

test('callback: [ClassName::class, method]', function () {
    $r = parse_source('<?php add_action("init", [Foo::class, "bar"]);');
    assert_eq('Foo::bar',      $r[0]['callback']);
    assert_eq('static_method', $r[0]['callback_type']);
    assert_eq('Foo',           $r[0]['callback_class']);
});

test('callback: closure', function () {
    $r = parse_source('<?php add_action("init", function () { return 1; });');
    assert_eq('closure', $r[0]['callback_type']);
});

test('callback: arrow function', function () {
    $r = parse_source('<?php add_action("init", fn() => 1);');
    assert_eq('closure', $r[0]['callback_type']);
});

test('callback: plain variable', function () {
    $r = parse_source('<?php add_action("init", $cb);');
    assert_eq('$cb',      $r[0]['callback']);
    assert_eq('variable', $r[0]['callback_type']);
});

// ── Scope tracking ──────────────────────────────────────────

test('scope: hook at top level has null scope', function () {
    $r = parse_source('<?php do_action("init");');
    assert_null($r[0]['scope_class']);
    assert_null($r[0]['scope_function']);
});

test('scope: hook inside top-level function', function () {
    $r = parse_source('<?php function top() { do_action("init"); }');
    assert_null($r[0]['scope_class']);
    assert_eq('top', $r[0]['scope_function']);
});

test('scope: hook inside class method', function () {
    $code = '<?php class Foo { public function bar() { do_action("init"); } }';
    $r = parse_source($code);
    assert_eq('Foo', $r[0]['scope_class']);
    assert_eq('bar', $r[0]['scope_function']);
});

test('scope: class scope cleared after closing brace', function () {
    $code = '<?php class Foo { public function bar() { do_action("a"); } } do_action("b");';
    $r = parse_source($code);
    assert_count(2, $r);
    assert_eq('Foo', $r[0]['scope_class']);
    assert_null($r[1]['scope_class']);
    assert_null($r[1]['scope_function']);
});

// ── Doc comments ────────────────────────────────────────────

test('doc_comment: adjacent block comment is captured', function () {
    $code = "<?php\n/**\n * Fires on init.\n */\ndo_action('init');";
    $r = parse_source($code);
    assert_contains('Fires on init.', $r[0]['doc_comment']);
});

test('doc_comment: blank-line gap breaks association', function () {
    $code = "<?php\n/**\n * unrelated\n */\n\ndo_action('init');";
    $r = parse_source($code);
    assert_null($r[0]['doc_comment']);
});

test('doc_comment: line comment is captured', function () {
    $code = "<?php\n// single line note\ndo_action('init');";
    $r = parse_source($code);
    assert_eq('single line note', $r[0]['doc_comment']);
});

// ── Metadata plumbing ───────────────────────────────────────

test('metadata: source label is set on each call', function () {
    $r = parse_source('<?php do_action("x");', 'wp-core');
    assert_eq('wp-core', $r[0]['source']);
});

test('metadata: line numbers are 1-indexed', function () {
    $r = parse_source("<?php\n\ndo_action('init');");
    assert_eq(3, $r[0]['line']);
});
