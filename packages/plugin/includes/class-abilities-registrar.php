<?php
/**
 * Wire the 10 hooksgraph query Abilities (WordPress 6.9+ Abilities API).
 *
 * Each Ability shares a per-request Graph_Index instance — building it inside
 * the registrar makes the cache request-scoped automatically (the registrar is
 * constructed once per request on `plugins_loaded`).
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

defined( 'ABSPATH' ) || exit;

final class Abilities_Registrar {

	/**
	 * Ability slugs (dashes only — Abilities API rejects underscores).
	 * Each slug maps to:
	 *   - ability name: "hooksgraph/{$slug}"
	 *   - factory file: "includes/abilities/{$slug}.php"
	 *   - factory fn:   "HooksGraph\Plugin\Abilities\hooksgraph_ability_{$slug_with_underscores}"
	 */
	private const TOOL_SLUGS = array(
		'list-codebases',
		'find-hook',
		'listeners-of',
		'firers-of',
		'hooks-in-file',
		'search-callbacks',
		'hotspots',
		'shared-hooks',
		'compare-hook',
		'filter-priority-conflicts',
	);

	public function __construct(
		private Storage $storage,
		private Graph_Index $index
	) {}

	public function register(): void {
		add_action( 'wp_abilities_api_categories_init', array( $this, 'register_category' ) );
		add_action( 'wp_abilities_api_init', array( $this, 'register_abilities' ) );
	}

	public function register_category(): void {
		if ( ! function_exists( 'wp_register_ability_category' ) ) {
			return;
		}
		\wp_register_ability_category(
			'hooksgraph',
			array(
				'label'       => __( 'HooksGraph', 'hooksgraph' ),
				'description' => __( 'Query WordPress hook graphs built by the HooksGraph plugin.', 'hooksgraph' ),
			)
		);
	}

	public function register_abilities(): void {
		if ( ! function_exists( 'wp_register_ability' ) ) {
			return;
		}

		$dir = HOOKSGRAPH_PLUGIN_DIR . 'includes/abilities/';
		require_once $dir . 'lib.php';

		foreach ( self::TOOL_SLUGS as $slug ) {
			require_once $dir . $slug . '.php';
			$factory = '\\HooksGraph\\Plugin\\Abilities\\hooksgraph_ability_' . str_replace( '-', '_', $slug );
			if ( ! function_exists( $factory ) ) {
				continue;
			}
			$args             = $factory( $this->index, $this->storage );
			$args['category'] = 'hooksgraph';
			\wp_register_ability( "hooksgraph/{$slug}", $args );
		}
	}
}
