"""Unit tests for the graph builder."""
from graph import build_graph, filter_graph_by_overlap


def _make_call(**overrides):
    """Create a hook call dict with defaults."""
    base = {
        "func": "do_action",
        "edge_type": "fires",
        "hook_type": "action",
        "hook_name": "init",
        "dynamic": False,
        "raw_expression": None,
        "callback": None,
        "callback_type": None,
        "callback_class": None,
        "callback_method": None,
        "priority": 10,
        "file": "/wp/wp-settings.php",
        "line": 100,
        "source": "wordpress",
        "scope_class": None,
        "scope_function": None,
        "doc_comment": None,
    }
    base.update(overrides)
    return base


# --- Basic structure ---

def test_empty_input():
    g = build_graph([], ["/wp"], total_files=0)
    assert g["metadata"]["total_hooks"] == 0
    assert g["metadata"]["dynamic_hooks"] == 0
    assert g["nodes"] == []
    assert g["edges"] == []

def test_single_fires_call():
    calls = [_make_call()]
    g = build_graph(calls, ["/wp"], total_files=1)
    assert g["metadata"]["total_hooks"] == 1
    assert len(g["nodes"]) == 2  # 1 hook + 1 file
    assert len(g["edges"]) == 1

    hook = next(n for n in g["nodes"] if n["type"] == "hook")
    assert hook["name"] == "init"
    assert hook["hook_type"] == "action"
    assert hook["fire_count"] == 1
    assert hook["listen_count"] == 0

    file_node = next(n for n in g["nodes"] if n["type"] == "file")
    assert file_node["hook_count"] == 1

def test_single_listens_call():
    calls = [_make_call(
        func="add_action", edge_type="listens",
        callback="my_func", priority=20,
    )]
    g = build_graph(calls, ["/wp"], total_files=1)

    hook = next(n for n in g["nodes"] if n["type"] == "hook")
    assert hook["fire_count"] == 0
    assert hook["listen_count"] == 1

    edge = g["edges"][0]
    assert edge["type"] == "listens"
    assert edge["callback"] == "my_func"
    assert edge["priority"] == 20


# --- Hook deduplication ---

def test_same_hook_multiple_files():
    calls = [
        _make_call(file="/wp/a.php", line=10),
        _make_call(file="/wp/b.php", line=20, func="add_action", edge_type="listens", callback="cb"),
    ]
    g = build_graph(calls, ["/wp"], total_files=2)

    hooks = [n for n in g["nodes"] if n["type"] == "hook"]
    assert len(hooks) == 1  # deduplicated
    assert hooks[0]["fire_count"] == 1
    assert hooks[0]["listen_count"] == 1

    files = [n for n in g["nodes"] if n["type"] == "file"]
    assert len(files) == 2

    assert len(g["edges"]) == 2

def test_same_hook_same_file():
    calls = [
        _make_call(line=10),
        _make_call(line=20, func="add_action", edge_type="listens", callback="cb"),
    ]
    g = build_graph(calls, ["/wp"], total_files=1)

    hooks = [n for n in g["nodes"] if n["type"] == "hook"]
    assert len(hooks) == 1
    assert hooks[0]["fire_count"] == 1
    assert hooks[0]["listen_count"] == 1

    files = [n for n in g["nodes"] if n["type"] == "file"]
    assert len(files) == 1
    assert files[0]["hook_count"] == 2


# --- Hook types ---

def test_action_and_filter_separate():
    calls = [
        _make_call(hook_name="init", hook_type="action"),
        _make_call(hook_name="the_content", hook_type="filter", func="apply_filters"),
    ]
    g = build_graph(calls, ["/wp"], total_files=1)

    hooks = [n for n in g["nodes"] if n["type"] == "hook"]
    assert len(hooks) == 2

    action = next(h for h in hooks if h["name"] == "init")
    assert action["hook_type"] == "action"

    filt = next(h for h in hooks if h["name"] == "the_content")
    assert filt["hook_type"] == "filter"


