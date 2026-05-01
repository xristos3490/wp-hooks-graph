<?php
/**
 * WP-Cron wiring for plugin parsing.
 *
 * One-shot events keyed by plugin basename — `wp_next_scheduled()` lets the UI
 * show a "Scheduled" pill while a job is pending.
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

defined( 'ABSPATH' ) || exit;

final class Cron {

	public const HOOK = 'hooksgraph_parse_plugin';

	public function __construct( private Parser_Service $parser ) {}

	public function register(): void {
		add_action( self::HOOK, [ $this, 'run' ], 10, 1 );
	}

	/**
	 * Schedule a parse for a plugin if one isn't already queued.
	 *
	 * @return bool True if newly scheduled, false if a job already exists or scheduling failed.
	 */
	public function schedule( string $plugin_relative ): bool {
		if ( $this->is_scheduled( $plugin_relative ) ) {
			return false;
		}
		return false !== wp_schedule_single_event( time() + 5, self::HOOK, [ $plugin_relative ] );
	}

	public function is_scheduled( string $plugin_relative ): bool {
		return false !== wp_next_scheduled( self::HOOK, [ $plugin_relative ] );
	}

	/**
	 * Cron callback. Looks the plugin up fresh — its version may have changed
	 * since the job was queued, and that's fine.
	 */
	public function run( string $plugin_relative ): void {
		// `get_plugins()` is an admin function — load it explicitly because
		// WP-Cron requests don't bootstrap wp-admin.
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$plugins = get_plugins();
		$key     = $plugin_relative . '.php';
		if ( ! isset( $plugins[ $key ] ) ) {
			return;
		}

		$version = (string) ( $plugins[ $key ]['Version'] ?? '' );
		$this->parser->parse( $plugin_relative, $version );
	}
}
