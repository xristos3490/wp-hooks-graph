<?php
/**
 * Wraps the HooksGraph parser library for in-process use from WordPress.
 *
 * Calls the lower-level Discovery/Parser/Graph classes directly rather than
 * going through `Cli\Runner`, which is interactive and writes to stdout/stderr.
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

use HooksGraph\Discovery\PhpFileFinder;
use HooksGraph\Graph\Builder;
use HooksGraph\Parser\FileParser;
use Throwable;

defined( 'ABSPATH' ) || exit;

final class Parser_Service {

	public function __construct( private Storage $storage ) {}

	/**
	 * Parse a plugin's source tree and persist the JSON.
	 *
	 * @param string       $plugin_relative  Plugin path as stored by core (`akismet/akismet`, `hello`).
	 * @param string       $version          Plugin header version, used in the output filename.
	 * @param list<string> $exclude_patterns Folder/file substrings or path segments to skip.
	 *
	 * @return array{ok: bool, path?: string, error?: string}
	 */
	public function parse( string $plugin_relative, string $version, array $exclude_patterns = [] ): array {
		if ( ! $this->storage->ensure_dir() ) {
			return [ 'ok' => false, 'error' => 'Could not create storage directory.' ];
		}

		[ $dirs, $files, $label ] = $this->resolve_targets( $plugin_relative, $exclude_patterns );
		if ( $files === [] ) {
			return [ 'ok' => false, 'error' => 'No PHP files found for this plugin.' ];
		}

		$all_calls = [];
		foreach ( $files as $file ) {
			try {
				array_push( $all_calls, ...FileParser::parse( $file, $label ) );
			} catch ( Throwable $e ) {
				// Per-file failures shouldn't abort the whole parse; log and skip.
				error_log( sprintf( '[hooksgraph] Failed to parse %s: %s', $file, $e->getMessage() ) );
			}
		}

		$graph = ( new Builder() )->build( $all_calls, $dirs, count( $files ) );

		$output_path = $this->storage->path_for( $plugin_relative, $version );
		$json        = wp_json_encode( $graph, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );

		if ( false === $json || false === file_put_contents( $output_path, $json ) ) {
			return [ 'ok' => false, 'error' => 'Failed to write output JSON.' ];
		}

		$this->storage->prune_older( $plugin_relative, basename( $output_path ) );

		$this->storage->save_codebase_meta(
			$plugin_relative,
			$version,
			basename( $output_path ),
			is_array( $graph['metadata'] ?? null ) ? $graph['metadata'] : [],
			is_array( $graph['edges'] ?? null ) ? count( $graph['edges'] ) : 0
		);

		return [ 'ok' => true, 'path' => $output_path ];
	}

	/**
	 * @param list<string> $exclude_patterns
	 * @return array{0: list<string>, 1: list<string>, 2: string} [$dirs, $files, $label]
	 */
	private function resolve_targets( string $plugin_relative, array $exclude_patterns ): array {
		if ( str_contains( $plugin_relative, '/' ) ) {
			$plugin_dir = trailingslashit( WP_PLUGIN_DIR ) . dirname( $plugin_relative );
			if ( ! is_dir( $plugin_dir ) ) {
				return [ [], [], '' ];
			}

			$label = basename( $plugin_dir );
			$files = PhpFileFinder::find( $plugin_dir, $exclude_patterns );
			return [ [ $plugin_dir ], array_values( $files ), $label ];
		}

		// Single-file plugin (e.g. `hello.php`). Treat the file as its own root.
		$file = trailingslashit( WP_PLUGIN_DIR ) . $plugin_relative . '.php';
		if ( ! is_file( $file ) ) {
			return [ [], [], '' ];
		}

		$label = basename( $plugin_relative );
		return [ [ trailingslashit( WP_PLUGIN_DIR ) ], [ $file ], $label ];
	}
}
