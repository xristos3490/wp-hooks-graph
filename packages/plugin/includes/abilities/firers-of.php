<?php
/**
 * Ability: hooksgraph/firers-of
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
	'hooksgraph/firers-of',
	array(
		'category'            => 'hooksgraph',
		'label'               => __( 'List hook firers', 'hooksgraph' ),
		'description'         => __( 'List every do_action/apply_filters call site for a given hook in one plugin codebase, paginated. Use when the user asks where a hook is fired from.', 'hooksgraph' ),
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array(
				'plugin' => array( 'type' => 'string', 'description' => __( 'Plugin key like "akismet/akismet".', 'hooksgraph' ) ),
				'hook'   => array( 'type' => 'string', 'description' => __( 'Hook name.', 'hooksgraph' ) ),
				'limit'  => array( 'type' => 'integer', 'minimum' => 1, 'maximum' => 500, 'default' => 50 ),
				'offset' => array( 'type' => 'integer', 'minimum' => 0, 'default' => 0 ),
			),
			'required'             => array( 'plugin', 'hook' ),
			'additionalProperties' => false,
		),
		'execute_callback'    => static function ( array $input ) use ( $index ) {
			$built = $index->for_plugin( $input['plugin'] );
			if ( $built instanceof \WP_Error ) {
				return $built;
			}
			$limit  = (int) ( $input['limit'] ?? 50 );
			$offset = (int) ( $input['offset'] ?? 0 );
			$node   = $built['hookByName'][ $input['hook'] ] ?? null;
			if ( ! $node ) {
				return array( 'total' => 0, 'has_more' => false, 'results' => array() );
			}
			$edges = $built['firesByHook'][ $node['id'] ] ?? array();
			$page  = paginate( $edges, $limit, $offset );
			$page['results'] = array_map( static fn ( $e ) => firer_result( $e, $built ), $page['results'] );
			return $page;
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
