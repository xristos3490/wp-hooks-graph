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

function bfsPath(start, end, { preferStraightTiebreak = 0 } = {}) {
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

    if (prevDir && preferStraightTiebreak > 0) {
      neighbors.sort((a, b) => {
        const score = (tile) => {
          const dx = tile.x - current.x;
          const dy = tile.y - current.y;
          return dx === prevDir.x && dy === prevDir.y ? -preferStraightTiebreak : 0;
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
    const segment = bfsPath(start, end, { preferStraightTiebreak: 0.85 });
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

function createParticle(routes, idRef) {
  if (!routes.length) return null;

  const id = `particle-${idRef.current++}`;

  return {
    id,
    routeIndex: Math.floor(Math.random() * routes.length),
    progress: 0,
    speed: rand(CONFIG.particles.minSpeed, CONFIG.particles.maxSpeed),
    radius: rand(CONFIG.particles.radiusMin, CONFIG.particles.radiusMax),
    stopped: false,
  };
}

// Mutates particle in place. Returns true if the particle should remain alive.
function advanceParticle(particle, routes, blocker, deltaSeconds) {
  const route = routes[particle.routeIndex];

  if (!route) return false;

  const point = samplePolyline(route.points, particle.progress);

  if (isInsideBlocker(point, blocker)) {
    particle.stopped = true;
    return true;
  }

  const step = particle.stopped
    ? CONFIG.particles.releaseStep
    : CONFIG.particles.baseStep;

  const progress = particle.progress + particle.speed * step * deltaSeconds;

  if (progress >= 1) return false;

  particle.progress = progress;
  particle.stopped = false;
  return true;
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
  const routesRef = useRef(routes);
  const wasAllStoppedRef = useRef(false);
  const onAllStoppedRef = useRef(onAllStopped);
  const particleIdRef = useRef(0);
  const slotsRef = useRef(null);
  if (slotsRef.current === null) {
    slotsRef.current = Array.from(
      { length: CONFIG.particles.maxActive },
      () => ({ g: null, ellipse: null, circle: null })
    );
  }

  useEffect(() => {
    blockerRef.current = blocker;
  }, [blocker]);

  useEffect(() => {
    onAllStoppedRef.current = onAllStopped;
  }, [onAllStopped]);

  useEffect(() => {
    routesRef.current = routes;
  }, [routes]);

  useEffect(() => {
    if (!routes.length) return undefined;

    particlesRef.current = Array.from(
      { length: Math.min(CONFIG.particles.initialCount, routes.length) },
      () => createParticle(routesRef.current, particleIdRef)
    ).filter(Boolean);

    const paint = () => {
      const particles = particlesRef.current;
      const currentRoutes = routesRef.current;
      const slots = slotsRef.current;
      for (let i = 0; i < slots.length; i += 1) {
        const slot = slots[i];
        if (!slot.g) continue;
        const particle = particles[i];
        if (!particle) {
          slot.g.style.display = 'none';
          continue;
        }
        const route = currentRoutes[particle.routeIndex];
        if (!route || !route.points?.length) {
          slot.g.style.display = 'none';
          continue;
        }
        const point = samplePolyline(route.points, particle.progress);
        const radius = particle.stopped
          ? particle.radius + CONFIG.particles.stoppedRadiusBoost
          : particle.radius;
        const shadowY = point.y + CONFIG.routes.floorOffset;

        slot.g.style.display = '';
        if (slot.ellipse) {
          slot.ellipse.setAttribute('cx', point.x);
          slot.ellipse.setAttribute('cy', shadowY);
          slot.ellipse.setAttribute('rx', radius * 1.2);
          slot.ellipse.setAttribute('ry', radius * 0.6);
        }
        if (slot.circle) {
          slot.circle.setAttribute('cx', point.x);
          slot.circle.setAttribute('cy', point.y);
          slot.circle.setAttribute('r', radius);
        }
      }
    };

    paint();

    let frameId = 0;
    let spawnAccumulator = 0;
    let lastTime = performance.now();

    const loop = (now) => {
      const deltaSeconds = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const currentRoutes = routesRef.current;

      const particles = particlesRef.current;
      let writeIdx = 0;
      for (let i = 0; i < particles.length; i += 1) {
        const particle = particles[i];
        const alive = advanceParticle(
          particle,
          currentRoutes,
          blockerRef.current,
          deltaSeconds
        );
        if (alive) {
          if (writeIdx !== i) particles[writeIdx] = particle;
          writeIdx += 1;
        }
      }
      particles.length = writeIdx;

      spawnAccumulator += deltaSeconds * CONFIG.particles.spawnRatePerSecond;

      while (
        spawnAccumulator >= 1 &&
        particlesRef.current.length < CONFIG.particles.maxActive
      ) {
        spawnAccumulator -= 1;
        const particle = createParticle(currentRoutes, particleIdRef);
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
        // Clear the frozen swarm so the spawn loop starts producing again
        // alongside the confetti burst.
        if (allStopped) particlesRef.current = [];
      }

      paint();
      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(frameId);
  }, [routes]);

  if (!routes || !routes.length) return null;

  // Fixed pool of slots — the RAF loop mutates attributes directly, so this
  // JSX is rendered once and React never reconciles per-frame.
  return (
    <g>
      {slotsRef.current.map((_, i) => (
        <g
          key={i}
          ref={(el) => {
            slotsRef.current[i].g = el;
          }}
          style={{ display: 'none' }}
        >
          <ellipse
            ref={(el) => {
              slotsRef.current[i].ellipse = el;
            }}
            fill="rgba(15,23,42,0.12)"
          />
          <circle
            ref={(el) => {
              slotsRef.current[i].circle = el;
            }}
            fill={CONFIG.colors.particle}
          />
        </g>
      ))}
    </g>
  );
}

// Pool sized to comfortably hold a couple of overlapping bursts; surplus
// pieces from a third concurrent burst are dropped rather than allocated.
const CONFETTI_POOL_SIZE = CONFIG.confetti.pieces * 3;

function ConfettiLayer({ burst }) {
  const piecesRef = useRef(null);
  const slotsRef = useRef(null);
  const frameRef = useRef(0);
  const lastTimeRef = useRef(0);

  if (piecesRef.current === null) {
    piecesRef.current = Array.from(
      { length: CONFETTI_POOL_SIZE },
      () => ({ active: false })
    );
  }
  if (slotsRef.current === null) {
    slotsRef.current = Array.from(
      { length: CONFETTI_POOL_SIZE },
      () => ({ rect: null })
    );
  }

  // Stop the RAF loop when no pieces remain; restart when a new burst arrives.
  const ensureLoop = useCallback(() => {
    if (frameRef.current) return;
    lastTimeRef.current = performance.now();

    const loop = (now) => {
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = now;

      const dragFactor = Math.exp(-CONFIG.confetti.drag * dt);
      const pieces = piecesRef.current;
      const slots = slotsRef.current;
      let anyActive = false;

      for (let i = 0; i < pieces.length; i += 1) {
        const piece = pieces[i];
        if (!piece.active) continue;

        piece.age += dt;
        const rect = slots[i].rect;

        if (piece.age >= piece.life) {
          piece.active = false;
          if (rect) rect.style.display = 'none';
          continue;
        }

        anyActive = true;
        piece.x += piece.vx * dt;
        piece.y += piece.vy * dt;
        piece.vx *= dragFactor;
        piece.vy = piece.vy * dragFactor + CONFIG.confetti.gravity * dt;
        piece.rotation += piece.spin * dt;

        if (rect) {
          const fade = 1 - piece.age / piece.life;
          rect.setAttribute('opacity', Math.max(0, fade));
          rect.setAttribute(
            'transform',
            `translate(${piece.x} ${piece.y}) rotate(${piece.rotation})`
          );
        }
      }

      if (anyActive) {
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

    const pool = piecesRef.current;
    const slots = slotsRef.current;
    let inserted = 0;

    // Even angle distribution with small jitter — burst reads as an organized
    // starburst rather than a chaotic spray.
    for (let s = 0; s < pool.length && inserted < pieces; s += 1) {
      const piece = pool[s];
      if (piece.active) continue;

      const angle =
        (inserted / pieces) * Math.PI * 2 +
        (Math.random() - 0.5) * angleJitter;
      const speed = rand(speedMin, speedMax);
      const size = rand(sizeMin, sizeMax);
      const color = palette[inserted % palette.length];
      const rotation = Math.random() * 360;

      piece.active = true;
      piece.x = burst.x;
      piece.y = burst.y;
      piece.vx = Math.cos(angle) * speed;
      piece.vy = Math.sin(angle) * speed - upwardBias;
      piece.rotation = rotation;
      piece.spin = rand(spinMin, spinMax);
      piece.size = size;
      piece.life = rand(lifeMin, lifeMax);
      piece.age = 0;

      const rect = slots[s].rect;
      if (rect) {
        const half = size / 2;
        rect.setAttribute('x', -half);
        rect.setAttribute('y', -half * 1.4);
        rect.setAttribute('width', size);
        rect.setAttribute('height', size * 1.4);
        rect.setAttribute('fill', color);
        rect.setAttribute('opacity', 1);
        rect.setAttribute(
          'transform',
          `translate(${burst.x} ${burst.y}) rotate(${rotation})`
        );
        rect.style.display = '';
      }

      inserted += 1;
    }

    ensureLoop();
  }, [burst, ensureLoop]);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    []
  );

  // Fixed pool of <rect>s — the RAF loop mutates attributes directly, so this
  // JSX is rendered once and React never reconciles per-frame.
  return (
    <g>
      {slotsRef.current.map((_, i) => (
        <rect
          key={i}
          ref={(el) => {
            slotsRef.current[i].rect = el;
          }}
          style={{ display: 'none' }}
        />
      ))}
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
    const latest = { x: 0, y: 0, valid: false };
    let frame = 0;

    function flush() {
      frame = 0;
      const svg = svgRef.current;
      const stage = stageRef.current;
      if (!svg || !stage) return;

      if (!latest.valid) {
        if (pointerRef.current !== null) setPointer(null);
        return;
      }

      const rect = svg.getBoundingClientRect();
      if (
        latest.x < rect.left ||
        latest.x > rect.right ||
        latest.y < rect.top ||
        latest.y > rect.bottom
      ) {
        if (pointerRef.current !== null) setPointer(null);
        return;
      }

      const matrix = stage.getScreenCTM();
      if (!matrix) return;

      const point = svg.createSVGPoint();
      point.x = latest.x;
      point.y = latest.y;
      const projected = point.matrixTransform(matrix.inverse());

      setPointer({
        x: projected.x,
        y: projected.y,
        shadowX: projected.x,
        shadowY: projected.y + CONFIG.routes.floorOffset,
      });
    }

    function schedule() {
      if (frame) return;
      frame = requestAnimationFrame(flush);
    }

    function onMove(event) {
      latest.x = event.clientX;
      latest.y = event.clientY;
      latest.valid = true;
      schedule();
    }

    function onLeave() {
      latest.valid = false;
      schedule();
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      if (frame) cancelAnimationFrame(frame);
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
