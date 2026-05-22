<?php
/**
 * Plugin Name:       HooksGraph
 * Plugin URI:        https://github.com/xristos3490/wp-hooks-graph
 * Description:       Visualize WordPress hook relationships (do_action/add_action/apply_filters/add_filter).
 * Version:           0.1.0
 * Requires at least: 6.5
 * Requires PHP:      8.2
 * Author:            Chris Lilitsas
 * License:           MIT
 * Text Domain:       hooksgraph
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || exit;

define( 'HOOKSGRAPH_PLUGIN_FILE', __FILE__ );
define( 'HOOKSGRAPH_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'HOOKSGRAPH_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'HOOKSGRAPH_ADMIN_PAGE_SLUG', 'hooksgraph' );

// Parser library autoloader. Prefer the plugin's own vendor (production /
// strauss bundle once that pipeline lands), fall back to the monorepo parser
// vendor for local dev.
$hooksgraph_autoload_candidates = [
	HOOKSGRAPH_PLUGIN_DIR . 'vendor/autoload.php',
	HOOKSGRAPH_PLUGIN_DIR . '../parser/vendor/autoload.php',
];
foreach ( $hooksgraph_autoload_candidates as $hooksgraph_autoload ) {
	if ( file_exists( $hooksgraph_autoload ) ) {
		require_once $hooksgraph_autoload;
		break;
	}
}
unset( $hooksgraph_autoload, $hooksgraph_autoload_candidates );

require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/class-storage.php';
require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/class-settings.php';
require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/class-parser-service.php';
require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/class-cron.php';
require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/class-admin-page.php';
require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/class-rest-controller.php';
require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/class-ai-chat-controller.php';
require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/class-graph-index.php';
require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/class-scan-cpt.php';
require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/class-scan-fields.php';
require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/class-scan-runner.php';
// Abilities are registered via top-level add_action() calls inside this file.
require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/abilities.php';

add_action( 'plugins_loaded', static function (): void {
	$storage  = new \HooksGraph\Plugin\Storage();
	$settings = new \HooksGraph\Plugin\Settings();
	$parser   = new \HooksGraph\Plugin\Parser_Service( $storage );
	$cron     = new \HooksGraph\Plugin\Cron( $parser, $storage );

	( new \HooksGraph\Plugin\Admin_Page() )->register();
	( new \HooksGraph\Plugin\Rest_Controller( $storage, $cron, $settings ) )->register();
	( new \HooksGraph\Plugin\Ai_Chat_Controller( $settings ) )->register();
	$cron->register();

	( new \HooksGraph\Plugin\Scan_CPT() )->register();
	( new \HooksGraph\Plugin\Scan_Fields( $storage ) )->register();

	$scan_runner = new \HooksGraph\Plugin\Scan_Runner( $storage );
	\HooksGraph\Plugin\Scan_Runner::set_instance( $scan_runner );
	$scan_runner->register();

	add_action(
		'rest_after_insert_hg_scan',
		static function ( $post, $request, $creating ): void {
			if ( ! $creating ) {
				return;
			}
			\HooksGraph\Plugin\Scan_Runner::instance()->queue_init( (int) $post->ID );
		},
		10,
		3
	);
} );