# --- Dynamic hooks ---

def test_dynamic_hook_with_partial_name():
    calls = [_make_call(
        hook_name="prefix_*", dynamic=True,
        raw_expression="'prefix_' . $type",
    )]
    g = build_graph(calls, ["/wp"], total_files=1)

    assert g["metadata"]["dynamic_hooks"] == 1
    hook = next(n for n in g["nodes"] if n["type"] == "hook")
    assert hook["dynamic"] is True
    assert hook["name"] == "prefix_*"
    assert hook["raw_expression"] == "'prefix_' . $type"

def test_dynamic_hook_no_name():
    calls = [_make_call(
        hook_name=None, dynamic=True,
        raw_expression="$hook_name",
    )]
    g = build_graph(calls, ["/wp"], total_files=1)

    assert g["metadata"]["dynamic_hooks"] == 1
    hook = next(n for n in g["nodes"] if n["type"] == "hook")
    assert hook["dynamic"] is True
    assert hook["id"].startswith("hook::dynamic_")
    assert hook["raw_expression"] == "$hook_name"

def test_multiple_dynamic_hooks_get_unique_ids():
    calls = [
        _make_call(hook_name=None, dynamic=True, raw_expression="$a", line=1),
        _make_call(hook_name=None, dynamic=True, raw_expression="$b", line=2),
    ]
    g = build_graph(calls, ["/wp"], total_files=1)

    hooks = [n for n in g["nodes"] if n["type"] == "hook"]
    ids = [h["id"] for h in hooks]
    assert len(set(ids)) == 2  # unique IDs

def test_non_dynamic_hooks_not_counted():
    calls = [
        _make_call(hook_name="init", dynamic=False),
        _make_call(hook_name="wp_head", dynamic=False),
    ]
    g = build_graph(calls, ["/wp"], total_files=1)
    assert g["metadata"]["dynamic_hooks"] == 0


# --- Multiple sources ---

def test_multiple_sources():
    calls = [
        _make_call(file="/wp/wp-settings.php", hook_name="init"),
        _make_call(file="/plugin/main.php", hook_name="init",
                   func="add_action", edge_type="listens", callback="plugin_init"),
    ]
    g = build_graph(calls, ["/wp", "/plugin"], total_files=2)

    hook = next(n for n in g["nodes"] if n["type"] == "hook")
    assert sorted(hook["sources"]) == ["plugin", "wp"]

    files = [n for n in g["nodes"] if n["type"] == "file"]
    sources = {f["source"] for f in files}
    assert sources == {"wp", "plugin"}

def test_source_labels_in_metadata():
    g = build_graph([], ["/wp", "/plugin", "/theme"], total_files=0)
    assert g["metadata"]["source_labels"] == ["wp", "plugin", "theme"]

def test_source_labels_single_dir():
    g = build_graph([], ["/home/user/my-project"], total_files=0)
    assert g["metadata"]["source_labels"] == ["my-project"]

def test_source_labels_order_matches_scanned_dirs():
    g = build_graph([], ["/z-repo", "/a-repo"], total_files=0)
    assert g["metadata"]["source_labels"] == ["z-repo", "a-repo"]

def test_source_label_from_dirname():
    calls = [_make_call(file="/home/user/my-project/src/plugin.php")]
    g = build_graph(calls, ["/home/user/my-project"], total_files=1)

    file_node = next(n for n in g["nodes"] if n["type"] == "file")
    assert file_node["source"] == "my-project"


# --- Edge metadata ---

def test_fires_edge_has_line():
    calls = [_make_call(line=42)]
    g = build_graph(calls, ["/wp"], total_files=1)
    edge = g["edges"][0]
    assert edge["line"] == 42
    assert edge["type"] == "fires"
    assert "callback" not in edge

