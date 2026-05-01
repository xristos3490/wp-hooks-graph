<?php
/**
 * Custom REST routes for the HooksGraph plugin.
 *
 * Owns its own namespace rather than extending `/wp/v2/plugins` — keeps the
 * plugin's data surface scoped to consumers that opt in, and makes the
 * permission story trivial to audit (every route below requires
 * `manage_options`).
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

final class Rest_Controller {

	public const NAMESPACE = 'hooksgraph/v1';

	public function __construct(
		private Storage $storage,
		private Cron $cron
	) {}

	public function register(): void {
		add_action( 'rest_api_init', [ $this, 'register_routes' ] );
	}

	public function register_routes(): void {
		$auth = static fn (): bool => current_user_can( 'manage_options' );

		register_rest_route(
			self::NAMESPACE,
			'/parse-status',
			[
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $auth,
				'callback'            => [ $this, 'list_status' ],
			]
		);

		register_rest_route(
			self::NAMESPACE,
			'/parse-plugin',
			[
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $auth,
				'args'                => [
					'plugin'  => [
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => [ $this, 'sanitize_plugin' ],
					],
					'exclude' => [
						'required'          => false,
						'type'              => 'array',
						'default'           => [],
						'items'             => [ 'type' => 'string' ],
						'sanitize_callback' => [ $this, 'sanitize_exclude' ],
					],
				],
				'callback'            => [ $this, 'schedule_parse' ],
			]
		);
	}

	/**
	 * Normalize the exclude list: trim each entry, drop blanks, cap length.
	 *
	 * @param mixed $value
	 * @return list<string>
	 */
	public function sanitize_exclude( $value ): array {
		if ( is_string( $value ) ) {
			$value = explode( ',', $value );
		}
		if ( ! is_array( $value ) ) {
			return [];
		}
		$out = [];
		foreach ( $value as $item ) {
			if ( ! is_string( $item ) ) {
				continue;
			}
			$item = trim( $item );
			if ( '' === $item ) {
				continue;
			}
			$out[] = mb_substr( $item, 0, 255 );
		}
		return array_values( array_unique( $out ) );
	}

	public function sanitize_plugin( $value ): string {
		// Plugin keys look like `akismet/akismet` (no extension) or `hello`.
		// Allow alnum, dashes, underscores, dots and a single forward slash
		// segment — anything else is rejected outright.
		$value = is_string( $value ) ? $value : '';
		if ( ! preg_match( '#^[a-zA-Z0-9._-]+(?:/[a-zA-Z0-9._-]+)?$#', $value ) ) {
			return '';
		}
		return $value;
	}

	/**
	 * Return a `{ "<plugin-key>": { status, last_parsed_at, exclude } }` map
	 * for every active plugin.
	 *
	 * Status values: parsed | stale | needs_parsing | scheduled.
	 */
	public function list_status( WP_REST_Request $request ): WP_REST_Response {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$active = (array) get_option( 'active_plugins', [] );
		$all    = get_plugins();

		$map = [];
		foreach ( $active as $file ) {
			if ( ! isset( $all[ $file ] ) ) {
				continue;
			}
			// Strip the trailing `.php` to match the form used elsewhere
			// (matches what core's plugin REST controller exposes as `plugin`).
			$key     = substr( $file, 0, -4 );
			$version = (string) ( $all[ $file ]['Version'] ?? '' );

			$status = $this->cron->is_scheduled( $key )
				? 'scheduled'
				: $this->storage->status_for( $key, $version );

			$last     = $this->storage->last_parsed_at( $key );
			$settings = $this->storage->get_settings( $key );

			$map[ $key ] = [
				'status'         => $status,
				'last_parsed_at' => null !== $last ? gmdate( 'c', $last ) : null,
				'exclude'        => $settings['exclude'],
			];
		}

		return new WP_REST_Response( $map, 200 );
	}

	public function schedule_parse( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$plugin = (string) $request->get_param( 'plugin' );
		if ( '' === $plugin ) {
			return new WP_Error( 'hooksgraph_invalid_plugin', __( 'Invalid plugin identifier.', 'hooksgraph' ), [ 'status' => 400 ] );
		}

		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$plugins = get_plugins();
		if ( ! isset( $plugins[ $plugin . '.php' ] ) ) {
			return new WP_Error( 'hooksgraph_unknown_plugin', __( 'Plugin not installed.', 'hooksgraph' ), [ 'status' => 404 ] );
		}

		$exclude = (array) $request->get_param( 'exclude' );
		$this->storage->save_settings( $plugin, $exclude );

		$scheduled = $this->cron->schedule( $plugin );
		return new WP_REST_Response(
			[
				'plugin'    => $plugin,
				'scheduled' => true, // Either we just queued it or one was already pending.
				'newly'     => $scheduled,
				'exclude'   => $exclude,
			],
			202
		);
	}
}
