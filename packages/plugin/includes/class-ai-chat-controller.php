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
	 * Read-only graph abilities — always available to the model. Filesystem
	 * access (`hooksgraph/read-file`) is gated separately by the
	 * `allow_read_files` setting and appended at request time via
	 * {@see self::abilities()}.
	 */
	private const GRAPH_ABILITIES = [
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

	public function __construct( private Settings $settings ) {}

	/**
	 * Build the per-request ability allowlist. `hooksgraph/read-file` is only
	 * included when the admin has opted in via Settings, so a disabled
	 * setting means the tool is invisible to the model — no enforcement at
	 * call time required.
	 *
	 * @return list<string>
	 */
	private function abilities(): array {
		$abilities = self::GRAPH_ABILITIES;
		if ( $this->settings->get( 'allow_read_files' ) ) {
			$abilities[] = 'hooksgraph/read-file';
		}
		return $abilities;
	}

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
				'abilities' => $this->abilities(),
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

		$history   = (array) $request->get_param( 'history' );
		$abilities = $this->abilities();
		$system    = $this->build_system_instruction( $history, $abilities );

		$resolver = new WP_AI_Client_Ability_Function_Resolver( ...$abilities );
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

		$result = $this->generate( $messages, $system, $abilities );
		if ( is_wp_error( $result ) ) {
			return $this->wrap_error( $result );
		}

		for ( $i = 0; $i < self::MAX_ITERATIONS; $i++ ) {
			$assistant_message = $result->toMessage();
			$messages[]        = $assistant_message;

			if ( ! $resolver->has_ability_calls( $assistant_message ) ) {
				// Some providers occasionally emit a "Let me pull X..." intent
				// statement and then stop without actually calling a tool.
				// Detect that pattern and nudge the model to follow through
				// instead of treating it as a final answer — the user sees a
				// continuous "thinking" state while the loop carries on.
				$reply = $this->message_to_text( $result );
				if ( $this->looks_like_unfinished_intent( $reply ) ) {
					$messages[] = new UserMessage(
						[
							new MessagePart(
								'You announced an action but did not call any tool. '
								. 'Make the tool call(s) you described now, in this turn. '
								. 'Do not narrate intent without acting on it.'
							),
						]
					);
					$this->extend_time_limit();
					$result = $this->generate( $messages, $system, $abilities );
					if ( is_wp_error( $result ) ) {
						return $this->wrap_error( $result );
					}
					continue;
				}

				return new WP_REST_Response(
					[
						'reply'      => $reply,
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
			$result = $this->generate( $messages, $system, $abilities );
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
			->using_max_tokens( 1024 )
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
	 * Heuristic for "the model announced a tool call but didn't make it."
	 * Looks for short, intent-like phrasing without a final answer marker.
	 * Conservative on purpose — false positives just cost one extra round
	 * trip; false negatives leave the user staring at a half-message.
	 */
	private function looks_like_unfinished_intent( string $reply ): bool {
		$trimmed = trim( $reply );
		if ( '' === $trimmed ) {
			// Pure tool-call turns sometimes come back with no text at all;
			// if there are no tool calls AND no text, the model has nothing
			// to say — push it to act.
			return true;
		}
		// Too long to be a pure intent statement — assume it's a real reply.
		if ( strlen( $trimmed ) > 400 ) {
			return false;
		}
		$lower = strtolower( $trimmed );
		// Trailing colon / ellipsis is a strong signal the model expected to
		// continue (with a tool call or a list) but stopped.
		if ( preg_match( '/[:\\.]{1,3}$/u', $trimmed ) && str_ends_with( $trimmed, ':' ) ) {
			return true;
		}
		$intent_phrases = [
			'let me ',
			"let's ",
			"i'll ",
			'i will ',
			'i am going to ',
			"i'm going to ",
			'going to ',
			'one moment',
			'one sec',
			'fetching ',
			'looking up',
			'pulling ',
			'checking ',
			'querying ',
			'gathering ',
			'about to ',
		];
		foreach ( $intent_phrases as $needle ) {
			if ( str_contains( $lower, $needle ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * @param list<\WordPress\AiClient\Messages\DTO\Message> $messages
	 * @param list<string>                                   $abilities
	 */
	private function generate( array $messages, string $system, array $abilities ) {
		return \wp_ai_client_prompt( $messages )
			->using_system_instruction( $system )
			->using_abilities( ...$abilities )
			->using_max_tokens( 1024 )
			->generate_text_result();
	}

	/**
	 * @param list<string> $abilities
	 */
	private function build_system_instruction( array $history, array $abilities ): string {
		$base = "You are the HooksGraph assistant — an expert on WordPress hooks (actions and filters) for this site's installed plugins.\n"
			. "Use the provided tools to look up real data. Never invent hook names, file paths, or plugin keys: call `hooksgraph/list-codebases` first if you don't yet know what is available.\n"
			. "Cite the codebase, file, line, callback, and priority when discussing listeners or firers.\n"
			. "NEVER announce a tool call without making it in the same turn. Do not write `Let me…`, `I'll check…`, `Pulling…`, `One moment…`, `Looking up…` or any similar intent statement on its own — either emit the actual tool call(s) immediately, or skip the narration entirely and just produce the call. If you need multiple tool calls to answer, emit them across consecutive turns; do not stall with a text-only acknowledgement.\n"
			. "Prefer the graph tools (`listeners-of`, `firers-of`, `hooks-in-file`, `search-callbacks`, `compare-hook`, `filter-priority-conflicts`, etc.) — they already carry the static-analysis metadata (`effects`, `targets`, `filter_behavior`, `called_apis`) you need for most questions.\n";

		// `read-file` is opt-in: the admin may have disabled it, in which case
		// the tool is not registered for this request. Only advertise it in
		// the system instruction when it's actually callable, so the model
		// doesn't try (and fail) to invoke a missing tool.
		if ( in_array( 'hooksgraph/read-file', $abilities, true ) ) {
			$base .= "When in doubt about a conflict, READ THE FILE. The graph data is a starting point, not a verdict. Whenever a conflict signal is not unambiguously clear from the graph data alone, you MUST call `hooksgraph/read-file` to inspect the actual callback bodies before drawing a conclusion. Treat the following as low-confidence and always escalate to reading the file:\n"
				. "- `filter_behavior.return_origin` of `conditional` (always — `conditional` means the static analyzer could not prove what the callback returns, never assume it is safe).\n"
				. "- `filter_behavior.return_origin` of `unknown`, `derived`, or `replaced` when the user is asking about correctness or potential conflicts.\n"
				. "- `targets[]` entries with `confidence: syntactic` (variable-rooted, type unknown) when the answer depends on what the variable resolves to.\n"
				. "- Two or more listeners sharing the same priority on the same hook, where you cannot tell from the metadata alone whether they actually clash.\n"
				. "- A listener has no `effects` / `targets` / `filter_behavior` keys at all (the analyzer could not see into the callback — e.g. a string callback or a cross-file method).\n"
				. "Pass the narrowest `start_line`/`end_line` window that covers the callback in question; never request the whole file when a range will do, and never call it for general curiosity or summarisation. If you confidently know from the graph data that there is no conflict (single listener, single firer, all metadata literal and unambiguous), you do not need to read the file.\n";
		} else {
			$base .= "You cannot read raw file contents — work entirely from the graph tools above. If a question genuinely requires inspecting source code that the graph doesn't expose, say so briefly and explain what additional access would be needed, rather than guessing.\n";
		}

		$base .= "Format every reply in GitHub-flavored Markdown:\n"
			. "- Use backticks for hook names, plugin keys, file paths, callbacks, and any other identifier.\n"
			. "- Use fenced code blocks (with a language tag when possible) for code, JSON, or file excerpts.\n"
			. "- Use compact bullet lists or tables when returning tool data, not prose paragraphs.\n"
			. "- Keep answers short. Lead with the result, then explain only if needed.\n"
			. "- Do not output raw HTML.\n"
			. "If a tool returns an error, read it carefully and either retry with corrected args or explain the limitation to the user.";

		if ( empty( $history ) ) {
			return $base;
		}

		// History caps:
		//  - Last 6 turns only (~3 user/assistant exchanges).
		//  - Each turn truncated to 600 chars.
		// Without these, by the third user message the system prompt carries
		// the full Markdown of every prior assistant turn — providers slow
		// down, the upstream gateway (Valet/nginx) times out at ~60s.
		$recent  = array_slice( $history, -6 );
		$max_len = 600;
		$lines   = [];
		foreach ( $recent as $turn ) {
			if ( ! is_array( $turn ) ) {
				continue;
			}
			$role    = ( $turn['role'] ?? '' ) === 'assistant' ? 'Assistant' : 'User';
			$content = trim( (string) ( $turn['content'] ?? '' ) );
			if ( '' === $content ) {
				continue;
			}
			if ( strlen( $content ) > $max_len ) {
				$content = substr( $content, 0, $max_len ) . '… [truncated]';
			}
			$lines[] = $role . ': ' . $content;
		}

		if ( empty( $lines ) ) {
			return $base;
		}

		return $base . "\n\nPrior conversation (for context, truncated):\n" . implode( "\n", $lines );
	}

	/**
	 * @param object $result GenerativeAiResult
	 */
	private function message_to_text( $result ): string {
		// `toText()` throws when the first candidate has no text part — common
		// on pure tool-call turns. Fall back to walking the parts ourselves
		// so the caller always gets a string (possibly empty) instead of an
		// uncaught exception bubbling up through the REST stack.
		if ( is_object( $result ) && method_exists( $result, 'toText' ) ) {
			try {
				return (string) $result->toText();
			} catch ( \Throwable $e ) { // phpcs:ignore Generic.CodeAnalysis.EmptyStatement
				// Fall through to part-walking.
			}
		}
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
