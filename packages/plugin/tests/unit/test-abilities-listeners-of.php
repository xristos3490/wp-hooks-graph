<?php
/** @package HooksGraph\Plugin */

require_once __DIR__ . '/../framework/class-hooksgraph-abilities-test-case.php';

class Ability_Listeners_Of_Tests extends HooksGraph_Abilities_Test_Case {

	public function test_returns_all_listeners_paginated(): void {
		$result = $this->call_ability( 'listeners_of', array( 'plugin' => 'alpha/alpha', 'hook' => 'init' ) );
		$this->assertSame( 3, $result['total'] );
		$this->assertFalse( $result['has_more'] );
		$callbacks = array_column( $result['results'], 'callback' );
		$this->assertContains( 'alpha_setup', $callbacks );
		$this->assertContains( 'Alpha\\Loader::register', $callbacks );
		$this->assertContains( 'alpha_extras_hook', $callbacks );
	}

	public function test_pagination_offset_and_limit(): void {
		$result = $this->call_ability( 'listeners_of', array( 'plugin' => 'alpha/alpha', 'hook' => 'init', 'limit' => 1, 'offset' => 0 ) );
		$this->assertSame( 3, $result['total'] );
		$this->assertTrue( $result['has_more'] );
		$this->assertCount( 1, $result['results'] );
	}

	public function test_listener_result_carries_priority_callback_type_file(): void {
		$result = $this->call_ability( 'listeners_of', array( 'plugin' => 'alpha/alpha', 'hook' => 'init', 'limit' => 1 ) );
		$row = $result['results'][0];
		$this->assertArrayHasKey( 'priority', $row );
		$this->assertArrayHasKey( 'callback_type', $row );
		$this->assertArrayHasKey( 'file', $row );
		$this->assertArrayHasKey( 'line', $row );
	}

	public function test_unknown_hook_returns_empty_paginated_set(): void {
		$result = $this->call_ability( 'listeners_of', array( 'plugin' => 'alpha/alpha', 'hook' => 'no_such_hook' ) );
		$this->assertSame( array( 'total' => 0, 'has_more' => false, 'results' => array() ), $result );
	}
}
