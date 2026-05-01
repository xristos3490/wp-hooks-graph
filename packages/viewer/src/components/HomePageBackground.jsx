import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './HomePageBackground.css';
import {
  CONFIG,
  TILE_MAP,
  advanceParticle,
  createParticle,
  createScene,
  rand,
  sameTile,
  samplePolyline,
  svgPoints,
  tileCenter,
  tileCorners,
} from './homepage-background-scene.js';

const STYLE = {
  route: {
    color: '#0b0b0b',
    width: 1,
    style: 'solid',
  },
  tile: {
    fill: '#ebeeff',
    edge: '#ffffff',
  },
  node: {
    fill: '#ffffff',
    edge: '#6b6b6b',
    core: '#3858e9',
  },
};

const CubeTile = memo(function CubeTile({ tile, isBlue, nodeFill, nodeStroke, nodeCore }) {
  if (!tile) return null;

  const z = CONFIG.grid.floatHeight + CONFIG.grid.cubeHeight * 0.6;
  const center = tileCenter(tile, z);
  const ground = tileCenter(tile, 0);

  const r = 10;
  const fill = isBlue ? CONFIG.colors.blueCube.right : nodeFill;
  const stroke = isBlue ? CONFIG.colors.blueCube.left : nodeStroke;

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
      <circle cx={center.x} cy={center.y} r={r} fill={fill} stroke={stroke} strokeWidth={2} />
      <circle cx={center.x} cy={center.y} r={r * 0.45} fill={isBlue ? '#dbeafe' : nodeCore} />
    </g>
  );
});

const GridLayer = memo(function GridLayer({ fill, stroke }) {
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
              fill={exists ? fill : 'transparent'}
              stroke={stroke}
              strokeWidth="1"
            />
          );
        })
      )}
    </>
  );
});

const NodeLayer = memo(function NodeLayer({ nodes, blueNode, nodeFill, nodeStroke, nodeCore }) {
  const sortedNodes = useMemo(() => nodes.slice().sort((a, b) => a.x + a.y - (b.x + b.y)), [nodes]);

  return (
    <>
      {sortedNodes.map((tile) => (
        <CubeTile
          key={`${tile.x}-${tile.y}`}
          tile={tile}
          isBlue={Boolean(blueNode && sameTile(tile, blueNode))}
          nodeFill={nodeFill}
          nodeStroke={nodeStroke}
          nodeCore={nodeCore}
        />
      ))}
    </>
  );
});

