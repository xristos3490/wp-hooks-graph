<?php
/**
 * Tests for the hg_scan CPT registration + core REST surface.
 *
 * @package HooksGraph\Plugin
 */

class Scan_Cpt_Tests extends HooksGraph_Test_Case {

	private static int $admin_id = 0;

	public static function wpSetUpBeforeClass( $factory ): void {
		self::$admin_id = $factory->user->create( [ 'role' => 'administrator' ] );
	}

	public function set_up(): void {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
	}

	public function test_post_type_is_registered(): void {
		$this->assertTrue( post_type_exists( 'hg_scan' ) );
	}

	public function test_collection_route_is_registered(): void {
		$server = rest_get_server();
		$routes = $server->get_routes();
		$this->assertArrayHasKey( '/wp/v2/hg-scans', $routes );
	}

	public function test_item_route_is_registered(): void {
		$server = rest_get_server();
		$routes = $server->get_routes();
		$this->assertArrayHasKey( '/wp/v2/hg-scans/(?P<id>[\d]+)', $routes );
	}

	public function test_anonymous_collection_request_is_rejected(): void {
		wp_set_current_user( 0 );
		$response = rest_do_request( new WP_REST_Request( 'GET', '/wp/v2/hg-scans' ) );
		$this->assertContains( $response->get_status(), [ 401, 403 ] );
	}

	public function test_admin_create_writes_top_level_fields(): void {
		$request = new WP_REST_Request( 'POST', '/wp/v2/hg-scans' );
		$request->set_param( 'title', 'Test scan' );
		$request->set_param( 'status', 'publish' );
		$request->set_param( 'plugins', [ 'akismet/akismet' ] );

		$response = rest_do_request( $request );
		$this->assertContains( $response->get_status(), [ 200, 201 ], 'Unexpected status: ' . wp_json_encode( $response->get_data() ) );

		$data = $response->get_data();
		$this->assertIsArray( $data );
		$this->assertArrayHasKey( 'plugins', $data );
		$this->assertSame( [ 'akismet/akismet' ], $data['plugins'] );

		$this->assertArrayHasKey( 'status', $data );
		// We register a custom `status` REST field which overrides the core
		// post status one — it should be `queued` immediately on insert.
		$this->assertSame( 'queued', $data['status'] );

		$this->assertArrayHasKey( 'progress', $data );
		$this->assertIsArray( $data['progress'] );
		$this->assertArrayHasKey( 'total_pairs', $data['progress'] );
	}
}
