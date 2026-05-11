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

	private const ABILITIES = array(
		'list_codebases'             => 'list-codebases.php',
		'find_hook'                  => 'find-hook.php',
		'listeners_of'               => 'listeners-of.php',
		'firers_of'                  => 'firers-of.php',
		'hooks_in_file'              => 'hooks-in-file.php',
		'search_callbacks'           => 'search-callbacks.php',
		'hotspots'                   => 'hotspots.php',
		'shared_hooks'               => 'shared-hooks.php',
		'compare_hook'               => 'compare-hook.php',
		'filter_priority_conflicts'  => 'filter-priority-conflicts.php',
	);

	public function __construct(
		private Storage $storage,
		private Graph_Index $index
	) {}

	public function register(): void {
		add_action( 'wp_abilities_api_init', array( $this, 'register_abilities' ) );
	}

	public function register_abilities(): void {
		if ( ! function_exists( 'wp_register_ability' ) ) {
			return;
		}

		$dir = HOOKSGRAPH_PLUGIN_DIR . 'includes/abilities/';
		require_once $dir . 'lib.php';

		foreach ( self::ABILITIES as $tool => $file ) {
			require_once $dir . $file;
			$factory = "\\HooksGraph\\Plugin\\Abilities\\hooksgraph_ability_{$tool}";
			if ( ! function_exists( $factory ) ) {
				continue;
			}
			$args = $factory( $this->index, $this->storage );
			\wp_register_ability( "hooksgraph/{$tool}", $args );
		}
	}
}
