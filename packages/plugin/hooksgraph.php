<?php
/**
 * Plugin Name:       HooksGraph
 * Plugin URI:        https://github.com/hooksgraph/wp-hooks-graph
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
require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/class-parser-service.php';
require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/class-cron.php';
require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/class-admin-page.php';
require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/class-rest-controller.php';

add_action( 'plugins_loaded', static function (): void {
	$storage = new \HooksGraph\Plugin\Storage();
	$parser  = new \HooksGraph\Plugin\Parser_Service( $storage );
	$cron    = new \HooksGraph\Plugin\Cron( $parser, $storage );

	( new \HooksGraph\Plugin\Admin_Page() )->register();
	( new \HooksGraph\Plugin\Rest_Controller( $storage, $cron ) )->register();
	$cron->register();
} );
