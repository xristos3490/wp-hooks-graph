<?php
/**
 * Smoke tests for HooksGraph\Plugin\Storage.
 *
 * @package HooksGraph\Plugin
 */

use HooksGraph\Plugin\Cron;
use HooksGraph\Plugin\Parser_Service;
use HooksGraph\Plugin\Storage;

class Storage_Tests extends HooksGraph_Test_Case {

	private function make_cron( Storage $storage ): Cron {
		return new Cron( new Parser_Service( $storage ), $storage );
	}

	private function reset_state( Storage $storage ): void {
		$storage->ensure_dir();
		delete_option( 'hooksgraph_plugin_settings' );
		$storage->invalidate_status_map();
	}

	private function record_success( Storage $storage, string $plugin, string $version ): void {
		$storage->record_parse_success(
			$plugin,
			$version,
			$storage->filename( $plugin, $version ),
			[ 'total_files' => 1, 'total_hooks' => 2, 'dynamic_hooks' => 0 ],
			3
		);
	}

	public function test_status_map_for_classifies_parsed_stale_and_needs_parsing(): void {
		$storage = new Storage();
		$this->reset_state( $storage );
		$cron = $this->make_cron( $storage );

		// `alpha-fixture` has the current version recorded → parsed.
		$this->record_success( $storage, 'alpha-fixture/alpha', '5.3.1' );
		// `beta-fixture` has an older version recorded → stale.
		$this->record_success( $storage, 'beta-fixture/beta', '0.9.0' );

		$map = $storage->status_map_for(
			[ 'alpha-fixture/alpha', 'beta-fixture/beta', 'gamma-fixture' ],
			[
				'alpha-fixture/alpha' => '5.3.1',
				'beta-fixture/beta'   => '1.0.0',
				'gamma-fixture'       => '1.0.0',
			],
			$cron
		);

		$this->assertSame( 'parsed', $map['alpha-fixture/alpha']['status'] );
		$this->assertSame( 'stale', $map['beta-fixture/beta']['status'] );
		$this->assertSame( 'needs_parsing', $map['gamma-fixture']['status'] );
	}

	public function test_status_map_for_uses_transient_cache(): void {
		$storage = new Storage();
		$this->reset_state( $storage );
		$cron = $this->make_cron( $storage );

		$keys     = [ 'cache-fixture/main' ];
		$versions = [ 'cache-fixture/main' => '5.3.1' ];

		// First call: parsed (record present).
		$this->record_success( $storage, 'cache-fixture/main', '5.3.1' );
		$first = $storage->status_map_for( $keys, $versions, $cron );
		$this->assertSame( 'parsed', $first['cache-fixture/main']['status'] );

		// Direct-write the option (bypassing update_record's invalidator) so
		// the next call hits the transient and still reports `parsed`.
		$all = get_option( 'hooksgraph_plugin_settings', [] );
		unset( $all['cache-fixture/main'] );
		update_option( 'hooksgraph_plugin_settings', $all, false );
		$second = $storage->status_map_for( $keys, $versions, $cron );
		$this->assertSame( 'parsed', $second['cache-fixture/main']['status'] );

		// Invalidation forces a recompute that reflects the cleared record.
		$storage->invalidate_status_map();
		$third = $storage->status_map_for( $keys, $versions, $cron );
		$this->assertSame( 'needs_parsing', $third['cache-fixture/main']['status'] );
	}

	public function test_record_parse_failure_surfaces_as_failed_status(): void {
		$storage = new Storage();
		$this->reset_state( $storage );
		$cron = $this->make_cron( $storage );

		$storage->record_parse_failure( 'oops-fixture/main', 'kaboom' );

		$map = $storage->status_map_for(
			[ 'oops-fixture/main' ],
			[ 'oops-fixture/main' => '1.0.0' ],
			$cron
		);

		$this->assertSame( 'failed', $map['oops-fixture/main']['status'] );
		$this->assertSame( 'kaboom', $map['oops-fixture/main']['failed_error'] );
	}

	public function test_save_settings_preserves_parse_record(): void {
		$storage = new Storage();
		$this->reset_state( $storage );

		$this->record_success( $storage, 'merge-fixture/main', '2.0.0' );
		$storage->save_settings( 'merge-fixture/main', [ 'tests/' ] );

		$record = $storage->get_record( 'merge-fixture/main' );
		$this->assertSame( '2.0.0', $record['last_parsed_version'] );
		$this->assertSame( [ 'tests/' ], $record['exclude'] );
	}

	public function test_ensure_dir_creates_storage_directory(): void {
		$storage = new Storage();
		$this->assertTrue( $storage->ensure_dir() );
		$this->assertDirectoryExists( $storage->dir() );
		$this->assertFileExists( $storage->dir() . '/index.php' );
	}

	public function test_status_for_unknown_plugin_is_needs_parsing(): void {
		$storage = new Storage();
		$storage->ensure_dir();

		$this->assertSame(
			Storage::STATUS_NEEDS_PARSING,
			$storage->status_for( 'does-not-exist/does-not-exist', '1.0.0' )
		);
	}

	public function test_slug_uses_directory_for_foldered_plugin(): void {
		$storage = new Storage();
		$this->assertSame( 'akismet', $storage->slug( 'akismet/akismet' ) );
		$this->assertSame( 'wordpress-seo', $storage->slug( 'wordpress-seo/wp-seo' ) );
		$this->assertSame( 'hello', $storage->slug( 'hello' ) );
	}
}
