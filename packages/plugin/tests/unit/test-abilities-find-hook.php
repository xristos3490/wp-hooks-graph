<?php
/** @package HooksGraph\Plugin */

require_once __DIR__ . '/../framework/class-hooksgraph-abilities-test-case.php';

class Ability_Find_Hook_Tests extends HooksGraph_Abilities_Test_Case {

	public function test_returns_hook_summary_when_present(): void {
		$result = $this->call_ability( 'find_hook', array( 'plugin' => 'alpha/alpha', 'name' => 'init' ) );
		$this->assertIsArray( $result );
		$this->assertSame( 'hook::init', $result['id'] );
		$this->assertSame( 'init', $result['name'] );
		$this->assertSame( 'action', $result['hook_type'] );
		$this->assertSame( 1, $result['fire_count'] );
		$this->assertSame( 3, $result['listen_count'] );
		$this->assertFalse( $result['dynamic'] );
		$this->assertSame( array( 'alpha' ), $result['sources'] );
	}

	public function test_returns_null_when_hook_absent(): void {
		$result = $this->call_ability( 'find_hook', array( 'plugin' => 'alpha/alpha', 'name' => 'no_such_hook' ) );
		$this->assertNull( $result );
	}

	public function test_returns_wp_error_when_plugin_not_parsed(): void {
		$err = $this->call_ability( 'find_hook', array( 'plugin' => 'nope/nope', 'name' => 'init' ) );
		$this->assertInstanceOf( WP_Error::class, $err );
		$this->assertSame( 'hooksgraph_not_parsed', $err->get_error_code() );
	}
}
