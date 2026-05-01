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
			'/parse-download',
			[
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $auth,
				'args'                => [
					'plugin' => [
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => [ $this, 'sanitize_plugin' ],
					],
				],
				'callback'            => [ $this, 'download_parse' ],
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

	/**
	 * Stream the most recent parsed JSON for `$plugin` as an attachment.
	 *
	 * Bypasses the REST serializer via `rest_pre_serve_request` so the file is
	 * sent byte-for-byte rather than re-encoded.
	 */
	public function download_parse( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$plugin = (string) $request->get_param( 'plugin' );
		if ( '' === $plugin ) {
			return new WP_Error( 'hooksgraph_invalid_plugin', __( 'Invalid plugin identifier.', 'hooksgraph' ), [ 'status' => 400 ] );
		}

		$basename = sanitize_file_name( basename( $plugin ) );
		$matches  = glob( $this->storage->dir() . '/' . $basename . '-*.json' ) ?: [];
		if ( ! $matches ) {
			return new WP_Error( 'hooksgraph_not_parsed', __( 'No parsed graph found for this plugin.', 'hooksgraph' ), [ 'status' => 404 ] );
		}

		// Prefer the newest file on disk — handles both `parsed` (current version)
		// and `stale` (older version) cases without the caller needing to know which.
		usort( $matches, static fn ( string $a, string $b ): int => ( (int) @filemtime( $b ) ) <=> ( (int) @filemtime( $a ) ) );
		$file = $matches[0];

		if ( ! is_readable( $file ) ) {
			return new WP_Error( 'hooksgraph_read_failed', __( 'Could not read the parsed graph.', 'hooksgraph' ), [ 'status' => 500 ] );
		}

		$filename = basename( $file );
		$size     = (int) @filesize( $file );

		add_filter(
			'rest_pre_serve_request',
			static function ( bool $served, $result, WP_REST_Request $req ) use ( $file, $filename, $size ): bool {
				if ( $served || $req->get_route() !== '/' . self::NAMESPACE . '/parse-download' ) {
					return $served;
				}
				if ( ! headers_sent() ) {
					header( 'Content-Type: application/json; charset=utf-8' );
					header( 'Content-Disposition: attachment; filename="' . $filename . '"' );
					if ( $size > 0 ) {
						header( 'Content-Length: ' . $size );
					}
					nocache_headers();
				}
				readfile( $file );
				return true;
			},
			10,
			3
		);

		// Returned response is consumed only if the filter above is bypassed
		// (e.g., headers already sent). Body is a no-op marker.
		$response = new WP_REST_Response( null, 200 );
		$response->header( 'Content-Disposition', 'attachment; filename="' . $filename . '"' );
		return $response;
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
