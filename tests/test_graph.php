<?php
/**
 * Tests for build_graph() and filter_graph_by_overlap() in hooks_graph.php.
 * These functions take plain associative arrays, so no temp files needed.
 */

function mk_call($overrides = []) {
    return array_merge([
        'func'            => 'do_action',
        'edge_type'       => 'fires',
        'hook_type'       => 'action',
        'hook_name'       => 'init',
        'dynamic'         => false,
        'raw_expression'  => null,
        'callback'        => null,
        'callback_type'   => null,
        'callback_class'  => null,
        'callback_method' => null,
        'priority'        => 10,
        'file'            => '/fake/wp-core/plugin.php',
        'line'            => 1,
        'source'          => 'wp-core',
        'scope_class'     => null,
        'scope_function'  => null,
        'doc_comment'     => null,
    ], $overrides);
}

function _nodes_of_type($graph, $type) {
    return array_values(array_filter($graph['nodes'], function ($n) use ($type) {
        return $n['type'] === $type;
    }));
}

function _find_hook($graph, $name) {
    foreach ($graph['nodes'] as $n) {
        if ($n['type'] === 'hook' && $n['name'] === $name) return $n;
    }
    return null;
}

// ── build_graph: basic shape ────────────────────────────────

test('build_graph: returns metadata/nodes/edges keys', function () {
    $g = build_graph([], ['/fake/wp-core'], 0);
    assert_true(isset($g['metadata']));
    assert_true(isset($g['nodes']));
    assert_true(isset($g['edges']));
});

test('build_graph: metadata records scanned dirs and totals', function () {
    $g = build_graph([mk_call()], ['/fake/wp-core'], 42);
    assert_eq(42, $g['metadata']['total_files']);
    assert_eq(1,  $g['metadata']['total_hooks']);
    assert_contains('wp-core', $g['metadata']['source_labels']);
});

// ── build_graph: hook deduplication ─────────────────────────

test('build_graph: same hook name deduplicates to one node', function () {
    $g = build_graph([
        mk_call(['file' => '/fake/wp-core/a.php']),
        mk_call(['file' => '/fake/wp-core/b.php']),
    ], ['/fake/wp-core'], 2);
    $hooks = _nodes_of_type($g, 'hook');
    assert_count(1, $hooks);
    assert_eq('init', $hooks[0]['name']);
});

test('build_graph: fire and listen counts are tallied', function () {
    $g = build_graph([
        mk_call(['edge_type' => 'fires']),
        mk_call(['edge_type' => 'fires']),
        mk_call(['edge_type' => 'listens', 'callback' => 'cb', 'callback_type' => 'function']),
    ], ['/fake/wp-core'], 1);
    $hook = _find_hook($g, 'init');
    assert_eq(2, $hook['fire_count']);
    assert_eq(1, $hook['listen_count']);
});

// ── build_graph: source tracking / overlap ──────────────────

test('build_graph: sources list collects each label once', function () {
    $g = build_graph([
        mk_call(['file' => '/fake/wp-core/a.php']),
        mk_call(['file' => '/fake/wp-core/b.php']),
        mk_call(['file' => '/fake/my-plugin/c.php']),
    ], ['/fake/wp-core', '/fake/my-plugin'], 3);
    $hook = _find_hook($g, 'init');
    assert_eq(['my-plugin', 'wp-core'], $hook['sources']);
});

test('build_graph: overlap=true when hook spans 2+ sources', function () {
    $g = build_graph([
        mk_call(['file' => '/fake/wp-core/a.php']),
        mk_call(['file' => '/fake/my-plugin/b.php']),
    ], ['/fake/wp-core', '/fake/my-plugin'], 2);
    $hook = _find_hook($g, 'init');
    assert_true($hook['overlap']);
    assert_eq(-1, $hook['sourceIndex']);
});

test('build_graph: overlap=false gets sourceIndex from labels list', function () {
    $g = build_graph([
        mk_call(['file' => '/fake/my-plugin/b.php', 'source' => 'my-plugin']),
    ], ['/fake/wp-core', '/fake/my-plugin'], 1);
    $hook = _find_hook($g, 'init');
    assert_false($hook['overlap']);
    assert_eq(1, $hook['sourceIndex']);
});

