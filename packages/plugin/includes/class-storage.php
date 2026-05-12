<?php
/**
 * Storage layout for parsed hook graphs.
 *
 * Files live at `wp-content/hooksgraph/<slug>-<version>.json`. The slug is the
 * plugin's directory name for foldered plugins (`akismet/akismet` → `akismet`,
 * `wordpress-seo/wp-seo` → `wordpress-seo`) and the filename stem for single-
 * file plugins (`hello` → `hello`). The version comes from the plugin header
 * and gives us a coarse stale/parsed/needs-parsing classifier.
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

defined( 'ABSPATH' ) || exit;

final class Storage {

	public const STATUS_PARSED        = 'parsed';
	public const STATUS_STALE         = 'stale';
	public const STATUS_NEEDS_PARSING = 'needs_parsing';

	private const SETTINGS_OPTION        = 'hooksgraph_plugin_settings';
	private const CODEBASE_OPTION_PREFIX = 'hooksgraph-parsed-data-';
	private const STATUS_MAP_TRANSIENT   = 'hooksgraph_plugin_status_map';
	private const STATUS_MAP_TTL         = 60;

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
	 * Classify the parse state of `<slug>` against the current `$version`.
	 *
	 * - parsed:        exact `<slug>-<version>.json` exists
	 * - stale:         a `<slug>-*.json` exists but not for the current version
	 * - needs_parsing: nothing on disk
	 */
	public function status_for( string $plugin_relative, string $version ): string {
		$exact = $this->path_for( $plugin_relative, $version );
		if ( file_exists( $exact ) ) {
			return self::STATUS_PARSED;
		}

		$slug    = $this->slug( $plugin_relative );
		$matches = glob( $this->dir() . '/' . $slug . '-*.json' ) ?: [];
		return $matches ? self::STATUS_STALE : self::STATUS_NEEDS_PARSING;
	}

	/**
	 * Latest mtime among any `<slug>-*.json` files, or null when nothing
	 * has been parsed yet. Returned as a Unix timestamp.
	 */
	public function last_parsed_at( string $plugin_relative ): ?int {
		$slug    = $this->slug( $plugin_relative );
		$matches = glob( $this->dir() . '/' . $slug . '-*.json' ) ?: [];
		$latest   = null;
		foreach ( $matches as $file ) {
			$mtime = @filemtime( $file );
			if ( false === $mtime ) {
				continue;
			}
			if ( null === $latest || $mtime > $latest ) {
				$latest = $mtime;
			}
		}
		return $latest;
	}

	/**
	 * Per-plugin settings (currently just exclude patterns) persisted in
	 * a single option so the UI can pre-fill the schedule modal.
	 *
	 * @return array{exclude: list<string>}
	 */
	public function get_settings( string $plugin_relative ): array {
		$all     = get_option( self::SETTINGS_OPTION, [] );
		$entry   = is_array( $all ) && isset( $all[ $plugin_relative ] ) && is_array( $all[ $plugin_relative ] )
			? $all[ $plugin_relative ]
			: [];
		$exclude = isset( $entry['exclude'] ) && is_array( $entry['exclude'] )
			? array_values( array_filter( array_map( 'strval', $entry['exclude'] ) ) )
			: [];
		return [ 'exclude' => $exclude ];
	}

	/**
	 * @param list<string> $exclude
	 */
	public function save_settings( string $plugin_relative, array $exclude ): void {
		$all = get_option( self::SETTINGS_OPTION, [] );
		if ( ! is_array( $all ) ) {
			$all = [];
		}
		$all[ $plugin_relative ] = [ 'exclude' => array_values( $exclude ) ];
		update_option( self::SETTINGS_OPTION, $all, false );
	}

	/**
	 * Stable id for a parsed codebase. Matches the slug used for JSON output,
	 * lower-cased and sanitized to be safe in an option name.
	 */
	public function codebase_id( string $plugin_relative ): string {
		return sanitize_key( $this->slug( $plugin_relative ) );
	}

	public function codebase_option_name( string $plugin_relative ): string {
		return self::CODEBASE_OPTION_PREFIX . $this->codebase_id( $plugin_relative );
	}

	/**
	 * Read the codebase metadata option, or null when nothing has been parsed.
	 *
	 * @return array<string, mixed>|null
	 */
	public function get_codebase_meta( string $plugin_relative ): ?array {
		$value = get_option( $this->codebase_option_name( $plugin_relative ), null );
		return is_array( $value ) ? $value : null;
	}

	/**
	 * Persist a small metadata record per parsed codebase in its own
	 * non-autoloaded option (`hooksgraph-parsed-data-<id>`). The shape mirrors
	 * the JSON header plus a few derived counts the UI may want without
	 * re-reading the full graph file.
	 *
	 * @param array<string, mixed> $metadata `metadata` block from the parser JSON.
	 */
	public function save_codebase_meta(
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

		$payload = [
			'id'            => $this->codebase_id( $plugin_relative ),
			'plugin'        => $plugin_relative,
			'version'       => $version,
			'file'          => $filename,
			'parsed_at'     => time(),
			'source_labels' => $source_labels,
			'total_files'   => isset( $metadata['total_files'] ) ? (int) $metadata['total_files'] : 0,
			'total_hooks'   => isset( $metadata['total_hooks'] ) ? (int) $metadata['total_hooks'] : 0,
			'dynamic_hooks' => isset( $metadata['dynamic_hooks'] ) ? (int) $metadata['dynamic_hooks'] : 0,
			'total_edges'   => $total_edges,
		];

		update_option( $this->codebase_option_name( $plugin_relative ), $payload, false );
	}

	/**
	 * Record a parse failure on the codebase meta option so the UI can show a
	 * "Parse failed" pill. Merges into the existing record (if any) — preserves
	 * the last successful parse fields so we still know what's on disk.
	 */
	public function save_codebase_failure( string $plugin_relative, string $error ): void {
		$existing = $this->get_codebase_meta( $plugin_relative ) ?? [
			'id'     => $this->codebase_id( $plugin_relative ),
			'plugin' => $plugin_relative,
		];

		$existing['failed_at']    = time();
		$existing['failed_error'] = wp_substr( $error, 0, 500 );

		update_option( $this->codebase_option_name( $plugin_relative ), $existing, false );
	}

	/**
	 * Batched status lookup for many plugins at once.
	 *
	 * Replaces the N-time `glob() + get_option()` loop in the REST list endpoint
	 * with one directory scan, one bulk read of the settings option, and one
	 * `get_option()` per codebase meta record. Wrapped in a short-TTL transient
	 * so the dashboard's first paint is the only one that pays the full cost
	 * until something invalidates the cache (scheduling or cron completion).
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

		// One glob() over the storage dir; bucket files by slug so each plugin
		// resolves with a hash lookup instead of a per-plugin glob.
		$files_by_slug = [];
		foreach ( glob( $this->dir() . '/*.json' ) ?: [] as $file ) {
			$base = basename( $file, '.json' );
			$dash = strrpos( $base, '-' );
			if ( false === $dash ) {
				continue;
			}
			$slug    = substr( $base, 0, $dash );
			$version = substr( $base, $dash + 1 );
			$mtime   = @filemtime( $file );
			$files_by_slug[ $slug ][] = [
				'version' => $version,
				'mtime'   => false === $mtime ? 0 : (int) $mtime,
			];
		}

		$map = [];
		foreach ( $plugin_keys as $key ) {
			$slug             = $this->slug( $key );
			$version          = (string) ( $versions[ $key ] ?? '' );
			$version_filename = sanitize_file_name( '' !== $version ? $version : 'unversioned' );

			$files_for = $files_by_slug[ $slug ] ?? [];
			$last      = null;
			$has_exact = false;
			foreach ( $files_for as $f ) {
				if ( $f['version'] === $version_filename ) {
					$has_exact = true;
				}
				if ( null === $last || $f['mtime'] > $last ) {
					$last = $f['mtime'];
				}
			}

			$entry   = isset( $all_settings[ $key ] ) && is_array( $all_settings[ $key ] ) ? $all_settings[ $key ] : [];
			$exclude = isset( $entry['exclude'] ) && is_array( $entry['exclude'] )
				? array_values( array_filter( array_map( 'strval', $entry['exclude'] ) ) )
				: [];

			$meta               = $this->get_codebase_meta( $key );
			$failed_at          = isset( $meta['failed_at'] ) ? (int) $meta['failed_at'] : null;
			$has_recent_failure = null !== $failed_at && ( null === $last || $failed_at > $last );

			if ( $cron->is_scheduled( $key ) ) {
				$status = 'scheduled';
			} elseif ( $has_recent_failure ) {
				$status = 'failed';
			} elseif ( $has_exact ) {
				$status = self::STATUS_PARSED;
			} elseif ( ! empty( $files_for ) ) {
				$status = self::STATUS_STALE;
			} else {
				$status = self::STATUS_NEEDS_PARSING;
			}

			$map[ $key ] = [
				'status'         => $status,
				'last_parsed_at' => null !== $last ? gmdate( 'c', $last ) : null,
				'exclude'        => $exclude,
				'total_files'    => isset( $meta['total_files'] ) ? (int) $meta['total_files'] : null,
				'total_hooks'    => isset( $meta['total_hooks'] ) ? (int) $meta['total_hooks'] : null,
				'total_edges'    => isset( $meta['total_edges'] ) ? (int) $meta['total_edges'] : null,
				'dynamic_hooks'  => isset( $meta['dynamic_hooks'] ) ? (int) $meta['dynamic_hooks'] : null,
				'failed_at'      => $has_recent_failure ? gmdate( 'c', $failed_at ) : null,
				'failed_error'   => $has_recent_failure && isset( $meta['failed_error'] ) ? (string) $meta['failed_error'] : null,
			];
		}

		set_transient( self::STATUS_MAP_TRANSIENT, [ 'fingerprint' => $fingerprint, 'map' => $map ], self::STATUS_MAP_TTL );

		return $map;
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
