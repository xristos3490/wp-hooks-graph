import { useRef, useState, useCallback, useMemo } from 'react';
import { Button, EmptyState, Stack, Text, Badge } from '@wordpress/ui';
import Logo from './Logo';

// Hand-crafted constellations: each is a self-contained mini graph that drifts and
// pulses behind the foreground. Coordinates are in a 200x200 viewBox, so animations
// stay perfectly smooth at any zoom level (vector, GPU-composited transforms only).
const CONSTELLATIONS = [
  {
    id: 'c1',
    nodes: [
      [40, 60], [100, 30], [160, 70],
      [60, 130], [120, 110], [170, 150],
      [90, 175],
    ],
    edges: [
      [0, 1], [1, 2], [0, 3], [1, 4], [2, 5],
      [3, 4], [4, 5], [3, 6], [4, 6], [5, 6],
    ],
    style: {
      top: '-8%', right: '-10%',
      width: '52rem',
      opacity: 0.55,
      '--c-spin': '360s', '--c-drift': '38s',
      '--c-spin-dir': '1', '--c-drift-x': '24px', '--c-drift-y': '-18px',
    },
  },
  {
    id: 'c2',
    nodes: [
      [30, 100], [80, 50], [80, 150],
      [130, 30], [130, 100], [130, 170],
      [180, 60], [180, 140],
    ],
    edges: [
      [0, 1], [0, 2], [1, 3], [1, 4], [2, 4], [2, 5],
      [3, 6], [4, 6], [4, 7], [5, 7], [3, 4], [4, 5],
    ],
    style: {
      bottom: '-14%', left: '-8%',
      width: '46rem',
      opacity: 0.7,
      '--c-spin': '420s', '--c-drift': '46s',
      '--c-spin-dir': '-1', '--c-drift-x': '-20px', '--c-drift-y': '14px',
    },
  },
  {
    id: 'c3',
    nodes: [
      [50, 50], [150, 50], [100, 100],
      [50, 150], [150, 150],
    ],
    edges: [
      [0, 2], [1, 2], [3, 2], [4, 2], [0, 1], [3, 4], [0, 3], [1, 4],
    ],
    style: {
      top: '52%', left: '58%',
      width: '22rem',
      opacity: 0.45,
      '--c-spin': '300s', '--c-drift': '32s',
      '--c-spin-dir': '1', '--c-drift-x': '-14px', '--c-drift-y': '-10px',
    },
  },
  {
    id: 'c4',
    nodes: [
      [40, 40], [100, 70], [160, 40],
      [70, 130], [130, 130], [100, 175],
    ],
    edges: [
      [0, 1], [1, 2], [0, 3], [1, 3], [1, 4], [2, 4], [3, 4], [3, 5], [4, 5],
    ],
    style: {
      top: '8%', left: '-6%',
      width: '28rem',
      opacity: 0.4,
      '--c-spin': '500s', '--c-drift': '54s',
      '--c-spin-dir': '-1', '--c-drift-x': '18px', '--c-drift-y': '12px',
    },
  },
];

function Constellation({ nodes, edges, style }) {
  // Pre-compute edge length so dash animation length matches the actual line —
  // keeps the "signal" pulse consistent across edges of different lengths.
  const edgeData = useMemo(() => edges.map(([a, b]) => {
    const [x1, y1] = nodes[a];
    const [x2, y2] = nodes[b];
    const len = Math.hypot(x2 - x1, y2 - y1);
    return { x1, y1, x2, y2, len };
  }), [nodes, edges]);

  return (
    <div className="hp-constellation" style={style}>
      <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g className="hp-constellation__spin">
          <g className="hp-constellation__edges">
            {edgeData.map(({ x1, y1, x2, y2, len }, i) => (
              <line
                key={i}
                x1={x1} y1={y1} x2={x2} y2={y2}
                strokeDasharray={`6 ${Math.max(len - 6, 4)}`}
                style={{ animationDelay: `${(i * 0.7) % 5}s` }}
              />
            ))}
          </g>
          <g className="hp-constellation__nodes">
            {nodes.map(([cx, cy], i) => (
              <circle
                key={i}
                cx={cx} cy={cy} r="3.5"
                style={{ animationDelay: `${(i * 0.4) % 3}s` }}
              />
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}

export default function HomePage({ onFileLoad, isLoading }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  function handleChange(e) {
    const file = e.target.files[0];
    if (file) onFileLoad(file);
  }

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    dragCounter.current = 0;
    const file = e.dataTransfer.files[0];
    if (file) onFileLoad(file);
  }, [onFileLoad]);

  const description = isLoading
    ? 'Parsing your graph…'
    : dragging
      ? 'Release to load this graph'
      : 'Drag and drop a hooks JSON file, or browse to pick one.';

  return (
    <div
      className={[
        'home-page',
        dragging && 'home-page--dragging',
        isLoading && 'home-page--loading',
      ].filter(Boolean).join(' ')}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="hp-mesh" aria-hidden="true" />
      <div className="hp-field" aria-hidden="true">
        {CONSTELLATIONS.map((c) => <Constellation key={c.id} {...c} />)}
      </div>

      <main className="hp-hero">
        <Stack direction="column" align="center" gap="3xl">
          <EmptyState.Root>
            <EmptyState.Visual>
              <Logo showWordmark={false} />
            </EmptyState.Visual>
            <EmptyState.Title>Hooks Graph</EmptyState.Title>
            <EmptyState.Description>{description}</EmptyState.Description>
            <EmptyState.Actions>
              <Button
                variant="primary"
                tone="accent"
                onClick={() => inputRef.current?.click()}
                disabled={isLoading}
              >
                {isLoading ? 'Loading…' : 'Browse files'}
              </Button>
            </EmptyState.Actions>
          </EmptyState.Root>

          <Stack direction="row" align="center" gap="sm" className="hp-hint">
            <Badge tone="info">Tip</Badge>
            <Text variant="body-sm" tone="muted">
              Generate one with <code>hooksgraph parse &lt;dir&gt;</code>
            </Text>
          </Stack>
        </Stack>
      </main>

      <input
        ref={inputRef}
        type="file"
        accept=".json"
        onChange={handleChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}
