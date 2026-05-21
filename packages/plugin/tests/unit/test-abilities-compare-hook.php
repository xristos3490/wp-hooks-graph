<?php
/** @package HooksGraph\Plugin */

require_once __DIR__ . '/../framework/class-hooksgraph-abilities-test-case.php';

class Ability_Compare_Hook_Tests extends HooksGraph_Abilities_Test_Case {

	public function test_exact_hook_pivots_fires_and_listeners(): void {
		$result = $this->call_ability( 'compare_hook', array( 'plugins' => array( 'alpha/alpha', 'beta/beta', 'gamma' ), 'hook' => 'init' ) );
		$this->assertSame( 1, $result['total'] );
		$match = $result['matches'][0];
		$this->assertSame( 'init', $match['hook'] );
		$codebases = array_unique( array_column( $match['listeners'], 'codebase' ) );
		sort( $codebases );
		$this->assertSame( array( 'alpha', 'beta', 'gamma' ), $codebases );
	}

	public function test_listeners_sorted_by_priority_then_codebase(): void {
		$result = $this->call_ability( 'compare_hook', array( 'plugins' => array( 'alpha/alpha', 'beta/beta', 'gamma' ), 'hook' => 'init' ) );
		$priorities = array_column( $result['matches'][0]['listeners'], 'priority' );
		$sorted = $priorities;
		sort( $sorted );
		$this->assertSame( $sorted, $priorities );
	}

	public function test_substring_returns_multiple_hooks(): void {
		$result = $this->call_ability( 'compare_hook', array( 'plugins' => array( 'alpha/alpha', 'gamma' ), 'substring' => 'init' ) );
		$hooks = array_column( $result['matches'], 'hook' );
		$this->assertContains( 'init', $hooks );
		$this->assertContains( 'init_extra', $hooks );
	}

	public function test_requires_exactly_one_of_hook_or_substring(): void {
		$err = $this->call_ability( 'compare_hook', array( 'plugins' => array( 'alpha/alpha' ) ) );
		$this->assertInstanceOf( WP_Error::class, $err );
		$err = $this->call_ability( 'compare_hook', array( 'plugins' => array( 'alpha/alpha' ), 'hook' => 'init', 'substring' => 'init' ) );
		$this->assertInstanceOf( WP_Error::class, $err );
	}
}
