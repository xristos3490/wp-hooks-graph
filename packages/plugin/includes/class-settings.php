<?php
/**
 * Plugin-wide settings, persisted as a single serialized option.
 *
 * The option is intentionally **not autoloaded** — settings are only consumed
 * in admin / REST flows, so paying the autoload cost on every front-end
 * request would be wasteful.
 *
 * Currently exposes one key:
 * - `allow_read_files` (bool, default false) — opt-in switch that will gate
 *   the `hooksgraph/read-file` AI ability once the enforcement code lands.
 *
 * @package HooksGraph\Plugin
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

defined( 'ABSPATH' ) || exit;

final class Settings {

	public const OPTION = 'hooksgraph_settings';

	private const DEFAULTS = [
		'allow_read_files' => false,
	];

	/**
	 * @return array{allow_read_files: bool}
	 */
	public function all(): array {
		$stored = get_option( self::OPTION, [] );
		if ( ! is_array( $stored ) ) {
			$stored = [];
		}
		return [
			'allow_read_files' => isset( $stored['allow_read_files'] )
				? (bool) $stored['allow_read_files']
				: self::DEFAULTS['allow_read_files'],
		];
	}

	public function get( string $key ): mixed {
		$all = $this->all();
		return $all[ $key ] ?? null;
	}

	/**
	 * Persist a partial settings update. Unknown keys are dropped; known keys
	 * are coerced to their declared type before being merged into the stored
	 * array.
	 *
	 * @param array<string, mixed> $input
	 * @return array{allow_read_files: bool}
	 */
	public function update( array $input ): array {
		$current = $this->all();
		if ( array_key_exists( 'allow_read_files', $input ) ) {
			$current['allow_read_files'] = (bool) $input['allow_read_files'];
		}
		// Third arg `false` keeps this out of the autoload table — front-end
		// requests have no reason to load these settings.
		update_option( self::OPTION, $current, false );
		return $current;
	}
}
