<?php
/**
 * Custom REST fields exposed by the HooksGraph plugin.
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

defined( 'ABSPATH' ) || exit;

final class Rest_Fields {

	public function __construct(
		private Storage $storage,
		private Cron $cron
	) {}

	public function register(): void {
		add_action( 'rest_api_init', [ $this, 'register_fields' ] );
	}

	public function register_fields(): void {
		register_rest_field(
			'plugin',
			'abspath',
			[
				'get_callback' => [ $this, 'get_abspath' ],
				'schema'       => [
					'description' => __( 'Absolute filesystem path to the plugin entry file. Visible only to users with `manage_options`.', 'hooksgraph' ),
					'type'        => [ 'string', 'null' ],
					'context'     => [ 'view', 'edit' ],
					'readonly'    => true,
				],
			]
		);

		register_rest_field(
			'plugin',
			'parse_status',
			[
				'get_callback' => [ $this, 'get_parse_status' ],
				'schema'       => [
					'description' => __( 'Parse state for this plugin (parsed | stale | needs_parsing | scheduled). Visible only to users with `manage_options`.', 'hooksgraph' ),
					'type'        => [ 'string', 'null' ],
					'enum'        => [ Storage::STATUS_PARSED, Storage::STATUS_STALE, Storage::STATUS_NEEDS_PARSING, 'scheduled', null ],
					'context'     => [ 'view', 'edit' ],
					'readonly'    => true,
				],
			]
		);
	}

	/**
	 * Absolute filesystem path of a plugin entry file.
	 *
	 * Restricted to users who can manage plugins — the path leaks server
	 * filesystem layout, so we narrow the audience beyond core's default
	 * `activate_plugins` gate on `/wp/v2/plugins`.
	 *
	 * @param array<string, mixed> $plugin
	 */
	public function get_abspath( array $plugin ): ?string {
		if ( ! current_user_can( 'manage_options' ) ) {
			return null;
		}

		$relative = $plugin['plugin'] ?? '';
		if ( '' === $relative ) {
			return null;
		}

		return wp_normalize_path( WP_PLUGIN_DIR . '/' . $relative . '.php' );
	}

	/**
	 * @param array<string, mixed> $plugin
	 */
	public function get_parse_status( array $plugin ): ?string {
		if ( ! current_user_can( 'manage_options' ) ) {
			return null;
		}

		$relative = (string) ( $plugin['plugin'] ?? '' );
		$version  = (string) ( $plugin['version'] ?? '' );
		if ( '' === $relative ) {
			return null;
		}

		// A pending cron job overrides the on-disk classification — once it
		// runs, the next request will reflect the new file state.
		if ( $this->cron->is_scheduled( $relative ) ) {
			return 'scheduled';
		}

		return $this->storage->status_for( $relative, $version );
	}
}
