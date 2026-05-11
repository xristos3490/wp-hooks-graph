<?php
/**
 * PHPUnit bootstrap for the HooksGraph plugin.
 *
 * Trimmed down from the WooCommerce Gift Cards bootstrap: installs only the
 * HooksGraph plugin against a stock WordPress test suite — no WooCommerce, no
 * other plugin dependencies.
 *
 * @package HooksGraph\Plugin
 */

// phpcs:disable WordPress.NamingConventions.ValidVariableName

class HooksGraph_Plugin_Unit_Tests_Bootstrap {

	/** @var HooksGraph_Plugin_Unit_Tests_Bootstrap|null */
	protected static $instance = null;

	/** @var string */
	private $tests_dir;

	/** @var string */
	private $plugin_dir;

	/** @var string */
	private $wp_tests_dir;

	public static function instance(): self {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	public function __construct() {
		define( 'HOOKSGRAPH_TESTING', true );
		define( 'WP_TESTS_PHPUNIT_POLYFILLS_PATH', dirname( __DIR__ ) . '/vendor/yoast/phpunit-polyfills/phpunitpolyfills-autoload.php' );

		ini_set( 'display_errors', 'on' );
		error_reporting( E_ALL );

		$this->tests_dir    = __DIR__;
		$this->plugin_dir   = dirname( __DIR__ );
		$this->wp_tests_dir = getenv( 'WP_TESTS_DIR' ) ? getenv( 'WP_TESTS_DIR' ) : ( getenv( 'HOME' ) . '/.hooks-graph-unit-tests/wordpress-tests-lib' );

		if ( ! file_exists( $this->wp_tests_dir . '/includes/functions.php' ) ) {
			echo "Could not find WP test suite at {$this->wp_tests_dir}." . PHP_EOL;
			echo 'Run `pnpm test:plugin:install` from the monorepo root to install it.' . PHP_EOL;
			exit( 1 );
		}

		require_once $this->wp_tests_dir . '/includes/functions.php';

		tests_add_filter( 'muplugins_loaded', [ $this, 'load_plugin' ] );

		require_once $this->wp_tests_dir . '/includes/bootstrap.php';

		$this->includes();
	}

	public function load_plugin(): void {
		require_once $this->plugin_dir . '/hooksgraph.php';
	}

	private function includes(): void {
		require_once $this->tests_dir . '/framework/class-hooksgraph-test-case.php';
	}
}

HooksGraph_Plugin_Unit_Tests_Bootstrap::instance();
