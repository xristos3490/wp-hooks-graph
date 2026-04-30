import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './HomePageBackground.css';

const CONFIG = {
  grid: {
    size: 8,
    tileWidth: 88,
    tileHeight: 44,
    cubeHeight: 34,
    floatHeight: 28,
    shadowInset: 0.62,
    nodeRatio: 0.22,
    minNodes: 10,
    minNodeDistance: 2,
  },
  routes: {
    count: 32,
    minLength: 3,
    waypointChance: 0.65,
    maxWaypoints: 2,
    floorOffset: 48.4,
  },
  particles: {
    initialCount: 7,
    maxActive: 14,
    spawnRatePerSecond: 1.2,
    baseStep: 0.18,
    releaseStep: 0.06,
    minSpeed: 0.8,
    maxSpeed: 1.4,
    radiusMin: 4.2,
    radiusMax: 5.4,
    stoppedRadiusBoost: 0.9,
    winThreshold: 5,
  },
  blocker: {
    radius: 26,
    floatHeight: 32,
  },
  confetti: {
    pieces: 28,
    angleJitter: 0.18,
    speedMin: 220,
    speedMax: 320,
    upwardBias: 80,
    gravity: 520,
    drag: 1.6,
    spinMin: -540,
    spinMax: 540,
    lifeMin: 1.4,
    lifeMax: 1.9,
    sizeMin: 5,
    sizeMax: 8,
    palette: ['#3858e9', '#f43f5e', '#fbbf24', '#34d399', '#8b5cf6', '#0ea5e9'],
  },
  colors: {
    background: '#f8fafc',
    gridFill: 'rgba(15,23,42,0.04)',
    missingTileFill: 'rgba(15,23,42,0.015)',
    gridStroke: 'rgba(15,23,42,0.08)',
    blockerFill: 'rgba(15,23,42,0.06)',
    blockerStroke: 'rgba(15,23,42,0.25)',
    // WPDS primary brand: --wpds-color-fg-interactive-brand
    particle: '#3858e9',
    cube: {
      left: '#e2e8f0',
      right: '#cbd5f5',
      front: '#cbd5e1',
      top: '#ffffff',
      stroke: 'rgba(15,23,42,0.18)',
    },
    // Brand-tinted shades derived from WPDS brand tokens.
    blueCube: {
      left: '#2337c8',  // --wpds-color-stroke-interactive-brand-active
      right: '#3858e9', // --wpds-color-fg-interactive-brand
      front: '#2e49d9', // --wpds-color-bg-interactive-brand-strong-active
      top: '#a3b1d4',   // --wpds-color-stroke-surface-brand
    },
  },
  stage: {
    y: 60,
    // Tight viewBox cropped to the actual iso scene bounds (≈ ±340 wide,
    // 0–400 tall after the stage translate). Eliminates the wide internal
    // padding the original component carried around the content.
    viewBox: '-360 -60 720 480',
  },
};

const TILE_MAP = [
  [1, 1, 1, 0, 1, 1, 1, 0],
  [1, 0, 1, 1, 1, 0, 1, 1],
  [1, 1, 1, 0, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 0, 1],
  [1, 1, 0, 1, 1, 1, 1, 1],
  [1, 0, 1, 1, 0, 1, 1, 0],
  [1, 1, 1, 1, 1, 1, 0, 1],
  [0, 1, 1, 0, 1, 1, 1, 1],
];

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (items) => {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
};
const keyOf = ({ x, y }) => `${x}:${y}`;
const sameTile = (a, b) => Boolean(a && b && a.x === b.x && a.y === b.y);
const tileDistance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function iso(x, y, z = 0) {
  return {
    x: (x - y) * (CONFIG.grid.tileWidth / 2),
    y: (x + y) * (CONFIG.grid.tileHeight / 2) - z,
  };
}

function tileCenter(tile, z = 0) {
  return iso(tile.x + 0.5, tile.y + 0.5, z);
}

function tileCorners(x, y, z = 0) {
  return [
    iso(x, y, z),
    iso(x + 1, y, z),
    iso(x + 1, y + 1, z),
    iso(x, y + 1, z),
  ];
}

function svgPoints(points) {
  return points.map(({ x, y }) => `${x},${y}`).join(' ');
}

const PLANE_TILES = TILE_MAP.flatMap((row, y) =>
  row.map((exists, x) => (exists ? { x, y } : null))
).filter(Boolean);

const WALKABLE = new Set(PLANE_TILES.map(keyOf));

