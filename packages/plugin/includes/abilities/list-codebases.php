<?php
/**
 * Ability: hooksgraph/list-codebases
 *
 * Discovery surface for the AI. Returns every active plugin that has at least
 * a stale parsed graph on disk — anything the other 9 abilities can actually
 * query.
 *
 * Included from {@see \HooksGraph\Plugin\hooksgraph_register_abilities()} with
 * `$index` (Graph_Index) and `$storage` (Storage) in local scope.
 *
 * @package HooksGraph\Plugin
 */

declare(strict_types=1);

namespace HooksGraph\Plugin\Abilities;

defined( 'ABSPATH' ) || exit;

/** @var \HooksGraph\Plugin\Storage $storage */

\wp_register_ability(
	'hooksgraph/list-codebases',
	array(
		'category'            => 'hooksgraph',
		'label'               => __( 'List available codebases', 'hooksgraph' ),
		'description'         => __( 'List every parsed plugin codebase available for hooks-graph querying. Call this first to learn which plugin keys to pass as the `plugin` argument to the other hooksgraph abilities.', 'hooksgraph' ),
		// `default` matters: the AI Client resolver calls `execute()` with `null`
		// when the model sends no args. `WP_Ability::normalize_input()` falls
		// through to `input_schema['default']`, so without it the validator
		// rejects `null` as "not of type object" and the model loops trying to
		// guess the right arg shape.
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => new \stdClass(),
			'additionalProperties' => false,
			'default'              => new \stdClass(),
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
				if ( \HooksGraph\Plugin\Storage::STATUS_NEEDS_PARSING === $status ) {
					continue;
				}

				$record = $storage->get_record( $key );

				$out[] = array(
					'plugin'         => $key,
					'version'        => $version,
					'status'         => $status,
					'last_parsed_at' => null !== $record['last_parsed_at'] ? gmdate( 'c', $record['last_parsed_at'] ) : null,
					'total_files'    => (int) ( $record['total_files'] ?? 0 ),
					'total_hooks'    => (int) ( $record['total_hooks'] ?? 0 ),
					'total_edges'    => (int) ( $record['total_edges'] ?? 0 ),
					'dynamic_hooks'  => (int) ( $record['dynamic_hooks'] ?? 0 ),
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
	)
);
