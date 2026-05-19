import apiFetch from '@wordpress/api-fetch';
import { Spinner } from '@wordpress/components';
import { useCallback, useEffect, useMemo, useRef, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { closeSmall } from '@wordpress/icons';
import { Badge, Button, IconButton, Notice, Stack, Text, Textarea } from '@wordpress/ui';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

const CHAT_PATH = '/hooksgraph/v1/ai-chat';
const STATUS_PATH = '/hooksgraph/v1/ai-chat/status';

// Locked-down sanitisation: inherit the GitHub-style schema and ensure links
// can't smuggle javascript: URLs or unsafe target/rel combos. react-markdown
// disables raw HTML by default; we keep that off.
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      ['target', 'href', 'title', 'rel'],
    ],
    code: [...(defaultSchema.attributes?.code ?? []), 'className'],
  },
};

const MARKDOWN_COMPONENTS = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
  // Strip the wrapping <p> when a single line of markdown is rendered inside
  // a tight bubble — keeps single-sentence replies on one line.
  p: ({ node, ...props }) => <p className="hooksgraph-chat__md-p" {...props} />,
  pre: ({ node, ...props }) => <pre className="hooksgraph-chat__md-pre" {...props} />,
  code: ({ node, inline, className, children, ...props }) => (
    <code className={`${className ?? ''} hooksgraph-chat__md-code`} {...props}>
      {children}
    </code>
  ),
  table: ({ node, ...props }) => (
    <div className="hooksgraph-chat__md-table-wrap">
      <table {...props} />
    </div>
  ),
};

function AssistantMarkdown({ source }) {
  return (
    <ReactMarkdown
      className="hooksgraph-chat__md"
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeSanitize, SANITIZE_SCHEMA]]}
      components={MARKDOWN_COMPONENTS}
    >
      {source}
    </ReactMarkdown>
  );
}

const SUGGESTIONS = [
  __('Which plugins do you have parsed graphs for?', 'hooksgraph'),
  __('What listens on `init`?', 'hooksgraph'),
  __('Find the busiest hooks across all codebases.', 'hooksgraph'),
  __('Are there any filter priority conflicts I should know about?', 'hooksgraph'),
];

function ToolCallEntry({ call }) {
  const [open, setOpen] = useState(false);
  const isError = call.result && typeof call.result === 'object' && call.result.error;

  return (
    <div className="hooksgraph-chat__tool">
      <Stack direction="row" align="center" gap="xs" className="hooksgraph-chat__tool-header">
        <Badge intent={isError ? 'error' : 'info'}>
          {isError ? __('error', 'hooksgraph') : __('tool', 'hooksgraph')}
        </Badge>
        <Text variant="muted" size="small">
          <code>{call.ability ?? __('unknown', 'hooksgraph')}</code>
        </Text>
        <Button
          variant="minimal"
          size="small"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
        >
          {open ? __('Hide', 'hooksgraph') : __('Details', 'hooksgraph')}
        </Button>
      </Stack>
      {open && (
        <pre className="hooksgraph-chat__tool-body">
{JSON.stringify({ args: call.args, result: call.result }, null, 2)}
        </pre>
      )}
    </div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div
      className={`hooksgraph-chat__bubble hooksgraph-chat__bubble--${isUser ? 'user' : 'assistant'}`}
    >
      <Stack direction="column" gap="xs">
        <Text variant="muted" size="small" className="hooksgraph-chat__role">
          {isUser ? __('You', 'hooksgraph') : __('Assistant', 'hooksgraph')}
        </Text>
        {message.content &&
          (isUser ? (
            <Text className="hooksgraph-chat__content">{message.content}</Text>
          ) : (
            <AssistantMarkdown source={message.content} />
          ))}
        {message.error && (
          <Notice.Root variant="error">
            <Notice.Description>{message.error}</Notice.Description>
          </Notice.Root>
        )}
        {message.truncated && (
          <Notice.Root variant="warning">
            <Notice.Description>
              {__(
                'Answered with partial data — the assistant hit its tool-call budget. Ask a follow-up to dig deeper.',
                'hooksgraph'
              )}
            </Notice.Description>
          </Notice.Root>
        )}
        {message.toolCalls?.length > 0 && (
          <Stack direction="column" gap="xs" className="hooksgraph-chat__tools">
            {message.toolCalls.map((call, idx) => (
              <ToolCallEntry key={`${call.id || call.ability || 'call'}-${idx}`} call={call} />
            ))}
          </Stack>
        )}
      </Stack>
    </div>
  );
}

