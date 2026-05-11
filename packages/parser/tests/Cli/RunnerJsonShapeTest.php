<?php

declare(strict_types=1);

namespace HooksGraph\Tests\Cli;

use HooksGraph\Graph\Builder;
use HooksGraph\Parser\FileParser;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\TestCase;

#[CoversClass(Builder::class)]
final class RunnerJsonShapeTest extends TestCase
{
    public function test_listener_edge_carries_new_callback_metadata_fields(): void
    {
        $tmp = sys_get_temp_dir() . '/hg_shape_' . uniqid();
        mkdir($tmp);
        $php = <<<'PHP'
<?php
add_action('init', function () {
    update_option('foo', 1);
    wp_remote_get('https://example.com');
});

add_filter('the_content', function ($c) {
    $c .= 'x';
    return $c;
});
PHP;
        $file = $tmp . '/plugin.php';
        file_put_contents($file, $php);

        try {
            $calls = FileParser::parse($file, 'test');
            $graph = (new Builder())->build($calls, [$tmp], 1);

            $this->assertArrayHasKey('edges', $graph);
            $listenEdges = array_values(array_filter($graph['edges'], fn ($e) => $e['type'] === 'listens'));
            $this->assertCount(2, $listenEdges);

            $action = $listenEdges[0];
            $this->assertArrayHasKey('effects', $action);
            $this->assertArrayHasKey('targets', $action);
            $this->assertArrayHasKey('called_apis', $action);
            $this->assertArrayNotHasKey('filter_behavior', $action);
            $this->assertContains('writes_option', $action['effects']);
            $this->assertContains('io_http', $action['effects']);

            $filter = $listenEdges[1];
            $this->assertArrayHasKey('filter_behavior', $filter);
            $this->assertSame('input_mutated', $filter['filter_behavior']['return_origin']);
            $this->assertTrue($filter['filter_behavior']['mutates_input']);
        } finally {
            @unlink($file);
            @rmdir($tmp);
        }
    }
}
