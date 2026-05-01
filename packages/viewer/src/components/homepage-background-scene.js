export const CONFIG = {
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

export const TILE_MAP = [
  [1, 1, 1, 0, 1, 1, 1, 0],
  [1, 0, 1, 1, 1, 0, 1, 1],
  [1, 1, 1, 0, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 0, 1],
  [1, 1, 0, 1, 1, 1, 1, 1],
  [1, 0, 1, 1, 0, 1, 1, 0],
  [1, 1, 1, 1, 1, 1, 0, 1],
  [0, 1, 1, 0, 1, 1, 1, 1],
];

export const rand = (min, max) => min + Math.random() * (max - min);
export const pick = (items) => {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
};
export const keyOf = ({ x, y }) => `${x}:${y}`;
export const sameTile = (a, b) => Boolean(a && b && a.x === b.x && a.y === b.y);
export const tileDistance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function iso(x, y, z = 0) {
  return {
    x: (x - y) * (CONFIG.grid.tileWidth / 2),
    y: (x + y) * (CONFIG.grid.tileHeight / 2) - z,
  };
}

export function tileCenter(tile, z = 0) {
  return iso(tile.x + 0.5, tile.y + 0.5, z);
}

export function tileCorners(x, y, z = 0) {
  return [
    iso(x, y, z),
    iso(x + 1, y, z),
    iso(x + 1, y + 1, z),
    iso(x, y + 1, z),
  ];
}

export function svgPoints(points) {
  return points.map(({ x, y }) => `${x},${y}`).join(' ');
}

export const PLANE_TILES = TILE_MAP.flatMap((row, y) =>
  row.map((exists, x) => (exists ? { x, y } : null))
).filter(Boolean);

export const WALKABLE = new Set(PLANE_TILES.map(keyOf));

export const INNER_TILES = PLANE_TILES.filter(
  ({ x, y }) =>
    x > 0 &&
    y > 0 &&
    x < CONFIG.grid.size - 1 &&
    y < CONFIG.grid.size - 1
);

export function getNeighbors(tile) {
  const candidates = [
    { x: tile.x + 1, y: tile.y },
    { x: tile.x - 1, y: tile.y },
    { x: tile.x, y: tile.y + 1 },
    { x: tile.x, y: tile.y - 1 },
  ];
  return candidates.filter((next) => WALKABLE.has(keyOf(next)));
}

export function chooseSparseNodes(tiles) {
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

export function bfsPath(start, end, { preferStraightTiebreak = 0 } = {}) {
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

export function createRoutePoints(path) {
  return path.map((tile) => tileCenter(tile, CONFIG.routes.floorOffset));
}

export function createRoute(nodes, index) {
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

export function createRoutes(nodes) {
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

export function createScene() {
  const nodeSource = INNER_TILES.length ? INNER_TILES : PLANE_TILES;
  const nodes = chooseSparseNodes(nodeSource);
  const blueNode = nodes[0] ?? null;

  return {
    nodes,
    blueNode,
    routes: createRoutes(nodes),
  };
}

export function samplePolyline(points, progress) {
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

export function isInsideBlocker(point, blocker) {
  if (!blocker) return false;
  return (
    Math.hypot(blocker.x - point.x, blocker.y - point.y) <=
    CONFIG.blocker.radius
  );
}

export function createParticle(routes, idRef) {
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
export function advanceParticle(particle, routes, blocker, deltaSeconds) {
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
