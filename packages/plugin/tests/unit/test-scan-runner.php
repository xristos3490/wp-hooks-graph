<?php
/**
 * Tests for the Scan_Runner cron pipeline.
 *
 * @package HooksGraph\Plugin
 */

use HooksGraph\Plugin\Scan_CPT;
use HooksGraph\Plugin\Scan_Fields;
use HooksGraph\Plugin\Scan_Runner;
use HooksGraph\Plugin\Settings;
use HooksGraph\Plugin\Storage;

class Scan_Runner_Tests extends HooksGraph_Test_Case {

	private static int $admin_id = 0;

	private Storage $storage;
	private Scan_Runner $runner;

	public static function wpSetUpBeforeClass( $factory ): void {
		self::$admin_id = $factory->user->create( [ 'role' => 'administrator' ] );
	}

	public function set_up(): void {
		parent::set_up();
		wp_set_current_user( self::$admin_id );

		// Enable read-file access by default — the existing tests assume the
		// runner schedules per-pair triage events. Tests that need to assert
		// the disabled path opt out explicitly.
		( new Settings() )->update( [ 'allow_read_files' => true ] );

		$this->storage = new Storage();
		$this->runner  = new Scan_Runner( $this->storage );
	}

	public function tear_down(): void {
		wp_clear_scheduled_hook( Scan_Runner::HOOK_INIT );
		wp_clear_scheduled_hook( Scan_Runner::HOOK_TRIAGE );
		wp_clear_scheduled_hook( Scan_Runner::HOOK_FINALIZE );
		delete_option( Settings::OPTION );
		// clear post meta locks
		parent::tear_down();
	}

	// -------- Helpers

	private function create_scan( array $plugins ): int {
		$id = wp_insert_post(
			[
				'post_type'   => Scan_CPT::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'Test scan',
			]
		);
		$this->assertIsInt( $id );
		$this->assertGreaterThan( 0, $id );
		update_post_meta( $id, Scan_Fields::META_PLUGINS, $plugins );
		return (int) $id;
	}

	/**
	 * Register a stubbed `hooksgraph/filter-priority-conflicts` ability for
	 * one test. Returns a cleanup callable.
	 */
	private function stub_conflicts_ability( array $rows ): callable {
		// `wp_register_ability` is gated to `wp_abilities_api_init` context. Re-fire
		// the action with a one-shot callback that registers the stub, so the
		// `doing_action` guard inside `wp_register_ability` is satisfied.
		$name = 'hooksgraph/filter-priority-conflicts';
		\wp_unregister_ability( $name );

		$callback = static function () use ( $name, $rows ): void {
			\wp_register_ability(
				$name,
				[
					'category'            => 'hooksgraph',
					'label'               => 'stub',
					'description'         => 'stub',
					'input_schema'        => [ 'type' => 'object', 'additionalProperties' => true ],
					'execute_callback'    => static fn ( array $input ) => [
						'query'    => [],
						'total'    => count( $rows ),
						'has_more' => false,
						'results'  => $rows,
					],
					'permission_callback' => static fn (): bool => true,
				]
			);
		};
		add_action( 'wp_abilities_api_init', $callback, 100 );
		do_action( 'wp_abilities_api_init' );
		remove_action( 'wp_abilities_api_init', $callback, 100 );

		return static function () use ( $name ): void {
			\wp_unregister_ability( $name );
		};
	}

	private function sample_collision( string $hook = 'the_content', int $priority = 10 ): array {
		return [
			[
				'hook'            => $hook,
				'collision_count' => 1,
				'collisions'      => [
					[
						'priority'       => $priority,
						'codebases'      => [ 'alpha', 'beta' ],
						'listener_count' => 2,
						'listeners'      => [
							[
								'codebase'        => 'alpha',
								'file'            => 'alpha.php',
								'line'            => 42,
								'callback'        => 'Alpha::handle',
								'priority'        => $priority,
								'filter_behavior' => [ 'return_origin' => 'replaced' ],
							],
							[
								'codebase' => 'beta',
								'file'     => 'beta.php',
								'line'     => 88,
								'callback' => 'Beta::handle',
								'priority' => $priority,
							],
						],
					],
				],
			],
		];
	}

	// -------- Tests