const INNER_TILES = PLANE_TILES.filter(
  ({ x, y }) =>
    x > 0 &&
    y > 0 &&
    x < CONFIG.grid.size - 1 &&
    y < CONFIG.grid.size - 1
);

function getNeighbors(tile) {
  const candidates = [
    { x: tile.x + 1, y: tile.y },
    { x: tile.x - 1, y: tile.y },
    { x: tile.x, y: tile.y + 1 },
    { x: tile.x, y: tile.y - 1 },
  ];
  return candidates.filter((next) => WALKABLE.has(keyOf(next)));
}

function chooseSparseNodes(tiles) {
  const target = Math.max(
    CONFIG.grid.minNodes,
    Math.round(tiles.length * CONFIG.grid.nodeRatio)
  );
  const candidates = shuffle(tiles);
  const selected = [];

  for (const tile of candidates) {
    const farEnough = selected.every(
      (node) => tileDistance(tile, node) >= CONFIG.grid.minNodeDistance
    );
    if (farEnough) selected.push(tile);
    if (selected.length >= target) return selected;
  }

  // Fallback: if the distance rule is too strict, fill with best remaining tiles.
  for (const tile of candidates) {
    if (!selected.some((node) => sameTile(node, tile))) {
      selected.push(tile);
    }
    if (selected.length >= target) break;
  }

  return selected;
}

function bfsPath(start, end, { preferStraight = 0 } = {}) {
  const startKey = keyOf(start);
  const endKey = keyOf(end);

  const queue = [start];
  let cursor = 0;

  const visited = new Set([startKey]);
  const parent = new Map();
  const direction = new Map();

  while (cursor < queue.length) {
    const current = queue[cursor++];
    const currentKey = keyOf(current);

    if (currentKey === endKey) break;

    const prevDir = direction.get(currentKey);
    let neighbors = shuffle(getNeighbors(current));

    if (prevDir && preferStraight > 0) {
      neighbors.sort((a, b) => {
        const score = (tile) => {
          const dx = tile.x - current.x;
          const dy = tile.y - current.y;
          return dx === prevDir.x && dy === prevDir.y ? -preferStraight : 0;
        };
        return score(a) - score(b);
      });
    }

    for (const next of neighbors) {
      const nextKey = keyOf(next);
      if (visited.has(nextKey)) continue;

      visited.add(nextKey);
      parent.set(nextKey, current);
      direction.set(nextKey, {
        x: next.x - current.x,
        y: next.y - current.y,
      });
      queue.push(next);
    }
  }

  if (!visited.has(endKey)) return null;

  const path = [];
  let current = end;

  while (current) {
    path.unshift(current);
    if (sameTile(current, start)) break;
    current = parent.get(keyOf(current));
  }

  return path;
}

function createRoutePoints(path) {
  return path.map((tile) => tileCenter(tile, CONFIG.routes.floorOffset));
}

function createRoute(nodes, index) {
  const start = pick(nodes);
  if (!start) return null;

  const candidates = shuffle(
    nodes
      .filter((node) => !sameTile(node, start))
      .sort((a, b) => tileDistance(b, start) - tileDistance(a, start))
  );

  for (const end of candidates) {
    const segment = bfsPath(start, end, { preferStraight: 0.85 });
    if (segment && segment.length >= CONFIG.routes.minLength) {
      return {
        id: `route-${index}`,
        start,
        end,
        path: segment,
        points: createRoutePoints(segment),
      };
    }
  }

  return null;
}

function createRoutes(nodes) {
  const routes = [];
  const maxAttempts = CONFIG.routes.count * 8;

  for (
    let attempt = 0;
    routes.length < CONFIG.routes.count && attempt < maxAttempts;
    attempt += 1
  ) {
    const route = createRoute(nodes, routes.length);
    if (route) routes.push(route);
  }

  return routes;
}

function createScene() {
  const nodeSource = INNER_TILES.length ? INNER_TILES : PLANE_TILES;
  const nodes = chooseSparseNodes(nodeSource);
  const blueNode = nodes[0] ?? null;

  return {
    nodes,
    blueNode,
    routes: createRoutes(nodes),
  };
}

