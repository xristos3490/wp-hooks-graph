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
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

final class Rest_Controller extends WP_REST_Controller {

	public const NAMESPACE = 'hooksgraph/v1';

	private const REST_BASE = 'plugins';

	public function __construct(
		private Storage $storage,
		private Cron $cron,
		private Settings $settings
	) {
		$this->namespace = self::NAMESPACE;
		$this->rest_base = self::REST_BASE;
	}

	public function register(): void {
		add_action( 'rest_api_init', [ $this, 'register_routes' ] );
	}

	public function register_routes(): void {
		$auth = static fn (): bool => current_user_can( 'manage_options' );

		register_rest_route(
			self::NAMESPACE,
			'/' . self::REST_BASE,
			[
				[
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => $auth,
					'callback'            => [ $this, 'get_items' ],
					'args'                => $this->get_collection_params(),
				],
				'schema' => [ $this, 'get_public_item_schema' ],
			]
		);

		register_rest_route(
			self::NAMESPACE,
			// Plugin keys can be either `foldered/main-file` or a single-file
			// slug (e.g. `hello`). Match one optional `/` segment.
			'/' . self::REST_BASE . '/(?P<id>[^/]+(?:/[^/]+)?)',
			[
				[
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => $auth,
					'callback'            => [ $this, 'get_item' ],
					'args'                => [
						'id'       => [
							'type'              => 'string',
							'sanitize_callback' => [ $this, 'sanitize_plugin' ],
						],
						'context'  => $this->get_context_param( [ 'default' => 'view' ] ),
						'_fields'  => [ 'type' => 'string' ],
					],
				],
				'schema' => [ $this, 'get_public_item_schema' ],
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
			'/settings',
			[
				[
					'methods'             => WP_REST_Server::READABLE,
					'permission_callback' => $auth,
					'callback'            => [ $this, 'get_settings' ],
				],
				[
					'methods'             => WP_REST_Server::CREATABLE,
					'permission_callback' => $auth,
					'args'                => [
						'allow_read_files' => [
							'required' => false,
							'type'     => 'boolean',
						],
					],
					'callback'            => [ $this, 'update_settings' ],
				],
			]
		);

		register_rest_route(
			self::NAMESPACE,
			'/parse-data',
			[
				'methods'             => WP_REST_Server::DELETABLE,
				'permission_callback' => $auth,
				'args'                => [
					'plugin' => [
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => [ $this, 'sanitize_plugin' ],
					],
				],
				'callback'            => [ $this, 'delete_parse_data' ],
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
			$out[] = substr( $item, 0, 255 );
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
	 * Collection endpoint: one record per active plugin, server-joined with the
	 * status map. Replaces the React-side `GET /wp/v2/plugins` + parse-state
	 * join with a single call wired through `@wordpress/core-data`.
	 *
	 * Supports `per_page`, `page`, `orderby` (`name|last_parsed_at|parse_status`),
	 * `order`, `search`, `_fields`, `context`. Emits `X-WP-Total` /
	 * `X-WP-TotalPages` headers so DataViews can drive its pager.
	 */
	public function get_items( $request ) {
		[ $keys, $versions, $headers ] = $this->active_plugin_keys();

		$map  = $this->storage->status_map_for( $keys, $versions, $this->cron );
		$rows = [];
		foreach ( $keys as $key ) {
			$file   = $key . '.php';
			$header = $headers[ $file ] ?? [];
			$entry  = $map[ $key ] ?? [];
			$rows[] = $this->row_for( $key, $header, $versions[ $key ] ?? '', $entry );
		}

		$search = (string) $request->get_param( 'search' );
		if ( '' !== $search ) {
			$needle = strtolower( $search );
			$rows   = array_values(
				array_filter(
					$rows,
					static fn ( array $r ): bool => false !== strpos(
						strtolower( $r['name'] . ' ' . $r['author'] . ' ' . $r['id'] ),
						$needle
					)
				)
			);
		}

		$orderby = (string) ( $request->get_param( 'orderby' ) ?: 'name' );
		$order   = strtolower( (string) $request->get_param( 'order' ) ) === 'desc' ? 'desc' : 'asc';
		usort(
			$rows,
			static function ( array $a, array $b ) use ( $orderby, $order ): int {
				$av = $a[ $orderby ] ?? null;
				$bv = $b[ $orderby ] ?? null;
				// Stable null-last ordering — DataViews surfaces null cells as
				// `—`; users expect those to fall to the bottom either way.
				if ( null === $av && null === $bv ) {
					return 0;
				}
				if ( null === $av ) {
					return 1;
				}
				if ( null === $bv ) {
					return -1;
				}
				$cmp = $av <=> $bv;
				return 'desc' === $order ? -$cmp : $cmp;
			}
		);

		$total    = count( $rows );
		$per_page = max( 1, (int) ( $request->get_param( 'per_page' ) ?: 25 ) );
		$page     = max( 1, (int) ( $request->get_param( 'page' ) ?: 1 ) );
		$offset   = ( $page - 1 ) * $per_page;
		$paged    = array_slice( $rows, $offset, $per_page );

		$items = [];
		foreach ( $paged as $row ) {
			$item    = $this->prepare_item_for_response( $row, $request );
			$items[] = $this->prepare_response_for_collection( $item );
		}

		$response = rest_ensure_response( $items );
		$response->header( 'X-WP-Total', (string) $total );
		$response->header( 'X-WP-TotalPages', (string) max( 1, (int) ceil( $total / $per_page ) ) );
		return $response;
	}

	/**
	 * Single-record endpoint at `/plugins/{id}` — used by `getEntityRecord`
	 * for surgical refreshes after a mutation.
	 */
	public function get_item( $request ) {
		$id = (string) $request->get_param( 'id' );
		if ( '' === $id ) {
			return new WP_Error( 'hooksgraph_invalid_plugin', __( 'Invalid plugin identifier.', 'hooksgraph' ), [ 'status' => 400 ] );
		}

		[ $keys, $versions, $headers ] = $this->active_plugin_keys();
		if ( ! in_array( $id, $keys, true ) ) {
			return new WP_Error( 'hooksgraph_unknown_plugin', __( 'Plugin not active.', 'hooksgraph' ), [ 'status' => 404 ] );
		}

		$map    = $this->storage->status_map_for( $keys, $versions, $this->cron );
		$header = $headers[ $id . '.php' ] ?? [];
		$row    = $this->row_for( $id, $header, $versions[ $id ] ?? '', $map[ $id ] ?? [] );

		return $this->prepare_item_for_response( $row, $request );
	}

	/**
	 * Reduce the row to the requested context + `_fields`. The internal
	 * structure already matches the schema, so this is just plumbing.
	 *
	 * @param array<string, mixed> $row
	 */
	public function prepare_item_for_response( $row, $request ): WP_REST_Response {
		$context = ! empty( $request['context'] ) ? (string) $request['context'] : 'view';
		$data    = $this->add_additional_fields_to_object( $row, $request );
		$data    = $this->filter_response_by_context( $data, $context );
		return rest_ensure_response( $data );
	}

	/**
	 * Public schema for `hooksgraph:plugin`. Drives `_fields`, `canUser`, and
	 * the entity store's edit/save shape on the client.
	 */
	public function get_item_schema(): array {
		if ( ! empty( $this->schema ) ) {
			return $this->add_additional_fields_schema( $this->schema );
		}

		$nullable_int = [ 'type' => [ 'integer', 'null' ] ];
		$nullable_str = [ 'type' => [ 'string', 'null' ] ];

		$this->schema = [
			'$schema'    => 'http://json-schema.org/draft-04/schema#',
			'title'      => 'hooksgraph-plugin',
			'type'       => 'object',
			'properties' => [
				'id'             => [ 'type' => 'string',  'context' => [ 'view', 'edit' ], 'readonly' => true ],
				'name'           => [ 'type' => 'string',  'context' => [ 'view', 'edit' ], 'readonly' => true ],
				'version'        => [ 'type' => 'string',  'context' => [ 'view', 'edit' ], 'readonly' => true ],
				'author'         => [ 'type' => 'string',  'context' => [ 'view', 'edit' ], 'readonly' => true ],
				'description'    => [ 'type' => 'string',  'context' => [ 'view', 'edit' ], 'readonly' => true ],
				'requires_php'   => [ 'type' => 'string',  'context' => [ 'view', 'edit' ], 'readonly' => true ],
				'parse_status'   => [
					'type'     => [ 'string', 'null' ],
					'enum'     => [ 'parsed', 'stale', 'needs_parsing', 'scheduled', 'failed', null ],
					'context'  => [ 'view', 'edit' ],
					'readonly' => true,
				],
				'last_parsed_at' => array_merge( $nullable_str, [ 'format' => 'date-time', 'context' => [ 'view', 'edit' ], 'readonly' => true ] ),
				'exclude'        => [
					'type'     => 'array',
					'items'    => [ 'type' => 'string' ],
					'context'  => [ 'view', 'edit' ],
					'readonly' => true,
				],
				'total_files'    => array_merge( $nullable_int, [ 'context' => [ 'view', 'edit' ], 'readonly' => true ] ),
				'total_hooks'    => array_merge( $nullable_int, [ 'context' => [ 'view', 'edit' ], 'readonly' => true ] ),
				'total_edges'    => array_merge( $nullable_int, [ 'context' => [ 'view', 'edit' ], 'readonly' => true ] ),
				'dynamic_hooks'  => array_merge( $nullable_int, [ 'context' => [ 'view', 'edit' ], 'readonly' => true ] ),
				'failed_at'      => array_merge( $nullable_str, [ 'format' => 'date-time', 'context' => [ 'view', 'edit' ], 'readonly' => true ] ),
				'failed_error'   => array_merge( $nullable_str, [ 'context' => [ 'view', 'edit' ], 'readonly' => true ] ),
			],
		];

		return $this->add_additional_fields_schema( $this->schema );
	}

	/**
	 * Restricted collection params — only the subset we actually honor.
	 */
	public function get_collection_params(): array {
		return [
			'context'  => $this->get_context_param( [ 'default' => 'view' ] ),
			'page'     => [
				'type'              => 'integer',
				'default'           => 1,
				'minimum'           => 1,
				'sanitize_callback' => 'absint',
			],
			'per_page' => [
				'type'              => 'integer',
				'default'           => 25,
				'minimum'           => 1,
				'maximum'           => 100,
				'sanitize_callback' => 'absint',
			],
			'search'   => [
				'type'              => 'string',
				'default'           => '',
				'sanitize_callback' => 'sanitize_text_field',
			],
			'orderby'  => [
				'type'    => 'string',
				'default' => 'name',
				'enum'    => [ 'name', 'last_parsed_at', 'parse_status', 'version', 'total_files', 'total_hooks', 'total_edges' ],
			],
			'order'    => [
				'type'    => 'string',
				'default' => 'asc',
				'enum'    => [ 'asc', 'desc' ],
			],
		];
	}

	/**
	 * Pull active plugins + their header records once, so list and single
	 * endpoints share the same lookup.
	 *
	 * @return array{0: list<string>, 1: array<string,string>, 2: array<string, array<string,mixed>>}
	 */
	private function active_plugin_keys(): array {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$active = (array) get_option( 'active_plugins', [] );
		$all    = get_plugins();

		$keys     = [];
		$versions = [];
		$headers  = [];
		foreach ( $active as $file ) {
			if ( ! isset( $all[ $file ] ) ) {
				continue;
			}
			$key              = substr( $file, 0, -4 );
			$keys[]           = $key;
			$versions[ $key ] = (string) ( $all[ $file ]['Version'] ?? '' );
			$headers[ $file ] = $all[ $file ];
		}

		return [ $keys, $versions, $headers ];
	}

	/**
	 * Compose the row shape consumed by both the client DataViews row + the
	 * entity store.
	 *
	 * @param array<string,mixed> $header
	 * @param array<string,mixed> $entry
	 * @return array<string,mixed>
	 */
	private function row_for( string $key, array $header, string $version, array $entry ): array {
		$strip = static fn ( string $html ): string => trim( wp_strip_all_tags( $html ) );

		return [
			'id'             => $key,
			'name'           => $strip( (string) ( $header['Name'] ?? '' ) ),
			'version'        => $version,
			'author'         => $strip( (string) ( $header['Author'] ?? '' ) ),
			'description'    => $strip( (string) ( $header['Description'] ?? '' ) ),
			'requires_php'   => (string) ( $header['RequiresPHP'] ?? '' ),
			'parse_status'   => $entry['status'] ?? null,
			'last_parsed_at' => $entry['last_parsed_at'] ?? null,
			'exclude'        => $entry['exclude'] ?? [],
			'total_files'    => $entry['total_files'] ?? null,
			'total_hooks'    => $entry['total_hooks'] ?? null,
			'total_edges'    => $entry['total_edges'] ?? null,
			'dynamic_hooks'  => $entry['dynamic_hooks'] ?? null,
			'failed_at'      => $entry['failed_at'] ?? null,
			'failed_error'   => $entry['failed_error'] ?? null,
		];
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

		$file = $this->storage->parsed_path( $plugin );
		if ( null === $file || ! is_file( $file ) ) {
			return new WP_Error( 'hooksgraph_not_parsed', __( 'No parsed graph found for this plugin.', 'hooksgraph' ), [ 'status' => 404 ] );
		}

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

	public function get_settings( WP_REST_Request $request ): WP_REST_Response {
		return new WP_REST_Response( $this->settings->all(), 200 );
	}

	public function update_settings( WP_REST_Request $request ): WP_REST_Response {
		$updated = $this->settings->update(
			[
				'allow_read_files' => (bool) $request->get_param( 'allow_read_files' ),
			]
		);
		return new WP_REST_Response( $updated, 200 );
	}

	/**
	 * Destructive: drop the parsed JSON files, codebase meta, and per-plugin
	 * settings entry; unschedule any pending cron event so it can't recreate
	 * the artefacts after the wipe.
	 */
	public function delete_parse_data( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$plugin = (string) $request->get_param( 'plugin' );
		if ( '' === $plugin ) {
			return new WP_Error( 'hooksgraph_invalid_plugin', __( 'Invalid plugin identifier.', 'hooksgraph' ), [ 'status' => 400 ] );
		}

		$this->cron->unschedule( $plugin );
		$result = $this->storage->delete_parsed_data( $plugin );

		return new WP_REST_Response(
			[
				'plugin'        => $plugin,
				'deleted'       => true,
				'files_removed' => $result['files_removed'],
			],
			200
		);
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

		$result = $this->cron->schedule( $plugin );
		if ( Cron::SCHEDULE_FAILED === $result ) {
			return new WP_Error(
				'hooksgraph_schedule_failed',
				__( 'Failed to schedule parse.', 'hooksgraph' ),
				[ 'status' => 500 ]
			);
		}

		return new WP_REST_Response(
			[
				'plugin'    => $plugin,
				'scheduled' => true,
				'newly'     => Cron::SCHEDULE_NEW === $result,
				'exclude'   => $exclude,
			],
			202
		);
	}
}
