<?php
/**
 * REST endpoint that powers the AI Assistant tab.
 *
 * Wraps WordPress 7.0's AI Client and the resolver allowlist around the
 * full set of `hooksgraph/*` abilities, runs the tool-call loop server
 * side, and returns the final assistant text together with a trace of
 * every tool invocation for the UI to render.
 *
 * Prior turns are injected as a contextual prefix on the system
 * instruction rather than re-constructed as Message DTOs — that keeps the
 * controller resilient to provider/SDK shape drift and avoids replaying
 * stale function-call/response pairs to the model.
 */

declare(strict_types=1);

namespace HooksGraph\Plugin;

use WordPress\AiClient\Messages\DTO\MessagePart;
use WordPress\AiClient\Messages\DTO\UserMessage;
use WP_AI_Client_Ability_Function_Resolver;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

final class Ai_Chat_Controller {

	/**
	 * Every hooksgraph ability is read-only — safe to expose to the model
	 * with no further gating beyond the resolver's allowlist + each
	 * ability's `manage_options` permission callback.
	 */
	private const ABILITIES = [
		'hooksgraph/list-codebases',
		'hooksgraph/find-hook',
		'hooksgraph/listeners-of',
		'hooksgraph/firers-of',
		'hooksgraph/hooks-in-file',
		'hooksgraph/search-callbacks',
		'hooksgraph/hotspots',
		'hooksgraph/shared-hooks',
		'hooksgraph/compare-hook',
		'hooksgraph/filter-priority-conflicts',
	];

	/**
	 * Hard safety cap so a pathological loop can't run forever. The UI
	 * lets the user cancel mid-flight via AbortController, so under
	 * normal operation we'll either return cleanly (model produced
	 * text) or be aborted long before hitting this number.
	 */
	private const MAX_ITERATIONS = 40;

	public function register(): void {
		add_action( 'rest_api_init', [ $this, 'register_routes' ] );
	}

	public function register_routes(): void {
		register_rest_route(
			Rest_Controller::NAMESPACE,
			'/ai-chat',
			[
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => static fn (): bool => current_user_can( 'manage_options' ),
				'args'                => [
					'message' => [
						'required' => true,
						'type'     => 'string',
					],
					'history' => [
						'required' => false,
						'type'     => 'array',
						'default'  => [],
					],
				],
				'callback'            => [ $this, 'chat' ],
			]
		);

		register_rest_route(
			Rest_Controller::NAMESPACE,
			'/ai-chat/status',
			[
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => static fn (): bool => current_user_can( 'manage_options' ),
				'callback'            => [ $this, 'status' ],
			]
		);
	}

	public function status(): WP_REST_Response {
		return new WP_REST_Response(
			[
				'available' => function_exists( 'wp_ai_client_prompt' ) && function_exists( 'wp_supports_ai' ) && \wp_supports_ai(),
				'abilities' => self::ABILITIES,
			],
			200
		);
	}

	public function chat( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		if ( ! function_exists( 'wp_ai_client_prompt' ) || ! class_exists( WP_AI_Client_Ability_Function_Resolver::class ) ) {
			return new WP_Error(
				'hooksgraph_ai_unavailable',
				__( 'The WordPress AI Client is not available on this site. Requires WordPress 7.0+.', 'hooksgraph' ),
				[ 'status' => 501 ]
			);
		}

		$message = trim( (string) $request->get_param( 'message' ) );
		if ( '' === $message ) {
			return new WP_Error(
				'hooksgraph_ai_empty',
				__( 'Message cannot be empty.', 'hooksgraph' ),
				[ 'status' => 400 ]
			);
		}

		$history = (array) $request->get_param( 'history' );
		$system  = $this->build_system_instruction( $history );

		$resolver = new WP_AI_Client_Ability_Function_Resolver( ...self::ABILITIES );
		$tool_log = [];

		// The PromptBuilder treats a `list<Message>` argument as the full
		// conversation, so we always pass the running message list — that
		// avoids the "first message must be from a user role" error that
		// `with_history()` produces by prepending the assistant turn in
		// front of a fresh user message.
		$messages = [ new UserMessage( [ new MessagePart( $message ) ] ) ];

		// Each provider round-trip can legitimately take 10–20s; a 15-iteration
		// agent loop blows past PHP's default 30s execution limit. Reset the
		// per-request budget to 60s before each generation so a stuck provider
		// or pathological loop still terminates, but a normal multi-step
		// answer has room to complete.
		$this->extend_time_limit();

		$result = $this->generate( $messages, $system );
		if ( is_wp_error( $result ) ) {
			return $this->wrap_error( $result );
		}

		for ( $i = 0; $i < self::MAX_ITERATIONS; $i++ ) {
			$assistant_message = $result->toMessage();
			$messages[]        = $assistant_message;

			if ( ! $resolver->has_ability_calls( $assistant_message ) ) {
				return new WP_REST_Response(
					[
						'reply'      => $this->message_to_text( $result ),
						'tool_calls' => $tool_log,
						'iterations' => $i,
					],
					200
				);
			}

			$this->capture_tool_calls( $assistant_message, $tool_log );

			$tool_response = $resolver->execute_abilities( $assistant_message );
			$this->capture_tool_responses( $tool_response, $tool_log );
			// OpenAI-compatible providers require one message per function
			// response (each becomes its own `role: tool` entry). The
			// resolver groups them into a single UserMessage with N parts,
			// which throws "The API only allows a single function response,
			// as the only content of the message." — so we split here.
			foreach ( $this->split_function_responses( $tool_response ) as $split ) {
				$messages[] = $split;
			}

			$this->extend_time_limit();
			$result = $this->generate( $messages, $system );
			if ( is_wp_error( $result ) ) {
				return $this->wrap_error( $result );
			}
		}

		// Out of tool-call budget — force one final turn without any tools
		// declared so the model has no choice but to produce a text answer
		// from whatever it has already gathered. Cheaper UX than surfacing
		// an error and asking the user to retry.
		$this->extend_time_limit();
		$messages[] = new UserMessage(
			[
				new MessagePart(
					'You have reached your tool-call limit. Do not call any more tools. '
					. 'Produce a final answer in Markdown using only the information already '
					. 'gathered above. If the data is incomplete, say so briefly and summarize '
					. 'the partial findings.'
				),
			]
		);
		$result = \wp_ai_client_prompt( $messages )
			->using_system_instruction( $system )
			->using_max_tokens( 2048 )
			->generate_text_result();

		if ( is_wp_error( $result ) ) {
			return $this->wrap_error( $result );
		}

		return new WP_REST_Response(
			[
				'reply'      => $this->message_to_text( $result ),
				'tool_calls' => $tool_log,
				'iterations' => self::MAX_ITERATIONS,
				'truncated'  => true,
			],
			200
		);
	}

