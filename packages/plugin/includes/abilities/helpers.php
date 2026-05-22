<?php
/**
 * Shared helpers for the HooksGraph ability handlers.
 *
 * PHP ports of `packages/mcp/src/lib/paginate.js` and `packages/mcp/src/lib/shape.js`.
 * Plain namespaced functions — every ability needs them and a class wrapper would
 * add no value.
 *
 * @package HooksGraph\Plugin
 */

declare(strict_types=1);

namespace HooksGraph\Plugin\Abilities;

use HooksGraph\Plugin\Storage;

defined( 'ABSPATH' ) || exit;

/**
 * Map of `<plugin_key> => <version>` for every active installed plugin.
 *
 * Exposes the `hooksgraph_known_plugins` filter so test suites (and any plugin
 * that wants to scope hooksgraph differently than "all active plugins") can
 * override the source list. Default implementation reads `get_plugins()` +
 * `active_plugins` option, matching the existing REST controller's surface.
 *
 * @return array<string, string>
 */
function known_active_plugins(): array {
	if ( ! function_exists( 'get_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	$active = (array) get_option( 'active_plugins', array() );
	$all    = \get_plugins();

	$out = array();
	foreach ( $active as $file ) {
		if ( ! isset( $all[ $file ] ) ) {
			continue;
		}
		$key         = substr( $file, 0, -4 );
		$out[ $key ] = (string) ( $all[ $file ]['Version'] ?? '' );
	}

	/**
	 * Filter the active plugin set that hooksgraph abilities operate over.
	 *
	 * @param array<string, string> $plugins Map of plugin key (e.g. `akismet/akismet`) → version.
	 */
	$filtered = apply_filters( 'hooksgraph_known_plugins', $out );
	return is_array( $filtered ) ? $filtered : $out;
}

/**
 * Enumerate active plugin keys that have at least a stale parsed graph on disk.
 * Used as the default "all codebases" for cross-plugin abilities.
 *
 * @return list<string>
 */
function active_parsed_plugin_keys( Storage $storage ): array {
	$out = array();
	foreach ( known_active_plugins() as $key => $version ) {
		if ( Storage::STATUS_NEEDS_PARSING === $storage->status_for( $key, $version ) ) {
			continue;
		}
		$out[] = $key;
	}
	return $out;
}

/**
 * @param array<int, mixed> $items
 * @return array{total:int, has_more:bool, results:array<int, mixed>}
 */
function paginate( array $items, int $limit, int $offset ): array {
	$total = count( $items );
	$start = min( $offset, $total );
	$end   = min( $start + $limit, $total );
	return array(
		'total'    => $total,
		'has_more' => $end < $total,
		'results'  => array_values( array_slice( $items, $start, $end - $start ) ),
	);
}

/**
 * @param array<string, mixed> $node
 * @return array<string, mixed>
 */
function hook_summary( array $node ): array {
	return array(
		'id'           => $node['id'] ?? null,
		'type'         => $node['type'] ?? null,
		'hook_type'    => $node['hook_type'] ?? null,
		'name'         => $node['name'] ?? null,
		'fire_count'   => $node['fire_count'] ?? 0,
		'listen_count' => $node['listen_count'] ?? 0,
		'dynamic'      => $node['dynamic'] ?? false,
		'sources'      => $node['sources'] ?? array(),
	);
}

/**
 * @param array<string, mixed> $edge
 * @param array<string, mixed> $built
 */
function file_path_from_edge_source( array $edge, array $built ): string {
	$source = $edge['source'] ?? '';
	$node   = $built['nodes'][ $source ] ?? null;
	if ( is_array( $node ) && isset( $node['path'] ) && is_string( $node['path'] ) ) {
		return $node['path'];
	}
	$parts = explode( '::', (string) $source );
	$tail  = implode( '::', array_slice( $parts, 2 ) );
	return '' !== $tail ? $tail : (string) $source;
}

/**
 * @param array<string, mixed> $edge
 * @param array<string, mixed> $built
 */
function hook_name_from_edge_target( array $edge, array $built ): string {
	$target = $edge['target'] ?? '';
	$node   = $built['nodes'][ $target ] ?? null;
	if ( is_array( $node ) && isset( $node['name'] ) && is_string( $node['name'] ) ) {
		return $node['name'];
	}
	$prefix = 'hook::';
	return str_starts_with( (string) $target, $prefix ) ? substr( (string) $target, strlen( $prefix ) ) : (string) $target;
}

const METADATA_FIELDS = array( 'effects', 'targets', 'called_apis', 'filter_behavior', 'callback_body_start_line', 'callback_body_end_line' );

/**
 * @param array<string, mixed> $base
 * @param array<string, mixed> $edge
 * @return array<string, mixed>
 */
function with_metadata( array $base, array $edge ): array {
	foreach ( METADATA_FIELDS as $key ) {
		if ( array_key_exists( $key, $edge ) ) {
			$base[ $key ] = $edge[ $key ];
		}
	}
	return $base;
}

/**
 * @param array<string, mixed> $edge
 * @param array<string, mixed> $built
 * @return array<string, mixed>
 */
function listener_result( array $edge, array $built ): array {
	return with_metadata(
		array(
			'file'           => file_path_from_edge_source( $edge, $built ),
			'line'           => $edge['line'] ?? null,
			'callback'       => $edge['callback'] ?? null,
			'callback_type'  => $edge['callback_type'] ?? null,
			'priority'       => $edge['priority'] ?? null,
			'scope_function' => $edge['scope_function'] ?? null,
		),
		$edge
	);
}

/**
 * @param array<string, mixed> $edge
 * @param array<string, mixed> $built
 * @return array<string, mixed>
 */
function firer_result( array $edge, array $built ): array {
	return with_metadata(
		array(
			'file'           => file_path_from_edge_source( $edge, $built ),
			'line'           => $edge['line'] ?? null,
			'callback'       => null,
			'callback_type'  => null,
			'priority'       => null,
			'scope_function' => $edge['scope_function'] ?? null,
		),
		$edge
	);
}

/**
 * @param array<string, mixed> $edge
 * @param array<string, mixed> $built
 * @return array<string, mixed>
 */
function file_edge_result( array $edge, array $built ): array {
	$base = array(
		'hook'      => hook_name_from_edge_target( $edge, $built ),
		'edge_type' => $edge['type'] ?? null,
		'line'      => $edge['line'] ?? null,
	);
	if ( 'listens' === ( $edge['type'] ?? null ) ) {
		$base['callback']       = $edge['callback'] ?? null;
		$base['priority']       = $edge['priority'] ?? null;
		$base['scope_function'] = $edge['scope_function'] ?? null;
	}
	return with_metadata( $base, $edge );
}

/**
 * @param array<string, mixed> $edge
 * @param array<string, mixed> $built
 * @return array<string, mixed>
 */
function codebased_listener_result( array $edge, string $codebase_id, array $built ): array {
	return array( 'codebase' => $codebase_id ) + listener_result( $edge, $built );
}

/**
 * @param array<string, mixed> $edge
 * @param array<string, mixed> $built
 * @return array<string, mixed>
 */
function codebased_firer_result( array $edge, string $codebase_id, array $built ): array {
	return array( 'codebase' => $codebase_id ) + firer_result( $edge, $built );
}

/**
 * @param array<string, mixed> $edge
 * @param array<string, mixed> $built
 * @return array<string, mixed>
 */
function callback_search_result( array $edge, string $codebase_id, array $built ): array {
	return with_metadata(
		array(
			'codebase' => $codebase_id,
			'hook'     => hook_name_from_edge_target( $edge, $built ),
			'file'     => file_path_from_edge_source( $edge, $built ),
			'line'     => $edge['line'] ?? null,
			'callback' => $edge['callback'] ?? null,
			'priority' => $edge['priority'] ?? null,
		),
		$edge
	);
}

/**
 * Comparator helpers (used by compare_hook / filter_priority_conflicts).
 */

function cmp_listeners( array $a, array $b ): int {
	$ap = $a['priority'] ?? PHP_INT_MAX;
	$bp = $b['priority'] ?? PHP_INT_MAX;
	if ( $ap !== $bp ) {
		return $ap <=> $bp;
	}
	if ( ( $a['codebase'] ?? '' ) !== ( $b['codebase'] ?? '' ) ) {
		return ( $a['codebase'] ?? '' ) <=> ( $b['codebase'] ?? '' );
	}
	$af = $a['file'] ?? '';
	$bf = $b['file'] ?? '';
	if ( $af !== $bf ) {
		return $af <=> $bf;
	}
	return ( $a['line'] ?? 0 ) <=> ( $b['line'] ?? 0 );
}

function cmp_firers( array $a, array $b ): int {
	if ( ( $a['codebase'] ?? '' ) !== ( $b['codebase'] ?? '' ) ) {
		return ( $a['codebase'] ?? '' ) <=> ( $b['codebase'] ?? '' );
	}
	$af = $a['file'] ?? '';
	$bf = $b['file'] ?? '';
	if ( $af !== $bf ) {
		return $af <=> $bf;
	}
	return ( $a['line'] ?? 0 ) <=> ( $b['line'] ?? 0 );
}

function cmp_priority_group_listener( array $a, array $b ): int {
	if ( ( $a['codebase'] ?? '' ) !== ( $b['codebase'] ?? '' ) ) {
		return ( $a['codebase'] ?? '' ) <=> ( $b['codebase'] ?? '' );
	}
	$af = $a['file'] ?? '';
	$bf = $b['file'] ?? '';
	if ( $af !== $bf ) {
		return $af <=> $bf;
	}
	return ( $a['line'] ?? 0 ) <=> ( $b['line'] ?? 0 );
}
