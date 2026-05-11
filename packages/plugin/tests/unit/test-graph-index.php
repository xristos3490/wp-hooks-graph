<?php
/**
 * @package HooksGraph\Plugin
 */

use HooksGraph\Plugin\Graph_Index;
use HooksGraph\Plugin\Storage;

require_once __DIR__ . '/../framework/class-hooksgraph-abilities-test-case.php';

class Graph_Index_Tests extends HooksGraph_Abilities_Test_Case {

	public function test_for_plugin_returns_built_index_with_expected_shape(): void {
		$built = $this->index->for_plugin( 'alpha/alpha' );
		$this->assertIsArray( $built );
		$this->assertArrayHasKey( 'nodes', $built );
		$this->assertArrayHasKey( 'hookByName', $built );
		$this->assertArrayHasKey( 'fileByPath', $built );
		$this->assertArrayHasKey( 'firesByHook', $built );
		$this->assertArrayHasKey( 'listensByHook', $built );
		$this->assertArrayHasKey( 'edgesByFile', $built );
		$this->assertArrayHasKey( 'allEdges', $built );
		$this->assertArrayHasKey( 'init', $built['hookByName'] );
		$this->assertArrayHasKey( 'core.php', $built['fileByPath'] );
	}

	public function test_for_plugin_returns_wp_error_when_not_parsed(): void {
		$err = $this->index->for_plugin( 'nonexistent/nonexistent' );
		$this->assertInstanceOf( WP_Error::class, $err );
		$this->assertSame( 'hooksgraph_not_parsed', $err->get_error_code() );
	}

	public function test_for_plugin_returns_wp_error_on_invalid_json(): void {
		$path = $this->storage->path_for( 'bogus/bogus', '1.0.0' );
		file_put_contents( $path, '{ not json' );

		$err = $this->index->for_plugin( 'bogus/bogus' );
		$this->assertInstanceOf( WP_Error::class, $err );
		$this->assertSame( 'hooksgraph_invalid_json', $err->get_error_code() );
	}

	public function test_for_plugin_memoizes_by_path(): void {
		$first  = $this->index->for_plugin( 'alpha/alpha' );
		$second = $this->index->for_plugin( 'alpha/alpha' );
		// Same array (reference equality) — memoization keeps the same in-memory copy.
		$this->assertSame( $first, $second );
	}

	public function test_for_plugin_picks_newest_file_when_multiple_versions_present(): void {
		// Drop a second, older version alongside the staged one.
		$old = $this->storage->path_for( 'alpha/alpha', '0.0.1' );
		copy( $this->storage->path_for( 'alpha/alpha', '1.0.0' ), $old );
		touch( $old, time() - 3600 );

		$built = $this->index->for_plugin( 'alpha/alpha' );
		$this->assertIsArray( $built );
		$this->assertStringContainsString( 'alpha-1.0.0.json', $built['path'] );
	}
}
