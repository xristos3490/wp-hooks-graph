<?php
/**
 * Ability: hooksgraph/read-file
 *
 * Read a PHP file from an installed plugin, optionally scoped to a line range.
 * Resolves the file via `WP_PLUGIN_DIR`, then reads it through the
 * `WP_Filesystem` API so the call honors the site's configured filesystem
 * transport.
 *
 * Included from {@see \HooksGraph\Plugin\hooksgraph_register_abilities()} with
 * `$index` (Graph_Index) and `$storage` (Storage) in local scope.
 *
 * @package HooksGraph\Plugin
 */

declare(strict_types=1);

namespace HooksGraph\Plugin\Abilities;

defined( 'ABSPATH' ) || exit;

\wp_register_ability(
	'hooksgraph/read-file',
	array(
		'category'            => 'hooksgraph',
		'label'               => __( 'Read a PHP file', 'hooksgraph' ),
		'description'         => __( 'Read the contents of a PHP file inside an installed plugin, optionally limited to a line range. `plugin` is the plugin key from `hooksgraph/list-codebases` (e.g. `akismet/akismet` or `hello`). `file_path` is the repo-relative path as returned by other hooksgraph abilities. `start_line` and `end_line` are 1-based and inclusive.', 'hooksgraph' ),
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array(
				'plugin'     => array(
					'type'        => 'string',
					'description' => __( 'Plugin key, e.g. `akismet/akismet` or `hello`.', 'hooksgraph' ),
				),
				'file_path'  => array(
					'type'        => 'string',
					'description' => __( 'Repo-relative path inside the plugin directory.', 'hooksgraph' ),
				),
				'start_line' => array(
					'type'        => 'integer',
					'minimum'     => 1,
					'description' => __( '1-based first line to include. Defaults to the start of the file.', 'hooksgraph' ),
				),
				'end_line'   => array(
					'type'        => 'integer',
					'minimum'     => 1,
					'description' => __( '1-based last line to include (inclusive). Defaults to the end of the file.', 'hooksgraph' ),
				),
			),
			'required'             => array( 'plugin', 'file_path' ),
			'additionalProperties' => false,
		),
		'output_schema'       => array(
			'type'       => 'object',
			'properties' => array(
				'plugin'      => array( 'type' => 'string' ),
				'file_path'   => array( 'type' => 'string' ),
				'start_line'  => array( 'type' => 'integer' ),
				'end_line'    => array( 'type' => 'integer' ),
				'total_lines' => array( 'type' => 'integer' ),
				'truncated'   => array( 'type' => 'boolean' ),
				'contents'    => array( 'type' => 'string' ),
			),
		),
		'execute_callback'    => static function ( array $input ) {
			$plugin    = (string) ( $input['plugin'] ?? '' );
			$file_path = (string) ( $input['file_path'] ?? '' );

			if ( '' === $plugin || '' === $file_path ) {
				return new \WP_Error(
					'hooksgraph_invalid_args',
					__( '`plugin` and `file_path` are required.', 'hooksgraph' )
				);
			}

			// Only allow keys the site actually has installed. This doubles as
			// a sanity check against arbitrary directory access via `plugin`.
			$known = known_active_plugins();
			if ( ! isset( $known[ $plugin ] ) ) {
				return new \WP_Error(
					'hooksgraph_unknown_plugin',
					sprintf(
						/* translators: %s: plugin key. */
						__( 'Unknown or inactive plugin: %s. Call `hooksgraph/list-codebases` for valid keys.', 'hooksgraph' ),
						$plugin
					)
				);
			}

			// Plugin directory: foldered plugins (`akismet/akismet`) live in
			// `WP_PLUGIN_DIR/<dir>/`; single-file plugins (`hello`) live in
			// `WP_PLUGIN_DIR/` directly. The graph paths the AI sees are
			// repo-relative to that root, so resolve against it.
			$slash      = strpos( $plugin, '/' );
			$plugin_dir = false === $slash
				? trailingslashit( WP_PLUGIN_DIR )
				: trailingslashit( WP_PLUGIN_DIR ) . substr( $plugin, 0, $slash ) . '/';

			$plugin_root = realpath( $plugin_dir );
			if ( false === $plugin_root ) {
				return new \WP_Error(
					'hooksgraph_plugin_missing',
					sprintf(
						/* translators: %s: plugin key. */
						__( 'Plugin directory not found for `%s`.', 'hooksgraph' ),
						$plugin
					)
				);
			}
			$plugin_root = trailingslashit( $plugin_root );

			// Reject absolute paths up-front; let realpath() catch traversal.
			$relative = ltrim( $file_path, '/\\' );
			if ( '' === $relative || str_contains( $relative, "\0" ) ) {
				return new \WP_Error(
					'hooksgraph_invalid_path',
					__( '`file_path` is empty or contains invalid characters.', 'hooksgraph' )
				);
			}

			$full = realpath( $plugin_root . $relative );
			if ( false === $full || ! str_starts_with( $full, $plugin_root ) ) {
				return new \WP_Error(
					'hooksgraph_file_not_found',
					sprintf(
						/* translators: %s: file path. */
						__( 'File not found inside plugin: %s', 'hooksgraph' ),
						$file_path
					)
				);
			}

			if ( '.php' !== strtolower( substr( $full, -4 ) ) ) {
				return new \WP_Error(
					'hooksgraph_unsupported_file',
					__( 'Only `.php` files can be read through this ability.', 'hooksgraph' )
				);
			}

			if ( ! function_exists( 'WP_Filesystem' ) ) {
				require_once ABSPATH . 'wp-admin/includes/file.php';
			}
			if ( ! \WP_Filesystem() ) {
				return new \WP_Error(
					'hooksgraph_filesystem_unavailable',
					__( 'Unable to initialise WP_Filesystem.', 'hooksgraph' )
				);
			}
			global $wp_filesystem;
			if ( ! $wp_filesystem || ! $wp_filesystem->is_readable( $full ) ) {
				return new \WP_Error(
					'hooksgraph_file_unreadable',
					__( 'File exists but is not readable by WP_Filesystem.', 'hooksgraph' )
				);
			}

			$contents = $wp_filesystem->get_contents( $full );
			if ( false === $contents ) {
				return new \WP_Error(
					'hooksgraph_file_read_failed',
					__( 'WP_Filesystem could not read the file.', 'hooksgraph' )
				);
			}

			// Hard cap on returned size so a single tool call can't blow out
			// the model context. ~64KB of PHP is plenty for code review.
			$max_bytes = 65536;
			$truncated = false;

			$lines       = preg_split( '/\r\n|\r|\n/', $contents );
			$total_lines = is_array( $lines ) ? count( $lines ) : 0;

			$start = isset( $input['start_line'] ) ? max( 1, (int) $input['start_line'] ) : 1;
			$end   = isset( $input['end_line'] ) ? max( $start, (int) $input['end_line'] ) : $total_lines;
			$end   = min( $end, $total_lines );

			$slice = array_slice( $lines, $start - 1, $end - $start + 1 );
			$body  = implode( "\n", $slice );

			if ( strlen( $body ) > $max_bytes ) {
				$body      = substr( $body, 0, $max_bytes );
				$truncated = true;
			}

			return array(
				'plugin'      => $plugin,
				'file_path'   => $file_path,
				'start_line'  => $start,
				'end_line'    => $end,
				'total_lines' => $total_lines,
				'truncated'   => $truncated,
				'contents'    => $body,
			);
		},
		'permission_callback' => static fn (): bool => current_user_can( 'manage_options' ),
		'meta'                => array(
			'annotations' => array(
				'readonly'    => true,
				'destructive' => false,
				'idempotent'  => true,
			),
		),
	)
);
