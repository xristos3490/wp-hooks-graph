import { useMemo } from 'react';
import useHomepageScene from '../hooks/useHomepageScene.js';
import useConstellationPhysics from '../hooks/useConstellationPhysics.js';
import './HomePageBackground.css';

// Pre-computed edge dash length keeps the "signal flowing" animation consistent
// across lines of different lengths. Node/edge refs let the physics hook mutate
// cx/cy (and connected line endpoints) bypassing React.
function Constellation({ nodes, edges, style, spinDir, nodeElRefs, edgeElRefs }) {
  const edgeData = useMemo(
    () =>
      edges.map(([a, b]) => {
        const [x1, y1] = nodes[a];
        const [x2, y2] = nodes[b];
        const len = Math.hypot(x2 - x1, y2 - y1);
        return { x1, y1, x2, y2, len };
      }),
    [nodes, edges]
  );

  return (
    <div className="hp-constellation" data-spin-dir={spinDir} style={style}>
      <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g className="hp-constellation__spin">
          <g className="hp-constellation__edges">
            {edgeData.map(({ x1, y1, x2, y2, len }, i) => (
              <line
                key={i}
                ref={edgeElRefs[i]}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                strokeDasharray={`6 ${Math.max(len - 6, 4)}`}
                style={{ animationDelay: `${(i * 0.7) % 5}s` }}
              />
            ))}
          </g>
          <g className="hp-constellation__nodes">
            {nodes.map(([cx, cy], i) => (
              <circle
                key={i}
                ref={nodeElRefs[i]}
                cx={cx}
                cy={cy}
                r="3.5"
                style={{ animationDelay: `${(i * 0.4) % 3}s` }}
              />
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}

// Faint elliptical orbital guides. Static — their role is celestial scale,
// not motion. Rendered as HTML with border-radius so they hug the viewport
// aspect correctly (preserveAspectRatio="none" would skew the stroke).
function Orbits({ orbits }) {
  return (
    <div className="hp-orbits" aria-hidden="true">
      {orbits.map((o, i) => (
        <span
          key={i}
          className="hp-orbit"
          style={{
            left: `${o.cx}%`,
            top: `${o.cy}%`,
            width: `${o.rx * 2}vw`,
            height: `${o.ry * 2}vh`,
            marginLeft: `-${o.rx}vw`,
            marginTop: `-${o.ry}vh`,
            opacity: o.opacity,
            transform: `rotate(${o.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}

export default function HomePageBackground() {
  const { drifters, orbits } = useHomepageScene();
  const { rootRef, bodyRefs, nodeRefs, edgeRefs } = useConstellationPhysics(drifters);
  return (
    <>
      <Orbits orbits={orbits} />
      <div className="hp-field" aria-hidden="true" ref={rootRef}>
        {drifters.map((d, i) => (
          <div
            key={d.id}
            ref={bodyRefs[i]}
            className="hp-constellation-body"
            data-band={d.band}
            style={d.bodyStyle}
          >
            <Constellation
              nodes={d.nodes}
              edges={d.edges}
              style={d.constellationStyle}
              spinDir={d.spinDir}
              nodeElRefs={nodeRefs[i]}
              edgeElRefs={edgeRefs[i]}
            />
          </div>
        ))}
      </div>
    </>
  );
}
