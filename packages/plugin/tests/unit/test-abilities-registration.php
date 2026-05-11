<?php
/**
 * Integration tests: abilities registered via the bootstrap's `plugins_loaded`
 * callback are visible through the WP 6.9 Abilities API and execute end-to-end.
 *
 * @package HooksGraph\Plugin
 */

require_once __DIR__ . '/../framework/class-hooksgraph-abilities-test-case.php';

class Abilities_Registration_Tests extends HooksGraph_Abilities_Test_Case {

	private const SLUGS = array(
		'list-codebases',
		'find-hook',
		'listeners-of',
		'firers-of',
		'hooks-in-file',
		'search-callbacks',
		'hotspots',
		'shared-hooks',
		'compare-hook',
		'filter-priority-conflicts',
	);

	public function set_up(): void {
		parent::set_up();
		if ( ! function_exists( 'wp_register_ability' ) ) {
			$this->markTestSkipped( 'Abilities API not available in this WordPress build.' );
		}
	}

	public function test_all_ten_abilities_register(): void {
		foreach ( self::SLUGS as $slug ) {
			$ability = wp_get_ability( "hooksgraph/{$slug}" );
			$this->assertNotNull( $ability, "hooksgraph/{$slug} should register" );
		}
	}

	public function test_permission_callback_blocks_subscriber(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$err = wp_get_ability( 'hooksgraph/find-hook' )->execute( array( 'plugin' => 'alpha/alpha', 'name' => 'init' ) );
		$this->assertInstanceOf( WP_Error::class, $err );
	}

	public function test_administrator_can_execute_find_hook_end_to_end(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$result = wp_get_ability( 'hooksgraph/find-hook' )->execute( array( 'plugin' => 'alpha/alpha', 'name' => 'init' ) );
		$this->assertIsArray( $result );
		$this->assertSame( 'init', $result['name'] );
		$this->assertSame( 'action', $result['hook_type'] );
	}

	public function test_wp_error_from_execute_callback_bubbles_through_api(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$err = wp_get_ability( 'hooksgraph/find-hook' )->execute( array( 'plugin' => 'nope/nope', 'name' => 'init' ) );
		$this->assertInstanceOf( WP_Error::class, $err );
		$this->assertSame( 'hooksgraph_not_parsed', $err->get_error_code() );
	}

	public function test_annotations_are_readonly_idempotent_for_all_tools(): void {
		foreach ( self::SLUGS as $slug ) {
			$meta = wp_get_ability( "hooksgraph/{$slug}" )->get_meta();
			$this->assertTrue( $meta['annotations']['readonly'] ?? false, "{$slug} readonly" );
			$this->assertFalse( $meta['annotations']['destructive'] ?? true, "{$slug} non-destructive" );
			$this->assertTrue( $meta['annotations']['idempotent'] ?? false, "{$slug} idempotent" );
		}
	}
}
