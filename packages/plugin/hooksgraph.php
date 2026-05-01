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

require_once HOOKSGRAPH_PLUGIN_DIR . 'includes/class-admin-page.php';

add_action( 'plugins_loaded', static function (): void {
	( new \HooksGraph\Plugin\Admin_Page() )->register();
} );
