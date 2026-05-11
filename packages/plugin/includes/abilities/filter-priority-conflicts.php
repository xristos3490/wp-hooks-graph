<?php
/**
 * Ability: hooksgraph/filter_priority_conflicts
 */

declare(strict_types=1);

namespace HooksGraph\Plugin\Abilities;

use HooksGraph\Plugin\Graph_Index;
use HooksGraph\Plugin\Storage;

defined( 'ABSPATH' ) || exit;

/**
 * @return array<string, mixed>
 */
function hooksgraph_ability_filter_priority_conflicts( Graph_Index $idx, Storage $storage ): array {
	return array(
		'label'               => __( 'Find filter priority conflicts', 'hooksgraph' ),
		'description'         => __( 'Find filter hooks where listeners from 2+ plugin codebases share the same priority. Filter execution order affects return values — earlier callbacks can overwrite what later ones receive.', 'hooksgraph' ),
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array(
				'hook'          => array( 'type' => 'string', 'description' => __( 'Exact hook name.', 'hooksgraph' ) ),
				'substring'     => array( 'type' => 'string', 'description' => __( 'Case-insensitive substring filter on hook name.', 'hooksgraph' ) ),
				'plugins'       => array(
					'type'  => 'array',
					'items' => array( 'type' => 'string' ),
					'description' => __( 'Restrict to this subset of plugin keys. Defaults to all active+parsed.', 'hooksgraph' ),
				),
				'min_codebases' => array( 'type' => 'integer', 'minimum' => 2, 'default' => 2 ),
				'limit'         => array( 'type' => 'integer', 'minimum' => 1, 'maximum' => 500, 'default' => 50 ),
				'offset'        => array( 'type' => 'integer', 'minimum' => 0, 'default' => 0 ),
			),
			'additionalProperties' => false,
		),
		'execute_callback'    => static function ( array $input ) use ( $idx, $storage ) {
			$hook      = $input['hook'] ?? null;
			$substring = $input['substring'] ?? null;
			$hasHook   = is_string( $hook ) && '' !== $hook;
			$hasSub    = is_string( $substring ) && '' !== $substring;
			if ( $hasHook && $hasSub ) {
				return new \WP_Error(
					'hooksgraph_bad_args',
					__( "filter_priority_conflicts: provide at most one of 'hook' or 'substring'.", 'hooksgraph' ),
					array( 'status' => 400 )
				);
			}
			$needle        = $hasSub ? strtolower( $substring ) : null;
			$min_codebases = (int) ( $input['min_codebases'] ?? 2 );
			$limit         = (int) ( $input['limit'] ?? 50 );
			$offset        = (int) ( $input['offset'] ?? 0 );

			$keys = ! empty( $input['plugins'] ) && is_array( $input['plugins'] )
				? array_values( array_map( 'strval', $input['plugins'] ) )
				: active_parsed_plugin_keys( $storage );

			$loaded = array();
			foreach ( $keys as $key ) {
				$built = $idx->for_plugin( $key );
				if ( $built instanceof \WP_Error ) {
					continue;
				}
				$loaded[] = array(
					'codebase_id' => $storage->codebase_id( $key ),
					'built'       => $built,
				);
			}

			$byHook    = array(); // hookName -> [priority -> [codebase_id -> [results...]]]
			$hookTypes = array();

			foreach ( $loaded as $cb ) {
				foreach ( $cb['built']['hookByName'] as $hookName => $node ) {
					if ( $hasHook && $hookName !== $hook ) {
						continue;
					}
					if ( null !== $needle && ! str_contains( strtolower( $hookName ), $needle ) ) {
						continue;
					}
					if ( ( $node['hook_type'] ?? null ) === 'action' ) {
						continue;
					}
					$listenEdges = $cb['built']['listensByHook'][ $node['id'] ] ?? array();
					if ( empty( $listenEdges ) ) {
						continue;
					}
					if ( ! empty( $node['hook_type'] ) ) {
						if ( ! isset( $hookTypes[ $hookName ] ) ) {
							$hookTypes[ $hookName ] = array();
						}
						$hookTypes[ $hookName ][ $cb['codebase_id'] ] = $node['hook_type'];
					}
					foreach ( $listenEdges as $edge ) {
						$priority = $edge['priority'] ?? null;
						if ( null === $priority ) {
							continue;
						}
						$byHook[ $hookName ][ $priority ][ $cb['codebase_id'] ][] = codebased_listener_result( $edge, $cb['codebase_id'], $cb['built'] );
					}
				}
			}

			$rows = array();
			foreach ( $byHook as $hookName => $priorityMap ) {
				$collisions = array();
				foreach ( $priorityMap as $priority => $cbMap ) {
					if ( count( $cbMap ) < $min_codebases ) {
						continue;
					}
					$listeners = array();
					foreach ( $cbMap as $bucket ) {
						foreach ( $bucket as $l ) {
							$listeners[] = $l;
						}
					}
					usort( $listeners, __NAMESPACE__ . '\\cmp_priority_group_listener' );
					$cbKeys = array_keys( $cbMap );
					sort( $cbKeys );
					$collisions[] = array(
						'priority'       => $priority,
						'codebases'      => $cbKeys,
						'listener_count' => count( $listeners ),
						'listeners'      => $listeners,
					);
				}
				if ( empty( $collisions ) ) {
					continue;
				}
				usort( $collisions, static fn ( $a, $b ) => $a['priority'] <=> $b['priority'] );
				$rows[] = array(
					'hook'                  => $hookName,
					'hook_type_by_codebase' => $hookTypes[ $hookName ] ?? array(),
					'collision_count'       => count( $collisions ),
					'collisions'            => $collisions,
				);
			}

			usort(
				$rows,
				static function ( $a, $b ) {
					if ( $a['collision_count'] !== $b['collision_count'] ) {
						return $b['collision_count'] <=> $a['collision_count'];
					}
					return $a['hook'] <=> $b['hook'];
				}
			);

			$page  = paginate( $rows, $limit, $offset );
			$query = array_merge(
				$hasHook ? array( 'hook' => $hook ) : array(),
				$hasSub ? array( 'substring' => $substring ) : array(),
				array( 'min_codebases' => $min_codebases )
			);
			return array(
				'query'    => $query,
				'total'    => $page['total'],
				'has_more' => $page['has_more'],
				'results'  => $page['results'],
			);
		},
		'permission_callback' => static fn (): bool => current_user_can( 'manage_options' ),
		'meta'                => array(
			'annotations' => array(
				'readonly'    => true,
				'destructive' => false,
				'idempotent'  => true,
			),
		),
	);
}