	public function test_run_init_with_conflicts_writes_findings_and_schedules_triage(): void {
		$this->stub_conflicts_ability( $this->sample_collision() );
		$id = $this->create_scan( [ 'alpha/alpha', 'beta/beta' ] );

		$this->runner->run_init( $id );

		$result = get_post_meta( $id, Scan_Fields::META_RESULT, true );
		$this->assertIsArray( $result );
		$this->assertSame( 'the_content', $result['priority_conflicts'][0]['hook'] );
		$this->assertCount( 1, $result['findings'] );

		$finding = $result['findings'][0];
		$this->assertSame( 'the_content#10#0', $finding['id'] );
		$this->assertSame( 'pending', $finding['verdict'] );

		$progress = get_post_meta( $id, Scan_Fields::META_PROGRESS, true );
		$this->assertSame( 1, (int) $progress['total_pairs'] );

		$status = get_post_meta( $id, Scan_Fields::META_STATUS, true );
		$this->assertSame( Scan_Runner::STATUS_TRIAGING, $status );

		$this->assertNotFalse( wp_next_scheduled( Scan_Runner::HOOK_TRIAGE, [ $id, 'the_content#10#0' ] ) );
	}

	public function test_run_init_skips_triage_when_read_files_disabled(): void {
		( new Settings() )->update( [ 'allow_read_files' => false ] );
		$this->stub_conflicts_ability( $this->sample_collision() );
		$id = $this->create_scan( [ 'alpha/alpha', 'beta/beta' ] );

		$this->runner->run_init( $id );

		$result = get_post_meta( $id, Scan_Fields::META_RESULT, true );
		$this->assertIsArray( $result );
		$this->assertTrue( $result['triage_skipped'] );
		$this->assertCount( 1, $result['findings'] );

		// No per-pair triage events; finalize is scheduled directly.
		$this->assertFalse( wp_next_scheduled( Scan_Runner::HOOK_TRIAGE, [ $id, 'the_content#10#0' ] ) );
		$this->assertNotFalse( wp_next_scheduled( Scan_Runner::HOOK_FINALIZE, [ $id ] ) );
	}

	public function test_run_init_with_no_conflicts_schedules_finalize_immediately(): void {
		$this->stub_conflicts_ability( [] );
		$id = $this->create_scan( [ 'alpha/alpha' ] );

		$this->runner->run_init( $id );

		$progress = get_post_meta( $id, Scan_Fields::META_PROGRESS, true );
		$this->assertSame( 0, (int) $progress['total_pairs'] );

		$this->assertNotFalse( wp_next_scheduled( Scan_Runner::HOOK_FINALIZE, [ $id ] ) );

		// Run finalize → completed.
		$this->runner->run_finalize( $id );
		$status = get_post_meta( $id, Scan_Fields::META_STATUS, true );
		$this->assertSame( Scan_Runner::STATUS_COMPLETED, $status );
	}

	public function test_run_finalize_aggregates_summary(): void {
		$id = $this->create_scan( [ 'alpha/alpha' ] );

		$result = [
			'plugins'            => [ 'alpha/alpha' ],
			'priority_conflicts' => [],
			'findings'           => [
				[ 'id' => 'a#1#0', 'verdict' => 'critical' ],
				[ 'id' => 'a#1#1', 'verdict' => 'critical' ],
				[ 'id' => 'a#1#2', 'verdict' => 'warning' ],
				[ 'id' => 'a#1#3', 'verdict' => 'none' ],
				[ 'id' => 'a#1#4', 'verdict' => 'error' ],
			],
			'summary'            => [ 'critical' => 0, 'warning' => 0, 'none' => 0, 'error' => 0 ],
		];
		update_post_meta( $id, Scan_Fields::META_RESULT, $result );

		$this->runner->run_finalize( $id );

		$after = get_post_meta( $id, Scan_Fields::META_RESULT, true );
		$this->assertSame(
			[ 'critical' => 2, 'warning' => 1, 'none' => 1, 'error' => 1 ],
			$after['summary']
		);
		$this->assertSame( Scan_Runner::STATUS_COMPLETED, get_post_meta( $id, Scan_Fields::META_STATUS, true ) );
	}

