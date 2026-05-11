<?php
/** @package HooksGraph\Plugin */

require_once __DIR__ . '/../framework/class-hooksgraph-abilities-test-case.php';

class Ability_Firers_Of_Tests extends HooksGraph_Abilities_Test_Case {

	public function test_returns_fire_sites_for_hook(): void {
		$result = $this->call_ability( 'firers_of', array( 'plugin' => 'alpha/alpha', 'hook' => 'init' ) );
		$this->assertSame( 1, $result['total'] );
		$this->assertFalse( $result['has_more'] );
		$row = $result['results'][0];
		$this->assertSame( 'core.php', $row['file'] );
		$this->assertSame( 10, $row['line'] );
		$this->assertSame( 'bootstrap', $row['scope_function'] );
		$this->assertNull( $row['callback'] );
	}

	public function test_unknown_hook_returns_empty(): void {
		$result = $this->call_ability( 'firers_of', array( 'plugin' => 'alpha/alpha', 'hook' => 'nope' ) );
		$this->assertSame( 0, $result['total'] );
		$this->assertSame( array(), $result['results'] );
	}
}
