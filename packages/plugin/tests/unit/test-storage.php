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

	private function clean_storage_dir( Storage $storage ): void {
		$storage->ensure_dir();
		foreach ( glob( $storage->dir() . '/*.json' ) ?: [] as $f ) {
			@unlink( $f );
		}
		$storage->invalidate_status_map();
	}

	public function test_status_map_for_classifies_parsed_stale_and_needs_parsing(): void {
		$storage = new Storage();
		$this->clean_storage_dir( $storage );
		$cron = $this->make_cron( $storage );

		// `alpha-fixture` has the current version on disk → parsed.
		file_put_contents( $storage->path_for( 'alpha-fixture/alpha', '5.3.1' ), '{}' );
		// `beta-fixture` has an older version only → stale.
		file_put_contents( $storage->path_for( 'beta-fixture/beta', '0.9.0' ), '{}' );

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
		$this->clean_storage_dir( $storage );
		$cron = $this->make_cron( $storage );

		$keys     = [ 'cache-fixture/main' ];
		$versions = [ 'cache-fixture/main' => '5.3.1' ];

		// First call: file exists, classified `parsed`, stored in transient.
		file_put_contents( $storage->path_for( 'cache-fixture/main', '5.3.1' ), '{}' );
		$first = $storage->status_map_for( $keys, $versions, $cron );
		$this->assertSame( 'parsed', $first['cache-fixture/main']['status'] );

		// Remove the file; cached result should still say parsed.
		@unlink( $storage->path_for( 'cache-fixture/main', '5.3.1' ) );
		$second = $storage->status_map_for( $keys, $versions, $cron );
		$this->assertSame( 'parsed', $second['cache-fixture/main']['status'] );

		// Invalidation forces a recompute that reflects current disk state.
		$storage->invalidate_status_map();
		$third = $storage->status_map_for( $keys, $versions, $cron );
		$this->assertSame( 'needs_parsing', $third['cache-fixture/main']['status'] );
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