function RouteLayer({ routes, color, width, style }) {
  if (!routes || !routes.length) return null;
  const dashArray = style === 'dashed' ? `${width * 3} ${width * 2}` : undefined;
  return (
    <g>
      {routes.map((route) => {
        if (!route.points?.length) return null;

        return (
          <polyline
            key={route.id}
            points={svgPoints(route.points)}
            fill="none"
            stroke={color}
            strokeWidth={width}
            strokeDasharray={dashArray}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </g>
  );
}

function ParticleLayer({ routes, blocker, onAllStopped, onStoppedCountChange }) {
  const particlesRef = useRef([]);
  const blockerRef = useRef(blocker);
  const routesRef = useRef(routes);
  const wasAllStoppedRef = useRef(false);
  const onAllStoppedRef = useRef(onAllStopped);
  const onStoppedCountChangeRef = useRef(onStoppedCountChange);
  const lastStoppedCountRef = useRef(0);
  const particleIdRef = useRef(0);
  const slotsRef = useRef(null);
  if (slotsRef.current === null) {
    slotsRef.current = Array.from({ length: CONFIG.particles.maxActive }, () => ({
      g: null,
      ellipse: null,
      circle: null,
    }));
  }

  useEffect(() => {
    blockerRef.current = blocker;
  }, [blocker]);

  useEffect(() => {
    onAllStoppedRef.current = onAllStopped;
  }, [onAllStopped]);

  useEffect(() => {
    onStoppedCountChangeRef.current = onStoppedCountChange;
  }, [onStoppedCountChange]);

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
        const alive = advanceParticle(particle, currentRoutes, blockerRef.current, deltaSeconds);
        if (alive) {
          if (writeIdx !== i) particles[writeIdx] = particle;
          writeIdx += 1;
        }
      }
      particles.length = writeIdx;

      spawnAccumulator += deltaSeconds * CONFIG.particles.spawnRatePerSecond;

      while (spawnAccumulator >= 1 && particlesRef.current.length < CONFIG.particles.maxActive) {
        spawnAccumulator -= 1;
        const particle = createParticle(currentRoutes, particleIdRef);
        if (particle) particlesRef.current.push(particle);
      }

      // Hidden achievement: enough dots are simultaneously frozen by the
      // blocker to hit the win threshold. The threshold is the same number
      // shown as the denominator in the on-stage counter, so "N/N" lines up
      // exactly with the confetti trigger.
      const active = particlesRef.current;
      let stoppedCount = 0;
      for (let i = 0; i < active.length; i += 1) {
        if (active[i].stopped) stoppedCount += 1;
      }
      const winReached = stoppedCount >= CONFIG.particles.maxActive;

      if (winReached !== wasAllStoppedRef.current) {
        wasAllStoppedRef.current = winReached;
        onAllStoppedRef.current?.(winReached);
        // Clear the frozen swarm so the spawn loop starts producing again
        // alongside the confetti burst.
        if (winReached) {
          particlesRef.current = [];
          stoppedCount = 0;
        }
      }

      if (stoppedCount !== lastStoppedCountRef.current) {
        lastStoppedCountRef.current = stoppedCount;
        onStoppedCountChangeRef.current?.(stoppedCount);
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
    piecesRef.current = Array.from({ length: CONFETTI_POOL_SIZE }, () => ({ active: false }));
  }
  if (slotsRef.current === null) {
    slotsRef.current = Array.from({ length: CONFETTI_POOL_SIZE }, () => ({ rect: null }));
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

    const {
      pieces,
      angleJitter,
      speedMin,
      speedMax,
      upwardBias,
      spinMin,
      spinMax,
      lifeMin,
      lifeMax,
      sizeMin,
      sizeMax,
      palette,
    } = CONFIG.confetti;

    const pool = piecesRef.current;
    const slots = slotsRef.current;
    let inserted = 0;

    // Even angle distribution with small jitter — burst reads as an organized
    // starburst rather than a chaotic spray.
    for (let s = 0; s < pool.length && inserted < pieces; s += 1) {
      const piece = pool[s];
      if (piece.active) continue;

      const angle = (inserted / pieces) * Math.PI * 2 + (Math.random() - 0.5) * angleJitter;
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
        rect.setAttribute('transform', `translate(${burst.x} ${burst.y}) rotate(${rotation})`);
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

function Blocker({ view }) {
  if (!view) return null;
  const { point, active } = view;

  return (
    <g className={`hp-bg__blocker${active ? ' is-active' : ''}`}>
      <g
        className="hp-bg__blocker-shadow-wrap"
        transform={`translate(${point.shadowX} ${point.shadowY})`}
      >
        <circle
          className="hp-bg__blocker-shadow"
          cx={0}
          cy={0}
          r={CONFIG.blocker.radius * 0.72}
          fill="rgba(15,23,42,0.08)"
          filter="url(#floatShadow)"
        />
      </g>
      <line
        className="hp-bg__blocker-line"
        x1={point.shadowX}
        y1={point.shadowY}
        x2={point.x}
        y2={point.y}
        stroke="rgba(15,23,42,0.12)"
        strokeWidth="1"
        strokeDasharray="3 5"
      />
      <g className="hp-bg__blocker-orb-wrap" transform={`translate(${point.x} ${point.y})`}>
        <circle
          className="hp-bg__blocker-orb"
          cx={0}
          cy={0}
          r={CONFIG.blocker.radius}
          fill={CONFIG.colors.blockerFill}
          stroke={CONFIG.colors.blockerStroke}
        />
      </g>
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
  const [blockerView, setBlockerView] = useState(null);
  const [burst, setBurst] = useState(null);
  const [stoppedCount, setStoppedCount] = useState(0);
  const pointerRef = useRef(null);

  useEffect(() => {
    pointerRef.current = pointer;
  }, [pointer]);

  // Keep the cursor-follower mounted briefly past pointer-leave so the exit
  // animation can play. While active, position tracks pointer; on leave, the
  // last position freezes and we only flip `active` off — CSS scales/fades it
  // out, then a timer clears the view entirely.
  useEffect(() => {
    if (pointer) {
      setBlockerView({ point: pointer, active: true });
      return undefined;
    }
    let cleared = false;
    setBlockerView((prev) => (prev ? { point: prev.point, active: false } : null));
    const timer = setTimeout(() => {
      if (!cleared) setBlockerView(null);
    }, 280);
    return () => {
      cleared = true;
      clearTimeout(timer);
    };
  }, [pointer]);

  const handleAllStopped = useCallback((isStopped) => {
    if (!isStopped) return;
    const at = pointerRef.current;
    if (!at) return;
    setBurst({ x: at.x, y: at.y, key: performance.now() });
  }, []);

  const handleStoppedCountChange = useCallback((count) => {
    setStoppedCount(count);
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
        <div className="hp-bg__stage">
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
              <GridLayer fill={STYLE.tile.fill} stroke={STYLE.tile.edge} />
              <Blocker view={blockerView} />
              <RouteLayer
                routes={scene.routes}
                color={STYLE.route.color}
                width={STYLE.route.width}
                style={STYLE.route.style}
              />
              <ParticleLayer
                routes={scene.routes}
                blocker={pointer}
                onAllStopped={handleAllStopped}
                onStoppedCountChange={handleStoppedCountChange}
              />
              <NodeLayer
                nodes={scene.nodes}
                blueNode={scene.blueNode}
                nodeFill={STYLE.node.fill}
                nodeStroke={STYLE.node.edge}
                nodeCore={STYLE.node.core}
              />
              <ConfettiLayer burst={burst} />
            </g>
          </svg>
        </div>
        {stoppedCount >= 2 ? (
          <div className="hp-bg__counter">
            <span className="hp-bg__counter-num">{stoppedCount}</span>
            <span className="hp-bg__counter-sep">/</span>
            <span className="hp-bg__counter-max">{CONFIG.particles.maxActive}</span>
          </div>
        ) : null}
      </div>
      <div className="hp-grain" aria-hidden="true" />
    </>
  );
}