def test_listens_edge_has_callback_and_priority():
    calls = [_make_call(
        func="add_action", edge_type="listens",
        callback="my_func", priority=99, line=55,
    )]
    g = build_graph(calls, ["/wp"], total_files=1)
    edge = g["edges"][0]
    assert edge["type"] == "listens"
    assert edge["callback"] == "my_func"
    assert edge["priority"] == 99
    assert edge["line"] == 55

def test_edge_scope_fields_passthrough():
    calls = [_make_call(
        func="add_action", edge_type="listens",
        callback="MyPlugin::handle", callback_type="method",
        callback_class="MyPlugin", callback_method="handle",
        scope_class="MyPlugin", scope_function="register",
    )]
    g = build_graph(calls, ["/wp"], total_files=1)
    edge = g["edges"][0]
    assert edge["callback_type"] == "method"
    assert edge["callback_class"] == "MyPlugin"
    assert edge["callback_method"] == "handle"
    assert edge["scope_class"] == "MyPlugin"
    assert edge["scope_function"] == "register"

def test_edge_scope_fields_omitted_when_none():
    calls = [_make_call()]
    g = build_graph(calls, ["/wp"], total_files=1)
    edge = g["edges"][0]
    assert "callback_type" not in edge
    assert "callback_class" not in edge
    assert "callback_method" not in edge
    assert "scope_class" not in edge
    assert "scope_function" not in edge


# --- File paths ---

def test_relative_paths():
    calls = [_make_call(file="/wp/wp-includes/plugin.php")]
    g = build_graph(calls, ["/wp"], total_files=1)

    file_node = next(n for n in g["nodes"] if n["type"] == "file")
    assert file_node["path"] == "wp-includes/plugin.php"

def test_file_id_includes_source():
    calls = [_make_call(file="/wp/plugin.php")]
    g = build_graph(calls, ["/wp"], total_files=1)

    file_node = next(n for n in g["nodes"] if n["type"] == "file")
    assert "wp" in file_node["id"]


# --- Metadata ---

def test_metadata_fields():
    calls = [_make_call()]
    g = build_graph(calls, ["/wp", "/plugin"], total_files=100)

    meta = g["metadata"]
    assert meta["total_files"] == 100
    assert meta["total_hooks"] == 1
    assert meta["dynamic_hooks"] == 0
    assert "scan_date" in meta
    assert len(meta["scanned_dirs"]) == 2


# --- Larger scenario ---

def test_realistic_scenario():
    """Simulate a small but realistic set of hooks."""
    calls = [
        # WordPress core fires init
        _make_call(file="/wp/wp-settings.php", hook_name="init", line=100),
        # Plugin listens to init
        _make_call(file="/plugin/main.php", hook_name="init",
                   func="add_action", edge_type="listens", callback="plugin_setup", priority=10, line=15),
        # Another plugin listens to init
        _make_call(file="/plugin/other.php", hook_name="init",
                   func="add_action", edge_type="listens", callback="other_setup", priority=20, line=8),
        # Core applies the_content filter
        _make_call(file="/wp/wp-includes/post-template.php", hook_name="the_content",
                   hook_type="filter", func="apply_filters", line=250),
        # Plugin filters the_content
        _make_call(file="/plugin/main.php", hook_name="the_content",
                   hook_type="filter", func="add_filter", edge_type="listens",
                   callback="add_readmore", priority=15, line=30),
        # Dynamic hook
        _make_call(file="/wp/wp-includes/plugin.php", hook_name=None,
                   dynamic=True, raw_expression="$tag", line=200),
    ]
    g = build_graph(calls, ["/wp", "/plugin"], total_files=50)

    assert g["metadata"]["total_hooks"] == 3  # init, the_content, dynamic_N
    assert g["metadata"]["dynamic_hooks"] == 1

    hooks = {n["name"]: n for n in g["nodes"] if n["type"] == "hook"}
    assert hooks["init"]["fire_count"] == 1
    assert hooks["init"]["listen_count"] == 2
    assert hooks["the_content"]["fire_count"] == 1
    assert hooks["the_content"]["listen_count"] == 1

    files = [n for n in g["nodes"] if n["type"] == "file"]
    assert len(files) == 5  # wp-settings, post-template, wp-includes/plugin, plugin/main, plugin/other

    assert len(g["edges"]) == 6


