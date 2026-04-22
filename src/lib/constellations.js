// Generator for the idle homepage background: six archetype shape families plus
// a scene composer that scatters drifters across the viewport using a polar
// distribution so the layout never reads as four-sided or grid-aligned.
//
// All coordinates live in a 200×200 viewBox so the SVG render stays pure.

const VIEWBOX = 200;
const CENTER = VIEWBOX / 2;

// mulberry32 PRNG — 32-bit state, good distribution, deterministic from a seed.
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}
function randFloat(rng, min, max) {
  return rng() * (max - min) + min;
}
function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// ---------------------------------------------------------------------------
// Archetype builders — each returns { nodes, edges } with coords in viewBox.
// Extra per-node jitter is applied so no archetype reads as mechanical.
// ---------------------------------------------------------------------------

function buildHub(rng) {
  const spokes = randInt(rng, 5, 9);
  const nodes = [[CENTER + randFloat(rng, -4, 4), CENTER + randFloat(rng, -4, 4)]];
  const edges = [];
  const radius = randFloat(rng, 56, 80);
  const startAngle = rng() * Math.PI * 2;
  for (let i = 0; i < spokes; i++) {
    const a = startAngle + (i / spokes) * Math.PI * 2 + randFloat(rng, -0.12, 0.12);
    const r = radius + randFloat(rng, -10, 10);
    nodes.push([CENTER + Math.cos(a) * r, CENTER + Math.sin(a) * r]);
    edges.push([0, i + 1]);
  }
  const extra = randInt(rng, 0, 2);
  for (let i = 0; i < extra; i++) {
    const a = randInt(rng, 1, spokes);
    const b = randInt(rng, 1, spokes);
    if (a !== b) edges.push([a, b]);
  }
  return { nodes, edges };
}

function buildTree(rng) {
  const total = randInt(rng, 7, 12);
  const branches = randInt(rng, 2, 3);
  const nodes = [];
  const edges = [];

  nodes.push([CENTER + randFloat(rng, -8, 8), 30 + randFloat(rng, -6, 6)]);
  const rootIdx = 0;

  const branchIdx = [];
  for (let b = 0; b < branches; b++) {
    const bx = 34 + ((b + 0.5) / branches) * (VIEWBOX - 68) + randFloat(rng, -10, 10);
    const by = 96 + randFloat(rng, -10, 10);
    nodes.push([bx, by]);
    branchIdx.push(nodes.length - 1);
    edges.push([rootIdx, branchIdx[b]]);
  }

  const leafSlots = total - nodes.length;
  const leavesPerBranch = Array.from({ length: branches }, (_, i) =>
    Math.floor(leafSlots / branches) + (i < leafSlots % branches ? 1 : 0)
  );

  for (let b = 0; b < branches; b++) {
    const [bx] = nodes[branchIdx[b]];
    const count = leavesPerBranch[b];
    for (let l = 0; l < count; l++) {
      const spread = Math.min(30, 12 + count * 4);
      const lx = bx + ((l + 0.5) / count - 0.5) * spread * 2 + randFloat(rng, -6, 6);
      const ly = 160 + randFloat(rng, -10, 10);
      nodes.push([lx, ly]);
      edges.push([branchIdx[b], nodes.length - 1]);
    }
  }

  return { nodes, edges };
}

function buildRing(rng) {
  const n = randInt(rng, 6, 10);
  const nodes = [];
  const edges = [];
  const radius = randFloat(rng, 58, 82);
  const startAngle = rng() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = startAngle + (i / n) * Math.PI * 2 + randFloat(rng, -0.18, 0.18);
    const r = radius + randFloat(rng, -10, 10);
    nodes.push([CENTER + Math.cos(a) * r, CENTER + Math.sin(a) * r]);
    edges.push([i, (i + 1) % n]);
  }
  const chordCount = randInt(rng, 1, 3);
  const seen = new Set(edges.map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)));
  let attempts = 0;
  let placed = 0;
  while (placed < chordCount && attempts < chordCount * 6) {
    attempts++;
    const a = randInt(rng, 0, n - 1);
    const offset = randInt(rng, 2, Math.max(2, Math.floor(n / 2)));
    const b = (a + offset) % n;
    if (a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b]);
    placed++;
  }
  return { nodes, edges };
}

function buildLattice(rng) {
  const cols = randInt(rng, 3, 4);
  const rows = randInt(rng, 3, 4);
  const nodes = [];
  const edges = [];
  const marginX = 26;
  const marginY = 26;
  const stepX = (VIEWBOX - marginX * 2) / (cols - 1);
  const stepY = (VIEWBOX - marginY * 2) / (rows - 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      nodes.push([
        marginX + c * stepX + randFloat(rng, -7, 7),
        marginY + r * stepY + randFloat(rng, -7, 7),
      ]);
    }
  }
  const idx = (r, c) => r * cols + c;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) edges.push([idx(r, c), idx(r, c + 1)]);
      if (r + 1 < rows) edges.push([idx(r, c), idx(r + 1, c)]);
    }
  }
  return { nodes, edges };
}

