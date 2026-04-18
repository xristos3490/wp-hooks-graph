"""Unit tests for the WordPress hooks parser."""
import tempfile
import os
from parser import parse_file


def _parse_php(code):
    """Helper: write PHP code to a temp file and parse it."""
    with tempfile.NamedTemporaryFile(suffix=".php", delete=False, mode="wb") as f:
        if isinstance(code, str):
            code = code.encode("utf-8")
        f.write(code)
        f.flush()
        path = f.name
    try:
        return parse_file(path, source_label="test")
    finally:
        os.unlink(path)


def _parse_one(code):
    """Parse PHP code expecting exactly one hook call."""
    results = _parse_php(code)
    assert len(results) == 1, f"Expected 1 result, got {len(results)}: {results}"
    return results[0]


# --- Basic hook detection ---

def test_do_action_simple():
    r = _parse_one("<?php do_action('init');")
    assert r["func"] == "do_action"
    assert r["edge_type"] == "fires"
    assert r["hook_type"] == "action"
    assert r["hook_name"] == "init"
    assert r["dynamic"] is False

def test_apply_filters_simple():
    r = _parse_one("<?php apply_filters('the_content', $content);")
    assert r["func"] == "apply_filters"
    assert r["edge_type"] == "fires"
    assert r["hook_type"] == "filter"
    assert r["hook_name"] == "the_content"

def test_add_action_simple():
    r = _parse_one("<?php add_action('init', 'my_func');")
    assert r["func"] == "add_action"
    assert r["edge_type"] == "listens"
    assert r["hook_type"] == "action"
    assert r["hook_name"] == "init"
    assert r["callback"] == "my_func"
    assert r["priority"] == 10  # default

def test_add_filter_simple():
    r = _parse_one("<?php add_filter('the_title', 'my_filter');")
    assert r["func"] == "add_filter"
    assert r["edge_type"] == "listens"
    assert r["hook_type"] == "filter"
    assert r["hook_name"] == "the_title"
    assert r["callback"] == "my_filter"

def test_do_action_ref_array():
    r = _parse_one("<?php do_action_ref_array('save_post', array($post_id, $post));")
    assert r["func"] == "do_action_ref_array"
    assert r["edge_type"] == "fires"
    assert r["hook_type"] == "action"
    assert r["hook_name"] == "save_post"

def test_apply_filters_ref_array():
    r = _parse_one("<?php apply_filters_ref_array('some_filter', array($val));")
    assert r["func"] == "apply_filters_ref_array"
    assert r["edge_type"] == "fires"
    assert r["hook_type"] == "filter"
    assert r["hook_name"] == "some_filter"


# --- String formats ---

def test_double_quoted_string():
    r = _parse_one('<?php do_action("init");')
    assert r["hook_name"] == "init"
    assert r["dynamic"] is False

def test_single_quoted_string():
    r = _parse_one("<?php do_action('init');")
    assert r["hook_name"] == "init"
    assert r["dynamic"] is False


# --- Callback formats ---

def test_callback_string():
    r = _parse_one("<?php add_action('init', 'wp_cron');")
    assert r["callback"] == "wp_cron"

def test_callback_array_this():
    r = _parse_one("<?php add_action('init', array($this, 'my_method'));")
    assert r["callback"] == "$this::my_method"

def test_callback_array_class():
    r = _parse_one("<?php add_action('init', array('MyClass', 'my_method'));")
    assert r["callback"] == "MyClass::my_method"

def test_callback_closure():
    r = _parse_one("<?php add_action('init', function() { echo 'hi'; });")
    assert r["callback"] is not None  # fallback to text representation

def test_callback_variable():
    r = _parse_one("<?php add_action('init', $callback);")
    assert r["callback"] == "$callback"


# --- Priority ---

def test_priority_explicit():
    r = _parse_one("<?php add_action('init', 'my_func', 20);")
    assert r["priority"] == 20

def test_priority_default():
    r = _parse_one("<?php add_action('init', 'my_func');")
    assert r["priority"] == 10

def test_priority_early():
    r = _parse_one("<?php add_action('init', 'my_func', 1);")
    assert r["priority"] == 1

def test_priority_late():
    r = _parse_one("<?php add_action('init', 'my_func', 9999);")
    assert r["priority"] == 9999


# --- Dynamic hooks ---

def test_dynamic_variable():
    r = _parse_one("<?php do_action($hook_name);")
    assert r["dynamic"] is True
    assert r["hook_name"] is None
    assert r["raw_expression"] == "$hook_name"

def test_dynamic_concatenation():
    r = _parse_one("<?php do_action('prefix_' . $type);")
    assert r["dynamic"] is True
    assert r["hook_name"] == "prefix_*"
    assert r["raw_expression"] == "'prefix_' . $type"

