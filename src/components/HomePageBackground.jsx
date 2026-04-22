import { useMemo } from 'react';
import useHomepageScene from '../hooks/useHomepageScene.js';
import useConstellationPhysics from '../hooks/useConstellationPhysics.js';
import './HomePageBackground.css';

// A single constellation rendered as SVG. Pre-computed edge dash length keeps
// the "signal flowing" animation consistent across lines of different lengths.
// Node refs let the physics hook mutate per-node cx/cy; edge refs let it keep
// the connecting lines attached to moved endpoints.
function Constellation({ nodes, edges, style, nodeElRefs, edgeElRefs }) {
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
                ref={edgeElRefs[i]}
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
                ref={nodeElRefs[i]}
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

// Idle-screen background: a soft neutral mesh plus a polar scatter of
// constellation drifters. Each node in each constellation reacts independently
// to the pointer via useConstellationPhysics.
export default function HomePageBackground() {
  const { drifters } = useHomepageScene();
  const { rootRef, bodyRefs, nodeRefs, edgeRefs } = useConstellationPhysics(drifters);
  return (
    <>
      <div className="hp-mesh" aria-hidden="true" />
      <div className="hp-field" aria-hidden="true" ref={rootRef}>
        {drifters.map((d, i) => {
          const {
            left, top, width, marginLeft, marginTop, ...innerStyle
          } = d.style;
          const bodyStyle = { left, top, width, marginLeft, marginTop };
          return (
            <div
              key={d.id}
              ref={bodyRefs[i]}
              className="hp-constellation-body"
              style={bodyStyle}
            >
              <Constellation
                nodes={d.nodes}
                edges={d.edges}
                style={innerStyle}
                nodeElRefs={nodeRefs[i]}
                edgeElRefs={edgeRefs[i]}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
