<?php
/**
 * Ability: hooksgraph/compare_hook
 */

declare(strict_types=1);

namespace HooksGraph\Plugin\Abilities;

use HooksGraph\Plugin\Graph_Index;
use HooksGraph\Plugin\Storage;

defined( 'ABSPATH' ) || exit;

const COMPARE_HOOK_CANDIDATE_CAP = 500;

/**
 * @return array<string, mixed>
 */
function hooksgraph_ability_compare_hook( Graph_Index $idx, Storage $storage ): array {
	return array(
		'label'               => __( 'Compare a hook across plugins', 'hooksgraph' ),
		'description'         => __( 'Pivot one or more hooks across plugin codebases. Provide exactly one of `hook` (exact) or `substring` (case-insensitive). Returns matches with fires + listeners grouped across codebases, listeners sorted by priority.', 'hooksgraph' ),
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array(
				'hook'      => array( 'type' => 'string', 'description' => __( 'Exact hook name. Mutually exclusive with substring.', 'hooksgraph' ) ),
				'substring' => array( 'type' => 'string', 'description' => __( 'Case-insensitive substring. Mutually exclusive with hook.', 'hooksgraph' ) ),
				'plugins'   => array(
					'type'  => 'array',
					'items' => array( 'type' => 'string' ),
					'description' => __( 'Restrict to this subset of plugin keys. Defaults to all active+parsed.', 'hooksgraph' ),
				),
				'limit'     => array( 'type' => 'integer', 'minimum' => 1, 'maximum' => 500, 'default' => 20 ),
				'offset'    => array( 'type' => 'integer', 'minimum' => 0, 'default' => 0 ),
			),
			'additionalProperties' => false,
		),
		'execute_callback'    => static function ( array $input ) use ( $idx, $storage ) {
			$hook      = $input['hook'] ?? null;
			$substring = $input['substring'] ?? null;
			$hasHook   = is_string( $hook ) && '' !== $hook;
			$hasSub    = is_string( $substring ) && '' !== $substring;
			if ( $hasHook === $hasSub ) {
				return new \WP_Error(
					'hooksgraph_bad_args',
					__( "compare_hook: provide exactly one of 'hook' or 'substring'.", 'hooksgraph' ),
					array( 'status' => 400 )
				);
			}
			$limit  = (int) ( $input['limit'] ?? 20 );
			$offset = (int) ( $input['offset'] ?? 0 );
			$keys   = ! empty( $input['plugins'] ) && is_array( $input['plugins'] )
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

			$capped     = false;
			$candidates = array();
			if ( $hasHook ) {
				$candidates = array( $hook );
			} else {
				$needle = strtolower( $substring );
				$set    = array();
				foreach ( $loaded as $cb ) {
					foreach ( array_keys( $cb['built']['hookByName'] ) as $hookName ) {
						if ( str_contains( strtolower( $hookName ), $needle ) ) {
							$set[ $hookName ] = true;
						}
					}
				}
				$candidates = array_keys( $set );
				sort( $candidates );
				if ( count( $candidates ) > COMPARE_HOOK_CANDIDATE_CAP ) {
					$capped     = true;
					$candidates = array_slice( $candidates, 0, COMPARE_HOOK_CANDIDATE_CAP );
				}
			}

			$matches = array();
			foreach ( $candidates as $hookName ) {
				$hook_type_by_codebase = array();
				$fires                 = array();
				$listeners             = array();
				$present               = false;
				foreach ( $loaded as $cb ) {
					$node = $cb['built']['hookByName'][ $hookName ] ?? null;
					if ( ! $node ) {
						continue;
					}
					$present = true;
					if ( ! empty( $node['hook_type'] ) ) {
						$hook_type_by_codebase[ $cb['codebase_id'] ] = $node['hook_type'];
					}
					foreach ( $cb['built']['firesByHook'][ $node['id'] ] ?? array() as $edge ) {
						$fires[] = codebased_firer_result( $edge, $cb['codebase_id'], $cb['built'] );
					}
					foreach ( $cb['built']['listensByHook'][ $node['id'] ] ?? array() as $edge ) {
						$listeners[] = codebased_listener_result( $edge, $cb['codebase_id'], $cb['built'] );
					}
				}
				if ( ! $present ) {
					continue;
				}
				usort( $listeners, __NAMESPACE__ . '\\cmp_listeners' );
				usort( $fires, __NAMESPACE__ . '\\cmp_firers' );
				$matches[] = array(
					'hook'                  => $hookName,
					'hook_type_by_codebase' => $hook_type_by_codebase,
					'fires'                 => $fires,
					'listeners'             => $listeners,
				);
			}

			$page = paginate( $matches, $limit, $offset );
			return array(
				'query'    => $hasHook ? array( 'hook' => $hook ) : array( 'substring' => $substring ),
				'total'    => $page['total'],
				'has_more' => $page['has_more'],
				'capped'   => $capped,
				'matches'  => $page['results'],
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