# --- Overlap filter ---

def test_overlap_filter_keeps_multi_source_hooks():
    calls = [
        _make_call(file="/wp/a.php", hook_name="wp_only"),
        _make_call(file="/wp/b.php", hook_name="shared"),
        _make_call(file="/plugin/c.php", hook_name="shared",
                   func="add_action", edge_type="listens", callback="cb"),
        _make_call(file="/plugin/d.php", hook_name="plugin_only",
                   func="add_action", edge_type="listens", callback="cb2"),
    ]
    g = build_graph(calls, ["/wp", "/plugin"], total_files=4)
    fg = filter_graph_by_overlap(g)

    hooks = [n for n in fg["nodes"] if n["type"] == "hook"]
    assert len(hooks) == 1
    assert hooks[0]["name"] == "shared"

def test_overlap_filter_removes_orphan_files():
    calls = [
        _make_call(file="/wp/a.php", hook_name="wp_only"),
        _make_call(file="/wp/b.php", hook_name="shared"),
        _make_call(file="/plugin/c.php", hook_name="shared",
                   func="add_action", edge_type="listens", callback="cb"),
    ]
    g = build_graph(calls, ["/wp", "/plugin"], total_files=3)
    fg = filter_graph_by_overlap(g)

    files = [n for n in fg["nodes"] if n["type"] == "file"]
    file_ids = {f["id"] for f in files}
    assert all("a.php" not in fid for fid in file_ids)
    assert len(files) == 2

def test_overlap_filter_removes_edges_to_filtered_hooks():
    calls = [
        _make_call(file="/wp/a.php", hook_name="wp_only"),
        _make_call(file="/wp/b.php", hook_name="shared"),
        _make_call(file="/plugin/c.php", hook_name="shared",
                   func="add_action", edge_type="listens", callback="cb"),
    ]
    g = build_graph(calls, ["/wp", "/plugin"], total_files=3)
    fg = filter_graph_by_overlap(g)

    assert len(fg["edges"]) == 2
    assert all(e["target"] == "hook::shared" for e in fg["edges"])

def test_overlap_filter_updates_metadata():
    calls = [
        _make_call(file="/wp/a.php", hook_name="shared"),
        _make_call(file="/plugin/b.php", hook_name="shared",
                   func="add_action", edge_type="listens", callback="cb"),
        _make_call(file="/wp/c.php", hook_name="wp_only"),
    ]
    g = build_graph(calls, ["/wp", "/plugin"], total_files=3)
    fg = filter_graph_by_overlap(g)

    assert fg["metadata"]["overlap_filter"] is True
    assert fg["metadata"]["pre_filter_total_hooks"] == 2
    assert fg["metadata"]["total_hooks"] == 1

def test_overlap_filter_no_intersection():
    calls = [
        _make_call(file="/wp/a.php", hook_name="wp_hook"),
        _make_call(file="/plugin/b.php", hook_name="plugin_hook",
                   func="add_action", edge_type="listens", callback="cb"),
    ]
    g = build_graph(calls, ["/wp", "/plugin"], total_files=2)
    fg = filter_graph_by_overlap(g)

    assert fg["metadata"]["total_hooks"] == 0
    assert fg["nodes"] == []
    assert fg["edges"] == []