	public function test_triage_pair_writes_verdict_and_concurrent_calls_persist(): void {
		// Two findings, two sequential triage calls — each writes a verdict.
		$id     = $this->create_scan( [ 'alpha/alpha', 'beta/beta' ] );
		$result = [
			'plugins'            => [ 'alpha/alpha', 'beta/beta' ],
			'priority_conflicts' => [
				[ 'hook' => 'h', 'priority' => 10, 'pair_count' => 2, 'listeners' => [] ],
			],
			'findings'           => [
				[
					'id'         => 'h#10#0',
					'hook'       => 'h',
					'priority'   => 10,
					'pair'       => [
						[ 'codebase' => 'alpha', 'file' => 'a.php', 'line' => 1, 'callback' => 'A' ],
						[ 'codebase' => 'beta',  'file' => 'b.php', 'line' => 1, 'callback' => 'B' ],
					],
					'verdict'    => 'pending',
					'rationale'  => '',
					'confidence' => null,
				],
				[
					'id'         => 'h#10#1',
					'hook'       => 'h',
					'priority'   => 10,
					'pair'       => [
						[ 'codebase' => 'alpha', 'file' => 'a.php', 'line' => 2, 'callback' => 'A2' ],
						[ 'codebase' => 'beta',  'file' => 'b.php', 'line' => 2, 'callback' => 'B2' ],
					],
					'verdict'    => 'pending',
					'rationale'  => '',
					'confidence' => null,
				],
			],
			'summary'            => [ 'critical' => 0, 'warning' => 0, 'none' => 0, 'error' => 0 ],
		];
		update_post_meta( $id, Scan_Fields::META_RESULT, $result );
		update_post_meta( $id, Scan_Fields::META_PROGRESS, [ 'total_pairs' => 2, 'completed_pairs' => 0, 'failed_pairs' => 0 ] );

		$verdicts = [ 'critical', 'warning' ];
		$call     = 0;
		$this->runner->set_prompt_callable( static function ( string $sys, string $body ) use ( &$verdicts, &$call ): string {
			$v = $verdicts[ $call++ ] ?? 'none';
			return wp_json_encode( [ 'verdict' => $v, 'confidence' => 'high', 'rationale' => 'because' ] );
		} );

		$this->runner->run_triage_pair( $id, 'h#10#0' );
		$this->runner->run_triage_pair( $id, 'h#10#1' );

		$after = get_post_meta( $id, Scan_Fields::META_RESULT, true );
		$by_id = [];
		foreach ( $after['findings'] as $f ) {
			$by_id[ $f['id'] ] = $f;
		}
		$this->assertSame( 'critical', $by_id['h#10#0']['verdict'] );
		$this->assertSame( 'warning', $by_id['h#10#1']['verdict'] );
		$this->assertSame( 'because', $by_id['h#10#0']['rationale'] );

		$progress = get_post_meta( $id, Scan_Fields::META_PROGRESS, true );
		$this->assertSame( 2, (int) $progress['completed_pairs'] );
		$this->assertSame( 0, (int) $progress['failed_pairs'] );

		// All pairs done → finalize should have been scheduled.
		$this->assertNotFalse( wp_next_scheduled( Scan_Runner::HOOK_FINALIZE, [ $id ] ) );
	}

	public function test_triage_pair_records_error_on_invalid_json(): void {
		$id     = $this->create_scan( [ 'alpha/alpha', 'beta/beta' ] );
		$result = [
			'plugins'            => [],
			'priority_conflicts' => [],
			'findings'           => [
				[
					'id'         => 'x#1#0',
					'hook'       => 'x',
					'priority'   => 1,
					'pair'       => [
						[ 'codebase' => 'alpha', 'file' => 'a.php', 'line' => 1, 'callback' => 'A' ],
						[ 'codebase' => 'beta',  'file' => 'b.php', 'line' => 1, 'callback' => 'B' ],
					],
					'verdict'    => 'pending',
					'rationale'  => '',
					'confidence' => null,
				],
			],
			'summary'            => [ 'critical' => 0, 'warning' => 0, 'none' => 0, 'error' => 0 ],
		];
		update_post_meta( $id, Scan_Fields::META_RESULT, $result );
		update_post_meta( $id, Scan_Fields::META_PROGRESS, [ 'total_pairs' => 1, 'completed_pairs' => 0, 'failed_pairs' => 0 ] );

		$this->runner->set_prompt_callable( static fn (): string => 'not json at all' );
		$this->runner->run_triage_pair( $id, 'x#1#0' );

		$after = get_post_meta( $id, Scan_Fields::META_RESULT, true );
		$this->assertSame( 'error', $after['findings'][0]['verdict'] );

		$progress = get_post_meta( $id, Scan_Fields::META_PROGRESS, true );
		$this->assertSame( 1, (int) $progress['failed_pairs'] );
	}

	public function test_run_init_snapshots_versions_and_freshness_flips_to_stale(): void {
		// Seed a parsed record so the snapshot has something to record.
		$this->storage->record_parse_success( 'alpha/alpha', '1.0.0', 'alpha-1.0.0.json', [], 0 );

		$this->stub_conflicts_ability( [] );
		$id = $this->create_scan( [ 'alpha/alpha' ] );
		$this->runner->run_init( $id );

		$snapshot = get_post_meta( $id, Scan_Fields::META_PLUGIN_VERSIONS, true );
		$this->assertSame( '1.0.0', $snapshot['alpha/alpha'] ?? null );

		// Now flip the parse to 2.0.0 — freshness should report stale.
		$this->storage->record_parse_success( 'alpha/alpha', '2.0.0', 'alpha-2.0.0.json', [], 0 );

		$fields    = new Scan_Fields( $this->storage );
		$freshness = $fields->compute_freshness( [ 'id' => $id ] );
		$this->assertSame( 'stale', $freshness );
	}
}
