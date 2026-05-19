<?php
/**
 * HooksGraph Abilities registration.
 *
 * Mirrors the WordPress core pattern from `wp-includes/abilities.php`:
 * plain functions hooked at file load via `add_action()`, calling
 * `wp_register_ability()` inline. Per-ability bodies live under
 * `includes/abilities/` and are required from inside the registration
 * function with `$index` / `$storage` in scope.
 *
 * @package HooksGraph\Plugin
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/abilities/helpers.php';

/**
 * Register the `hooksgraph` ability category.
 */
function hooksgraph_register_ability_category(): void {
	if ( ! function_exists( 'wp_register_ability_category' ) ) {
		return;
	}
	\wp_register_ability_category(
		'hooksgraph',
		array(
			'label'       => __( 'Hooks Graph', 'hooksgraph' ),
			'description' => __( 'Query WordPress hook graphs built by the HooksGraph plugin.', 'hooksgraph' ),
		)
	);
}

/**
 * Register every HooksGraph ability.
 *
 * Constructs one request-scoped Storage + Graph_Index pair, then includes
 * the per-ability files which each call `wp_register_ability()` directly.
 */
function hooksgraph_register_abilities(): void {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	$storage = new Storage();
	$index   = new Graph_Index( $storage );

	$dir = __DIR__ . '/abilities/';
	require_once $dir . 'list-codebases.php';
	require_once $dir . 'find-hook.php';
	require_once $dir . 'listeners-of.php';
	require_once $dir . 'firers-of.php';
	require_once $dir . 'hooks-in-file.php';
	require_once $dir . 'search-callbacks.php';
	require_once $dir . 'hotspots.php';
	require_once $dir . 'shared-hooks.php';
	require_once $dir . 'compare-hook.php';
	require_once $dir . 'filter-priority-conflicts.php';
}

add_action( 'wp_abilities_api_categories_init', __NAMESPACE__ . '\\hooksgraph_register_ability_category' );
add_action( 'wp_abilities_api_init', __NAMESPACE__ . '\\hooksgraph_register_abilities' );