def test_overlap_filter_does_not_mutate_input():
    calls = [
        _make_call(file="/wp/a.php", hook_name="shared"),
        _make_call(file="/plugin/b.php", hook_name="shared",
                   func="add_action", edge_type="listens", callback="cb"),
        _make_call(file="/wp/c.php", hook_name="wp_only"),
    ]
    g = build_graph(calls, ["/wp", "/plugin"], total_files=3)
    original_hook_count = g["metadata"]["total_hooks"]
    original_node_count = len(g["nodes"])

    filter_graph_by_overlap(g)

    assert g["metadata"]["total_hooks"] == original_hook_count
    assert len(g["nodes"]) == original_node_count

def test_overlap_filter_three_sources():
    calls = [
        _make_call(file="/wp/a.php", hook_name="init"),
        _make_call(file="/pluginA/b.php", hook_name="init",
                   func="add_action", edge_type="listens", callback="cb1"),
        _make_call(file="/pluginB/c.php", hook_name="init",
                   func="add_action", edge_type="listens", callback="cb2"),
        _make_call(file="/pluginA/d.php", hook_name="pluginA_only",
                   func="do_action", edge_type="fires"),
    ]
    g = build_graph(calls, ["/wp", "/pluginA", "/pluginB"], total_files=4)
    fg = filter_graph_by_overlap(g)

    hooks = [n for n in fg["nodes"] if n["type"] == "hook"]
    assert len(hooks) == 1
    assert hooks[0]["name"] == "init"
    assert sorted(hooks[0]["sources"]) == ["pluginA", "pluginB", "wp"]

def test_overlap_filter_recalculates_file_hook_count():
    calls = [
        _make_call(file="/wp/a.php", hook_name="shared", line=1),
        _make_call(file="/wp/a.php", hook_name="wp_only", line=2),
        _make_call(file="/plugin/b.php", hook_name="shared",
                   func="add_action", edge_type="listens", callback="cb"),
    ]
    g = build_graph(calls, ["/wp", "/plugin"], total_files=2)
    fg = filter_graph_by_overlap(g)

    wp_file = next(n for n in fg["nodes"] if n["type"] == "file" and "a.php" in n["id"])
    assert wp_file["hook_count"] == 1


# --- overlap and sourceIndex fields ---

def test_hook_overlap_field_single_source():
    calls = [_make_call(file="/wp/a.php", hook_name="init")]
    g = build_graph(calls, ["/wp"], total_files=1)
    hook = next(n for n in g["nodes"] if n["type"] == "hook")
    assert hook["overlap"] is False

def test_hook_overlap_field_multi_source():
    calls = [
        _make_call(file="/wp/a.php", hook_name="init"),
        _make_call(file="/plugin/b.php", hook_name="init",
                   func="add_action", edge_type="listens", callback="cb"),
    ]
    g = build_graph(calls, ["/wp", "/plugin"], total_files=2)
    hook = next(n for n in g["nodes"] if n["type"] == "hook")
    assert hook["overlap"] is True

def test_hook_sourceIndex_single_source():
    calls = [
        _make_call(file="/wp/a.php", hook_name="wp_hook"),
        _make_call(file="/plugin/b.php", hook_name="plugin_hook",
                   func="add_action", edge_type="listens", callback="cb"),
    ]
    g = build_graph(calls, ["/wp", "/plugin"], total_files=2)
    hooks = {n["name"]: n for n in g["nodes"] if n["type"] == "hook"}
    assert hooks["wp_hook"]["sourceIndex"] == 0
    assert hooks["plugin_hook"]["sourceIndex"] == 1

def test_hook_sourceIndex_overlap_is_negative_one():
    calls = [
        _make_call(file="/wp/a.php", hook_name="shared"),
        _make_call(file="/plugin/b.php", hook_name="shared",
                   func="add_action", edge_type="listens", callback="cb"),
    ]
    g = build_graph(calls, ["/wp", "/plugin"], total_files=2)
    hook = next(n for n in g["nodes"] if n["type"] == "hook")
    assert hook["sourceIndex"] == -1


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
