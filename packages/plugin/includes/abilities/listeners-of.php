<?php
/**
 * Ability: hooksgraph/listeners_of
 */

declare(strict_types=1);

namespace HooksGraph\Plugin\Abilities;

use HooksGraph\Plugin\Graph_Index;
use HooksGraph\Plugin\Storage;

defined( 'ABSPATH' ) || exit;

/**
 * @return array<string, mixed>
 */
function hooksgraph_ability_listeners_of( Graph_Index $idx, Storage $storage ): array {
	return array(
		'label'               => __( 'List hook listeners', 'hooksgraph' ),
		'description'         => __( 'List every add_action/add_filter registration for a given hook in one plugin codebase, paginated. Use when the user wants to know which callbacks subscribe to a hook.', 'hooksgraph' ),
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array(
				'plugin' => array(
					'type'        => 'string',
					'description' => __( 'Plugin key like "akismet/akismet". Call hooksgraph/list_codebases for available plugins.', 'hooksgraph' ),
				),
				'hook'   => array( 'type' => 'string', 'description' => __( 'Hook name.', 'hooksgraph' ) ),
				'limit'  => array( 'type' => 'integer', 'minimum' => 1, 'maximum' => 500, 'default' => 50 ),
				'offset' => array( 'type' => 'integer', 'minimum' => 0, 'default' => 0 ),
			),
			'required'             => array( 'plugin', 'hook' ),
			'additionalProperties' => false,
		),
		'execute_callback'    => static function ( array $input ) use ( $idx ) {
			$built = $idx->for_plugin( $input['plugin'] );
			if ( $built instanceof \WP_Error ) {
				return $built;
			}
			$limit  = (int) ( $input['limit'] ?? 50 );
			$offset = (int) ( $input['offset'] ?? 0 );
			$node   = $built['hookByName'][ $input['hook'] ] ?? null;
			if ( ! $node ) {
				return array( 'total' => 0, 'has_more' => false, 'results' => array() );
			}
			$edges = $built['listensByHook'][ $node['id'] ] ?? array();
			$page  = paginate( $edges, $limit, $offset );
			$page['results'] = array_map( static fn ( $e ) => listener_result( $e, $built ), $page['results'] );
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
	);
}
