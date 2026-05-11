<?php
/**
 * Ability: hooksgraph/shared_hooks
 */

declare(strict_types=1);

namespace HooksGraph\Plugin\Abilities;

use HooksGraph\Plugin\Graph_Index;
use HooksGraph\Plugin\Storage;

defined( 'ABSPATH' ) || exit;

/**
 * @return array<string, mixed>
 */
function hooksgraph_ability_shared_hooks( Graph_Index $idx, Storage $storage ): array {
	return array(
		'label'               => __( 'Hooks shared across plugins', 'hooksgraph' ),
		'description'         => __( 'Enumerate hook names that appear in 2+ plugin codebases. Useful for finding hooks that multiple plugins integrate with.', 'hooksgraph' ),
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array(
				'plugins'     => array(
					'type'  => 'array',
					'items' => array( 'type' => 'string' ),
					'description' => __( 'Restrict to this subset of plugin keys. Defaults to every active+parsed plugin.', 'hooksgraph' ),
				),
				'substring'   => array( 'type' => 'string', 'minLength' => 1 ),
				'min_sources' => array( 'type' => 'integer', 'minimum' => 2, 'default' => 2 ),
				'sort'        => array(
					'type'    => 'string',
					'enum'    => array( 'source_count', 'total_activity' ),
					'default' => 'source_count',
				),
				'limit'       => array( 'type' => 'integer', 'minimum' => 1, 'maximum' => 500, 'default' => 50 ),
				'offset'      => array( 'type' => 'integer', 'minimum' => 0, 'default' => 0 ),
			),
			'additionalProperties' => false,
		),
		'execute_callback'    => static function ( array $input ) use ( $idx, $storage ) {
			$keys = ! empty( $input['plugins'] ) && is_array( $input['plugins'] )
				? array_values( array_map( 'strval', $input['plugins'] ) )
				: active_parsed_plugin_keys( $storage );
			$needle      = isset( $input['substring'] ) ? strtolower( (string) $input['substring'] ) : null;
			$min_sources = (int) ( $input['min_sources'] ?? 2 );
			$sort        = $input['sort'] ?? 'source_count';
			$limit       = (int) ( $input['limit'] ?? 50 );
			$offset      = (int) ( $input['offset'] ?? 0 );

			$table = array(); // hookName => [codebase_id => {fire_count, listen_count, hook_type}]
			foreach ( $keys as $key ) {
				$built = $idx->for_plugin( $key );
				if ( $built instanceof \WP_Error ) {
					continue;
				}
				$codebase_id = $storage->codebase_id( $key );
				foreach ( $built['hookByName'] as $hookName => $node ) {
					if ( null !== $needle && ! str_contains( strtolower( $hookName ), $needle ) ) {
						continue;
					}
					if ( ! isset( $table[ $hookName ] ) ) {
						$table[ $hookName ] = array();
					}
					$table[ $hookName ][ $codebase_id ] = array(
						'fire_count'   => (int) ( $node['fire_count'] ?? 0 ),
						'listen_count' => (int) ( $node['listen_count'] ?? 0 ),
						'hook_type'    => $node['hook_type'] ?? null,
					);
				}
			}

			$rows = array();
			foreach ( $table as $hookName => $perCb ) {
				if ( count( $perCb ) < $min_sources ) {
					continue;
				}
				$per_codebase  = array();
				$total_fires   = 0;
				$total_listens = 0;
				$typeSet       = array();
				$canonicalType = null;
				foreach ( $perCb as $cb => $stats ) {
					$per_codebase[] = array(
						'codebase'     => $cb,
						'fire_count'   => $stats['fire_count'],
						'listen_count' => $stats['listen_count'],
					);
					$total_fires   += $stats['fire_count'];
					$total_listens += $stats['listen_count'];
					if ( $stats['hook_type'] ) {
						$typeSet[ $stats['hook_type'] ] = true;
						if ( ! $canonicalType ) {
							$canonicalType = $stats['hook_type'];
						}
					}
				}
				usort( $per_codebase, static fn ( $a, $b ) => $a['codebase'] <=> $b['codebase'] );
				$rows[] = array(
					'hook'                 => $hookName,
					'hook_type'            => $canonicalType,
					'hook_type_divergence' => count( $typeSet ) > 1,
					'sources'              => array_map( static fn ( $p ) => $p['codebase'], $per_codebase ),
					'per_codebase'         => $per_codebase,
					'total_fires'          => $total_fires,
					'total_listens'        => $total_listens,
				);
			}

			usort(
				$rows,
				static function ( $a, $b ) use ( $sort ) {
					if ( 'total_activity' === $sort ) {
						$aTotal = $a['total_fires'] + $a['total_listens'];
						$bTotal = $b['total_fires'] + $b['total_listens'];
						if ( $aTotal !== $bTotal ) {
							return $bTotal <=> $aTotal;
						}
					} else {
						if ( count( $a['sources'] ) !== count( $b['sources'] ) ) {
							return count( $b['sources'] ) <=> count( $a['sources'] );
						}
					}
					return $a['hook'] <=> $b['hook'];
				}
			);

			return paginate( $rows, $limit, $offset );
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
