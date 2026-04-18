import { useEffect, useState } from 'react';
import {
  ColorIndicator,
  __experimentalHStack as HStack,
  __experimentalText as Text,
} from '@wordpress/components';
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
      fontSize: 'var(--wpds-font-size-xs)',
      zIndex: 5,
      display: 'flex',
      gap: 'var(--wpds-dimension-gap-lg)',
      alignItems: 'center',
      opacity: visible ? 1 : 0,
      transition: 'opacity 400ms ease',
    }}>
      {/* Source dots */}
      {sourceLabels.map((label) => (
        <HStack key={label} spacing={1} expanded={false} alignment="center">
          <ColorIndicator colorValue={repoPalettes[label].action} />
          <Text style={{ fontSize: 'inherit' }}>
            {label}
          </Text>
        </HStack>
      ))}

      <Separator />

      {/* Edge types */}
      <HStack spacing={1} expanded={false} alignment="center">
        <span style={{
          display: 'inline-block',
          width: 22,
          borderTop: '2px solid currentColor',
          flexShrink: 0,
        }} />
        <Text style={{ fontSize: 'inherit' }}>fires</Text>
      </HStack>
      <HStack spacing={1} expanded={false} alignment="center">
        <span style={{
          display: 'inline-block',
          width: 22,
          borderTop: '2px dashed currentColor',
          flexShrink: 0,
        }} />
        <Text style={{ fontSize: 'inherit' }}>listens</Text>
      </HStack>

      {/* Overlap dots */}
      {hasOverlap && (
        <>
          <Separator />
          <HStack spacing={1} expanded={false} alignment="center">
            <ColorIndicator colorValue={OVERLAP_ACTION} />
            <Text style={{ fontSize: 'inherit' }}>
              overlap action
            </Text>
          </HStack>
          <HStack spacing={1} expanded={false} alignment="center">
            <ColorIndicator colorValue={OVERLAP_FILTER} />
            <Text style={{ fontSize: 'inherit' }}>
              overlap filter
            </Text>
          </HStack>
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
