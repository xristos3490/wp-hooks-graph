<?php
/**
 * WP-Cron wiring for plugin parsing.
 *
 * One-shot events keyed by plugin basename — `wp_next_scheduled()` lets the UI
 * show a "Scheduled" pill while a job is pending.
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

use Throwable;

defined( 'ABSPATH' ) || exit;

final class Cron {

	public const HOOK = 'hooksgraph_parse_plugin';

	public function __construct(
		private Parser_Service $parser,
		private Storage $storage
	) {}

	public function register(): void {
		add_action( self::HOOK, [ $this, 'run' ], 10, 1 );
	}

	public const SCHEDULE_NEW      = 'new';
	public const SCHEDULE_EXISTING = 'existing';
	public const SCHEDULE_FAILED   = 'failed';

	/**
	 * Schedule a parse for a plugin if one isn't already queued.
	 *
	 * @return string One of SCHEDULE_NEW (newly queued), SCHEDULE_EXISTING (a job
	 *                was already pending), or SCHEDULE_FAILED (wp_schedule_single_event
	 *                rejected the request).
	 */
	public function schedule( string $plugin_relative ): string {
		if ( $this->is_scheduled( $plugin_relative ) ) {
			return self::SCHEDULE_EXISTING;
		}
		$queued = wp_schedule_single_event( time() + 5, self::HOOK, [ $plugin_relative ] );
		return false === $queued ? self::SCHEDULE_FAILED : self::SCHEDULE_NEW;
	}

	public function is_scheduled( string $plugin_relative ): bool {
		return false !== wp_next_scheduled( self::HOOK, [ $plugin_relative ] );
	}

	/**
	 * Cron callback. Looks the plugin up fresh — its version may have changed
	 * since the job was queued, and that's fine.
	 */
	public function run( string $plugin_relative ): void {
		try {
			// `get_plugins()` is an admin function — load it explicitly because
			// WP-Cron requests don't bootstrap wp-admin.
			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}

			$plugins = get_plugins();
			$key     = $plugin_relative . '.php';
			if ( ! isset( $plugins[ $key ] ) ) {
				$this->record_failure( $plugin_relative, 'Plugin not installed.' );
				return;
			}

			$version  = (string) ( $plugins[ $key ]['Version'] ?? '' );
			$settings = $this->storage->get_settings( $plugin_relative );
			$result   = $this->parser->parse( $plugin_relative, $version, $settings['exclude'] );

			if ( ! ( $result['ok'] ?? false ) ) {
				$this->record_failure( $plugin_relative, (string) ( $result['error'] ?? 'Unknown parser failure.' ) );
			}
		} catch ( Throwable $e ) {
			$this->record_failure(
				$plugin_relative,
				sprintf( '%s: %s', $e::class, $e->getMessage() )
			);
		}
	}

	private function record_failure( string $plugin_relative, string $error ): void {
		error_log( sprintf( '[hooksgraph] Parse failed for %s: %s', $plugin_relative, $error ) );
		$this->storage->save_codebase_failure( $plugin_relative, $error );
	}
}