function samplePolyline(points, progress) {
  if (!points.length) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];

  const total = points.length - 1;
  // Clamp progress defensively. HMR / strict-mode re-runs can momentarily
  // hand us a stale or out-of-range value; an unguarded NaN here would index
  // points[NaN] = undefined and crash the whole tree.
  const safeProgress = Number.isFinite(progress)
    ? Math.max(0, Math.min(progress, 1))
    : 0;
  const scaled = safeProgress * total;
  const index = Math.max(0, Math.min(Math.floor(scaled), total - 1));
  const local = scaled - index;

  const a = points[index] ?? points[0];
  const b = points[index + 1] ?? points[points.length - 1];

  return {
    x: a.x + (b.x - a.x) * local,
    y: a.y + (b.y - a.y) * local,
  };
}

function isInsideBlocker(point, blocker) {
  if (!blocker) return false;
  return (
    Math.hypot(blocker.x - point.x, blocker.y - point.y) <=
    CONFIG.blocker.radius
  );
}

let particleId = 0;

function createParticle(routes) {
  if (!routes.length) return null;

  const id = `particle-${particleId++}`;

  return {
    id,
    routeIndex: Math.floor(Math.random() * routes.length),
    progress: 0,
    speed: rand(CONFIG.particles.minSpeed, CONFIG.particles.maxSpeed),
    radius: rand(CONFIG.particles.radiusMin, CONFIG.particles.radiusMax),
    stopped: false,
  };
}

function advanceParticle(particle, routes, blocker, deltaSeconds) {
  const route = routes[particle.routeIndex];

  if (!route) {
    return { ...particle, done: true };
  }

  const point = samplePolyline(route.points, particle.progress);

  if (isInsideBlocker(point, blocker)) {
    return { ...particle, stopped: true };
  }

  const step = particle.stopped
    ? CONFIG.particles.releaseStep
    : CONFIG.particles.baseStep;

  const progress = particle.progress + particle.speed * step * deltaSeconds;

  if (progress >= 1) {
    return {
      ...particle,
      progress: 1,
      stopped: false,
      done: true,
    };
  }

  return {
    ...particle,
    progress,
    stopped: false,
  };
}

const CubeTile = memo(function CubeTile({ tile, isBlue }) {
  if (!tile) return null;

  const z = CONFIG.grid.floatHeight + CONFIG.grid.cubeHeight * 0.6;
  const center = tileCenter(tile, z);
  const ground = tileCenter(tile, 0);

  const r = 10;
  const fill = isBlue ? CONFIG.colors.blueCube.right : '#ffffff';
  const stroke = isBlue ? CONFIG.colors.blueCube.left : '#cbd5e1';

  return (
    <g>
      <ellipse
        cx={ground.x}
        cy={ground.y}
        rx={r * 1.4}
        ry={r * 0.7}
        fill="rgba(15,23,42,0.12)"
        filter="url(#floatShadow)"
      />
      <line
        x1={ground.x}
        y1={ground.y}
        x2={center.x}
        y2={center.y}
        stroke="rgba(15,23,42,0.12)"
        strokeWidth={1}
        strokeDasharray="3 5"
      />
      <circle
        cx={center.x}
        cy={center.y}
        r={r}
        fill={fill}
        stroke={stroke}
        strokeWidth={2}
      />
      <circle
        cx={center.x}
        cy={center.y}
        r={r * 0.45}
        fill={isBlue ? '#dbeafe' : '#f1f5f9'}
      />
    </g>
  );
});

const GridLayer = memo(function GridLayer() {
  return (
    <>
      {Array.from({ length: CONFIG.grid.size }, (_, y) =>
        Array.from({ length: CONFIG.grid.size }, (_, x) => {
          const exists = Boolean(TILE_MAP[y]?.[x]);
          const corners = tileCorners(x, y, 0);

          return (
            <polygon
              key={`tile-${x}-${y}`}
              points={svgPoints(corners)}
              fill={exists ? '#f1f5f9' : 'transparent'}
              stroke="rgba(15,23,42,0.06)"
              strokeWidth="1"
            />
          );
        })
      )}
    </>
  );
});

const NodeLayer = memo(function NodeLayer({ nodes, blueNode }) {
  const sortedNodes = useMemo(
    () => nodes.slice().sort((a, b) => a.x + a.y - (b.x + b.y)),
    [nodes]
  );

  return (
    <>
      {sortedNodes.map((tile) => (
        <CubeTile
          key={`${tile.x}-${tile.y}`}
          tile={tile}
          isBlue={Boolean(blueNode && sameTile(tile, blueNode))}
        />
      ))}
    </>
  );
});

