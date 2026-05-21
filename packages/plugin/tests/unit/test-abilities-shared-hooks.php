<?php
/** @package HooksGraph\Plugin */

require_once __DIR__ . '/../framework/class-hooksgraph-abilities-test-case.php';

class Ability_Shared_Hooks_Tests extends HooksGraph_Abilities_Test_Case {

	public function test_returns_hooks_shared_by_multiple_codebases(): void {
		$result = $this->call_ability( 'shared_hooks', array( 'plugins' => array( 'alpha/alpha', 'beta/beta', 'gamma' ) ) );
		$names = array_column( $result['results'], 'hook' );
		$this->assertContains( 'init', $names ); // present in all 3
	}

	public function test_min_sources_filter(): void {
		$result = $this->call_ability( 'shared_hooks', array( 'plugins' => array( 'alpha/alpha', 'beta/beta', 'gamma' ), 'min_sources' => 3 ) );
		foreach ( $result['results'] as $row ) {
			$this->assertGreaterThanOrEqual( 3, count( $row['sources'] ) );
		}
	}

	public function test_substring_filter(): void {
		$result = $this->call_ability( 'shared_hooks', array( 'plugins' => array( 'alpha/alpha', 'beta/beta', 'gamma' ), 'substring' => 'init' ) );
		foreach ( $result['results'] as $row ) {
			$this->assertStringContainsString( 'init', strtolower( $row['hook'] ) );
		}
	}

	public function test_hook_type_divergence_flagged_when_alpha_filter_vs_gamma_action(): void {
		// the_content: alpha says filter, gamma says action (from fixtures).
		$result = $this->call_ability( 'shared_hooks', array( 'plugins' => array( 'alpha/alpha', 'gamma' ) ) );
		$row = null;
		foreach ( $result['results'] as $r ) {
			if ( 'the_content' === $r['hook'] ) {
				$row = $r;
				break;
			}
		}
		$this->assertNotNull( $row );
		$this->assertTrue( $row['hook_type_divergence'] );
	}
}
