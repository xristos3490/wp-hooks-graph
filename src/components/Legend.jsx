import { useEffect, useState } from 'react';
import { ColorIndicator } from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { useGraphContext } from '../context/GraphContext';
import { OVERLAP_ACTION, OVERLAP_FILTER } from '../lib/constants';

export default function Legend() {
  const { data, sourceLabels, repoPalettes } = useGraphContext();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(timer);
  }, []);

  if (!data) return null;

  const hookNodes = data.nodes.filter((n) => n.type === 'hook');
  const hasOverlap = hookNodes.some((n) => n.overlap);

  return (
    <div style={{
      position: 'absolute',
      bottom: 16,
      left: '50%',
      transform: 'translateX(-50%)',
      borderRadius: 'var(--wpds-border-radius-lg)',
      padding: 'var(--wpds-dimension-padding-sm) var(--wpds-dimension-padding-md)',
      fontSize: 'var(--wpds-typography-font-size-xs)',
      zIndex: 5,
      display: 'flex',
      gap: 'var(--wpds-dimension-gap-lg)',
      alignItems: 'center',
      opacity: visible ? 1 : 0,
      transition: 'opacity 400ms ease',
    }}>
      {/* Source dots */}
      {sourceLabels.map((label) => (
        <Stack key={label} direction="row" gap="xs" align="center">
          <ColorIndicator colorValue={repoPalettes[label].action} />
          <Text variant="body-sm" style={{ fontSize: 'inherit' }}>
            {label}
          </Text>
        </Stack>
      ))}

      <Separator />

      {/* Edge types */}
      <Stack direction="row" gap="xs" align="center">
        <span style={{
          display: 'inline-block',
          width: 22,
          borderTop: '2px solid currentColor',
          flexShrink: 0,
        }} />
        <Text variant="body-sm" style={{ fontSize: 'inherit' }}>fires</Text>
      </Stack>
      <Stack direction="row" gap="xs" align="center">
        <span style={{
          display: 'inline-block',
          width: 22,
          borderTop: '2px dashed currentColor',
          flexShrink: 0,
        }} />
        <Text variant="body-sm" style={{ fontSize: 'inherit' }}>listens</Text>
      </Stack>

      {/* Overlap dots */}
      {hasOverlap && (
        <>
          <Separator />
          <Stack direction="row" gap="xs" align="center">
            <ColorIndicator colorValue={OVERLAP_ACTION} />
            <Text variant="body-sm" style={{ fontSize: 'inherit' }}>
              overlap action
            </Text>
          </Stack>
          <Stack direction="row" gap="xs" align="center">
            <ColorIndicator colorValue={OVERLAP_FILTER} />
            <Text variant="body-sm" style={{ fontSize: 'inherit' }}>
              overlap filter
            </Text>
          </Stack>
        </>
      )}
    </div>
  );
}

function Separator() {
  return (
    <span style={{
      width: 1,
      height: 14,
      background: '#e0e0e0',
      flexShrink: 0,
    }} />
  );
}
