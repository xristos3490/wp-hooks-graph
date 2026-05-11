<?php
/**
 * Ability: hooksgraph/list_codebases
 *
 * Discovery surface for the AI. Returns every active plugin that has at least
 * a stale parsed graph on disk — anything the other 9 abilities can actually
 * query.
 */

declare(strict_types=1);

namespace HooksGraph\Plugin\Abilities;

use HooksGraph\Plugin\Graph_Index;
use HooksGraph\Plugin\Storage;

defined( 'ABSPATH' ) || exit;

/**
 * @return array<string, mixed>
 */
function hooksgraph_ability_list_codebases( Graph_Index $idx, Storage $storage ): array {
	return array(
		'label'               => __( 'List available codebases', 'hooksgraph' ),
		'description'         => __( 'List every parsed plugin codebase available for hooks-graph querying. Call this first to learn which plugin keys to pass as the `plugin` argument to the other hooksgraph abilities.', 'hooksgraph' ),
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => new \stdClass(),
			'additionalProperties' => false,
		),
		'output_schema'       => array(
			'type'  => 'array',
			'items' => array(
				'type'       => 'object',
				'properties' => array(
					'plugin'         => array( 'type' => 'string' ),
					'version'        => array( 'type' => 'string' ),
					'status'         => array( 'type' => 'string' ),
					'last_parsed_at' => array( 'type' => array( 'string', 'null' ) ),
					'total_files'    => array( 'type' => 'integer' ),
					'total_hooks'    => array( 'type' => 'integer' ),
					'total_edges'    => array( 'type' => 'integer' ),
					'dynamic_hooks'  => array( 'type' => 'integer' ),
				),
			),
		),
		'execute_callback'    => static function () use ( $storage ): array {
			$out = array();
			foreach ( known_active_plugins() as $key => $version ) {
				$status = $storage->status_for( $key, $version );
				if ( Storage::STATUS_NEEDS_PARSING === $status ) {
					continue;
				}

				$last = $storage->last_parsed_at( $key );
				$meta = $storage->get_codebase_meta( $key );

				$out[] = array(
					'plugin'         => $key,
					'version'        => $version,
					'status'         => $status,
					'last_parsed_at' => null !== $last ? gmdate( 'c', $last ) : null,
					'total_files'    => isset( $meta['total_files'] ) ? (int) $meta['total_files'] : 0,
					'total_hooks'    => isset( $meta['total_hooks'] ) ? (int) $meta['total_hooks'] : 0,
					'total_edges'    => isset( $meta['total_edges'] ) ? (int) $meta['total_edges'] : 0,
					'dynamic_hooks'  => isset( $meta['dynamic_hooks'] ) ? (int) $meta['dynamic_hooks'] : 0,
				);
			}
			return $out;
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
