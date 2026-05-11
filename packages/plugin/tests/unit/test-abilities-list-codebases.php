<?php
/** @package HooksGraph\Plugin */

require_once __DIR__ . '/../framework/class-hooksgraph-abilities-test-case.php';

class Ability_List_Codebases_Tests extends HooksGraph_Abilities_Test_Case {

	public function test_lists_only_active_plugins_with_parsed_graphs(): void {
		$this->fake_active_plugins(
			array(
				'alpha/alpha'             => '1.0.0',
				'beta/beta'               => '2.0.0',
				'nothing-parsed/nothing'  => '9.9.9',
			)
		);

		$result = $this->call_ability( 'list_codebases' );
		$plugins = array_column( $result, 'plugin' );
		$this->assertContains( 'alpha/alpha', $plugins );
		$this->assertContains( 'beta/beta', $plugins );
		$this->assertNotContains( 'nothing-parsed/nothing', $plugins );
	}

	public function test_each_row_carries_status_and_version(): void {
		$this->fake_active_plugins( array( 'alpha/alpha' => '1.0.0' ) );
		$result = $this->call_ability( 'list_codebases' );
		$this->assertNotEmpty( $result );
		$row = $result[0];
		$this->assertArrayHasKey( 'status', $row );
		$this->assertArrayHasKey( 'version', $row );
		$this->assertArrayHasKey( 'last_parsed_at', $row );
		$this->assertSame( '1.0.0', $row['version'] );
		$this->assertSame( 'parsed', $row['status'] );
	}

	public function test_stale_plugins_are_still_listed(): void {
		// Plugin advertises version 9.9.9 but on-disk JSON is alpha-1.0.0.json → stale.
		$this->fake_active_plugins( array( 'alpha/alpha' => '9.9.9' ) );
		$result = $this->call_ability( 'list_codebases' );
		$this->assertNotEmpty( $result );
		$this->assertSame( 'stale', $result[0]['status'] );
	}
}
