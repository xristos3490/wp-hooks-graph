<?php
/**
 * Custom Post Type for AI conflict scans.
 *
 * `hg_scan` is admin-invisible (no UI, no menu) — the React SPA is the only
 * surface. Exposed through core `/wp/v2/hg-scans` so DataViews can drive list
 * + create flows without bespoke REST.
 *
 * The CPT uses a unique `capability_type` (`hg_scan` / `hg_scans`) and the
 * `map_meta_cap` filter rewrites only those scoped caps to `manage_options`,
 * keeping parity with the rest of the plugin's permission story without
 * affecting site-wide post caps for other users/roles.
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

defined( 'ABSPATH' ) || exit;

final class Scan_CPT {

	public const POST_TYPE = 'hg_scan';
	public const REST_BASE = 'hg-scans';

	public function register(): void {
		add_action( 'init', [ $this, 'register_post_type' ] );
		add_filter( 'map_meta_cap', [ $this, 'map_meta_cap' ], 10, 4 );
		add_filter( 'rest_pre_dispatch', [ $this, 'gate_rest_routes' ], 10, 3 );
	}

	/**
	 * Force every `/wp/v2/hg-scans` request through a `manage_options` check —
	 * the default posts controller exposes view-context reads to anonymous
	 * users for any `show_in_rest` CPT.
	 */
	public function gate_rest_routes( $result, $server, $request ) {
		if ( null !== $result ) {
			return $result;
		}
		$route = (string) $request->get_route();
		if ( ! str_starts_with( $route, '/wp/v2/' . self::REST_BASE ) ) {
			return $result;
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			return new \WP_Error(
				'rest_forbidden',
				__( 'Sorry, you are not allowed to access scans.', 'hooksgraph' ),
				[ 'status' => is_user_logged_in() ? 403 : 401 ]
			);
		}
		return $result;
	}

	public function register_post_type(): void {
		\register_post_type(
			self::POST_TYPE,
			[
				'label'               => __( 'HooksGraph Scans', 'hooksgraph' ),
				'public'              => false,
				'show_ui'             => false,
				'show_in_menu'        => false,
				'show_in_nav_menus'   => false,
				'show_in_admin_bar'   => false,
				'show_in_rest'        => true,
				'rest_base'           => self::REST_BASE,
				'rest_namespace'      => 'wp/v2',
				'supports'            => [ 'title', 'author', 'custom-fields' ],
				// Unique capability_type so cap checks resolve to
				// `edit_hg_scan(s)` etc. — `map_meta_cap` then only rewrites
				// those, leaving site-wide caps (`edit_posts`, …) untouched.
				'capability_type'     => [ 'hg_scan', 'hg_scans' ],
				'map_meta_cap'        => true,
				'has_archive'         => false,
				'hierarchical'        => false,
				'exclude_from_search' => true,
				'publicly_queryable'  => false,
			]
		);
	}

	/**
	 * Gate all hg_scan capability checks behind `manage_options`.
	 *
	 * @param array<int, string> $caps    Required primitive capabilities.
	 * @param string             $cap     Meta capability being checked.
	 * @param int                $user_id User the check is for.
	 * @param array<int, mixed>  $args    Context args (post id etc.).
	 *
	 * @return array<int, string>
	 */
	public function map_meta_cap( $caps, $cap, $user_id, $args ): array {
		// Only rewrite caps that are uniquely scoped to our CPT — never
		// touch generic post caps (`edit_posts`, `delete_posts`, …) since
		// `map_meta_cap` fires for every capability check site-wide and
		// rewriting those would break unrelated authors/editors.
		$type_caps = [
			'edit_hg_scan',
			'edit_hg_scans',
			'edit_others_hg_scans',
			'publish_hg_scans',
			'read_hg_scan',
			'read_private_hg_scans',
			'delete_hg_scan',
			'delete_hg_scans',
			'delete_others_hg_scans',
			'delete_published_hg_scans',
			'delete_private_hg_scans',
			'edit_published_hg_scans',
			'edit_private_hg_scans',
			'create_hg_scans',
		];

		if ( in_array( $cap, $type_caps, true ) ) {
			return [ 'manage_options' ];
		}

		return (array) $caps;
	}
}
