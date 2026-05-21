<?php
/**
 * Storage layout for parsed hook graphs.
 *
 * Files live at `wp-content/hooksgraph/<slug>-<version>.json`. The slug is the
 * plugin's directory name for foldered plugins (`akismet/akismet` → `akismet`,
 * `wordpress-seo/wp-seo` → `wordpress-seo`) and the filename stem for single-
 * file plugins (`hello` → `hello`).
 *
 * Per-plugin parse state (exclude patterns, last-parsed version + filename,
 * totals, failure record) is the responsibility of the single
 * `hooksgraph_plugin_settings` option — keyed by plugin key. The on-disk JSON
 * is the artefact; the option is the source of truth for "what state are we
 * in?". Filesystem checks intentionally do not influence status: if someone
 * removes a JSON file out-of-band, the UI still says `parsed` until the next
 * re-parse, which is the same fragility we had with per-plugin meta options
 * and lets the hot list path stay glob-free.
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

defined( 'ABSPATH' ) || exit;

final class Storage {

	public const STATUS_PARSED        = 'parsed';
	public const STATUS_STALE         = 'stale';
	public const STATUS_NEEDS_PARSING = 'needs_parsing';

	private const SETTINGS_OPTION      = 'hooksgraph_plugin_settings';
	private const STATUS_MAP_TRANSIENT = 'hooksgraph_plugin_status_map';
	private const STATUS_MAP_TTL       = 60;

	public function dir(): string {
		return trailingslashit( WP_CONTENT_DIR ) . 'hooksgraph';
	}

	public function ensure_dir(): bool {
		$dir = $this->dir();
		if ( ! wp_mkdir_p( $dir ) ) {
			return false;
		}

		// Defense-in-depth: prevent directory listing / direct browsing of
		// JSON files even though they only contain public hook metadata.
		$index = $dir . '/index.php';
		if ( ! file_exists( $index ) ) {
			if ( false === @file_put_contents( $index, "<?php\n// Silence is golden.\n" ) ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Stable, collision-free slug for a plugin key. Foldered plugins use the
	 * directory part (`wordpress-seo/wp-seo` → `wordpress-seo`) since WP enforces
	 * unique plugin directories; single-file plugins fall back to the filename
	 * stem (`hello` → `hello`), which is already unique within `plugins/`.
	 * `basename( $plugin_relative )` alone is not safe — two foldered plugins
	 * can share a main-file basename (e.g. `foo/wp-seo` vs `bar/wp-seo`).
	 */
	public function slug( string $plugin_relative ): string {
		$slash = strpos( $plugin_relative, '/' );
		$slug  = false === $slash ? $plugin_relative : substr( $plugin_relative, 0, $slash );
		return sanitize_file_name( $slug );
	}

	/**
	 * Filename for a given plugin + version pair.
	 *
	 * @param string $plugin_relative e.g. `akismet/akismet` or `hello`.
	 */
	public function filename( string $plugin_relative, string $version ): string {
		$slug    = $this->slug( $plugin_relative );
		$version = sanitize_file_name( $version !== '' ? $version : 'unversioned' );
		return "{$slug}-{$version}.json";
	}

	public function path_for( string $plugin_relative, string $version ): string {
		return $this->dir() . '/' . $this->filename( $plugin_relative, $version );
	}

	/**
	 * Stable id for a parsed codebase. Used as the result key in the abilities
	 * surface so AI responses can pivot per-codebase without knowing the full
	 * plugin path.
	 */
	public function codebase_id( string $plugin_relative ): string {
		return sanitize_key( $this->slug( $plugin_relative ) );
	}

	/**
	 * Read the full per-plugin record from the settings option, returning the
	 * canonical shape (with defaults) so callers don't need to type-check
	 * every field.
	 *
	 * @return array{
	 *   exclude: list<string>,
	 *   last_parsed_version: ?string,
	 *   last_parsed_at: ?int,
	 *   filename: ?string,
	 *   total_files: ?int,
	 *   total_hooks: ?int,
	 *   total_edges: ?int,
	 *   dynamic_hooks: ?int,
	 *   source_labels: list<string>,
	 *   failed_at: ?int,
	 *   failed_error: ?string,
	 * }
	 */
	public function get_record( string $plugin_relative ): array {
		$all   = get_option( self::SETTINGS_OPTION, [] );
		$entry = is_array( $all ) && isset( $all[ $plugin_relative ] ) && is_array( $all[ $plugin_relative ] )
			? $all[ $plugin_relative ]
			: [];
		return $this->normalize_record( $entry );
	}

	/**
	 * Back-compat wrapper for callers that only want exclude patterns.
	 *
	 * @return array{exclude: list<string>}
	 */
	public function get_settings( string $plugin_relative ): array {
		return [ 'exclude' => $this->get_record( $plugin_relative )['exclude'] ];
	}

	/**
	 * Update the exclude list without clobbering parse history.
	 *
	 * @param list<string> $exclude
	 */
	public function save_settings( string $plugin_relative, array $exclude ): void {
		$this->update_record( $plugin_relative, [ 'exclude' => array_values( $exclude ) ] );
	}

	/**
	 * Record a successful parse: stores the version + filename so the hot
	 * list path can derive status without touching the filesystem, plus the
	 * counts we surface in the DataView row. Clears any previous failure.
	 *
	 * @param array<string, mixed> $metadata `metadata` block from the parser JSON.
	 */
	public function record_parse_success(
		string $plugin_relative,
		string $version,
		string $filename,
		array $metadata,
		int $total_edges
	): void {
		$source_labels = [];
		if ( isset( $metadata['source_labels'] ) && is_array( $metadata['source_labels'] ) ) {
			$source_labels = array_values( array_map( 'strval', $metadata['source_labels'] ) );
		}

		$this->update_record(
			$plugin_relative,
			[
				'last_parsed_version' => $version,
				'last_parsed_at'      => time(),
				'filename'            => $filename,
				'total_files'         => isset( $metadata['total_files'] ) ? (int) $metadata['total_files'] : 0,
				'total_hooks'         => isset( $metadata['total_hooks'] ) ? (int) $metadata['total_hooks'] : 0,
				'dynamic_hooks'       => isset( $metadata['dynamic_hooks'] ) ? (int) $metadata['dynamic_hooks'] : 0,
				'total_edges'         => $total_edges,
				'source_labels'       => $source_labels,
				'failed_at'           => null,
				'failed_error'        => null,
			]
		);
	}

	/**
	 * Record a parse failure. Keeps any prior successful parse fields so the
	 * UI still knows what's on disk — only the failure overlay is updated.
	 */
	public function record_parse_failure( string $plugin_relative, string $error ): void {
		$this->update_record(
			$plugin_relative,
			[
				'failed_at'    => time(),
				'failed_error' => function_exists( 'wp_substr' ) ? wp_substr( $error, 0, 500 ) : mb_substr( $error, 0, 500 ),
			]
		);
	}

	/**
	 * Batched status lookup for many plugins at once.
	 *
	 * Reads the settings option (one DB hit) and the cron queue (in-memory)
	 * — no filesystem scan, no per-plugin option reads. Wrapped in a short
	 * transient because the input fingerprint rarely changes between
	 * dashboard polls.
	 *
	 * @param list<string>          $plugin_keys e.g. `[ 'akismet/akismet', 'hello' ]`.
	 * @param array<string,string>  $versions    Map of plugin key → plugin header version.
	 * @param Cron                  $cron        Used to layer the `scheduled` status on top.
	 * @return array<string, array{
	 *   status: string,
	 *   last_parsed_at: ?string,
	 *   exclude: list<string>,
	 *   total_files: ?int,
	 *   total_hooks: ?int,
	 *   total_edges: ?int,
	 *   dynamic_hooks: ?int,
	 *   failed_at: ?string,
	 *   failed_error: ?string,
	 * }>
	 */
	public function status_map_for( array $plugin_keys, array $versions, Cron $cron ): array {
		$fingerprint = $this->status_map_fingerprint( $plugin_keys, $versions );
		$cached      = get_transient( self::STATUS_MAP_TRANSIENT );
		if ( is_array( $cached ) && ( $cached['fingerprint'] ?? '' ) === $fingerprint && isset( $cached['map'] ) && is_array( $cached['map'] ) ) {
			return $cached['map'];
		}

		$all_settings = get_option( self::SETTINGS_OPTION, [] );
		if ( ! is_array( $all_settings ) ) {
			$all_settings = [];
		}

		$map = [];
		foreach ( $plugin_keys as $key ) {
			$current_version = (string) ( $versions[ $key ] ?? '' );
			$entry           = isset( $all_settings[ $key ] ) && is_array( $all_settings[ $key ] )
				? $this->normalize_record( $all_settings[ $key ] )
				: $this->normalize_record( [] );

			$last_version       = $entry['last_parsed_version'];
			$last_at            = $entry['last_parsed_at'];
			$failed_at          = $entry['failed_at'];
			$has_recent_failure = null !== $failed_at && ( null === $last_at || $failed_at > $last_at );

			if ( $cron->is_scheduled( $key ) ) {
				$status = 'scheduled';
			} elseif ( $has_recent_failure ) {
				$status = 'failed';
			} elseif ( null !== $last_version && $last_version === $current_version ) {
				$status = self::STATUS_PARSED;
			} elseif ( null !== $last_version ) {
				$status = self::STATUS_STALE;
			} else {
				$status = self::STATUS_NEEDS_PARSING;
			}

			$map[ $key ] = [
				'status'         => $status,
				'last_parsed_at' => null !== $last_at ? gmdate( 'c', $last_at ) : null,
				'exclude'        => $entry['exclude'],
				'total_files'    => $entry['total_files'],
				'total_hooks'    => $entry['total_hooks'],
				'total_edges'    => $entry['total_edges'],
				'dynamic_hooks'  => $entry['dynamic_hooks'],
				'failed_at'      => $has_recent_failure ? gmdate( 'c', $failed_at ) : null,
				'failed_error'   => $has_recent_failure ? $entry['failed_error'] : null,
			];
		}

		set_transient( self::STATUS_MAP_TRANSIENT, [ 'fingerprint' => $fingerprint, 'map' => $map ], self::STATUS_MAP_TTL );

		return $map;
	}

	/**
	 * Single-plugin status — convenience wrapper around `status_map_for()` for
	 * code paths that only know about one plugin (currently the abilities
	 * surface). Does not consult cron; pass through `status_map_for()` if you
	 * need the `scheduled` overlay.
	 */
	public function status_for( string $plugin_relative, string $version ): string {
		$entry        = $this->get_record( $plugin_relative );
		$last_version = $entry['last_parsed_version'];

		if ( null !== $last_version && $last_version === $version ) {
			return self::STATUS_PARSED;
		}
		if ( null !== $last_version ) {
			return self::STATUS_STALE;
		}
		return self::STATUS_NEEDS_PARSING;
	}

	/**
	 * Timestamp of the last successful parse for this plugin, or null when
	 * nothing has been parsed yet.
	 */
	public function last_parsed_at( string $plugin_relative ): ?int {
		return $this->get_record( $plugin_relative )['last_parsed_at'];
	}

	/**
	 * Absolute path of the most recent parsed JSON for this plugin, or null
	 * when nothing has been parsed yet. Used by the abilities and the
	 * download endpoint to locate the on-disk file without globbing.
	 */
	public function parsed_path( string $plugin_relative ): ?string {
		$filename = $this->get_record( $plugin_relative )['filename'];
		if ( null === $filename ) {
			return null;
		}
		return $this->dir() . '/' . $filename;
	}

	/**
	 * Destructively reset every piece of state we hold for a plugin:
	 *
	 *   - every `<slug>-*.json` file under the storage dir
	 *   - the plugin's entry in the `hooksgraph_plugin_settings` option
	 *   - the cached status map (so the next REST hit reflects the wipe)
	 *
	 * Callers are responsible for unscheduling pending cron jobs separately
	 * — that lives on `Cron::unschedule()` so this class stays free of
	 * cron concerns.
	 *
	 * @return array{ files_removed: int }
	 */
	public function delete_parsed_data( string $plugin_relative ): array {
		$slug    = $this->slug( $plugin_relative );
		$matches = glob( $this->dir() . '/' . $slug . '-*.json' ) ?: [];
		$removed = 0;
		foreach ( $matches as $file ) {
			if ( @unlink( $file ) ) {
				$removed++;
			}
		}

		$all = get_option( self::SETTINGS_OPTION, [] );
		if ( is_array( $all ) && isset( $all[ $plugin_relative ] ) ) {
			unset( $all[ $plugin_relative ] );
			update_option( self::SETTINGS_OPTION, $all, false );
		}

		$this->invalidate_status_map();

		return [ 'files_removed' => $removed ];
	}

	/**
	 * Drop the cached status map so the next REST hit recomputes.
	 *
	 * Called from `Cron::schedule()` and the tail of `Cron::run()` so the UI
	 * sees `scheduled → parsed` transitions without waiting out the TTL.
	 */
	public function invalidate_status_map(): void {
		delete_transient( self::STATUS_MAP_TRANSIENT );
	}

	/**
	 * Merge a patch into the record for one plugin, preserving every field
	 * the patch doesn't mention. Always invalidates the status map.
	 *
	 * @param array<string, mixed> $patch
	 */
	private function update_record( string $plugin_relative, array $patch ): void {
		$all = get_option( self::SETTINGS_OPTION, [] );
		if ( ! is_array( $all ) ) {
			$all = [];
		}
		$existing                = isset( $all[ $plugin_relative ] ) && is_array( $all[ $plugin_relative ] ) ? $all[ $plugin_relative ] : [];
		$all[ $plugin_relative ] = array_merge( $existing, $patch );
		update_option( self::SETTINGS_OPTION, $all, false );
		$this->invalidate_status_map();
	}

	/**
	 * @param array<string, mixed> $entry
	 * @return array{
	 *   exclude: list<string>,
	 *   last_parsed_version: ?string,
	 *   last_parsed_at: ?int,
	 *   filename: ?string,
	 *   total_files: ?int,
	 *   total_hooks: ?int,
	 *   total_edges: ?int,
	 *   dynamic_hooks: ?int,
	 *   source_labels: list<string>,
	 *   failed_at: ?int,
	 *   failed_error: ?string,
	 * }
	 */
	private function normalize_record( array $entry ): array {
		$nullable_int = static fn ( $v ): ?int => null === $v || '' === $v ? null : (int) $v;
		$nullable_str = static function ( $v ): ?string {
			if ( null === $v ) {
				return null;
			}
			$s = (string) $v;
			return '' === $s ? null : $s;
		};

		$exclude = isset( $entry['exclude'] ) && is_array( $entry['exclude'] )
			? array_values( array_filter( array_map( 'strval', $entry['exclude'] ) ) )
			: [];

		$source_labels = isset( $entry['source_labels'] ) && is_array( $entry['source_labels'] )
			? array_values( array_map( 'strval', $entry['source_labels'] ) )
			: [];

		return [
			'exclude'             => $exclude,
			'last_parsed_version' => $nullable_str( $entry['last_parsed_version'] ?? null ),
			'last_parsed_at'      => $nullable_int( $entry['last_parsed_at'] ?? null ),
			'filename'            => $nullable_str( $entry['filename'] ?? null ),
			'total_files'         => $nullable_int( $entry['total_files'] ?? null ),
			'total_hooks'         => $nullable_int( $entry['total_hooks'] ?? null ),
			'total_edges'         => $nullable_int( $entry['total_edges'] ?? null ),
			'dynamic_hooks'       => $nullable_int( $entry['dynamic_hooks'] ?? null ),
			'source_labels'       => $source_labels,
			'failed_at'           => $nullable_int( $entry['failed_at'] ?? null ),
			'failed_error'        => $nullable_str( $entry['failed_error'] ?? null ),
		];
	}

	/**
	 * Fingerprint of the active-plugins + versions input. Same input → same key,
	 * regardless of order — so callers don't need to canonicalize.
	 *
	 * @param list<string>         $plugin_keys
	 * @param array<string,string> $versions
	 */
	private function status_map_fingerprint( array $plugin_keys, array $versions ): string {
		sort( $plugin_keys );
		ksort( $versions );
		return md5( serialize( [ $plugin_keys, $versions ] ) );
	}

	/**
	 * Remove older parsed files for a given plugin slug. Called after a successful
	 * parse so we don't accumulate stale versions indefinitely.
	 */
	public function prune_older( string $plugin_relative, string $current_filename ): void {
		$slug    = $this->slug( $plugin_relative );
		$matches = glob( $this->dir() . '/' . $slug . '-*.json' ) ?: [];
		foreach ( $matches as $file ) {
			if ( basename( $file ) !== $current_filename ) {
				@unlink( $file );
			}
		}
	}
}