export default function AiChatView() {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [availability, setAvailability] = useState({ state: 'loading', available: false });
  const scrollerRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    apiFetch({ path: STATUS_PATH })
      .then((response) =>
        setAvailability({
          state: 'ready',
          available: Boolean(response?.available),
          abilities: response?.abilities ?? [],
        })
      )
      .catch(() => setAvailability({ state: 'ready', available: false }));
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, sending]);

  const history = useMemo(
    () =>
      messages
        .filter((m) => m.role && m.content)
        .map((m) => ({ role: m.role, content: m.content })),
    [messages]
  );

  const send = useCallback(
    async (rawText) => {
      const text = (rawText ?? draft).trim();
      if (!text || sending) return;

      setMessages((prev) => [...prev, { role: 'user', content: text }]);
      setDraft('');
      setSending(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await apiFetch({
          path: CHAT_PATH,
          method: 'POST',
          data: { message: text, history },
          signal: controller.signal,
        });
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: response?.reply ?? '',
            toolCalls: response?.tool_calls ?? [],
            truncated: Boolean(response?.truncated),
          },
        ]);
      } catch (err) {
        // Distinguish a user-initiated cancellation from a real failure.
        const aborted =
          err?.name === 'AbortError' || controller.signal.aborted;
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: '',
            error: aborted
              ? __('Stopped by user.', 'hooksgraph')
              : err?.message ??
                __('The assistant could not complete this request.', 'hooksgraph'),
            toolCalls: err?.data?.tool_calls ?? [],
            cancelled: aborted,
          },
        ]);
      } finally {
        abortRef.current = null;
        setSending(false);
      }
    },
    [draft, history, sending]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const onKeyDown = useCallback(
    (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        send();
      }
    },
    [send]
  );

  const resetConversation = useCallback(() => {
    setMessages([]);
    setDraft('');
  }, []);

  if (availability.state === 'loading') {
    return (
      <Stack alignment="center" spacing={4} className="hooksgraph-chat__loading">
        <Spinner />
      </Stack>
    );
  }

  if (!availability.available) {
    return (
      <div className="hooksgraph-chat">
        <Notice.Root variant="warning">
          <Notice.Title>{__('AI Client not available', 'hooksgraph')}</Notice.Title>
          <Notice.Description>
            {__(
              'The WordPress AI Client API is required for this assistant. It ships in WordPress 7.0; on older releases or when the wp_supports_ai filter returns false the chat is disabled.',
              'hooksgraph'
            )}
          </Notice.Description>
        </Notice.Root>
      </div>
    );
  }

  return (
    <div className="hooksgraph-chat">
      <div className="hooksgraph-chat__scroller" ref={scrollerRef}>
        {messages.length === 0 ? (
          <Stack direction="column" gap="md" className="hooksgraph-chat__intro">
            <Text size="large" weight="strong">
              {__('Ask anything about your hooks', 'hooksgraph')}
            </Text>
            <Text variant="muted">
              {__(
                'The assistant can query parsed plugin graphs through 10 read-only tools — listeners, firers, hotspots, priority conflicts, callback search, and more.',
                'hooksgraph'
              )}
            </Text>
            <Stack direction="column" gap="xs" className="hooksgraph-chat__suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  tone="neutral"
                  onClick={() => send(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </Stack>
          </Stack>
        ) : (
          messages.map((message, idx) => (
            <MessageBubble key={idx} message={message} />
          ))
        )}
        {sending && (
          <div className="hooksgraph-chat__bubble hooksgraph-chat__bubble--assistant hooksgraph-chat__bubble--thinking">
            <Spinner />
            <Text variant="muted" size="small">
              {__('Thinking…', 'hooksgraph')}
            </Text>
          </div>
        )}
      </div>

      <div className="hooksgraph-chat__composer">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={__('Ask about a hook, a listener, a conflict…', 'hooksgraph')}
          rows={3}
          disabled={sending}
        />
        <Stack
          direction="row"
          justify="space-between"
          align="center"
          gap="sm"
          className="hooksgraph-chat__actions"
        >
          <Text variant="muted" size="small" className="hooksgraph-chat__hint">
            {__('⌘/Ctrl + Enter to send', 'hooksgraph')}
          </Text>
          <Stack direction="row" gap="xs" align="center">
            {messages.length > 0 && (
              <Button variant="minimal" tone="neutral" onClick={resetConversation} disabled={sending}>
                {__('New conversation', 'hooksgraph')}
              </Button>
            )}
            {sending ? (
              <IconButton
                variant="outline"
                tone="neutral"
                icon={closeSmall}
                label={__('Stop generating', 'hooksgraph')}
                onClick={stop}
              />
            ) : (
              <Button
                variant="solid"
                tone="brand"
                onClick={() => send()}
                disabled={draft.trim() === ''}
              >
                {__('Send', 'hooksgraph')}
              </Button>
            )}
          </Stack>
        </Stack>
      </div>
    </div>
  );
}