// ── build_graph: file nodes and edges ───────────────────────

test('build_graph: file node id uses source::rel format', function () {
    $g = build_graph([
        mk_call(['file' => '/fake/wp-core/plugin.php']),
    ], ['/fake/wp-core'], 1);
    $files = _nodes_of_type($g, 'file');
    assert_count(1, $files);
    assert_eq('file::wp-core::plugin.php', $files[0]['id']);
    assert_eq('plugin.php', $files[0]['path']);
    assert_eq('wp-core',    $files[0]['source']);
});

test('build_graph: edges carry callback and priority on listens', function () {
    $g = build_graph([
        mk_call([
            'edge_type'     => 'listens',
            'callback'      => 'my_cb',
            'callback_type' => 'function',
            'priority'      => 20,
        ]),
    ], ['/fake/wp-core'], 1);
    assert_count(1, $g['edges']);
    $e = $g['edges'][0];
    assert_eq('listens',  $e['type']);
    assert_eq('my_cb',    $e['callback']);
    assert_eq(20,         $e['priority']);
});

test('build_graph: fires edges omit priority field', function () {
    $g = build_graph([mk_call(['edge_type' => 'fires'])], ['/fake/wp-core'], 1);
    assert_false(isset($g['edges'][0]['priority']));
});

// ── build_graph: dynamic hooks ──────────────────────────────

test('build_graph: dynamic hooks get synthetic ids and counter resets', function () {
    $calls = [
        mk_call(['hook_name' => null, 'dynamic' => true, 'raw_expression' => '$a']),
        mk_call(['hook_name' => null, 'dynamic' => true, 'raw_expression' => '$b']),
    ];
    $g1 = build_graph($calls, ['/fake/wp-core'], 2);
    $g2 = build_graph($calls, ['/fake/wp-core'], 2);
    // Counter must reset between calls so both runs produce identical ids.
    $ids1 = array_map(function ($n) { return $n['id']; }, _nodes_of_type($g1, 'hook'));
    $ids2 = array_map(function ($n) { return $n['id']; }, _nodes_of_type($g2, 'hook'));
    sort($ids1); sort($ids2);
    assert_eq($ids1, $ids2);
    assert_eq(2, $g1['metadata']['dynamic_hooks']);
});

// ── filter_graph_by_overlap ─────────────────────────────────

test('filter_overlap: drops single-source hooks', function () {
    $g = build_graph([
        mk_call(['hook_name' => 'only_here',    'file' => '/fake/wp-core/a.php']),
        mk_call(['hook_name' => 'shared_hook',  'file' => '/fake/wp-core/a.php']),
        mk_call(['hook_name' => 'shared_hook',  'file' => '/fake/my-plugin/b.php']),
    ], ['/fake/wp-core', '/fake/my-plugin'], 3);
    $filtered = filter_graph_by_overlap($g);

    $hooks = _nodes_of_type($filtered, 'hook');
    assert_count(1, $hooks);
    assert_eq('shared_hook', $hooks[0]['name']);
    assert_true($filtered['metadata']['overlap_filter']);
    assert_eq(2, $filtered['metadata']['pre_filter_total_hooks']);
});

test('filter_overlap: drops files that only referenced filtered-out hooks', function () {
    $g = build_graph([
        mk_call(['hook_name' => 'orphan', 'file' => '/fake/wp-core/only.php']),
        mk_call(['hook_name' => 'shared', 'file' => '/fake/wp-core/other.php']),
        mk_call(['hook_name' => 'shared', 'file' => '/fake/my-plugin/p.php']),
    ], ['/fake/wp-core', '/fake/my-plugin'], 3);
    $filtered = filter_graph_by_overlap($g);
    $files = _nodes_of_type($filtered, 'file');
    $paths = array_map(function ($f) { return $f['path']; }, $files);
    sort($paths);
    assert_eq(['other.php', 'p.php'], $paths);
});
