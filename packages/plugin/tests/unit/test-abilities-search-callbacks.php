<?php
/** @package HooksGraph\Plugin */

require_once __DIR__ . '/../framework/class-hooksgraph-abilities-test-case.php';

class Ability_Search_Callbacks_Tests extends HooksGraph_Abilities_Test_Case {

	public function test_single_plugin_substring_match(): void {
		$result = $this->call_ability( 'search_callbacks', array( 'plugin' => 'alpha/alpha', 'substring' => 'alpha_setup' ) );
		$this->assertSame( 1, $result['total'] );
		$this->assertSame( 'alpha_setup', $result['results'][0]['callback'] );
		$this->assertSame( 'alpha', $result['results'][0]['codebase'] );
	}

	public function test_cross_plugin_default_searches_all_active_parsed(): void {
		$this->fake_active_plugins(
			array(
				'alpha/alpha' => '1.0.0',
				'beta/beta'   => '2.0.0',
			)
		);
		$result = $this->call_ability( 'search_callbacks', array( 'substring' => 'boot' ) );
		$cbs = array_column( $result['results'], 'callback' );
		// beta_boot exists in beta fixture
		$this->assertContains( 'beta_boot', $cbs );
	}

	public function test_substring_is_case_insensitive(): void {
		$result = $this->call_ability( 'search_callbacks', array( 'plugin' => 'alpha/alpha', 'substring' => 'ALPHA_SETUP' ) );
		$this->assertSame( 1, $result['total'] );
	}

	public function test_returns_wp_error_when_explicit_plugin_missing(): void {
		$err = $this->call_ability( 'search_callbacks', array( 'plugin' => 'nope/nope', 'substring' => 'foo' ) );
		$this->assertInstanceOf( WP_Error::class, $err );
	}

	public function test_pagination(): void {
		$result = $this->call_ability( 'search_callbacks', array( 'plugin' => 'gamma', 'substring' => 'gamma', 'limit' => 1, 'offset' => 0 ) );
		$this->assertGreaterThan( 1, $result['total'] );
		$this->assertCount( 1, $result['results'] );
		$this->assertTrue( $result['has_more'] );
	}
}
