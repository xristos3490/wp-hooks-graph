<?php

declare(strict_types=1);

namespace HooksGraph\Tests\Graph;

use HooksGraph\Graph\Builder;
use HooksGraph\Graph\OverlapFilter;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\TestCase;

#[CoversClass(Builder::class)]
#[CoversClass(OverlapFilter::class)]
final class BuilderTest extends TestCase
{
    private function build(array $calls, array $dirs, int $totalFiles = 0): array
    {
        return (new Builder())->build($calls, $dirs, $totalFiles);
    }

    private function call(array $overrides = []): array
    {
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

    private function nodesOfType(array $graph, string $type): array
    {
        return array_values(array_filter($graph['nodes'], static fn ($n) => $n['type'] === $type));
    }

    private function findHook(array $graph, string $name): ?array
    {
        foreach ($graph['nodes'] as $n) {
            if ($n['type'] === 'hook' && $n['name'] === $name) {
                return $n;
            }
        }
        return null;
    }

    // ── build: basic shape ──────────────────────────────────────

    public function test_returns_metadata_nodes_edges_keys(): void
    {
        $g = $this->build([], ['/fake/wp-core']);
        $this->assertArrayHasKey('metadata', $g);
        $this->assertArrayHasKey('nodes',    $g);
        $this->assertArrayHasKey('edges',    $g);
    }

    public function test_metadata_records_scanned_dirs_and_totals(): void
    {
        $g = $this->build([$this->call()], ['/fake/wp-core'], 42);
        $this->assertSame(42, $g['metadata']['total_files']);
        $this->assertSame(1,  $g['metadata']['total_hooks']);
        $this->assertContains('wp-core', $g['metadata']['source_labels']);
    }

    // ── build: hook deduplication ───────────────────────────────

    public function test_same_hook_name_deduplicates(): void
    {
        $g = $this->build([
            $this->call(['file' => '/fake/wp-core/a.php']),
            $this->call(['file' => '/fake/wp-core/b.php']),
        ], ['/fake/wp-core'], 2);
        $hooks = $this->nodesOfType($g, 'hook');
        $this->assertCount(1, $hooks);
        $this->assertSame('init', $hooks[0]['name']);
    }

    public function test_fire_and_listen_counts(): void
    {
        $g = $this->build([
            $this->call(['edge_type' => 'fires']),
            $this->call(['edge_type' => 'fires']),
            $this->call(['edge_type' => 'listens', 'callback' => 'cb', 'callback_type' => 'function']),
        ], ['/fake/wp-core'], 1);
        $hook = $this->findHook($g, 'init');
        $this->assertSame(2, $hook['fire_count']);
        $this->assertSame(1, $hook['listen_count']);
    }

    // ── build: source tracking / overlap ────────────────────────

    public function test_sources_list_collects_each_label_once(): void
    {
        $g = $this->build([
            $this->call(['file' => '/fake/wp-core/a.php']),
            $this->call(['file' => '/fake/wp-core/b.php']),
            $this->call(['file' => '/fake/my-plugin/c.php']),
        ], ['/fake/wp-core', '/fake/my-plugin'], 3);
        $hook = $this->findHook($g, 'init');
        $this->assertSame(['my-plugin', 'wp-core'], $hook['sources']);
    }

    public function test_overlap_true_when_hook_spans_two_sources(): void
    {
        $g = $this->build([
            $this->call(['file' => '/fake/wp-core/a.php']),
            $this->call(['file' => '/fake/my-plugin/b.php']),
        ], ['/fake/wp-core', '/fake/my-plugin'], 2);
        $hook = $this->findHook($g, 'init');
        $this->assertTrue($hook['overlap']);
        $this->assertSame(-1, $hook['sourceIndex']);
    }

    public function test_overlap_false_gets_source_index(): void
    {
        $g = $this->build([
            $this->call(['file' => '/fake/my-plugin/b.php', 'source' => 'my-plugin']),
        ], ['/fake/wp-core', '/fake/my-plugin'], 1);
        $hook = $this->findHook($g, 'init');
        $this->assertFalse($hook['overlap']);
        $this->assertSame(1, $hook['sourceIndex']);
    }

    // ── build: file nodes and edges ─────────────────────────────

    public function test_file_node_id_format(): void
    {
        $g = $this->build([
            $this->call(['file' => '/fake/wp-core/plugin.php']),
        ], ['/fake/wp-core'], 1);
        $files = $this->nodesOfType($g, 'file');
        $this->assertCount(1, $files);
        $this->assertSame('file::wp-core::plugin.php', $files[0]['id']);
        $this->assertSame('plugin.php', $files[0]['path']);
        $this->assertSame('wp-core',    $files[0]['source']);
    }

    public function test_edges_carry_callback_and_priority_on_listens(): void
    {
        $g = $this->build([
            $this->call([
                'edge_type'     => 'listens',
                'callback'      => 'my_cb',
                'callback_type' => 'function',
                'priority'      => 20,
            ]),
        ], ['/fake/wp-core'], 1);
        $this->assertCount(1, $g['edges']);
        $e = $g['edges'][0];
        $this->assertSame('listens', $e['type']);
        $this->assertSame('my_cb',   $e['callback']);
        $this->assertSame(20,        $e['priority']);
    }

    public function test_fires_edges_omit_priority_field(): void
    {
        $g = $this->build([$this->call(['edge_type' => 'fires'])], ['/fake/wp-core'], 1);
        $this->assertArrayNotHasKey('priority', $g['edges'][0]);
    }

    // ── build: dynamic hooks ────────────────────────────────────

    public function test_dynamic_hooks_get_stable_synthetic_ids(): void
    {
        $calls = [
            $this->call(['hook_name' => null, 'dynamic' => true, 'raw_expression' => '$a']),
            $this->call(['hook_name' => null, 'dynamic' => true, 'raw_expression' => '$b']),
        ];
        $g1 = $this->build($calls, ['/fake/wp-core'], 2);
        $g2 = $this->build($calls, ['/fake/wp-core'], 2);

        $ids1 = array_map(static fn ($n) => $n['id'], $this->nodesOfType($g1, 'hook'));
        $ids2 = array_map(static fn ($n) => $n['id'], $this->nodesOfType($g2, 'hook'));
        sort($ids1);
        sort($ids2);
        $this->assertSame($ids1, $ids2);
        $this->assertSame(2, $g1['metadata']['dynamic_hooks']);
    }

    // ── OverlapFilter ───────────────────────────────────────────

    public function test_filter_drops_single_source_hooks(): void
    {
        $g = $this->build([
            $this->call(['hook_name' => 'only_here',   'file' => '/fake/wp-core/a.php']),
            $this->call(['hook_name' => 'shared_hook', 'file' => '/fake/wp-core/a.php']),
            $this->call(['hook_name' => 'shared_hook', 'file' => '/fake/my-plugin/b.php']),
        ], ['/fake/wp-core', '/fake/my-plugin'], 3);
        $filtered = OverlapFilter::apply($g);

        $hooks = $this->nodesOfType($filtered, 'hook');
        $this->assertCount(1, $hooks);
        $this->assertSame('shared_hook', $hooks[0]['name']);
        $this->assertTrue($filtered['metadata']['overlap_filter']);
        $this->assertSame(2, $filtered['metadata']['pre_filter_total_hooks']);
    }

    public function test_filter_drops_files_referencing_only_filtered_hooks(): void
    {
        $g = $this->build([
            $this->call(['hook_name' => 'orphan', 'file' => '/fake/wp-core/only.php']),
            $this->call(['hook_name' => 'shared', 'file' => '/fake/wp-core/other.php']),
            $this->call(['hook_name' => 'shared', 'file' => '/fake/my-plugin/p.php']),
        ], ['/fake/wp-core', '/fake/my-plugin'], 3);
        $filtered = OverlapFilter::apply($g);
        $files    = $this->nodesOfType($filtered, 'file');
        $paths    = array_map(static fn ($f) => $f['path'], $files);
        sort($paths);
        $this->assertSame(['other.php', 'p.php'], $paths);
    }
}
