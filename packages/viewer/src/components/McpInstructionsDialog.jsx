import { Button, Dialog, Stack, Text } from '@wordpress/ui';

const REGISTER_COMMAND = `claude mcp add hooks-graph --scope user -- \\
  node /absolute/path/to/wp-hooks-graph/packages/mcp/bin/hooksgraph-mcp.js`;

const codeBlockStyle = {
  fontFamily: 'var(--wpds-typography-font-family-mono)',
  fontSize: 'var(--wpds-typography-font-size-sm)',
  lineHeight: 1.5,
  padding: 'var(--wpds-dimension-padding-md)',
  backgroundColor: 'var(--wpds-color-bg-surface-neutral-weak)',
  border: '1px solid var(--wpds-color-stroke-surface-neutral)',
  borderRadius: 'var(--wpds-border-radius-md)',
  whiteSpace: 'pre',
  overflowX: 'auto',
  margin: 0,
};

const inlineCodeStyle = {
  fontFamily: 'var(--wpds-typography-font-family-mono)',
  fontSize: '0.95em',
  padding: '0 0.25em',
  backgroundColor: 'var(--wpds-color-bg-surface-neutral-weak)',
  border: '1px solid var(--wpds-color-stroke-surface-neutral)',
  borderRadius: 'var(--wpds-border-radius-sm)',
};

const mutedStyle = { opacity: 0.7 };

export default function McpInstructionsDialog({ disabled = false }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        disabled={disabled}
        render={
          <Button variant="minimal" tone="neutral" className="sidebar__mcp-btn">
            MCP Instructions
          </Button>
        }
      />
      <Dialog.Popup size="medium">
        <Dialog.Header>
          <Dialog.Title>MCP Instructions</Dialog.Title>
          <Dialog.CloseIcon />
        </Dialog.Header>
        <Stack direction="column" gap="lg">
          <Text>
            Expose every codebase parsed via{' '}
            <code style={inlineCodeStyle}>hooksgraph parse-codebase</code> (which writes to{' '}
            <code style={inlineCodeStyle}>~/.hooksgraph/codebases/</code>) to Claude Code as a
            local MCP server — so agents can query the graph without loading JSON into context.
          </Text>
          <Stack direction="column" gap="xs">
            <Text variant="heading-sm">1. Register with Claude Code</Text>
            <Text variant="body-sm" style={mutedStyle}>
              Replace the path with the absolute path to this repo on your machine. The server
              reads <code style={inlineCodeStyle}>~/.hooksgraph/codebases/</code> by default;
              override with <code style={inlineCodeStyle}>--storage</code> or{' '}
              <code style={inlineCodeStyle}>$HOOKSGRAPH_CODEBASES_DIR</code>.
            </Text>
            <pre style={codeBlockStyle}>{REGISTER_COMMAND}</pre>
          </Stack>
          <Stack direction="column" gap="xs">
            <Text variant="heading-sm">2. Verify</Text>
            <Text variant="body-sm">
              Run <code style={inlineCodeStyle}>claude mcp list</code> — you should see{' '}
              <code style={inlineCodeStyle}>hooks-graph: ✓ Connected</code>.
            </Text>
          </Stack>
          <Text variant="body-sm" style={mutedStyle}>
            Re-run <code style={inlineCodeStyle}>hooksgraph parse-codebase</code> and the next MCP
            call picks up the new data — no restart needed.
          </Text>
        </Stack>
        <Dialog.Footer>
          <Dialog.Action render={<Button variant="primary" tone="accent" />}>Got it</Dialog.Action>
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