	/**
	 * Split a multi-part function-response message into one message per
	 * FunctionResponse part. Non-function-response parts are kept together
	 * in a trailing message — in practice the resolver only emits
	 * function-response parts, so the trailing message is usually empty
	 * and discarded.
	 *
	 * @return list<\WordPress\AiClient\Messages\DTO\Message>
	 */
	private function split_function_responses( $tool_response ): array {
		if ( ! is_object( $tool_response ) || ! method_exists( $tool_response, 'getParts' ) ) {
			return [ $tool_response ];
		}
		$out = [];
		foreach ( $tool_response->getParts() as $part ) {
			if ( ! is_object( $part ) || ! method_exists( $part, 'getFunctionResponse' ) ) {
				continue;
			}
			// `getFunctionResponse()` returns null for non-function-response
			// parts. `getType()->isFunctionResponse()` is implemented via
			// AbstractEnum::__call and therefore invisible to
			// `method_exists`, so we can't gate on it — checking the
			// payload directly is both safer and more robust.
			if ( $part->getFunctionResponse() instanceof \WordPress\AiClient\Tools\DTO\FunctionResponse ) {
				$out[] = new UserMessage( [ $part ] );
			}
		}
		return $out;
	}

	/**
	 * Reset PHP's execution-time budget for the upcoming provider call.
	 * Each call resets the timer rather than disabling it outright so a
	 * genuinely stuck request still fails within ~60s instead of holding
	 * the worker open indefinitely.
	 */
	private function extend_time_limit(): void {
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 60 );
		}
	}

	/**
	 * @param list<\WordPress\AiClient\Messages\DTO\Message> $messages
	 */
	private function generate( array $messages, string $system ) {
		return \wp_ai_client_prompt( $messages )
			->using_system_instruction( $system )
			->using_abilities( ...self::ABILITIES )
			->using_max_tokens( 2048 )
			->generate_text_result();
	}

	private function build_system_instruction( array $history ): string {
		$base = "You are the HooksGraph assistant — an expert on WordPress hooks (actions and filters) for this site's installed plugins.\n"
			. "Use the provided tools to look up real data. Never invent hook names, file paths, or plugin keys: call `hooksgraph/list-codebases` first if you don't yet know what is available.\n"
			. "Cite the codebase, file, line, callback, and priority when discussing listeners or firers.\n"
			. "Format every reply in GitHub-flavored Markdown:\n"
			. "- Use backticks for hook names, plugin keys, file paths, callbacks, and any other identifier.\n"
			. "- Use fenced code blocks (with a language tag when possible) for code, JSON, or file excerpts.\n"
			. "- Use compact bullet lists or tables when returning tool data, not prose paragraphs.\n"
			. "- Keep answers short. Lead with the result, then explain only if needed.\n"
			. "- Do not output raw HTML.\n"
			. "If a tool returns an error, read it carefully and either retry with corrected args or explain the limitation to the user.";

		if ( empty( $history ) ) {
			return $base;
		}

		$lines = [];
		foreach ( $history as $turn ) {
			if ( ! is_array( $turn ) ) {
				continue;
			}
			$role = ( $turn['role'] ?? '' ) === 'assistant' ? 'Assistant' : 'User';
			$content = trim( (string) ( $turn['content'] ?? '' ) );
			if ( '' === $content ) {
				continue;
			}
			$lines[] = $role . ': ' . $content;
		}

		if ( empty( $lines ) ) {
			return $base;
		}

		return $base . "\n\nPrior conversation (for context):\n" . implode( "\n", $lines );
	}

	/**
	 * @param object $result GenerativeAiResult
	 */
	private function message_to_text( $result ): string {
		if ( is_object( $result ) && method_exists( $result, 'toText' ) ) {
			return (string) $result->toText();
		}
		// Fallback: walk the message parts for text.
		$message = is_object( $result ) && method_exists( $result, 'toMessage' ) ? $result->toMessage() : null;
		return $this->extract_text( $message );
	}

	private function extract_text( $message ): string {
		if ( ! is_object( $message ) || ! method_exists( $message, 'getParts' ) ) {
			return '';
		}
		$out = '';
		foreach ( $message->getParts() as $part ) {
			if ( is_object( $part ) && method_exists( $part, 'getText' ) ) {
				$out .= $part->getText();
			}
		}
		return $out;
	}

	private function capture_tool_calls( $assistant_message, array &$log ): void {
		if ( ! is_object( $assistant_message ) || ! method_exists( $assistant_message, 'getParts' ) ) {
			return;
		}
		foreach ( $assistant_message->getParts() as $part ) {
			if ( ! is_object( $part ) || ! method_exists( $part, 'getFunctionCall' ) ) {
				continue;
			}
			$call = $part->getFunctionCall();
			if ( ! is_object( $call ) ) {
				continue;
			}
			$mangled = method_exists( $call, 'getName' ) ? (string) $call->getName() : '';
			$args    = method_exists( $call, 'getArgs' ) ? $call->getArgs() : null;
			$id      = method_exists( $call, 'getId' ) ? (string) $call->getId() : '';
			$log[]   = [
				'id'      => $id,
				'ability' => $this->unmangle( $mangled ),
				'args'    => $args,
				'result'  => null,
			];
		}
	}

	private function capture_tool_responses( $tool_response_message, array &$log ): void {
		if ( ! is_object( $tool_response_message ) || ! method_exists( $tool_response_message, 'getParts' ) ) {
			return;
		}
		foreach ( $tool_response_message->getParts() as $part ) {
			if ( ! is_object( $part ) || ! method_exists( $part, 'getFunctionResponse' ) ) {
				continue;
			}
			$resp = $part->getFunctionResponse();
			if ( ! is_object( $resp ) ) {
				continue;
			}
			$id      = method_exists( $resp, 'getId' ) ? (string) $resp->getId() : '';
			$payload = method_exists( $resp, 'getResponse' ) ? $resp->getResponse() : null;

			// Match back to the call entry by id (function-name fallback if no id).
			$matched = false;
			foreach ( $log as $i => $entry ) {
				if ( $entry['id'] === $id && null === $entry['result'] ) {
					$log[ $i ]['result'] = $this->summarize_payload( $payload );
					$matched             = true;
					break;
				}
			}
			if ( ! $matched ) {
				$log[] = [
					'id'      => $id,
					'ability' => null,
					'args'    => null,
					'result'  => $this->summarize_payload( $payload ),
				];
			}
		}
	}

	private function unmangle( string $mangled ): string {
		if ( str_starts_with( $mangled, 'wpab__' ) ) {
			$tail = substr( $mangled, 6 );
			// Last `__` separates namespace from name.
			$pos = strrpos( $tail, '__' );
			if ( false !== $pos ) {
				return substr( $tail, 0, $pos ) . '/' . substr( $tail, $pos + 2 );
			}
			return $tail;
		}
		return $mangled;
	}

	/**
	 * Keep payloads small in the trace so the UI doesn't drown in JSON.
	 */
	private function summarize_payload( $payload ): mixed {
		if ( is_array( $payload ) && isset( $payload['error'] ) ) {
			return [
				'error' => $payload['error'],
				'code'  => $payload['code'] ?? null,
			];
		}
		if ( is_array( $payload ) && isset( $payload['results'] ) && is_array( $payload['results'] ) ) {
			return [
				'total'    => $payload['total'] ?? count( $payload['results'] ),
				'has_more' => $payload['has_more'] ?? false,
				'preview'  => array_slice( $payload['results'], 0, 3 ),
			];
		}
		if ( is_array( $payload ) ) {
			// Indexed list — show first 3.
			if ( array_is_list( $payload ) ) {
				return [
					'count'   => count( $payload ),
					'preview' => array_slice( $payload, 0, 3 ),
				];
			}
		}
		return $payload;
	}

	private function wrap_error( WP_Error $error ): WP_Error {
		$data = $error->get_error_data();
		$status = is_array( $data ) && isset( $data['status'] ) ? (int) $data['status'] : 500;
		return new WP_Error(
			$error->get_error_code(),
			$error->get_error_message(),
			[ 'status' => $status ]
		);
	}
}
