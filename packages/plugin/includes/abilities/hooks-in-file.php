<?php
/**
 * Ability: hooksgraph/hooks_in_file
 */

declare(strict_types=1);

namespace HooksGraph\Plugin\Abilities;

use HooksGraph\Plugin\Graph_Index;
use HooksGraph\Plugin\Storage;

defined( 'ABSPATH' ) || exit;

/**
 * @return array<string, mixed>
 */
function hooksgraph_ability_hooks_in_file( Graph_Index $idx, Storage $storage ): array {
	return array(
		'label'               => __( 'List hooks in a file', 'hooksgraph' ),
		'description'         => __( 'List every hook fire or listener registered in a specific file inside one plugin codebase, paginated. The path is the repo-relative path as stored in the graph.', 'hooksgraph' ),
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array(
				'plugin'    => array( 'type' => 'string' ),
				'file_path' => array( 'type' => 'string', 'description' => __( 'Repo-relative file path as stored in the graph.', 'hooksgraph' ) ),
				'limit'     => array( 'type' => 'integer', 'minimum' => 1, 'maximum' => 500, 'default' => 50 ),
				'offset'    => array( 'type' => 'integer', 'minimum' => 0, 'default' => 0 ),
			),
			'required'             => array( 'plugin', 'file_path' ),
			'additionalProperties' => false,
		),
		'execute_callback'    => static function ( array $input ) use ( $idx ) {
			$built = $idx->for_plugin( $input['plugin'] );
			if ( $built instanceof \WP_Error ) {
				return $built;
			}
			$limit    = (int) ( $input['limit'] ?? 50 );
			$offset   = (int) ( $input['offset'] ?? 0 );
			$fileNode = $built['fileByPath'][ $input['file_path'] ] ?? null;
			if ( ! $fileNode ) {
				return array( 'total' => 0, 'has_more' => false, 'results' => array() );
			}
			$edges = $built['edgesByFile'][ $fileNode['id'] ] ?? array();
			$page  = paginate( $edges, $limit, $offset );
			$page['results'] = array_map( static fn ( $e ) => file_edge_result( $e, $built ), $page['results'] );
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