function RouteLayer({ routes }) {
  if (!routes || !routes.length) return null;
  return (
    <g>
      {routes.map((route) => {
        if (!route.points?.length) return null;

        return (
          <polyline
            key={route.id}
            points={svgPoints(route.points)}
            fill="none"
            stroke="#bfdbfe"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </g>
  );
}

function ParticleLayer({ routes, blocker, onAllStopped }) {
  const particlesRef = useRef([]);
  const blockerRef = useRef(blocker);
  const wasAllStoppedRef = useRef(false);
  const onAllStoppedRef = useRef(onAllStopped);
  const [, render] = useState(0);

  useEffect(() => {
    blockerRef.current = blocker;
  }, [blocker]);

  useEffect(() => {
    onAllStoppedRef.current = onAllStopped;
  }, [onAllStopped]);

  useEffect(() => {
    if (!routes.length) return undefined;

    particlesRef.current = Array.from(
      { length: Math.min(CONFIG.particles.initialCount, routes.length) },
      () => createParticle(routes)
    ).filter(Boolean);

    render((tick) => tick + 1);

    let frameId = 0;
    let spawnAccumulator = 0;
    let lastTime = performance.now();

    const loop = (now) => {
      const deltaSeconds = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      particlesRef.current = particlesRef.current
        .map((particle) =>
          advanceParticle(
            particle,
            routes,
            blockerRef.current,
            deltaSeconds
          )
        )
        .filter((particle) => !particle.done);

      spawnAccumulator += deltaSeconds * CONFIG.particles.spawnRatePerSecond;

      while (
        spawnAccumulator >= 1 &&
        particlesRef.current.length < CONFIG.particles.maxActive
      ) {
        spawnAccumulator -= 1;
        const particle = createParticle(routes);
        if (particle) particlesRef.current.push(particle);
      }

      // Hidden achievement: every active dot is currently frozen by the
      // blocker. Requires a non-trivial population so a single freshly-spawned
      // particle near the cursor doesn't trip it.
      const active = particlesRef.current;
      const allStopped =
        active.length >= CONFIG.particles.winThreshold &&
        active.every((particle) => particle.stopped);

      if (allStopped !== wasAllStoppedRef.current) {
        wasAllStoppedRef.current = allStopped;
        onAllStoppedRef.current?.(allStopped);
      }

      render((tick) => tick + 1);
      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(frameId);
  }, [routes]);

  if (!routes || !routes.length) return null;

  return (
    <g>
      {particlesRef.current.map((particle) => {
        const route = routes[particle.routeIndex];
        if (!route || !route.points?.length) return null;

        const point = samplePolyline(route.points, particle.progress);
        const radius = particle.stopped
          ? particle.radius + CONFIG.particles.stoppedRadiusBoost
          : particle.radius;

        const shadowY = point.y + CONFIG.routes.floorOffset;

        return (
          <g key={particle.id}>
            <ellipse
              cx={point.x}
              cy={shadowY}
              rx={radius * 1.2}
              ry={radius * 0.6}
              fill="rgba(15,23,42,0.12)"
            />
            <circle
              cx={point.x}
              cy={point.y}
              r={radius}
              fill={CONFIG.colors.particle}
            />
          </g>
        );
      })}
    </g>
  );
}

let confettiId = 0;

function ConfettiLayer({ burst }) {
  const piecesRef = useRef([]);
  const frameRef = useRef(0);
  const lastTimeRef = useRef(0);
  const [, render] = useState(0);

  // Stop the RAF loop when no pieces remain; restart when a new burst arrives.
  const ensureLoop = useCallback(() => {
    if (frameRef.current) return;
    lastTimeRef.current = performance.now();

    const loop = (now) => {
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = now;

      const dragFactor = Math.exp(-CONFIG.confetti.drag * dt);

      piecesRef.current = piecesRef.current
        .map((piece) => {
          const age = piece.age + dt;
          if (age >= piece.life) return null;

          return {
            ...piece,
            age,
            x: piece.x + piece.vx * dt,
            y: piece.y + piece.vy * dt,
            vx: piece.vx * dragFactor,
            vy: piece.vy * dragFactor + CONFIG.confetti.gravity * dt,
            rotation: piece.rotation + piece.spin * dt,
          };
        })
        .filter(Boolean);

      render((tick) => tick + 1);

      if (piecesRef.current.length > 0) {
        frameRef.current = requestAnimationFrame(loop);
      } else {
        frameRef.current = 0;
      }
    };

    frameRef.current = requestAnimationFrame(loop);
  }, []);

  useEffect(() => {
    if (!burst) return;

    const { pieces, angleJitter, speedMin, speedMax, upwardBias, spinMin,
      spinMax, lifeMin, lifeMax, sizeMin, sizeMax, palette } = CONFIG.confetti;

    // Even angle distribution with small jitter — burst reads as an organized
    // starburst rather than a chaotic spray.
    const fresh = [];
    for (let i = 0; i < pieces; i += 1) {
      const angle =
        (i / pieces) * Math.PI * 2 + (Math.random() - 0.5) * angleJitter;
      const speed = rand(speedMin, speedMax);

      fresh.push({
        id: `confetti-${confettiId++}`,
        x: burst.x,
        y: burst.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - upwardBias,
        rotation: Math.random() * 360,
        spin: rand(spinMin, spinMax),
        size: rand(sizeMin, sizeMax),
        color: palette[i % palette.length],
        age: 0,
        life: rand(lifeMin, lifeMax),
      });
    }

    piecesRef.current = piecesRef.current.concat(fresh);
    ensureLoop();
  }, [burst, ensureLoop]);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    []
  );

  if (!piecesRef.current.length) return null;

  return (
    <g>
      {piecesRef.current.map((piece) => {
        const fade = 1 - piece.age / piece.life;
        const half = piece.size / 2;
        return (
          <rect
            key={piece.id}
            x={-half}
            y={-half * 1.4}
            width={piece.size}
            height={piece.size * 1.4}
            fill={piece.color}
            opacity={Math.max(0, fade)}
            transform={`translate(${piece.x} ${piece.y}) rotate(${piece.rotation})`}
          />
        );
      })}
    </g>
  );
}

function Blocker({ point }) {
  if (!point) return null;

  return (
    <g>
      <circle
        cx={point.shadowX}
        cy={point.shadowY}
        r={CONFIG.blocker.radius * 0.72}
        fill="rgba(15,23,42,0.08)"
        filter="url(#floatShadow)"
      />
      <line
        x1={point.shadowX}
        y1={point.shadowY}
        x2={point.x}
        y2={point.y}
        stroke="rgba(15,23,42,0.12)"
        strokeWidth="1"
        strokeDasharray="3 5"
      />
      <circle
        cx={point.x}
        cy={point.y}
        r={CONFIG.blocker.radius}
        fill={CONFIG.colors.blockerFill}
        stroke={CONFIG.colors.blockerStroke}
      />
    </g>
  );
}

export default function HomePageBackground() {
  const svgRef = useRef(null);
  const stageRef = useRef(null);
  const scene = useMemo(createScene, []);

  // Pointer is tracked via window listeners (not pointer events on the SVG)
  // so the centered hero card sitting above the background — which has its
  // own pointer-events: auto — does not swallow movement under it.
  const [pointer, setPointer] = useState(null);
  const [burst, setBurst] = useState(null);
  const pointerRef = useRef(null);

  useEffect(() => {
    pointerRef.current = pointer;
  }, [pointer]);

  const handleAllStopped = useCallback((isStopped) => {
    if (!isStopped) return;
    const at = pointerRef.current;
    if (!at) return;
    setBurst({ x: at.x, y: at.y, key: performance.now() });
  }, []);

  useEffect(() => {
    function onMove(event) {
      const svg = svgRef.current;
      const stage = stageRef.current;
      if (!svg || !stage) return;

      const rect = svg.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        setPointer(null);
        return;
      }

      const matrix = stage.getScreenCTM();
      if (!matrix) return;

      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const projected = point.matrixTransform(matrix.inverse());

      setPointer({
        x: projected.x,
        y: projected.y,
        shadowX: projected.x,
        shadowY: projected.y + CONFIG.routes.floorOffset,
      });
    }

    function onLeave() {
      setPointer(null);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <>
      <div className="hp-bg" aria-hidden="true">
        <svg
          ref={svgRef}
          viewBox={CONFIG.stage.viewBox}
          className="hp-bg__svg"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
          <filter id="softGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="floatShadow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

          <g ref={stageRef} transform={`translate(0 ${CONFIG.stage.y})`}>
            <GridLayer />
            <Blocker point={pointer} />
            <RouteLayer routes={scene.routes} />
            <ParticleLayer
              routes={scene.routes}
              blocker={pointer}
              onAllStopped={handleAllStopped}
            />
            <NodeLayer nodes={scene.nodes} blueNode={scene.blueNode} />
            <ConfettiLayer burst={burst} />
          </g>
        </svg>
      </div>
      <div className="hp-grain" aria-hidden="true" />
    </>
  );
}
