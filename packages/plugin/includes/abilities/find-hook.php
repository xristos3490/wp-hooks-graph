<?php
/**
 * Ability: hooksgraph/find_hook
 */

declare(strict_types=1);

namespace HooksGraph\Plugin\Abilities;

use HooksGraph\Plugin\Graph_Index;
use HooksGraph\Plugin\Storage;

defined( 'ABSPATH' ) || exit;

/**
 * @return array<string, mixed>
 */
function hooksgraph_ability_find_hook( Graph_Index $idx, Storage $storage ): array {
	return array(
		'label'               => __( 'Find hook', 'hooksgraph' ),
		'description'         => __( 'Look up a hook by exact name in one plugin codebase. Returns a single hook summary or null when not found. Use when the user names a specific hook and you want its metadata (type, fire/listen counts, dynamic flag).', 'hooksgraph' ),
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array(
				'plugin' => array(
					'type'        => 'string',
					'description' => __( 'Plugin key like "akismet/akismet" or "hello". Call hooksgraph/list_codebases first to see available plugins.', 'hooksgraph' ),
				),
				'name'   => array(
					'type'        => 'string',
					'description' => __( 'Exact hook name.', 'hooksgraph' ),
				),
			),
			'required'             => array( 'plugin', 'name' ),
			'additionalProperties' => false,
		),
		'execute_callback'    => static function ( array $input ) use ( $idx ) {
			$built = $idx->for_plugin( $input['plugin'] );
			if ( $built instanceof \WP_Error ) {
				return $built;
			}
			$node = $built['hookByName'][ $input['name'] ] ?? null;
			return $node ? hook_summary( $node ) : null;
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
