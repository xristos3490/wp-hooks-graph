<?php
/**
 * Ability: hooksgraph/search-callbacks
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
/** @var \HooksGraph\Plugin\Storage $storage */

\wp_register_ability(
	'hooksgraph/search-callbacks',
	array(
		'category'            => 'hooksgraph',
		'label'               => __( 'Search listener callbacks', 'hooksgraph' ),
		'description'         => __( 'Case-insensitive substring search over listener callback names. Provide a single `plugin` to scope or `plugins` (array) to search several. Omit both to search every active+parsed plugin.', 'hooksgraph' ),
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array(
				'substring' => array( 'type' => 'string', 'minLength' => 1 ),
				'plugin'    => array( 'type' => 'string', 'description' => __( 'Restrict to a single plugin key.', 'hooksgraph' ) ),
				'plugins'   => array(
					'type'        => 'array',
					'items'       => array( 'type' => 'string' ),
					'description' => __( 'Restrict to a subset of plugin keys.', 'hooksgraph' ),
				),
				'limit'     => array( 'type' => 'integer', 'minimum' => 1, 'maximum' => 500, 'default' => 50 ),
				'offset'    => array( 'type' => 'integer', 'minimum' => 0, 'default' => 0 ),
			),
			'required'             => array( 'substring' ),
			'additionalProperties' => false,
		),
		'execute_callback'    => static function ( array $input ) use ( $index, $storage ) {
			$needle = strtolower( (string) $input['substring'] );
			$limit  = (int) ( $input['limit'] ?? 50 );
			$offset = (int) ( $input['offset'] ?? 0 );

			if ( ! empty( $input['plugin'] ) ) {
				$keys = array( $input['plugin'] );
			} elseif ( ! empty( $input['plugins'] ) && is_array( $input['plugins'] ) ) {
				$keys = array_values( array_map( 'strval', $input['plugins'] ) );
			} else {
				$keys = active_parsed_plugin_keys( $storage );
			}

			$matches = array();
			foreach ( $keys as $key ) {
				$built = $index->for_plugin( $key );
				if ( $built instanceof \WP_Error ) {
					if ( ! empty( $input['plugin'] ) ) {
						return $built;
					}
					continue;
				}
				$codebase_id = $storage->codebase_id( $key );
				foreach ( $built['allEdges'] as $edge ) {
					if ( ( $edge['type'] ?? null ) !== 'listens' ) {
						continue;
					}
					$cb = is_string( $edge['callback'] ?? null ) ? $edge['callback'] : '';
					$cm = is_string( $edge['callback_method'] ?? null ) ? $edge['callback_method'] : '';
					if ( str_contains( strtolower( $cb ), $needle ) || str_contains( strtolower( $cm ), $needle ) ) {
						$matches[] = callback_search_result( $edge, $codebase_id, $built );
					}
				}
			}

			return paginate( $matches, $limit, $offset );
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