def test_dynamic_concat_both_sides():
    r = _parse_one("<?php do_action($prefix . '_suffix');")
    assert r["dynamic"] is True
    assert r["hook_name"] == "*_suffix"

def test_dynamic_in_add_action():
    r = _parse_one("<?php add_action($hook, 'my_func', 5);")
    assert r["dynamic"] is True
    assert r["hook_name"] is None
    assert r["callback"] == "my_func"
    assert r["priority"] == 5


# --- Multi-line and formatting ---

def test_multiline_call():
    r = _parse_one("""<?php
add_action(
    'init',
    'my_func',
    10
);
""")
    assert r["hook_name"] == "init"
    assert r["callback"] == "my_func"
    assert r["priority"] == 10

def test_extra_whitespace():
    r = _parse_one("<?php   do_action(   'init'   );")
    assert r["hook_name"] == "init"

def test_tabs_and_indentation():
    r = _parse_one("<?php\n\t\tdo_action('init');")
    assert r["hook_name"] == "init"


# --- Multiple hooks in one file ---

def test_multiple_hooks():
    results = _parse_php("""<?php
do_action('init');
add_action('wp_head', 'my_header');
apply_filters('the_content', $content);
add_filter('the_title', 'my_title_filter');
""")
    assert len(results) == 4
    hooks = [r["hook_name"] for r in results]
    assert hooks == ["init", "wp_head", "the_content", "the_title"]


# --- Inside functions and classes ---

def test_hook_inside_function():
    r = _parse_one("""<?php
function my_setup() {
    do_action('my_custom_hook');
}
""")
    assert r["hook_name"] == "my_custom_hook"

def test_hook_inside_class_method():
    r = _parse_one("""<?php
class MyPlugin {
    public function init() {
        add_action('wp_head', array($this, 'render_header'));
    }
}
""")
    assert r["hook_name"] == "wp_head"
    assert r["callback"] == "MyPlugin::render_header"

def test_hook_inside_conditional():
    r = _parse_one("""<?php
if (is_admin()) {
    add_action('admin_init', 'setup_admin');
}
""")
    assert r["hook_name"] == "admin_init"
    assert r["callback"] == "setup_admin"


# --- Scope detection ---

def test_scope_top_level():
    r = _parse_one("<?php do_action('init');")
    assert r["scope_class"] is None
    assert r["scope_function"] is None

def test_scope_inside_function():
    r = _parse_one("""<?php
function my_setup() {
    do_action('my_hook');
}
""")
    assert r["scope_class"] is None
    assert r["scope_function"] == "my_setup"

def test_scope_inside_class_method():
    r = _parse_one("""<?php
class MyPlugin {
    public function register() {
        do_action('plugin_loaded');
    }
}
""")
    assert r["scope_class"] == "MyPlugin"
    assert r["scope_function"] == "register"

def test_scope_closure_in_method():
    results = _parse_php("""<?php
class MyPlugin {
    public function register() {
        add_action('init', function() {
            do_action('inner_hook');
        });
    }
}
""")
    inner = next(r for r in results if r["hook_name"] == "inner_hook")
    assert inner["scope_class"] == "MyPlugin"
    assert inner["scope_function"] == "register"


# --- Callback types ---

def test_callback_type_function():
    r = _parse_one("<?php add_action('init', 'my_func');")
    assert r["callback_type"] == "function"
    assert r["callback_class"] is None
    assert r["callback_method"] == "my_func"

def test_callback_type_method():
    r = _parse_one("""<?php
class MyPlugin {
    public function register() {
        add_action('init', array($this, 'handle'));
    }
}
""")
    assert r["callback_type"] == "method"
    assert r["callback_class"] == "MyPlugin"
    assert r["callback_method"] == "handle"
    assert r["callback"] == "MyPlugin::handle"

def test_callback_type_static_string():
    r = _parse_one("<?php add_action('init', array('Handler', 'run'));")
    assert r["callback_type"] == "static_method"
    assert r["callback_class"] == "Handler"
    assert r["callback_method"] == "run"
    assert r["callback"] == "Handler::run"

def test_callback_type_class_const():
    r = _parse_one("<?php add_action('init', [MyPlugin::class, 'handle']);")
    assert r["callback_type"] == "static_method"
    assert r["callback_class"] == "MyPlugin"
    assert r["callback_method"] == "handle"
    assert r["callback"] == "MyPlugin::handle"

def test_callback_self_class():
    r = _parse_one("""<?php
class MyPlugin {
    public function register() {
        add_action('init', array(self::class, 'handle'));
    }
}
""")
    assert r["callback_type"] == "static_method"
    assert r["callback_class"] == "MyPlugin"
    assert r["callback_method"] == "handle"
    assert r["callback"] == "MyPlugin::handle"

