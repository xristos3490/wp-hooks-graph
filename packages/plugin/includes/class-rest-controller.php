<?php
/**
 * Custom REST routes for the HooksGraph plugin.
 *
 * Owns its own namespace rather than extending `/wp/v2/plugins` — keeps the
 * plugin's data surface scoped to consumers that opt in, and makes the
 * permission story trivial to audit (every route below requires
 * `manage_options`).
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

use WordPress\AiClient\Messages\DTO\MessagePart;
use WordPress\AiClient\Messages\DTO\UserMessage;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

final class Rest_Controller {

	public const NAMESPACE = 'hooksgraph/v1';

	public function __construct(
		private Storage $storage,
		private Cron $cron
	) {}

	public function register(): void {
		add_action( 'rest_api_init', [ $this, 'register_routes' ] );
	}

	public function register_routes(): void {
		$auth = static fn (): bool => current_user_can( 'manage_options' );

		register_rest_route(
			self::NAMESPACE,
			'/parse-status',
			[
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $auth,
				'callback'            => [ $this, 'list_status' ],
			]
		);

		register_rest_route(
			self::NAMESPACE,
			'/parse-download',
			[
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $auth,
				'args'                => [
					'plugin' => [
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => [ $this, 'sanitize_plugin' ],
					],
				],
				'callback'            => [ $this, 'download_parse' ],
			]
		);

		register_rest_route(
			self::NAMESPACE,
			'/ai/list-codebases',
			[
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $auth,
				'callback'            => [ $this, 'ai_list_codebases' ],
			]
		);

		register_rest_route(
			self::NAMESPACE,
			'/parse-plugin',
			[
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $auth,
				'args'                => [
					'plugin'  => [
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => [ $this, 'sanitize_plugin' ],
					],
					'exclude' => [
						'required'          => false,
						'type'              => 'array',
						'default'           => [],
						'items'             => [ 'type' => 'string' ],
						'sanitize_callback' => [ $this, 'sanitize_exclude' ],
					],
				],
				'callback'            => [ $this, 'schedule_parse' ],
			]
		);
	}

	/**
	 * Normalize the exclude list: trim each entry, drop blanks, cap length.
	 *
	 * @param mixed $value
	 * @return list<string>
	 */
	public function sanitize_exclude( $value ): array {
		if ( is_string( $value ) ) {
			$value = explode( ',', $value );
		}
		if ( ! is_array( $value ) ) {
			return [];
		}
		$out = [];
		foreach ( $value as $item ) {
			if ( ! is_string( $item ) ) {
				continue;
			}
			$item = trim( $item );
			if ( '' === $item ) {
				continue;
			}
			$out[] = wp_substr( $item, 0, 255 );
		}
		return array_values( array_unique( $out ) );
	}

	public function sanitize_plugin( $value ): string {
		// Plugin keys look like `akismet/akismet` (no extension) or `hello`.
		// Allow alnum, dashes, underscores, dots and a single forward slash
		// segment — anything else is rejected outright.
		$value = is_string( $value ) ? $value : '';
		if ( ! preg_match( '#^[a-zA-Z0-9._-]+(?:/[a-zA-Z0-9._-]+)?$#', $value ) ) {
			return '';
		}
		return $value;
	}

	/**
	 * Return a `{ "<plugin-key>": { status, last_parsed_at, exclude } }` map
	 * for every active plugin.
	 *
	 * Status values: parsed | stale | needs_parsing | scheduled | failed.
	 */
	public function list_status( WP_REST_Request $request ): WP_REST_Response {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$active = (array) get_option( 'active_plugins', [] );
		$all    = get_plugins();

		$map = [];
		foreach ( $active as $file ) {
			if ( ! isset( $all[ $file ] ) ) {
				continue;
			}
			// Strip the trailing `.php` to match the form used elsewhere
			// (matches what core's plugin REST controller exposes as `plugin`).
			$key     = substr( $file, 0, -4 );
			$version = (string) ( $all[ $file ]['Version'] ?? '' );

			$last     = $this->storage->last_parsed_at( $key );
			$settings = $this->storage->get_settings( $key );
			$meta     = $this->storage->get_codebase_meta( $key );

			$failed_at = isset( $meta['failed_at'] ) ? (int) $meta['failed_at'] : null;
			// A failure is "current" only if it's newer than the last successful
			// parse on disk — otherwise a successful re-parse already resolved it.
			$has_recent_failure = null !== $failed_at && ( null === $last || $failed_at > $last );

			if ( $this->cron->is_scheduled( $key ) ) {
				$status = 'scheduled';
			} elseif ( $has_recent_failure ) {
				$status = 'failed';
			} else {
				$status = $this->storage->status_for( $key, $version );
			}

			$map[ $key ] = [
				'status'         => $status,
				'last_parsed_at' => null !== $last ? gmdate( 'c', $last ) : null,
				'exclude'        => $settings['exclude'],
				'total_files'    => isset( $meta['total_files'] ) ? (int) $meta['total_files'] : null,
				'total_hooks'    => isset( $meta['total_hooks'] ) ? (int) $meta['total_hooks'] : null,
				'total_edges'    => isset( $meta['total_edges'] ) ? (int) $meta['total_edges'] : null,
				'dynamic_hooks'  => isset( $meta['dynamic_hooks'] ) ? (int) $meta['dynamic_hooks'] : null,
				'failed_at'      => $has_recent_failure ? gmdate( 'c', $failed_at ) : null,
				'failed_error'   => $has_recent_failure && isset( $meta['failed_error'] ) ? (string) $meta['failed_error'] : null,
			];
		}

		return new WP_REST_Response( $map, 200 );
	}

	/**
	 * Stream the most recent parsed JSON for `$plugin` as an attachment.
	 *
	 * Bypasses the REST serializer via `rest_pre_serve_request` so the file is
	 * sent byte-for-byte rather than re-encoded.
	 */
	public function download_parse( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$plugin = (string) $request->get_param( 'plugin' );
		if ( '' === $plugin ) {
			return new WP_Error( 'hooksgraph_invalid_plugin', __( 'Invalid plugin identifier.', 'hooksgraph' ), [ 'status' => 400 ] );
		}

		$slug    = $this->storage->slug( $plugin );
		$matches = glob( $this->storage->dir() . '/' . $slug . '-*.json' ) ?: [];
		if ( ! $matches ) {
			return new WP_Error( 'hooksgraph_not_parsed', __( 'No parsed graph found for this plugin.', 'hooksgraph' ), [ 'status' => 404 ] );
		}

		// Prefer the newest file on disk — handles both `parsed` (current version)
		// and `stale` (older version) cases without the caller needing to know which.
		usort( $matches, static fn ( string $a, string $b ): int => ( (int) @filemtime( $b ) ) <=> ( (int) @filemtime( $a ) ) );
		$file = $matches[0];

		if ( ! is_readable( $file ) ) {
			return new WP_Error( 'hooksgraph_read_failed', __( 'Could not read the parsed graph.', 'hooksgraph' ), [ 'status' => 500 ] );
		}

		$filename = basename( $file );
		$size     = (int) @filesize( $file );

		add_filter(
			'rest_pre_serve_request',
			static function ( bool $served, $result, WP_REST_Request $req ) use ( $file, $filename, $size ): bool {
				if ( $served || $req->get_route() !== '/' . self::NAMESPACE . '/parse-download' ) {
					return $served;
				}
				if ( ! headers_sent() ) {
					header( 'Content-Type: application/json; charset=utf-8' );
					header( 'Content-Disposition: attachment; filename="' . $filename . '"' );
					if ( $size > 0 ) {
						header( 'Content-Length: ' . $size );
					}
					nocache_headers();
				}
				readfile( $file );
				return true;
			},
			10,
			3
		);

		// Returned response is consumed only if the filter above is bypassed
		// (e.g., headers already sent). Body is a no-op marker.
		$response = new WP_REST_Response( null, 200 );
		$response->header( 'Content-Disposition', 'attachment; filename="' . $filename . '"' );
		return $response;
	}

	/**
	 * Run a single-turn AI Client loop scoped to the `hooksgraph/list-codebases`
	 * ability and return the model's final text answer.
	 *
	 * Surfaces the WP 7.0 AI Client + Abilities API integration in the simplest
	 * possible form so the admin UI can demonstrate "ask the model what's
	 * parsed" without bespoke prompt plumbing.
	 */
	public function ai_list_codebases( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		if ( ! function_exists( 'wp_ai_client_prompt' ) ) {
			return new WP_Error(
				'hooksgraph_ai_unavailable',
				__( 'The WordPress AI Client is not available on this site. Requires WordPress 7.0+.', 'hooksgraph' ),
				[ 'status' => 501 ]
			);
		}

		// The AI Client defaults each provider HTTP call to 30s. A tool-call
		// loop compounds that across turns, and cold starts on aggregator
		// providers (e.g. OpenRouter) routinely brush the limit on a single
		// turn. Bump it for the duration of this request only.
		$timeout_filter = static fn (): int => 120;
		add_filter( 'wp_ai_client_default_request_timeout', $timeout_filter );

		$allowed  = [ 'hooksgraph/list-codebases' ];
		$resolver = new \WP_AI_Client_Ability_Function_Resolver( ...$allowed );
		$user_msg = __( 'List every plugin codebase available for hooksgraph querying on this site. For each, show the plugin key, version, status, and total parsed hooks.', 'hooksgraph' );
		$system   = __( 'You are an assistant inside a WordPress admin page. Use the hooksgraph tools to answer factual questions about parsed plugin codebases on this site. Always call the relevant tool — do not guess.', 'hooksgraph' );

		/**
		 * Filter the model preference list for hooksgraph AI features. Each
		 * entry can be a model id string (e.g. `'openai/gpt-4o-mini'`) or a
		 * `[provider_id, model_id]` tuple (e.g. `['openrouter', 'openai/gpt-4o-mini']`).
		 * Required for provider configurations (e.g. OpenRouter) that expose
		 * many models — the AI Client refuses to pick one when multiple
		 * advertise the text_generation + function_calling capability pair.
		 *
		 * Return an empty array to fall back to the AI Client's auto-pick.
		 *
		 * @param array<int, string|array{0:string,1:string}> $preferences
		 */
		$preferences = (array) apply_filters( 'hooksgraph_ai_model_preference', array( array( 'openrouter', 'anthropic/claude-sonnet-4.5' ) ) );

		$build = static function () use ( $user_msg, $system, $allowed, $preferences ) {
			$builder = wp_ai_client_prompt( $user_msg )
				->using_system_instruction( $system )
				->using_abilities( ...$allowed );
			if ( ! empty( $preferences ) ) {
				$builder = $builder->using_model_preference( ...$preferences );
			}
			return $builder;
		};

		// Seed history with the user turn so `with_history()` (which prepends
		// onto the builder's messages) keeps a user-role message at index 0 on
		// follow-up iterations — otherwise the model's first response becomes
		// $history[0] and the AI Client rejects the prompt with
		// `prompt_invalid_argument`.
		$history = [ new UserMessage( [ new MessagePart( $user_msg ) ] ) ];
		$result  = $build()->generate_text_result();

		try {
			for ( $i = 0; $i < 5; $i++ ) {
				if ( is_wp_error( $result ) ) {
					return $result;
				}
				$assistant = $result->toMessage();
				$history[] = $assistant;
				if ( ! $resolver->has_ability_calls( $assistant ) ) {
					break;
				}
				$history[] = $resolver->execute_abilities( $assistant );
				$result    = $build()->with_history( ...$history )->generate_text_result();
			}
		} finally {
			remove_filter( 'wp_ai_client_default_request_timeout', $timeout_filter );
		}

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		// `toText()` throws when the final candidate has no text part (e.g.
		// iteration cap hit with the model still emitting tool calls). Collect
		// text parts manually so the response degrades to "" instead of a 500.
		$text = '';
		foreach ( $result->toMessage()->getParts() as $part ) {
			if ( $part->getType()->isText() ) {
				$text .= $part->getText();
			}
		}
		$iteration_capped = $resolver->has_ability_calls( $result->toMessage() );

		return new WP_REST_Response(
			[
				'text'             => $text,
				'iterations'       => $i,
				'iteration_capped' => $iteration_capped,
			],
			200
		);
	}

	public function schedule_parse( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$plugin = (string) $request->get_param( 'plugin' );
		if ( '' === $plugin ) {
			return new WP_Error( 'hooksgraph_invalid_plugin', __( 'Invalid plugin identifier.', 'hooksgraph' ), [ 'status' => 400 ] );
		}

		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$plugins = get_plugins();
		if ( ! isset( $plugins[ $plugin . '.php' ] ) ) {
			return new WP_Error( 'hooksgraph_unknown_plugin', __( 'Plugin not installed.', 'hooksgraph' ), [ 'status' => 404 ] );
		}

		$exclude = (array) $request->get_param( 'exclude' );
		$this->storage->save_settings( $plugin, $exclude );

		$result = $this->cron->schedule( $plugin );
		if ( Cron::SCHEDULE_FAILED === $result ) {
			return new WP_Error(
				'hooksgraph_schedule_failed',
				__( 'Failed to schedule parse.', 'hooksgraph' ),
				[ 'status' => 500 ]
			);
		}

		return new WP_REST_Response(
			[
				'plugin'    => $plugin,
				'scheduled' => true,
				'newly'     => Cron::SCHEDULE_NEW === $result,
				'exclude'   => $exclude,
			],
			202
		);
	}
}
