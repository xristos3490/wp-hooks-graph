<?php
/**
 * Tests for the `/hooksgraph/v1/plugins` REST endpoint.
 *
 * Exercises the joined collection shape and the pagination headers that
 * drive DataViews. Stubs the active-plugin list with the `all_plugins`
 * filter so no real plugin filesystem is required.
 *
 * @package HooksGraph\Plugin
 */

use HooksGraph\Plugin\Storage;

class Rest_Controller_Tests extends HooksGraph_Test_Case {

	private static int $admin_id = 0;

	private $previous_active_plugins = null;

	public static function wpSetUpBeforeClass( $factory ): void {
		self::$admin_id = $factory->user->create( [ 'role' => 'administrator' ] );
	}

	public function set_up(): void {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		( new Storage() )->invalidate_status_map();

		// Stub `get_plugins()` via the object cache it consults first — no
		// `all_plugins` filter exists in core, but the cache key short-circuits
		// the filesystem scan and lets us inject deterministic fixtures.
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		wp_cache_set( 'plugins', [ '' => $this->fake_plugin_index() ], 'plugins' );

		// Snapshot so tear_down restores it — HooksGraph_Test_Case doesn't
		// reset options between tests, so leaking active_plugins here would
		// cause order-dependent failures elsewhere.
		$this->previous_active_plugins = get_option( 'active_plugins' );
		update_option( 'active_plugins', [ 'akismet/akismet.php', 'hello.php' ] );
	}

	public function tear_down(): void {
		wp_cache_delete( 'plugins', 'plugins' );
		( new Storage() )->invalidate_status_map();

		if ( false === $this->previous_active_plugins ) {
			delete_option( 'active_plugins' );
		} else {
			update_option( 'active_plugins', $this->previous_active_plugins );
		}
		$this->previous_active_plugins = null;

		parent::tear_down();
	}

	private function fake_plugin_index(): array {
		return [
			'akismet/akismet.php' => [
				'Name'        => 'Akismet',
				'Version'     => '5.3.1',
				'Author'      => 'Automattic',
				'Description' => 'Anti-spam.',
				'RequiresPHP' => '5.6',
			],
			'hello.php'           => [
				'Name'        => 'Hello Dolly',
				'Version'     => '1.7.2',
				'Author'      => 'Matt Mullenweg',
				'Description' => 'Sing.',
				'RequiresPHP' => '',
			],
		];
	}

	public function test_list_returns_joined_row_shape_with_pagination_headers(): void {
		$response = rest_do_request( new WP_REST_Request( 'GET', '/hooksgraph/v1/plugins' ) );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertIsArray( $data );
		$this->assertCount( 2, $data );

		$names = array_column( $data, 'name' );
		$this->assertContains( 'Akismet', $names );
		$this->assertContains( 'Hello Dolly', $names );

		$ids = array_column( $data, 'id' );
		$this->assertContains( 'akismet/akismet', $ids );
		$this->assertContains( 'hello', $ids );

		$headers = $response->get_headers();
		$this->assertSame( '2', (string) $headers['X-WP-Total'] );
		$this->assertSame( '1', (string) $headers['X-WP-TotalPages'] );

		// `parse_status` defaults to needs_parsing when nothing is on disk.
		$row = current( array_filter( $data, static fn ( $r ) => $r['id'] === 'hello' ) );
		$this->assertSame( 'needs_parsing', $row['parse_status'] );
	}

	public function test_single_record_route_returns_404_for_unknown_id(): void {
		$response = rest_do_request(
			new WP_REST_Request( 'GET', '/hooksgraph/v1/plugins/does-not-exist' )
		);
		$this->assertSame( 404, $response->get_status() );
	}

	public function test_single_record_route_returns_record_for_active_plugin(): void {
		$response = rest_do_request(
			new WP_REST_Request( 'GET', '/hooksgraph/v1/plugins/akismet/akismet' )
		);
		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'akismet/akismet', $data['id'] );
		$this->assertSame( 'Akismet', $data['name'] );
	}

	public function test_list_endpoint_rejects_non_admin(): void {
		wp_set_current_user( 0 );
		$response = rest_do_request( new WP_REST_Request( 'GET', '/hooksgraph/v1/plugins' ) );
		$this->assertContains( $response->get_status(), [ 401, 403 ] );
	}

	public function test_search_filters_by_name(): void {
		$request = new WP_REST_Request( 'GET', '/hooksgraph/v1/plugins' );
		$request->set_param( 'search', 'hello' );
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertCount( 1, $data );
		$this->assertSame( 'hello', $data[0]['id'] );
	}
}
