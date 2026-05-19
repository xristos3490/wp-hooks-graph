<?php
/**
 * Ability: hooksgraph/hotspots
 *
 * Included from {@see \HooksGraph\Plugin\hooksgraph_register_abilities()} with
 * `$index` (Graph_Index) and `$storage` (Storage) in local scope.
 *
 * @package HooksGraph\Plugin
 */

declare(strict_types=1);

namespace HooksGraph\Plugin\Abilities;

defined( 'ABSPATH' ) || exit;

/** @var \HooksGraph\Plugin\Graph_Index $index */

\wp_register_ability(
	'hooksgraph/hotspots',
	array(
		'category'            => 'hooksgraph',
		'label'               => __( 'Hook hotspots', 'hooksgraph' ),
		'description'         => __( 'Return the hooks with the most activity in one plugin codebase, sorted descending. Use to highlight the busiest extension points.', 'hooksgraph' ),
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array(
				'plugin' => array( 'type' => 'string' ),
				'metric' => array(
					'type'    => 'string',
					'enum'    => array( 'total', 'fires', 'listens' ),
					'default' => 'total',
				),
				'limit'  => array( 'type' => 'integer', 'minimum' => 1, 'maximum' => 500, 'default' => 20 ),
			),
			'required'             => array( 'plugin' ),
			'additionalProperties' => false,
		),
		'execute_callback'    => static function ( array $input ) use ( $index ) {
			$built = $index->for_plugin( $input['plugin'] );
			if ( $built instanceof \WP_Error ) {
				return $built;
			}
			$metric = $input['metric'] ?? 'total';
			$limit  = (int) ( $input['limit'] ?? 20 );

			$rows = array();
			foreach ( $built['nodes'] as $node ) {
				if ( ( $node['type'] ?? null ) !== 'hook' ) {
					continue;
				}
				$fires   = (int) ( $node['fire_count'] ?? 0 );
				$listens = (int) ( $node['listen_count'] ?? 0 );
				$rows[]  = array(
					'hook'         => $node['name'] ?? null,
					'hook_type'    => $node['hook_type'] ?? null,
					'fire_count'   => $fires,
					'listen_count' => $listens,
					'total'        => $fires + $listens,
				);
			}
			$key = 'fires' === $metric ? 'fire_count' : ( 'listens' === $metric ? 'listen_count' : 'total' );
			usort(
				$rows,
				static function ( $a, $b ) use ( $key ) {
					if ( $b[ $key ] !== $a[ $key ] ) {
						return $b[ $key ] <=> $a[ $key ];
					}
					return ( $a['hook'] ?? '' ) <=> ( $b['hook'] ?? '' );
				}
			);
			return array_slice( $rows, 0, $limit );
		},
		'permission_callback' => static fn (): bool => current_user_can( 'manage_options' ),
		'meta'                => array(
			'annotations' => array(
				'readonly'    => true,
				'destructive' => false,
				'idempotent'  => true,
			),
		),
	)
);
