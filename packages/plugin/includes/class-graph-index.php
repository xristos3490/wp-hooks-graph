<?php
/**
 * Per-request memoized in-memory index over a parsed hooks-graph JSON file.
 *
 * Mirrors the JS index in `packages/mcp/src/index.js`. The cache is keyed by
 * resolved file path so two plugin keys that point at the same file share a
 * single build. The service is constructed once per request inside
 * Abilities_Registrar, which makes the cache request-scoped automatically.
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

use WP_Error;

defined( 'ABSPATH' ) || exit;

final class Graph_Index {

	/**
	 * @var array<string, array<string, mixed>> path → built index
	 */
	private array $cache = array();

	public function __construct( private Storage $storage ) {}

	/**
	 * Resolve a plugin key (`akismet/akismet` form) to its newest parsed JSON
	 * on disk and return the built index. Returns a WP_Error when no JSON
	 * exists or the file is unreadable / invalid.
	 *
	 * @return array<string, mixed>|WP_Error
	 */
	public function for_plugin( string $plugin_key ) {
		$path = $this->resolve_path( $plugin_key );
		if ( $path instanceof WP_Error ) {
			return $path;
		}

		if ( isset( $this->cache[ $path ] ) ) {
			return $this->cache[ $path ];
		}

		$text = @file_get_contents( $path );
		if ( false === $text ) {
			return new WP_Error(
				'hooksgraph_read_failed',
				/* translators: %s: file path */
				sprintf( __( 'Could not read parsed graph at %s.', 'hooksgraph' ), $path ),
				array( 'status' => 500 )
			);
		}

		$raw = json_decode( $text, true );
		if ( ! is_array( $raw ) ) {
			return new WP_Error(
				'hooksgraph_invalid_json',
				__( 'Parsed graph JSON is invalid.', 'hooksgraph' ),
				array( 'status' => 500 )
			);
		}

		$built                = $this->build( $plugin_key, $path, $raw );
		$this->cache[ $path ] = $built;
		return $built;
	}

	/**
	 * Path of the parsed JSON for this plugin as recorded in
	 * `hooksgraph_plugin_settings`, or WP_Error when nothing has been parsed.
	 *
	 * @return string|WP_Error
	 */
	private function resolve_path( string $plugin_key ) {
		$path = $this->storage->parsed_path( $plugin_key );
		if ( null === $path || ! is_file( $path ) ) {
			return new WP_Error(
				'hooksgraph_not_parsed',
				/* translators: %s: plugin key */
				sprintf( __( 'No parsed graph found for "%s". Call hooksgraph/list-codebases to see what is available.', 'hooksgraph' ), $plugin_key ),
				array( 'status' => 404 )
			);
		}
		return $path;
	}

	/**
	 * Build the index buckets — same shape as `buildIndex()` in
	 * `packages/mcp/src/index.js`.
	 *
	 * @param array<string, mixed> $raw
	 * @return array<string, mixed>
	 */
	private function build( string $id, string $path, array $raw ): array {
		$nodes       = array();
		$hookByName  = array();
		$fileByPath  = array();

		foreach ( (array) ( $raw['nodes'] ?? array() ) as $node ) {
			if ( ! is_array( $node ) || ! isset( $node['id'] ) ) {
				continue;
			}
			$nodes[ $node['id'] ] = $node;
			if ( ( $node['type'] ?? null ) === 'hook' && isset( $node['name'] ) && is_string( $node['name'] ) ) {
				$hookByName[ $node['name'] ] = $node;
			} elseif ( ( $node['type'] ?? null ) === 'file' && isset( $node['path'] ) && is_string( $node['path'] ) ) {
				$fileByPath[ $node['path'] ] = $node;
			}
		}

		$firesByHook   = array();
		$listensByHook = array();
		$edgesByFile   = array();
		$allEdges      = array();

		foreach ( (array) ( $raw['edges'] ?? array() ) as $edge ) {
			if ( ! is_array( $edge ) ) {
				continue;
			}
			$allEdges[] = $edge;

			$type   = $edge['type'] ?? null;
			$target = $edge['target'] ?? null;
			$source = $edge['source'] ?? null;

			if ( 'fires' === $type && null !== $target ) {
				$firesByHook[ $target ][] = $edge;
			} elseif ( 'listens' === $type && null !== $target ) {
				$listensByHook[ $target ][] = $edge;
			}

			if ( null !== $source ) {
				$edgesByFile[ $source ][] = $edge;
			}
		}

		return array(
			'id'             => $id,
			'path'           => $path,
			'meta'           => is_array( $raw['metadata'] ?? null ) ? $raw['metadata'] : array(),
			'nodes'          => $nodes,
			'hookByName'     => $hookByName,
			'fileByPath'     => $fileByPath,
			'firesByHook'    => $firesByHook,
			'listensByHook'  => $listensByHook,
			'edgesByFile'    => $edgesByFile,
			'allEdges'       => $allEdges,
		);
	}
}
