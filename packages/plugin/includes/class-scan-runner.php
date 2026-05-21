<?php
/**
 * Background runner for hg_scan rows.
 *
 * Three chained WP-Cron events drive a scan from `queued` to `completed`:
 *
 *  - `hooksgraph_scan_init`         — find priority conflicts, build findings skeletons.
 *  - `hooksgraph_scan_triage_pair`  — one event per finding; calls the AI for a verdict.
 *  - `hooksgraph_scan_finalize`     — aggregates summary counts + status.
 *
 * Single-flight on writes is handled by a per-scan transient lock with a
 * bounded backoff. Idempotent re-fires are safe: each step keys its work by
 * scan id + finding id, and writes through a read-modify-write inside the
 * lock.
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

use Throwable;
use WordPress\AiClient\Messages\DTO\MessagePart;
use WordPress\AiClient\Messages\DTO\UserMessage;

defined( 'ABSPATH' ) || exit;

final class Scan_Runner {

	public const HOOK_INIT     = 'hooksgraph_scan_init';
	public const HOOK_TRIAGE   = 'hooksgraph_scan_triage_pair';
	public const HOOK_FINALIZE = 'hooksgraph_scan_finalize';
	public const HOOK_WATCHDOG = 'hooksgraph_scan_watchdog';

	/**
	 * How long a scan can sit in an in-flight status (`queued`,
	 * `finding_conflicts`, `triaging`) before the watchdog assumes it
	 * crashed and starts marking its pending findings as errors. Long
	 * enough to outlive a slow AI provider; short enough that the UI isn't
	 * stuck on a dead scan for hours.
	 */
	private const WATCHDOG_STUCK_AFTER_SECONDS = 600;

	/** Period between watchdog ticks while any scan is in flight. */
	private const WATCHDOG_INTERVAL_SECONDS = 120;

	public const STATUS_QUEUED            = 'queued';
	public const STATUS_FINDING_CONFLICTS = 'finding_conflicts';
	public const STATUS_TRIAGING          = 'triaging';
	public const STATUS_COMPLETED         = 'completed';
	public const STATUS_FAILED            = 'failed';

	private const LOCK_TTL          = 30;
	private const LOCK_MAX_ATTEMPTS = 10;
	private const LOCK_SLEEP_US     = 250000;

	private static ?self $instance = null;

	/** @var callable|null */
	private $prompt_callable = null;

	public function __construct( private Storage $storage ) {}

	public static function instance(): self {
		if ( null === self::$instance ) {
			self::$instance = new self( new Storage() );
		}
		return self::$instance;
	}

	public static function set_instance( self $instance ): void {
		self::$instance = $instance;
	}

	/**
	 * Inject a prompt callable for tests / future provider swaps.
	 *
	 * Signature: `fn ( string $system, string $body ): string` — returns the
	 * raw text the runner will JSON-decode.
	 */
	public function set_prompt_callable( callable $fn ): void {
		$this->prompt_callable = $fn;
	}

	public function register(): void {
		add_action( self::HOOK_INIT, [ $this, 'run_init' ], 10, 1 );
		add_action( self::HOOK_TRIAGE, [ $this, 'run_triage_pair' ], 10, 2 );
		add_action( self::HOOK_FINALIZE, [ $this, 'run_finalize' ], 10, 1 );
		add_action( self::HOOK_WATCHDOG, [ $this, 'run_watchdog' ], 10, 0 );
	}

	public function queue_init( int $scan_id ): void {
		if ( $scan_id <= 0 ) {
			return;
		}
		wp_schedule_single_event( time() + 5, self::HOOK_INIT, [ $scan_id ] );
		$this->ensure_watchdog_scheduled();
	}

	/**
	 * Schedule the watchdog if it's not already queued. The watchdog
	 * self-reschedules from its own callback while any scan is in flight, so
	 * we only need to seed it whenever a fresh scan is created.
	 */
	private function ensure_watchdog_scheduled(): void {
		if ( false !== wp_next_scheduled( self::HOOK_WATCHDOG ) ) {
			return;
		}
		wp_schedule_single_event( time() + self::WATCHDOG_INTERVAL_SECONDS, self::HOOK_WATCHDOG );
	}

	// -------------------------------------------------------------- init step

	public function run_init( int $scan_id ): void {
		try {
			$this->assume_scan_author( $scan_id );
			update_post_meta( $scan_id, Scan_Fields::META_STATUS, self::STATUS_FINDING_CONFLICTS );
			update_post_meta( $scan_id, Scan_Fields::META_STARTED_AT, gmdate( 'c' ) );

			$keys = (array) get_post_meta( $scan_id, Scan_Fields::META_PLUGINS, true );
			$keys = array_values( array_filter( array_map( 'strval', $keys ) ) );

			$snapshot = $this->snapshot_versions( $keys );
			update_post_meta( $scan_id, Scan_Fields::META_PLUGIN_VERSIONS, $snapshot );

			$ability = function_exists( '\\wp_get_ability' ) ? \wp_get_ability( 'hooksgraph/filter-priority-conflicts' ) : null;
			if ( null === $ability ) {
				throw new \RuntimeException( 'Ability hooksgraph/filter-priority-conflicts not registered.' );
			}

			$response = $ability->execute( [ 'plugins' => $keys, 'limit' => 500 ] );
			if ( $response instanceof \WP_Error ) {
				throw new \RuntimeException( 'Ability error: ' . $response->get_error_message() );
			}

			$collisions = is_array( $response ) && isset( $response['results'] ) && is_array( $response['results'] )
				? $response['results']
				: [];

			[ $priority_conflicts, $findings ] = $this->build_findings_from_collisions( $collisions );

			// AI triage requires reading callback bodies via the `read-file`
			// ability, which is gated by the `allow_read_files` setting. With
			// it off, we still surface the priority-conflict findings (the
			// list of colliding listener pairs) but skip per-pair verdicts —
			// the scan completes immediately with no rationale.
			$triage_enabled = (bool) ( new Settings() )->get( 'allow_read_files' );

			$result = [
				'plugins'            => $keys,
				'priority_conflicts' => $priority_conflicts,
				'findings'           => $findings,
				'summary'            => [ 'critical' => 0, 'warning' => 0, 'none' => 0, 'error' => 0 ],
				'triage_skipped'     => ! $triage_enabled,
			];

			update_post_meta( $scan_id, Scan_Fields::META_RESULT, $result );
			update_post_meta(
				$scan_id,
				Scan_Fields::META_PROGRESS,
				[ 'total_pairs' => count( $findings ), 'completed_pairs' => 0, 'failed_pairs' => 0 ]
			);

			if ( 0 === count( $findings ) || ! $triage_enabled ) {
				update_post_meta( $scan_id, Scan_Fields::META_STATUS, self::STATUS_TRIAGING );
				wp_schedule_single_event( time() + 5, self::HOOK_FINALIZE, [ $scan_id ] );
				return;
			}

			update_post_meta( $scan_id, Scan_Fields::META_STATUS, self::STATUS_TRIAGING );

			$base = time();
			foreach ( $findings as $idx => $finding ) {
				wp_schedule_single_event( $base + 5 + (int) $idx, self::HOOK_TRIAGE, [ $scan_id, (string) $finding['id'] ] );
			}
		} catch ( Throwable $e ) {
			update_post_meta( $scan_id, Scan_Fields::META_STATUS, self::STATUS_FAILED );
			update_post_meta( $scan_id, Scan_Fields::META_ERROR, sprintf( '%s: %s', $e::class, $e->getMessage() ) );
			update_post_meta( $scan_id, Scan_Fields::META_FINISHED_AT, gmdate( 'c' ) );
		}
	}

	/**
	 * Capture the parsed-version snapshot for each scoped plugin. We deliberately
	 * read directly off the storage record (`last_parsed_version`) rather than
	 * the installed plugin header — the freshness check compares what we *parsed*
	 * against the latest parse output, so a plugin upgrade alone isn't stale until
	 * the new version is reparsed.
	 *
	 * @param list<string> $keys
	 * @return array<string, string>
	 */
	private function snapshot_versions( array $keys ): array {
		$out = [];
		foreach ( $keys as $key ) {
			$record       = $this->storage->get_record( $key );
			$out[ $key ] = (string) ( $record['last_parsed_version'] ?? '' );
		}
		return $out;
	}

	/**
	 * Walk the ability output rows and produce (a) a normalized
	 * `priority_conflicts[]` mirror of what we'll show in the UI and (b) the
	 * flat list of cross-plugin pair findings.
	 *
	 * @param array<int, array<string, mixed>> $rows
	 * @return array{0: list<array<string,mixed>>, 1: list<array<string,mixed>>}
	 */
	private function build_findings_from_collisions( array $rows ): array {
		$priority_conflicts = [];
		$findings           = [];

		foreach ( $rows as $row ) {
			$hook       = (string) ( $row['hook'] ?? '' );
			$collisions = is_array( $row['collisions'] ?? null ) ? $row['collisions'] : [];

			foreach ( $collisions as $collision ) {
				$priority  = (int) ( $collision['priority'] ?? 0 );
				$listeners = is_array( $collision['listeners'] ?? null ) ? $collision['listeners'] : [];
				if ( count( $listeners ) < 2 ) {
					continue;
				}

				// Pair generator: every unordered cross-plugin pair.
				$pairs = [];
				$n     = count( $listeners );
				for ( $i = 0; $i < $n; $i++ ) {
					for ( $j = $i + 1; $j < $n; $j++ ) {
						$a = $listeners[ $i ];
						$b = $listeners[ $j ];
						if ( ( $a['codebase'] ?? null ) === ( $b['codebase'] ?? null ) ) {
							continue;
						}
						$pairs[] = [ $a, $b ];
					}
				}

				$priority_conflicts[] = [
					'hook'       => $hook,
					'priority'   => $priority,
					'pair_count' => count( $pairs ),
					'listeners'  => array_values( $listeners ),
				];

				foreach ( $pairs as $idx => $pair ) {
					$findings[] = [
						'id'         => sprintf( '%s#%d#%d', $hook, $priority, $idx ),
						'hook'       => $hook,
						'priority'   => $priority,
						'pair'       => $pair,
						'verdict'    => 'pending',
						'rationale'  => '',
						'confidence' => null,
						'tokens'     => null,
						'failed_at'  => null,
						'error'      => null,
					];
				}
			}
		}

		return [ $priority_conflicts, $findings ];
	}

	// ------------------------------------------------------------- triage step

	public function run_triage_pair( int $scan_id, string $finding_id ): void {
		try {
			$this->assume_scan_author( $scan_id );
			$finding = $this->load_finding( $scan_id, $finding_id );
			if ( null === $finding ) {
				return;
			}

			$pair    = is_array( $finding['pair'] ?? null ) ? $finding['pair'] : [];
			$bodies  = [ $this->read_callback_body( $pair[0] ?? [] ), $this->read_callback_body( $pair[1] ?? [] ) ];
			$hook    = (string) ( $finding['hook'] ?? '' );
			$prio    = (int) ( $finding['priority'] ?? 0 );

			[ $system, $body ] = $this->build_prompt( $hook, $prio, $pair[0] ?? [], $pair[1] ?? [], $bodies[0], $bodies[1] );

			error_log( sprintf(
				"[hooksgraph triage] scan=%d finding=%s hook=%s priority=%d\n--- SYSTEM ---\n%s\n--- BODY ---\n%s\n--- END ---",
				$scan_id,
				$finding_id,
				$hook,
				$prio,
				$system,
				$body
			) );

			$raw     = $this->run_prompt( $system, $body );
			$parsed  = $this->parse_verdict( $raw );

			error_log( sprintf(
				"[hooksgraph triage] scan=%d finding=%s verdict=%s confidence=%s rationale=%s\n--- RAW ---\n%s\n--- END ---",
				$scan_id,
				$finding_id,
				$parsed['verdict'] ?? '',
				$parsed['confidence'] ?? '',
				$parsed['rationale'] ?? '',
				$raw
			) );

			$acquired = $this->with_lock( $scan_id, function () use ( $scan_id, $finding_id, $parsed ): void {
				$result = $this->read_result( $scan_id );
				if ( null === $result ) {
					return;
				}
				foreach ( $result['findings'] as $i => $f ) {
					if ( ( $f['id'] ?? null ) !== $finding_id ) {
						continue;
					}
					$result['findings'][ $i ]['verdict']    = $parsed['verdict'];
					$result['findings'][ $i ]['confidence'] = $parsed['confidence'];
					$result['findings'][ $i ]['rationale']  = $parsed['rationale'];
					if ( 'error' === $parsed['verdict'] ) {
						$result['findings'][ $i ]['failed_at'] = gmdate( 'c' );
						$result['findings'][ $i ]['error']     = $parsed['error'] ?? 'parse_error';
					}
					break;
				}

				update_post_meta( $scan_id, Scan_Fields::META_RESULT, $result );
				$this->bump_progress( $scan_id, 'error' === $parsed['verdict'] ? 'failed' : 'completed' );
			} );

			if ( ! $acquired ) {
				// Lock contention — retry this pair later instead of losing it.
				wp_schedule_single_event( time() + 30, self::HOOK_TRIAGE, [ $scan_id, $finding_id ] );
				return;
			}

			$this->maybe_schedule_finalize( $scan_id );
		} catch ( Throwable $e ) {
			$this->record_pair_error( $scan_id, $finding_id, $e );
			$this->maybe_schedule_finalize( $scan_id );
		}
	}

	private function record_pair_error( int $scan_id, string $finding_id, Throwable $e ): void {
		try {
			$this->with_lock( $scan_id, function () use ( $scan_id, $finding_id, $e ): void {
				$result = $this->read_result( $scan_id );
				if ( null === $result ) {
					return;
				}
				foreach ( $result['findings'] as $i => $f ) {
					if ( ( $f['id'] ?? null ) !== $finding_id ) {
						continue;
					}
					$result['findings'][ $i ]['verdict']   = 'error';
					$result['findings'][ $i ]['rationale'] = '';
					$result['findings'][ $i ]['failed_at'] = gmdate( 'c' );
					$result['findings'][ $i ]['error']     = sprintf( '%s: %s', $e::class, $e->getMessage() );
					break;
				}
				update_post_meta( $scan_id, Scan_Fields::META_RESULT, $result );
				$this->bump_progress( $scan_id, 'failed' );
			} );
		} catch ( Throwable $inner ) {
			update_post_meta( $scan_id, Scan_Fields::META_ERROR, sprintf( '%s: %s', $inner::class, $inner->getMessage() ) );
		}
	}

	private function load_finding( int $scan_id, string $finding_id ): ?array {
		$result = $this->read_result( $scan_id );
		if ( null === $result ) {
			return null;
		}
		foreach ( $result['findings'] as $f ) {
			if ( ( $f['id'] ?? null ) === $finding_id ) {
				return $f;
			}
		}
		return null;
	}

	/**
	 * Resolve the callback source slice for a listener record. Falls back to a
	 * placeholder string when the read-file ability is unavailable or returns
	 * an error — the AI prompt is robust to "(body unavailable)" and will lean
	 * on the metadata fields we already embed.
	 *
	 * @param array<string, mixed> $listener
	 */
	private function read_callback_body( array $listener ): string {
		$plugin = (string) ( $listener['codebase'] ?? '' );
		$file   = (string) ( $listener['file'] ?? '' );
		$line   = (int) ( $listener['line'] ?? 0 );

		if ( '' === $plugin || '' === $file || $line <= 0 ) {
			return '(body unavailable)';
		}

		// Prefer the exact span the parser recorded for this callback's body.
		// Falls back to a window around the add_filter() call only when the
		// parser couldn't resolve the body (string callback into another file,
		// closure assigned to a variable, etc.).
		$body_start = isset( $listener['callback_body_start_line'] ) ? (int) $listener['callback_body_start_line'] : 0;
		$body_end   = isset( $listener['callback_body_end_line'] ) ? (int) $listener['callback_body_end_line'] : 0;

		if ( $body_start > 0 && $body_end >= $body_start ) {
			$start_line = max( 1, $body_start - 2 );
			$end_line   = $body_end + 2;
		} else {
			$start_line = max( 1, $line - 5 );
			$end_line   = $line + 80;
		}

		$plugin_key = $this->resolve_plugin_key( $plugin );

		if ( ! function_exists( '\\wp_get_ability' ) ) {
			return '(body unavailable)';
		}
		$ability = \wp_get_ability( 'hooksgraph/read-file' );
		if ( null === $ability ) {
			return '(body unavailable)';
		}

		$response = $ability->execute(
			[
				'plugin'     => $plugin_key,
				'file_path'  => $file,
				'start_line' => $start_line,
				'end_line'   => $end_line,
			]
		);
		if ( $response instanceof \WP_Error || ! is_array( $response ) ) {
			return '(body unavailable)';
		}
		return (string) ( $response['contents'] ?? '(body unavailable)' );
	}

	/**
	 * Best-effort reverse lookup from codebase id (slug) to plugin key.
	 * Scans active plugins whose key resolves to the same slug.
	 */
	private function resolve_plugin_key( string $codebase_or_key ): string {
		// If it already looks like `dir/file`, treat as a key.
		if ( str_contains( $codebase_or_key, '/' ) ) {
			return $codebase_or_key;
		}
		// Otherwise try to find an active plugin whose codebase_id matches.
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		$all    = function_exists( 'get_plugins' ) ? \get_plugins() : [];
		$active = (array) get_option( 'active_plugins', [] );
		foreach ( $active as $file ) {
			if ( ! isset( $all[ $file ] ) ) {
				continue;
			}
			$key = substr( (string) $file, 0, -4 );
			if ( $this->storage->codebase_id( $key ) === $codebase_or_key ) {
				return $key;
			}
		}
		return $codebase_or_key;
	}

	/**
	 * @param array<string, mixed> $a
	 * @param array<string, mixed> $b
	 * @return array{0: string, 1: string}
	 */
	private function build_prompt( string $hook, int $priority, array $a, array $b, string $body_a, string $body_b ): array {
		$system = "You are a WordPress filter conflict triage assistant. You receive the "
			. "source of two PHP callbacks that are both registered on the same filter "
			. "hook at the same priority, from two different plugins. Decide whether "
			. "they actually conflict at runtime by reading the two function bodies.\n\n"
			. "Output STRICT JSON only — no prose, no fences, no commentary. Schema:\n\n"
			. "{\n"
			. "  \"verdict\": \"critical\" | \"warning\" | \"none\",\n"
			. "  \"confidence\": \"high\" | \"medium\" | \"low\",\n"
			. "  \"rationale\": \"<= 240 chars, plain text\"\n"
			. "}\n\n"
			. "## Baseline\n"
			. "Two callbacks on the same filter at the same priority is the ordinary,\n"
			. "intended WordPress pattern. WordPress chains same-priority callbacks in\n"
			. "registration order, feeding each one's return value into the next.\n"
			. "Co-existence is not a conflict on its own. A real conflict requires\n"
			. "evidence in the bodies that one callback discards or overwrites the\n"
			. "other's work on overlapping state.\n\n"
			. "## How to read each body\n"
			. "A filter callback receives a first parameter and is expected to return a\n"
			. "value. Classify what each body does on its realistic execution path:\n"
			. "- Pass-through: returns the first parameter, possibly with field-level\n"
			. "  mutations on it.\n"
			. "- Conditional pass-through: returns the first parameter on most paths;\n"
			. "  diverges only under narrow guards.\n"
			. "- Derived: returns a value computed from the first parameter (wrapping,\n"
			. "  reformatting, extracting a part of it).\n"
			. "- Replacement: returns a value built independently of the first\n"
			. "  parameter, so prior callbacks' contributions are dropped.\n\n"
			. "Judge by what the code does, not by surface cues. Treat early returns of\n"
			. "the first parameter as pass-through, not replacement.\n\n"
			. "## Verdict rubric\n"
			. "critical — guaranteed data loss visible in the bodies:\n"
			. "  - Both bodies are replacements on every realistic path, OR\n"
			. "  - Both bodies unconditionally write the same concrete keyed state\n"
			. "    (option / meta / transient family) with literal keys and without\n"
			. "    read-merging the existing value, OR\n"
			. "  - Both bodies unconditionally overwrite the same named field on the\n"
			. "    input value with incompatible content.\n"
			. "  You must be able to name the exact data lost in the rationale.\n\n"
			. "warning — plausible interaction, not a guaranteed clobber:\n"
			. "  - One body is a replacement, the other passes the input through.\n"
			. "  - Both touch the same state family but with variable keys, or one side\n"
			. "    reads-modifies-writes.\n"
			. "  - Overlapping externally-visible side effects on the same target\n"
			. "    (redirect, termination, enqueue, header) where only one can win.\n"
			. "  - One body short-circuits the filter under a condition the other does\n"
			. "    not also gate on.\n\n"
			. "none — no real interference:\n"
			. "  - Either body is pass-through with no overlapping field-level\n"
			. "    mutation.\n"
			. "  - Both mutate the input on disjoint fields/keys.\n"
			. "  - One body is read-only, logging, or diagnostic.\n"
			. "  - The two bodies run under mutually exclusive guards.\n"
			. "  - The bodies compose without targeting the same named state.\n\n"
			. "## Process\n"
			. "1. Read both bodies. If either is unavailable or too small to judge,\n"
			. "   return `none` with `low` confidence.\n"
			. "2. Identify what each body returns on its realistic path and what state\n"
			. "   it writes outside the return value.\n"
			. "3. If either side passes the first parameter through, default to `none`\n"
			. "   unless both sides demonstrably fight over the same named\n"
			. "   field/key/target.\n"
			. "4. Escalate to `critical` only when you can quote the specific data one\n"
			. "   side discards. Name it in the rationale.\n"
			. "5. When in doubt between `warning` and `critical`, pick `warning`.\n"
			. "6. When in doubt between `none` and `warning`, pick `none`. Same-\n"
			. "   priority co-existence is the WordPress default; assume safety until\n"
			. "   the bodies prove otherwise.";

		$body  = sprintf( "HOOK: %s     PRIORITY: %d     TYPE: filter\n\n", $hook, $priority );
		$body .= $this->format_listener( 'LISTENER A', $a, $body_a );
		$body .= "\n";
		$body .= $this->format_listener( 'LISTENER B', $b, $body_b );

		return [ $system, $body ];
	}

	/**
	 * @param array<string, mixed> $listener
	 */
	private function format_listener( string $label, array $listener, string $body ): string {
		$file     = (string) ( $listener['file'] ?? '' );
		$line     = (int) ( $listener['line'] ?? 0 );
		$callback = (string) ( $listener['callback'] ?? '' );
		$plugin   = (string) ( $listener['codebase'] ?? '' );

		$out  = $label . "\n";
		$out .= "  plugin:   " . $plugin . "\n";
		$out .= "  callback: " . $callback . "\n";
		$out .= "  file:     " . $file . ":" . $line . "\n";
		$out .= "  body:\n  ```php\n" . $body . "\n  ```\n";
		return $out;
	}

	private function run_prompt( string $system, string $body ): string {
		if ( null !== $this->prompt_callable ) {
			return (string) ( $this->prompt_callable )( $system, $body );
		}
		if ( ! function_exists( '\\wp_ai_client_prompt' ) ) {
			throw new \RuntimeException( 'wp_ai_client_prompt is unavailable.' );
		}
		$messages = [ new UserMessage( [ new MessagePart( $body ) ] ) ];
		$result   = \wp_ai_client_prompt( $messages )
			->using_system_instruction( $system )
			->using_max_tokens( 1024 )
			->generate_text_result();
		if ( is_object( $result ) && method_exists( $result, 'toText' ) ) {
			try {
				return (string) $result->toText();
			} catch ( Throwable $e ) {
				return '';
			}
		}
		return '';
	}

	/**
	 * @return array{verdict: string, confidence: ?string, rationale: string, error?: string}
	 */
	private function parse_verdict( string $raw ): array {
		$text = trim( $raw );
		// Strip ```json fences (tolerant).
		if ( preg_match( '/^```(?:json)?\s*(.*?)```\s*$/is', $text, $m ) ) {
			$text = trim( $m[1] );
		}
		$decoded = json_decode( $text, true );
		if ( ! is_array( $decoded ) ) {
			return [ 'verdict' => 'error', 'confidence' => null, 'rationale' => '', 'error' => 'parse_error' ];
		}
		$verdict    = strtolower( (string) ( $decoded['verdict'] ?? '' ) );
		$confidence = strtolower( (string) ( $decoded['confidence'] ?? '' ) );
		$rationale  = (string) ( $decoded['rationale'] ?? '' );

		if ( ! in_array( $verdict, [ 'critical', 'warning', 'none' ], true ) ) {
			return [ 'verdict' => 'error', 'confidence' => null, 'rationale' => '', 'error' => 'invalid_verdict' ];
		}
		if ( ! in_array( $confidence, [ 'high', 'medium', 'low' ], true ) ) {
			$confidence = 'low';
		}
		return [ 'verdict' => $verdict, 'confidence' => $confidence, 'rationale' => $rationale ];
	}

	// ----------------------------------------------------------- finalize step

	public function run_finalize( int $scan_id ): void {
		try {
			$this->assume_scan_author( $scan_id );
			$result = $this->read_result( $scan_id );
			if ( null === $result ) {
				$result = [ 'findings' => [], 'summary' => [], 'priority_conflicts' => [], 'plugins' => [] ];
			}

			$summary = [ 'critical' => 0, 'warning' => 0, 'none' => 0, 'error' => 0 ];
			$total   = 0;
			foreach ( $result['findings'] as $finding ) {
				$total++;
				$v = (string) ( $finding['verdict'] ?? '' );
				if ( isset( $summary[ $v ] ) ) {
					$summary[ $v ]++;
				}
			}
			$result['summary'] = $summary;
			update_post_meta( $scan_id, Scan_Fields::META_RESULT, $result );

			$status = ( $total > 0 && $summary['error'] === $total ) ? self::STATUS_FAILED : self::STATUS_COMPLETED;
			update_post_meta( $scan_id, Scan_Fields::META_STATUS, $status );
			update_post_meta( $scan_id, Scan_Fields::META_FINISHED_AT, gmdate( 'c' ) );
		} catch ( Throwable $e ) {
			update_post_meta( $scan_id, Scan_Fields::META_STATUS, self::STATUS_FAILED );
			update_post_meta( $scan_id, Scan_Fields::META_ERROR, sprintf( '%s: %s', $e::class, $e->getMessage() ) );
			update_post_meta( $scan_id, Scan_Fields::META_FINISHED_AT, gmdate( 'c' ) );
		}
	}

	// ----------------------------------------------------------------- helpers

	/**
	 * WP-Cron callbacks run as user 0, which makes every ability
	 * `permission_callback` based on `current_user_can( 'manage_options' )`
	 * fail. Re-assert the scan's author (the admin who created the row) for
	 * the duration of the cron tick so abilities behave as if invoked
	 * directly by that user. If the author has lost the capability, the
	 * abilities will fail honestly — no silent escalation.
	 */
	private function assume_scan_author( int $scan_id ): void {
		$author_id = (int) get_post_field( 'post_author', $scan_id );
		if ( $author_id > 0 ) {
			wp_set_current_user( $author_id );
		}
	}

	private function read_result( int $scan_id ): ?array {
		$raw = get_post_meta( $scan_id, Scan_Fields::META_RESULT, true );
		if ( ! is_array( $raw ) ) {
			return null;
		}
		if ( ! isset( $raw['findings'] ) || ! is_array( $raw['findings'] ) ) {
			$raw['findings'] = [];
		}
		if ( ! isset( $raw['summary'] ) || ! is_array( $raw['summary'] ) ) {
			$raw['summary'] = [ 'critical' => 0, 'warning' => 0, 'none' => 0, 'error' => 0 ];
		}
		if ( ! isset( $raw['priority_conflicts'] ) || ! is_array( $raw['priority_conflicts'] ) ) {
			$raw['priority_conflicts'] = [];
		}
		if ( ! isset( $raw['plugins'] ) || ! is_array( $raw['plugins'] ) ) {
			$raw['plugins'] = [];
		}
		return $raw;
	}

	private function bump_progress( int $scan_id, string $bucket ): void {
		$raw = get_post_meta( $scan_id, Scan_Fields::META_PROGRESS, true );
		$progress = is_array( $raw ) ? $raw : [ 'total_pairs' => 0, 'completed_pairs' => 0, 'failed_pairs' => 0 ];
		if ( 'completed' === $bucket ) {
			$progress['completed_pairs'] = (int) ( $progress['completed_pairs'] ?? 0 ) + 1;
		} elseif ( 'failed' === $bucket ) {
			$progress['failed_pairs'] = (int) ( $progress['failed_pairs'] ?? 0 ) + 1;
		}
		update_post_meta( $scan_id, Scan_Fields::META_PROGRESS, $progress );
	}

	// --------------------------------------------------------------- watchdog
	//
	// Cron callbacks that crash mid-flight (PHP fatal, max-execution-time,
	// OOM) never reach our try/catch, so the finding stays `pending` forever
	// and the scan gets stuck in `triaging`. The watchdog sweeps in-flight
	// scans on a fixed cadence and force-completes anything that's both
	// (a) older than WATCHDOG_STUCK_AFTER_SECONDS and (b) has no pending
	// triage events queued for its `pending` findings.

	public function run_watchdog(): void {
		try {
			$in_flight = $this->find_in_flight_scans();

			foreach ( $in_flight as $scan_id ) {
				$started_raw = (string) get_post_meta( $scan_id, Scan_Fields::META_STARTED_AT, true );
				$started_ts  = '' !== $started_raw ? strtotime( $started_raw ) : false;
				if ( false === $started_ts ) {
					$started_ts = (int) get_post_field( 'post_date_gmt', $scan_id );
					$started_ts = $started_ts ?: time();
				}

				if ( ( time() - $started_ts ) < self::WATCHDOG_STUCK_AFTER_SECONDS ) {
					continue; // Still within the grace window.
				}

				$this->recover_stuck_scan( $scan_id );
			}

			// Reschedule while any scan is still in flight (including
			// freshly-stuck ones we just nudged toward finalize).
			if ( ! empty( $this->find_in_flight_scans() ) ) {
				wp_schedule_single_event( time() + self::WATCHDOG_INTERVAL_SECONDS, self::HOOK_WATCHDOG );
			}
		} catch ( Throwable $e ) {
			// Don't let watchdog itself crash silently — surface via error_log
			// and keep the schedule alive for the next tick.
			error_log( sprintf( '[hooksgraph] Watchdog tick failed: %s: %s', $e::class, $e->getMessage() ) );
			wp_schedule_single_event( time() + self::WATCHDOG_INTERVAL_SECONDS, self::HOOK_WATCHDOG );
		}
	}

	/**
	 * Scans in any of the in-flight statuses. Bounded by `posts_per_page` so a
	 * runaway site doesn't pull every history row.
	 *
	 * @return list<int>
	 */
	private function find_in_flight_scans(): array {
		$query = new \WP_Query(
			[
				'post_type'              => Scan_CPT::POST_TYPE,
				'post_status'            => 'any',
				'posts_per_page'         => 50,
				'fields'                 => 'ids',
				'no_found_rows'          => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
				'meta_query'             => [
					[
						'key'     => Scan_Fields::META_STATUS,
						'value'   => [
							self::STATUS_QUEUED,
							self::STATUS_FINDING_CONFLICTS,
							self::STATUS_TRIAGING,
						],
						'compare' => 'IN',
					],
				],
			]
		);
		return array_map( 'intval', (array) $query->posts );
	}

	/**
	 * Mark every `pending` finding that no longer has a queued triage event
	 * as `error`, then force a finalize. If the scan still has live triage
	 * events queued, do nothing — the runner will get to them.
	 */
	private function recover_stuck_scan( int $scan_id ): void {
		$this->with_lock( $scan_id, function () use ( $scan_id ): void {
			$result = $this->read_result( $scan_id );
			if ( null === $result ) {
				// No result blob (init crashed) — flip straight to failed.
				update_post_meta( $scan_id, Scan_Fields::META_STATUS, self::STATUS_FAILED );
				update_post_meta( $scan_id, Scan_Fields::META_ERROR, 'Scan stalled before any conflicts were found.' );
				update_post_meta( $scan_id, Scan_Fields::META_FINISHED_AT, gmdate( 'c' ) );
				return;
			}

			$has_live = false;
			foreach ( $result['findings'] as $i => $f ) {
				if ( 'pending' !== ( $f['verdict'] ?? '' ) ) {
					continue;
				}
				$finding_id = (string) ( $f['id'] ?? '' );
				if ( '' !== $finding_id && false !== wp_next_scheduled( self::HOOK_TRIAGE, [ $scan_id, $finding_id ] ) ) {
					// Still queued for retry — don't touch it.
					$has_live = true;
					continue;
				}
				$result['findings'][ $i ]['verdict']   = 'error';
				$result['findings'][ $i ]['rationale'] = '';
				$result['findings'][ $i ]['failed_at'] = gmdate( 'c' );
				$result['findings'][ $i ]['error']     = 'timeout_or_crash';
				$this->bump_progress( $scan_id, 'failed' );
			}

			update_post_meta( $scan_id, Scan_Fields::META_RESULT, $result );

			if ( ! $has_live ) {
				if ( false === wp_next_scheduled( self::HOOK_FINALIZE, [ $scan_id ] ) ) {
					wp_schedule_single_event( time() + 5, self::HOOK_FINALIZE, [ $scan_id ] );
				}
			}
		} );
	}

	private function maybe_schedule_finalize( int $scan_id ): void {
		$raw = get_post_meta( $scan_id, Scan_Fields::META_PROGRESS, true );
		if ( ! is_array( $raw ) ) {
			return;
		}
		$total     = (int) ( $raw['total_pairs'] ?? 0 );
		$completed = (int) ( $raw['completed_pairs'] ?? 0 );
		$failed    = (int) ( $raw['failed_pairs'] ?? 0 );
		if ( $total > 0 && ( $completed + $failed ) >= $total ) {
			if ( false === wp_next_scheduled( self::HOOK_FINALIZE, [ $scan_id ] ) ) {
				wp_schedule_single_event( time() + 5, self::HOOK_FINALIZE, [ $scan_id ] );
			}
		}
	}

	/**
	 * Run `$work` under a per-scan transient lock with bounded backoff. Returns
	 * true if the lock was acquired and the work ran (even if it threw); false
	 * if backoff was exhausted — the caller is responsible for rescheduling so
	 * the finding isn't lost. The lock is released even if the callback throws.
	 */
	private function with_lock( int $scan_id, callable $work ): bool {
		$key = 'hg_scan_lock_' . $scan_id;
		$acquired = false;
		for ( $i = 0; $i < self::LOCK_MAX_ATTEMPTS; $i++ ) {
			if ( false === get_transient( $key ) ) {
				set_transient( $key, 1, self::LOCK_TTL );
				$acquired = true;
				break;
			}
			usleep( self::LOCK_SLEEP_US );
		}
		if ( ! $acquired ) {
			return false;
		}
		try {
			$work();
		} finally {
			delete_transient( $key );
		}
		return true;
	}
}
