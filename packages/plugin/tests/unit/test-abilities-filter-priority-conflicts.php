<?php
/** @package HooksGraph\Plugin */

require_once __DIR__ . '/../framework/class-hooksgraph-abilities-test-case.php';

class Ability_Filter_Priority_Conflicts_Tests extends HooksGraph_Abilities_Test_Case {

	public function test_detects_collision_when_two_codebases_share_priority(): void {
		// alpha and beta both listen on wp_query_vars at priority 10.
		$result = $this->call_ability( 'filter_priority_conflicts', array( 'plugins' => array( 'alpha/alpha', 'beta/beta' ) ) );
		$hooks = array_column( $result['results'], 'hook' );
		$this->assertContains( 'wp_query_vars', $hooks );

		$row = null;
		foreach ( $result['results'] as $r ) {
			if ( 'wp_query_vars' === $r['hook'] ) {
				$row = $r;
				break;
			}
		}
		$this->assertNotNull( $row );
		$this->assertCount( 1, $row['collisions'] );
		$this->assertSame( 10, $row['collisions'][0]['priority'] );
		$this->assertSame( array( 'alpha', 'beta' ), $row['collisions'][0]['codebases'] );
	}

	public function test_skips_action_hooks(): void {
		$result = $this->call_ability( 'filter_priority_conflicts', array( 'plugins' => array( 'alpha/alpha', 'beta/beta', 'gamma' ) ) );
		$hooks  = array_column( $result['results'], 'hook' );
		// init is an action everywhere — should not appear.
		$this->assertNotContains( 'init', $hooks );
	}

	public function test_min_codebases_filter(): void {
		$result = $this->call_ability( 'filter_priority_conflicts', array( 'plugins' => array( 'alpha/alpha', 'beta/beta' ), 'min_codebases' => 3 ) );
		$this->assertSame( 0, $result['total'] );
	}

	public function test_rejects_both_hook_and_substring(): void {
		$err = $this->call_ability( 'filter_priority_conflicts', array( 'hook' => 'foo', 'substring' => 'bar' ) );
		$this->assertInstanceOf( WP_Error::class, $err );
	}
}
