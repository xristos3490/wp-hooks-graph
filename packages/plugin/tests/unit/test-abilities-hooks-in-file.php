<?php
/** @package HooksGraph\Plugin */

require_once __DIR__ . '/../framework/class-hooksgraph-abilities-test-case.php';

class Ability_Hooks_In_File_Tests extends HooksGraph_Abilities_Test_Case {

	public function test_lists_all_edges_for_a_file(): void {
		$result = $this->call_ability( 'hooks_in_file', array( 'plugin' => 'alpha/alpha', 'file_path' => 'plugin.php' ) );
		$this->assertGreaterThan( 0, $result['total'] );
		$hooks = array_column( $result['results'], 'hook' );
		$this->assertContains( 'init', $hooks );
	}

	public function test_listens_edges_carry_callback_metadata(): void {
		$result = $this->call_ability( 'hooks_in_file', array( 'plugin' => 'alpha/alpha', 'file_path' => 'plugin.php' ) );
		$listens = array_values( array_filter( $result['results'], static fn ( $r ) => 'listens' === $r['edge_type'] ) );
		$this->assertNotEmpty( $listens );
		$this->assertArrayHasKey( 'callback', $listens[0] );
		$this->assertArrayHasKey( 'priority', $listens[0] );
	}

	public function test_unknown_file_returns_empty(): void {
		$result = $this->call_ability( 'hooks_in_file', array( 'plugin' => 'alpha/alpha', 'file_path' => 'missing.php' ) );
		$this->assertSame( 0, $result['total'] );
	}
}
