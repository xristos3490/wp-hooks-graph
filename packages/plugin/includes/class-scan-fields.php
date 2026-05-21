<?php
/**
 * Meta + REST fields for the hg_scan CPT.
 *
 * Every scan-specific field lives on post meta so it round-trips through the
 * default `WP_REST_Posts_Controller`. We additionally register top-level REST
 * fields so DataViews can bind directly to e.g. `scan.plugins` instead of
 * `scan.meta._hg_scan_plugins`.
 *
 * The `freshness` field is computed at read time — it's never persisted.
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

use WP_Post;

defined( 'ABSPATH' ) || exit;

final class Scan_Fields {

	public const META_PLUGINS         = '_hg_scan_plugins';
	public const META_STATUS          = '_hg_scan_status';
	public const META_PROGRESS        = '_hg_scan_progress';
	public const META_STARTED_AT      = '_hg_scan_started_at';
	public const META_FINISHED_AT     = '_hg_scan_finished_at';
	public const META_RESULT          = '_hg_scan_result';
	public const META_PLUGIN_VERSIONS = '_hg_scan_plugin_versions';
	public const META_ERROR           = '_hg_scan_error';

	public function __construct( private Storage $storage ) {}

	public function register(): void {
		add_action( 'init', [ $this, 'register_meta' ] );
		add_action( 'rest_api_init', [ $this, 'register_rest_fields' ] );
	}

	public function register_meta(): void {
		$auth = static fn (): bool => current_user_can( 'manage_options' );

		\register_post_meta(
			Scan_CPT::POST_TYPE,
			self::META_PLUGINS,
			[
				'type'              => 'array',
				'single'            => true,
				'default'           => [],
				'show_in_rest'      => [
					'schema' => [
						'type'  => 'array',
						'items' => [ 'type' => 'string' ],
					],
				],
				'auth_callback'     => $auth,
				'sanitize_callback' => [ $this, 'sanitize_plugins' ],
			]
		);

		\register_post_meta(
			Scan_CPT::POST_TYPE,
			self::META_STATUS,
			[
				'type'          => 'string',
				'single'        => true,
				'default'       => 'queued',
				'show_in_rest'  => true,
				'auth_callback' => $auth,
			]
		);

		\register_post_meta(
			Scan_CPT::POST_TYPE,
			self::META_PROGRESS,
			[
				'type'          => 'object',
				'single'        => true,
				'default'       => [ 'total_pairs' => 0, 'completed_pairs' => 0, 'failed_pairs' => 0 ],
				'show_in_rest'  => [
					'schema' => [
						'type'                 => 'object',
						'properties'           => [
							'total_pairs'     => [ 'type' => 'integer' ],
							'completed_pairs' => [ 'type' => 'integer' ],
							'failed_pairs'    => [ 'type' => 'integer' ],
						],
						'additionalProperties' => true,
					],
				],
				'auth_callback' => $auth,
			]
		);

		\register_post_meta(
			Scan_CPT::POST_TYPE,
			self::META_STARTED_AT,
			[ 'type' => 'string', 'single' => true, 'default' => '', 'show_in_rest' => true, 'auth_callback' => $auth ]
		);

		\register_post_meta(
			Scan_CPT::POST_TYPE,
			self::META_FINISHED_AT,
			[ 'type' => 'string', 'single' => true, 'default' => '', 'show_in_rest' => true, 'auth_callback' => $auth ]
		);

		\register_post_meta(
			Scan_CPT::POST_TYPE,
			self::META_RESULT,
			[
				'type'          => 'object',
				'single'        => true,
				'default'       => [],
				'show_in_rest'  => [
					'schema' => [
						'type'                 => 'object',
						'additionalProperties' => true,
					],
				],
				'auth_callback' => $auth,
			]
		);

		\register_post_meta(
			Scan_CPT::POST_TYPE,
			self::META_PLUGIN_VERSIONS,
			[
				'type'          => 'object',
				'single'        => true,
				'default'       => [],
				'show_in_rest'  => [
					'schema' => [
						'type'                 => 'object',
						'additionalProperties' => [ 'type' => 'string' ],
					],
				],
				'auth_callback' => $auth,
			]
		);

		\register_post_meta(
			Scan_CPT::POST_TYPE,
			self::META_ERROR,
			[ 'type' => 'string', 'single' => true, 'default' => '', 'show_in_rest' => true, 'auth_callback' => $auth ]
		);
	}

	public function register_rest_fields(): void {
		$auth      = static fn (): bool => current_user_can( 'manage_options' );
		$post_type = Scan_CPT::POST_TYPE;

		\register_rest_field(
			$post_type,
			'plugins',
			[
				'get_callback'    => static fn ( array $post ): array => (array) get_post_meta( (int) $post['id'], self::META_PLUGINS, true ),
				'update_callback' => function ( $value, WP_Post $post ): void {
					$sanitized = $this->sanitize_plugins( $value );
					update_post_meta( $post->ID, self::META_PLUGINS, $sanitized );
				},
				'schema'          => [
					'type'  => 'array',
					'items' => [ 'type' => 'string' ],
				],
			]
		);

		// NOTE: deliberately no update_callback — REST clients send the core
		// post `status` (publish/draft) which would otherwise be written into
		// our `_hg_scan_status` meta. The runner is the sole writer.
		\register_rest_field(
			$post_type,
			'status',
			[
				'get_callback' => static fn ( array $post ): string => (string) ( get_post_meta( (int) $post['id'], self::META_STATUS, true ) ?: 'queued' ),
				'schema'       => [ 'type' => 'string' ],
			]
		);

		\register_rest_field(
			$post_type,
			'progress',
			[
				'get_callback' => static function ( array $post ) {
					$raw = get_post_meta( (int) $post['id'], self::META_PROGRESS, true );
					if ( ! is_array( $raw ) ) {
						return [ 'total_pairs' => 0, 'completed_pairs' => 0, 'failed_pairs' => 0 ];
					}
					return [
						'total_pairs'     => (int) ( $raw['total_pairs'] ?? 0 ),
						'completed_pairs' => (int) ( $raw['completed_pairs'] ?? 0 ),
						'failed_pairs'    => (int) ( $raw['failed_pairs'] ?? 0 ),
					];
				},
				'schema'       => [
					'type'       => 'object',
					'properties' => [
						'total_pairs'     => [ 'type' => 'integer' ],
						'completed_pairs' => [ 'type' => 'integer' ],
						'failed_pairs'    => [ 'type' => 'integer' ],
					],
				],
			]
		);

		\register_rest_field(
			$post_type,
			'started_at',
			[
				'get_callback' => static fn ( array $post ): ?string => self::nullable_string( get_post_meta( (int) $post['id'], self::META_STARTED_AT, true ) ),
				'schema'       => [ 'type' => [ 'string', 'null' ] ],
			]
		);

		\register_rest_field(
			$post_type,
			'finished_at',
			[
				'get_callback' => static fn ( array $post ): ?string => self::nullable_string( get_post_meta( (int) $post['id'], self::META_FINISHED_AT, true ) ),
				'schema'       => [ 'type' => [ 'string', 'null' ] ],
			]
		);

		\register_rest_field(
			$post_type,
			'result',
			[
				'get_callback' => static function ( array $post ) {
					$raw = get_post_meta( (int) $post['id'], self::META_RESULT, true );
					return is_array( $raw ) ? $raw : null;
				},
				'schema'       => [ 'type' => [ 'object', 'null' ] ],
			]
		);

		\register_rest_field(
			$post_type,
			'plugin_versions',
			[
				'get_callback' => static function ( array $post ): array {
					$raw = get_post_meta( (int) $post['id'], self::META_PLUGIN_VERSIONS, true );
					return is_array( $raw ) ? $raw : [];
				},
				'schema'       => [ 'type' => 'object' ],
			]
		);

		\register_rest_field(
			$post_type,
			'freshness',
			[
				'get_callback' => [ $this, 'compute_freshness' ],
				'schema'       => [ 'type' => 'string', 'enum' => [ 'fresh', 'stale', 'missing' ] ],
			]
		);

		\register_rest_field(
			$post_type,
			'error',
			[
				'get_callback' => static fn ( array $post ): ?string => self::nullable_string( get_post_meta( (int) $post['id'], self::META_ERROR, true ) ),
				'schema'       => [ 'type' => [ 'string', 'null' ] ],
			]
		);
	}

	/**
	 * Derive `fresh | stale | missing` by diffing the recorded snapshot against
	 * the current `Storage::status_map_for` output.
	 *
	 * @param array<string, mixed> $post
	 */
	public function compute_freshness( array $post ): string {
		$snapshot = get_post_meta( (int) $post['id'], self::META_PLUGIN_VERSIONS, true );
		if ( ! is_array( $snapshot ) || empty( $snapshot ) ) {
			return 'fresh';
		}

		$keys     = array_keys( $snapshot );
		$versions = array_map( 'strval', $snapshot );

		// `status_map_for` wants the *current* installed version per key, so
		// surface whatever the storage layer reports as the active record's
		// last-parsed version (mirrors known_active_plugins() shape).
		$current_versions = [];
		foreach ( $keys as $key ) {
			$record = $this->storage->get_record( $key );
			$current_versions[ $key ] = (string) ( $record['last_parsed_version'] ?? '' );
		}

		$cron = new Cron( new Parser_Service( $this->storage ), $this->storage );
		$map  = $this->storage->status_map_for( $keys, $current_versions, $cron );

		$has_missing = false;
		$has_stale   = false;

		foreach ( $snapshot as $key => $snap_version ) {
			$entry = $map[ $key ] ?? null;
			if ( ! is_array( $entry ) ) {
				$has_missing = true;
				continue;
			}
			$status      = (string) ( $entry['status'] ?? '' );
			$current_ver = (string) ( $this->storage->get_record( $key )['last_parsed_version'] ?? '' );

			if ( '' === $current_ver || Storage::STATUS_NEEDS_PARSING === $status ) {
				$has_missing = true;
				continue;
			}

			if ( $current_ver !== (string) $snap_version ) {
				$has_stale = true;
			}
		}

		if ( $has_missing ) {
			return 'missing';
		}
		if ( $has_stale ) {
			return 'stale';
		}
		return 'fresh';
	}

	/**
	 * Mirror Rest_Controller::sanitize_plugin() — same regex, applied per item.
	 *
	 * @param mixed $value
	 * @return list<string>
	 */
	public function sanitize_plugins( $value ): array {
		if ( ! is_array( $value ) ) {
			return [];
		}
		$out = [];
		foreach ( $value as $item ) {
			if ( ! is_string( $item ) ) {
				continue;
			}
			if ( ! preg_match( '#^[a-zA-Z0-9._-]+(?:/[a-zA-Z0-9._-]+)?$#', $item ) ) {
				continue;
			}
			$out[] = $item;
		}
		return array_values( array_unique( $out ) );
	}

	private static function nullable_string( $value ): ?string {
		$value = is_string( $value ) ? $value : '';
		return '' === $value ? null : $value;
	}
}