def test_callback_static_class():
    r = _parse_one("""<?php
class MyPlugin {
    public function register() {
        add_action('init', array(static::class, 'handle'));
    }
}
""")
    assert r["callback_type"] == "static_method"
    assert r["callback_class"] == "MyPlugin"
    assert r["callback_method"] == "handle"
    assert r["callback"] == "MyPlugin::handle"

def test_callback_static_string_notation():
    r = _parse_one("<?php add_action('init', 'MyClass::my_method');")
    assert r["callback_type"] == "static_method"
    assert r["callback_class"] == "MyClass"
    assert r["callback_method"] == "my_method"
    assert r["callback"] == "MyClass::my_method"

def test_callback_type_closure():
    r = _parse_one("<?php add_action('init', function() { echo 1; });")
    assert r["callback_type"] == "closure"
    assert r["callback_class"] is None
    assert r["callback_method"] is None

def test_callback_type_variable():
    r = _parse_one("<?php add_action('init', $callback);")
    assert r["callback_type"] == "variable"
    assert r["callback_class"] is None
    assert r["callback_method"] is None


# --- Line numbers ---

def test_line_numbers():
    results = _parse_php("""<?php
// line 2
do_action('hook_on_line_3');
// line 4
add_action('hook_on_line_5', 'cb');
""")
    assert results[0]["line"] == 3
    assert results[1]["line"] == 5


# --- Edge cases ---

def test_empty_file():
    results = _parse_php(b"")
    assert results == []

def test_no_hooks():
    results = _parse_php(b"<?php echo 'hello';")
    assert results == []

def test_non_hook_function_call():
    results = _parse_php(b"<?php my_function('init');")
    assert results == []

def test_similar_function_names():
    """Functions that contain hook function names but aren't hooks."""
    results = _parse_php(b"<?php my_do_action('test'); do_action_something('test');")
    assert results == []

def test_commented_out_hook():
    """Hooks in comments should still be parsed by tree-sitter (they're in the AST)."""
    results = _parse_php(b"<?php // do_action('init');")
    # Tree-sitter treats comments as comments, not code
    assert results == []

def test_hook_in_block_comment():
    results = _parse_php(b"<?php /* do_action('init'); */")
    assert results == []

def test_doc_comment_none():
    r = _parse_one("<?php do_action('init');")
    assert r["doc_comment"] is None

def test_doc_comment_single_line():
    r = _parse_one("""<?php
// Fires after WordPress is fully loaded.
do_action('wp_loaded');
""")
    assert r["doc_comment"] == "Fires after WordPress is fully loaded."

def test_doc_comment_double_slash_with_spaces():
    r = _parse_one("""<?php
//   Spaced comment
do_action('init');
""")
    assert r["doc_comment"] == "Spaced comment"

def test_doc_comment_block():
    r = _parse_one("""<?php
/* Filter the post title. */
apply_filters('the_title', $title);
""")
    assert r["doc_comment"] == "Filter the post title."

def test_doc_comment_docblock():
    r = _parse_one("""<?php
/** Fires on init. */
do_action('init');
""")
    assert r["doc_comment"] == "Fires on init."

def test_doc_comment_not_adjacent():
    r = _parse_one("""<?php
// This comment is too far away.

do_action('init');
""")
    assert r["doc_comment"] is None

def test_doc_comment_multiple_hooks():
    results = _parse_php("""<?php
// First hook comment
do_action('first');
do_action('second');
""")
    assert results[0]["doc_comment"] == "First hook comment"
    assert results[1]["doc_comment"] is None

def test_doc_comment_in_function():
    r = _parse_one("""<?php
function my_setup() {
    // Setup the init hook.
    do_action('my_hook');
}
""")
    assert r["doc_comment"] == "Setup the init hook."

def test_doc_comment_in_class():
    r = _parse_one("""<?php
class MyPlugin {
    public function register() {
        // Register the handler.
        add_action('init', 'handler');
    }
}
""")
    assert r["doc_comment"] == "Register the handler."

def test_source_label():
    r = _parse_one("<?php do_action('init');")
    assert r["source"] == "test"

def test_file_path_recorded():
    r = _parse_one("<?php do_action('init');")
    assert r["file"].endswith(".php")


# --- Run all tests ---

if __name__ == "__main__":
    test_funcs = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = 0
    failed = 0
    for func in test_funcs:
        try:
            func()
            passed += 1
            print(f"  PASS  {func.__name__}")
        except Exception as e:
            failed += 1
            print(f"  FAIL  {func.__name__}: {e}")
    print(f"\n{passed} passed, {failed} failed out of {passed + failed} tests")
