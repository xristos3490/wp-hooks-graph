<?php
/** @package HooksGraph\Plugin */

require_once __DIR__ . '/../framework/class-hooksgraph-abilities-test-case.php';

class Ability_Hotspots_Tests extends HooksGraph_Abilities_Test_Case {

	public function test_sorts_by_total_activity_desc_by_default(): void {
		$result = $this->call_ability( 'hotspots', array( 'plugin' => 'alpha/alpha' ) );
		$this->assertIsArray( $result );
		$this->assertSame( 'init', $result[0]['hook'] );
		// init has fires=1, listens=3 -> total 4
		$this->assertSame( 4, $result[0]['total'] );
	}

	public function test_metric_fires_promotes_high_fire_hooks(): void {
		$result   = $this->call_ability( 'hotspots', array( 'plugin' => 'alpha/alpha', 'metric' => 'fires' ) );
		$fireCounts = array_column( $result, 'fire_count' );
		// already sorted desc by fire_count
		$sorted = $fireCounts;
		rsort( $sorted );
		$this->assertSame( $sorted, $fireCounts );
	}

	public function test_limit_caps_result_size(): void {
		$result = $this->call_ability( 'hotspots', array( 'plugin' => 'alpha/alpha', 'limit' => 2 ) );
		$this->assertCount( 2, $result );
	}

	public function test_wp_error_when_plugin_missing(): void {
		$err = $this->call_ability( 'hotspots', array( 'plugin' => 'nope/nope' ) );
		$this->assertInstanceOf( WP_Error::class, $err );
	}
}
