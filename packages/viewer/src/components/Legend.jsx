import { useEffect, useState } from 'react';
import { ColorIndicator } from '@wordpress/components';
import { Text } from '@wordpress/ui';
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

  const hasOverlap = data.nodes.some((n) => n.type === 'hook' && n.overlap);

  return (
    <div
      className="legend"
      style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: 'calc(100vw - 32px)',
        background: 'var(--wpds-color-bg-surface-neutral-weak)',
        border: '1px solid var(--wpds-color-stroke-surface-neutral)',
        borderRadius: 'var(--wpds-border-radius-lg)',
        padding: 'var(--wpds-dimension-padding-sm) var(--wpds-dimension-padding-md)',
        fontSize: 'var(--wpds-typography-font-size-xs)',
        zIndex: 5,
        opacity: visible ? 1 : 0,
        transition: 'opacity 400ms ease',
        display: 'grid',
        gridTemplateColumns: 'auto repeat(4, auto)',
        columnGap: 'var(--wpds-dimension-gap-md)',
        rowGap: 'var(--wpds-dimension-gap-xs)',
        alignItems: 'center',
      }}
    >
      <span />
      <HeaderCell>action</HeaderCell>
      <HeaderCell>filter</HeaderCell>
      <HeaderCell>fires</HeaderCell>
      <HeaderCell>listens</HeaderCell>

      {sourceLabels.map((label) => {
        const palette = repoPalettes[label];
        return (
          <Row
            key={label}
            label={label}
            actionColor={palette.action}
            filterColor={palette.filter}
            fireColor={palette.fireEdge}
            listenColor={palette.listenEdge}
          />
        );
      })}

      {hasOverlap && (
        <>
          <Text variant="muted" style={{ fontSize: 'inherit' }}>
            overlap
          </Text>
          <SwatchCell>
            <ColorIndicator colorValue={OVERLAP_ACTION} />
          </SwatchCell>
          <SwatchCell>
            <ColorIndicator colorValue={OVERLAP_FILTER} />
          </SwatchCell>
          <span />
          <span />
        </>
      )}
    </div>
  );
}

function HeaderCell({ children }) {
  return (
    <Text variant="muted" style={{ fontSize: 'inherit', textAlign: 'center' }}>
      {children}
    </Text>
  );
}

function Row({ label, actionColor, filterColor, fireColor, listenColor }) {
  return (
    <>
      <Text style={{ fontSize: 'inherit' }}>{label}</Text>
      <SwatchCell>
        <ColorIndicator colorValue={actionColor} />
      </SwatchCell>
      <SwatchCell>
        <ColorIndicator colorValue={filterColor} />
      </SwatchCell>
      <SwatchCell>
        <CurveSwatch color={fireColor} direction="fires" />
      </SwatchCell>
      <SwatchCell>
        <CurveSwatch color={listenColor} direction="listens" />
      </SwatchCell>
    </>
  );
}

function SwatchCell({ children }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--wpds-dimension-gap-xs)',
        justifyContent: 'center',
      }}
    >
      {children}
    </span>
  );
}

// Inline SVG that mirrors how sigma's curvedArrow program draws edges:
// fires arc above the source→target axis, listens arc below. Arrowhead at
// the target end. Single stroke, current per-source color.
function CurveSwatch({ color, direction }) {
  const apexY = direction === 'fires' ? 4 : 14;
  return (
    <svg width="32" height="14" viewBox="0 0 32 18" aria-hidden="true">
      <path
        d={`M 2 9 Q 16 ${apexY} 28 9`}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M 25 6 L 28 9 L 25 12"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
