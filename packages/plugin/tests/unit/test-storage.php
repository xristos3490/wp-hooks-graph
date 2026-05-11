<?php
/**
 * Smoke tests for HooksGraph\Plugin\Storage.
 *
 * @package HooksGraph\Plugin
 */

use HooksGraph\Plugin\Storage;

class Storage_Tests extends HooksGraph_Test_Case {

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
