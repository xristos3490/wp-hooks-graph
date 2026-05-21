<?php
/**
 * Base test case for Graph_Index + abilities tests.
 *
 * Stages parsed-graph fixtures (re-used from packages/mcp/tests/fixtures/)
 * into the live Storage directory under WP_CONTENT_DIR so the production
 * code paths exercise real disk lookups. Each fixture is mapped to a plugin
 * key via `<slug>-<version>.json`.
 *
 * @package HooksGraph\Plugin
 */

use HooksGraph\Plugin\Graph_Index;
use HooksGraph\Plugin\Storage;

require_once __DIR__ . '/class-hooksgraph-test-case.php';

abstract class HooksGraph_Abilities_Test_Case extends HooksGraph_Test_Case {

	protected Storage $storage;
	protected Graph_Index $index;

	/** @var array<string, array{plugin: string, version: string, file: string}> */
	protected array $fixtures = array(
		'alpha' => array( 'plugin' => 'alpha/alpha', 'version' => '1.0.0' ),
		'beta'  => array( 'plugin' => 'beta/beta',   'version' => '2.0.0' ),
		'gamma' => array( 'plugin' => 'gamma',       'version' => '0.1.0' ),
	);

	public function set_up(): void {
		parent::set_up();
		$this->storage = new Storage();
		$this->index   = new Graph_Index( $this->storage );
		$this->storage->ensure_dir();
		$this->stage_fixtures();

		// Abilities are gated behind `manage_options`. Run every ability test
		// as an administrator unless the test overrides explicitly.
		if ( function_exists( 'wp_set_current_user' ) ) {
			wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		}
	}

	public function tear_down(): void {
		$dir = $this->storage->dir();
		if ( is_dir( $dir ) ) {
			foreach ( glob( $dir . '/*.json' ) ?: array() as $file ) {
				@unlink( $file );
			}
		}
		delete_option( 'hooksgraph_plugin_settings' );
		$this->storage->invalidate_status_map();
		parent::tear_down();
	}

	protected function stage_fixtures(): void {
		$source_dir = dirname( dirname( __DIR__ ) ) . '/../mcp/tests/fixtures';
		foreach ( $this->fixtures as $name => $meta ) {
			$src = $source_dir . '/' . $name . '.json';
			$dst = $this->storage->path_for( $meta['plugin'], $meta['version'] );
			if ( file_exists( $src ) ) {
				copy( $src, $dst );
				$raw = json_decode( (string) file_get_contents( $src ), true );
				$this->storage->record_parse_success(
					$meta['plugin'],
					$meta['version'],
					basename( $dst ),
					is_array( $raw['metadata'] ?? null ) ? $raw['metadata'] : array(),
					is_array( $raw['edges'] ?? null ) ? count( $raw['edges'] ) : 0
				);
			}
		}
	}

	/**
	 * Force a deterministic active-plugin set via the `hooksgraph_known_plugins`
	 * filter so tests don't depend on whatever the WP test install has on disk.
	 *
	 * @param array<string, string> $map plugin_key → version
	 */
	protected function fake_active_plugins( array $map ): void {
		add_filter( 'hooksgraph_known_plugins', static fn () => $map );
	}

	/**
	 * Resolve an ability by short name (with underscores or dashes) and execute
	 * it through the WordPress Abilities API. Goes through input validation +
	 * permission_callback — `set_up()` installs an admin user so the permission
	 * check passes by default. Returns the raw value from the execute callback
	 * (array | WP_Error | null).
	 *
	 * @return mixed
	 */
	protected function call_ability( string $tool, array $input = array() ) {
		$slug    = str_replace( '_', '-', $tool );
		$ability = wp_get_ability( "hooksgraph/{$slug}" );
		if ( null === $ability ) {
			$this->fail( "Ability hooksgraph/{$slug} is not registered." );
		}
		return $ability->execute( $input );
	}
}