function buildChain(rng) {
  const n = randInt(rng, 5, 8);
  const nodes = [];
  const edges = [];
  const phase = rng() * Math.PI * 2;
  const wave = randFloat(rng, 22, 42);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const x = 22 + t * (VIEWBOX - 44) + randFloat(rng, -6, 6);
    const y = CENTER + Math.sin(phase + i * randFloat(rng, 0.7, 1.1)) * wave + randFloat(rng, -5, 5);
    nodes.push([x, y]);
    if (i > 0) edges.push([i - 1, i]);
  }
  const bypassTarget = randInt(rng, 1, 2);
  const seen = new Set(edges.map(([a, b]) => `${a}-${b}`));
  let placed = 0;
  let attempts = 0;
  while (placed < bypassTarget && attempts < bypassTarget * 6) {
    attempts++;
    if (n < 3) break;
    const start = randInt(rng, 0, n - 3);
    const key = `${start}-${start + 2}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([start, start + 2]);
    placed++;
  }
  return { nodes, edges };
}

function buildMesh(rng) {
  const n = randInt(rng, 8, 14);
  const nodes = [];
  const edges = [];
  for (let i = 0; i < n; i++) {
    nodes.push([randFloat(rng, 20, VIEWBOX - 20), randFloat(rng, 20, VIEWBOX - 20)]);
  }
  const target = Math.round(n * 1.8);
  const seen = new Set();
  let attempts = 0;
  while (edges.length < target && attempts < target * 8) {
    attempts++;
    const a = randInt(rng, 0, n - 1);
    const b = randInt(rng, 0, n - 1);
    if (a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b]);
  }
  return { nodes, edges };
}

const ARCHETYPES = {
  hub: buildHub,
  tree: buildTree,
  ring: buildRing,
  lattice: buildLattice,
  chain: buildChain,
  mesh: buildMesh,
};

export const ARCHETYPE_NAMES = Object.freeze(Object.keys(ARCHETYPES));

export function buildArchetype(name, rng) {
  const fn = ARCHETYPES[name];
  if (!fn) throw new Error(`Unknown archetype: ${name}`);
  return fn(rng);
}

// ---------------------------------------------------------------------------
// Scene composition — polar scatter: a random angle + radius around the
// viewport centre so layout never reads as a four-sided arrangement. The radius
// range lets some sprites sit mostly on-screen and others bleed off an edge.
// Depth bands tune opacity/scale/duration so the scene has near/far parallax.
// ---------------------------------------------------------------------------

const DEPTH_BANDS = [
  { name: 'back',  opacity: [0.06, 0.14], scale: 0.75, durMult: 1.3 },
  { name: 'mid',   opacity: [0.14, 0.24], scale: 1.00, durMult: 1.0 },
  { name: 'front', opacity: [0.24, 0.36], scale: 1.20, durMult: 0.8 },
];

function rollDrifterStyle(rng) {
  const band = pick(rng, DEPTH_BANDS);

  // Polar scatter in viewport units. radius 1.0 ≈ edge; >1.0 bleeds off-screen.
  const angle = rng() * Math.PI * 2;
  const radius = randFloat(rng, 0.55, 1.2);
  const centerX = 50 + Math.cos(angle) * 50 * radius;
  const centerY = 50 + Math.sin(angle) * 50 * radius;

  const sizeRem = randFloat(rng, 14, 46) * band.scale;
  const opacity = randFloat(rng, band.opacity[0], band.opacity[1]);

  return {
    band: band.name,
    anchorX: Number(centerX.toFixed(1)),
    anchorY: Number(centerY.toFixed(1)),
    style: {
      left: `${centerX.toFixed(1)}%`,
      top: `${centerY.toFixed(1)}%`,
      width: `${sizeRem.toFixed(1)}rem`,
      // Anchor the polar point at the sprite's centre.
      marginLeft: `-${(sizeRem / 2).toFixed(2)}rem`,
      marginTop: `-${(sizeRem / 2).toFixed(2)}rem`,
      opacity: Number(opacity.toFixed(2)),
      '--c-spin': `${Math.round(randFloat(rng, 260, 560) * band.durMult)}s`,
      '--c-spin-dir': rng() > 0.5 ? '1' : '-1',
    },
  };
}

function buildDrifterList(rng, count) {
  const used = ARCHETYPE_NAMES.map(() => 0);
  const result = [];
  for (let i = 0; i < count; i++) {
    // Prefer archetypes least used so far — keeps a balanced palette of shapes
    // without forcing perfect rotation.
    const minUsed = Math.min(...used);
    const candidates = ARCHETYPE_NAMES.filter((_, idx) => used[idx] === minUsed);
    const archetype = pick(rng, candidates);
    used[ARCHETYPE_NAMES.indexOf(archetype)]++;
    const { nodes, edges } = buildArchetype(archetype, rng);
    const { style, band, anchorX, anchorY } = rollDrifterStyle(rng);
    result.push({ id: `d${i}`, archetype, band, nodes, edges, style, anchorX, anchorY });
  }
  return result;
}

export function buildScene({ seed = 1, drifterCount = 6 } = {}) {
  const rng = makeRng(seed);
  return { drifters: buildDrifterList(rng, drifterCount) };
}

// ---------------------------------------------------------------------------
// Curated scene — a hand-composed piece of art rather than a random scatter.
//
// The homepage hero sits centered; the composition deliberately frames that
// dead space. Drifters are placed with asymmetric balance (heavier upper-left
// and lower-right) and varying depth bands so the eye reads the scene as a
// painted night sky of signal clusters rather than a uniform grid. Two
// ambient layers are added:
//   - stardust:  deterministic scatter of tiny twinkling points, atmosphere
//   - orbits:    faint elliptical guides suggesting celestial scale
// Archetype internals (node jitter, edge chord counts) still use a seeded RNG
// so the interior of each cluster has life without being different each load.
// ---------------------------------------------------------------------------

// x/y are viewport percent. Negative or >100 bleeds off-screen intentionally.
// size is rem; opacity is the drifter's base opacity (on top of edge/node opacity).
const CURATED_DRIFTERS = [
  { archetype: 'mesh',    band: 'back',  x: 16, y: 22, size: 40, opacity: 0.09, spin: 520, dir:  1 },
  { archetype: 'lattice', band: 'back',  x: 82, y: 14, size: 34, opacity: 0.08, spin: 560, dir: -1 },
  { archetype: 'hub',     band: 'mid',   x: -3, y: 58, size: 28, opacity: 0.16, spin: 380, dir: -1 },
  { archetype: 'tree',    band: 'mid',   x: 88, y: 74, size: 30, opacity: 0.18, spin: 340, dir:  1 },
  { archetype: 'ring',    band: 'front', x: 22, y: 88, size: 20, opacity: 0.28, spin: 300, dir:  1 },
  { archetype: 'hub',     band: 'front', x: 98, y: 42, size: 18, opacity: 0.30, spin: 260, dir: -1 },
  { archetype: 'chain',   band: 'mid',   x: 58, y: 104, size: 32, opacity: 0.20, spin: 320, dir:  1 },
];

const CURATED_SEED = 2026;
const STARDUST_COUNT = 92;

// Deterministic sky of tiny points. Twinkle tempos vary per-star so the field
// never pulses in sync.
function buildStardust(rng) {
  const stars = new Array(STARDUST_COUNT);
  for (let i = 0; i < STARDUST_COUNT; i++) {
    stars[i] = {
      x: Number((rng() * 100).toFixed(2)),
      y: Number((rng() * 100).toFixed(2)),
      r: Number((0.35 + rng() * 0.95).toFixed(2)),
      opacity: Number((0.08 + rng() * 0.3).toFixed(2)),
      delay: Number((rng() * 8).toFixed(2)),
      dur: Number((3.5 + rng() * 4.5).toFixed(2)),
    };
  }
  return stars;
}

// Faint orbital rings. Static, no animation — their role is to add celestial
// scale, not motion. Positioned off-center so they never cut through the hero
// title. Sized in vw/vh so they stay proportional to the viewport.
const CURATED_ORBITS = [
  { cx: 16, cy: 26, rx: 24, ry: 15, rot: -18, opacity: 0.10 },
  { cx: 84, cy: 72, rx: 28, ry: 18, rot:  22, opacity: 0.09 },
  { cx: 78, cy: 18, rx: 14, ry:  9, rot:  10, opacity: 0.12 },
];

export function buildCuratedScene() {
  const rng = makeRng(CURATED_SEED);
  const drifters = CURATED_DRIFTERS.map((p, i) => {
    const { nodes, edges } = buildArchetype(p.archetype, rng);
    return {
      id: `d${i}`,
      archetype: p.archetype,
      band: p.band,
      nodes,
      edges,
      anchorX: p.x,
      anchorY: p.y,
      style: {
        left: `${p.x.toFixed(1)}%`,
        top: `${p.y.toFixed(1)}%`,
        width: `${p.size.toFixed(1)}rem`,
        marginLeft: `-${(p.size / 2).toFixed(2)}rem`,
        marginTop: `-${(p.size / 2).toFixed(2)}rem`,
        opacity: p.opacity,
        '--c-spin': `${p.spin}s`,
        '--c-spin-dir': p.dir === -1 ? '-1' : '1',
      },
    };
  });
  const stars = buildStardust(rng);
  return { drifters, stars, orbits: CURATED_ORBITS };
}
