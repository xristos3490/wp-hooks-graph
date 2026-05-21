<?php
/**
 * Admin page registration and asset enqueueing for the HooksGraph plugin.
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

defined( 'ABSPATH' ) || exit;

final class Admin_Page {

	private const SCRIPT_HANDLE = 'hooksgraph-admin';

	public function register(): void {
		add_action( 'admin_menu', [ $this, 'register_menu' ] );
		add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_assets' ] );
	}

	public function register_menu(): void {
		add_management_page(
			__( 'Hooks Graph', 'hooksgraph' ),
			__( 'Hooks Graph', 'hooksgraph' ),
			'manage_options',
			HOOKSGRAPH_ADMIN_PAGE_SLUG,
			[ $this, 'render_page' ]
		);
	}

	public function render_page(): void {
		echo '<div id="hooksgraph-admin-root"></div>';
	}

	public function enqueue_assets( string $hook_suffix ): void {
		if ( 'tools_page_' . HOOKSGRAPH_ADMIN_PAGE_SLUG !== $hook_suffix ) {
			return;
		}

		$asset_file = HOOKSGRAPH_PLUGIN_DIR . 'build/index.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return;
		}

		$asset = include $asset_file;

		wp_enqueue_script(
			self::SCRIPT_HANDLE,
			HOOKSGRAPH_PLUGIN_URL . 'build/index.js',
			$asset['dependencies'] ?? [],
			$asset['version'] ?? false,
			[ 'in_footer' => true ]
		);

		wp_set_script_translations( self::SCRIPT_HANDLE, 'hooksgraph' );

		wp_enqueue_style(
			self::SCRIPT_HANDLE,
			HOOKSGRAPH_PLUGIN_URL . 'build/style-index.css',
			[ 'wp-components' ],
			$asset['version'] ?? false
		);
	}
}
