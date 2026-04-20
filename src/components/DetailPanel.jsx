import { useState, useEffect, useRef } from 'react';
import { IconButton, Text, Stack } from '@wordpress/ui';
import { DataViews } from '@wordpress/dataviews';
import '@wordpress/dataviews/build-style/style.css';
import { close } from '@wordpress/icons';
import { useGraphContext } from '../context/GraphContext';
import { LISTEN_TRUNCATION_LIMIT } from '../lib/constants';

function scopeLabel(ed) {
  const cls = ed.scopeClass || '';
  const fn = ed.scopeFunction || '';
  if (cls && fn) return `in ${cls}::${fn}`;
  if (cls) return `in ${cls}`;
  if (fn) return `in ${fn}`;
  return '';
}

const PANEL_INSET = 'var(--wpds-dimension-padding-xl)';

const sectionHeadingStyle = {
  padding: `0 ${PANEL_INSET}`,
  marginBottom: 'var(--wpds-dimension-gap-md)',
  display: 'block',
  textTransform: 'uppercase',
  opacity: 0.6,
};

const monoStyle = {
  fontFamily: 'var(--wpds-font-family-mono)',
  fontFeatureSettings: "'tnum' 1, 'kern' 1",
};

const edgeFields = [
  {
    id: 'title',
    label: 'Name',
    render: ({ item }) => (
      <span style={{
        fontWeight: 'var(--wpds-font-weight-medium)',
        wordBreak: 'break-all',
        overflowWrap: 'anywhere',
      }}>
        {item.title}
      </span>
    ),
    enableSorting: false,
    enableGlobalSearch: false,
  },
  {
    id: 'description',
    label: 'Details',
    render: ({ item }) => (
      <>
        {item.files && (
          <span style={{ ...monoStyle, display: 'block', fontSize: 11.5, opacity: 0.6, wordBreak: 'break-all' }}>
            {item.files}
          </span>
        )}
        <span style={{ ...monoStyle, fontSize: 10.5, lineHeight: 1.5 }}>
          {item.description}
        </span>
        {item.docComment && (
          <span style={{
            display: 'block',
            fontSize: 'var(--wpds-font-size-xs)',
            fontStyle: 'italic',
            marginTop: 2,
            padding: 'var(--wpds-dimension-padding-xs) var(--wpds-dimension-padding-sm)',
            borderLeft: '2px solid #e0e0e0',
            borderRadius: '0 var(--wpds-border-radius-md) var(--wpds-border-radius-md) 0',
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {item.docComment}
          </span>
        )}
      </>
    ),
    enableSorting: false,
    enableGlobalSearch: false,
  },
];

const EDGE_VIEW = {
  type: 'list',
  titleField: 'title',
  descriptionField: 'description',
  fields: [],
  page: 1,
  perPage: 1000,
};

export default function DetailPanel() {
  const { selectedNode, clearSelection, selectNode, cyRef } = useGraphContext();
  const panelRef = useRef(null);

  useEffect(() => {
    if (selectedNode && panelRef.current) {
      panelRef.current.scrollTop = 0;
    }
  }, [selectedNode]);

  const cy = cyRef.current;
  if (!cy) return null;

  const isOpen = selectedNode !== null;
  const node = isOpen ? cy.getElementById(selectedNode) : null;
  const d = node && node.length ? node.data() : null;

  function handleEdgeClick(nodeId) {
    selectNode(nodeId);
  }

  const panelStyle = {
    width: 420,
    borderLeft: '1px solid #e0e0e0',
    fontSize: 'var(--wpds-font-size-md)',
    transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
    opacity: isOpen ? 1 : 0,
    transition: 'transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease',
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 30,
    overflowY: 'auto',
    overflowX: 'hidden',
    background: '#fff',
  };

  return (
    <div ref={panelRef} style={panelStyle}>
      {d && (
        <>
          <div style={{
            padding: 'var(--wpds-dimension-padding-xl)',
            borderBottom: '1px solid #e0e0e0',
            position: 'sticky',
            top: 0,
            background: '#fff',
            zIndex: 1,
          }}>
            <div style={{ position: 'absolute', top: 18, right: 18 }}>
              <IconButton
                icon={close}
                onClick={clearSelection}
                label="Close"
                variant="minimal"
                tone="neutral"
                size="small"
              />
            </div>
            {d.type === 'hook' && <HookHeader d={d} />}
            {d.type === 'file' && <FileHeader d={d} />}
            {d.type === 'class' && <ClassHeader d={d} />}
          </div>
          <div style={{ paddingTop: 'var(--wpds-dimension-gap-lg)', paddingBottom: 'var(--wpds-dimension-padding-3xl)' }}>
            {d.type === 'hook' && <HookBody d={d} cy={cy} onEdgeClick={handleEdgeClick} />}
            {d.type === 'file' && <FileBody d={d} cy={cy} onEdgeClick={handleEdgeClick} />}
            {d.type === 'class' && <ClassBody d={d} cy={cy} onEdgeClick={handleEdgeClick} />}
          </div>
        </>
      )}
    </div>
  );
}

// --- Header sub-components ---

function TypeBadge({ color, label }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      ...monoStyle,
      fontSize: 10.5,
      fontWeight: 'var(--wpds-font-weight-medium)',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      padding: '3px var(--wpds-dimension-padding-sm)',
      borderRadius: 'var(--wpds-border-radius-md)',
      marginBottom: 'var(--wpds-dimension-gap-sm)',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        background: color,
      }} />
      {label}
    </span>
  );
}

function HookHeader({ d }) {
  const badgeDotColor = d.hook_type === 'action' ? 'var(--hg-color-overlap-action)' : 'var(--hg-color-overlap-filter)';
  const sourceName = d.sources && d.sources.length === 1 ? d.sources[0] : (d.sources ? d.sources.join(', ') : '');

  return (
    <>
      <TypeBadge color={badgeDotColor} label={d.hook_type + (d.dynamic ? ' \u00b7 dynamic' : '')} />
      <h3 style={{
        fontSize: 16,
        fontWeight: 600,
        marginBottom: 'var(--wpds-dimension-gap-xs)',
        lineHeight: 1.4,
        paddingRight: 32,
        wordBreak: 'break-word',
        overflowWrap: 'anywhere',
      }}>
        {d.name}
      </h3>
      {sourceName && (
        <Text variant="body-sm" style={{ display: 'block', opacity: 0.6 }}>
          {sourceName}
        </Text>
      )}
      {d.dynamic && d.raw_expression && (
        <div style={{
          ...monoStyle,
          fontSize: 11.5,
          marginTop: 'var(--wpds-dimension-gap-xs)',
          padding: 'var(--wpds-dimension-padding-xs) var(--wpds-dimension-padding-sm)',
          borderRadius: 'var(--wpds-border-radius-md)',
          wordBreak: 'break-all',
          overflowWrap: 'anywhere',
        }}>
          {d.raw_expression}
        </div>
      )}
    </>
  );
}

function FileHeader({ d }) {
  return (
    <>
      <TypeBadge color="#999" label="file" />
      <h3 style={{
        fontSize: 16, fontWeight: 600,
        marginBottom: 'var(--wpds-dimension-gap-xs)', lineHeight: 1.4,
        paddingRight: 32, wordBreak: 'break-word', overflowWrap: 'anywhere',
      }}>
        {d.path}
      </h3>
      <Text variant="body-sm" style={{ display: 'block', opacity: 0.6 }}>
        {d.source}
      </Text>
    </>
  );
}

function ClassHeader({ d }) {
  return (
    <>
      <TypeBadge color="#999" label="class" />
      <h3 style={{
        fontSize: 16, fontWeight: 600,
        marginBottom: 'var(--wpds-dimension-gap-xs)', lineHeight: 1.4,
        paddingRight: 32, wordBreak: 'break-word', overflowWrap: 'anywhere',
      }}>
        {d.name}
      </h3>
      <Text variant="body-sm" style={{ display: 'block', opacity: 0.6 }}>
        {d.source}
      </Text>
    </>
  );
}

// --- Stats grid ---

function StatsGrid({ children, cols }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 2,
      borderRadius: 'var(--wpds-border-radius-lg)',
      padding: `var(--wpds-dimension-padding-lg) ${PANEL_INSET}`,
      marginBottom: 'var(--wpds-dimension-gap-xl)',
    }}>
      {children}
    </div>
  );
}

function StatCell({ number, label }) {
  return (
    <div style={{ padding: 'var(--wpds-dimension-padding-xs) 2px' }}>
      <div style={{
        ...monoStyle,
        fontSize: 22,
        fontWeight: 'var(--wpds-font-weight-medium)',
      }}>
        {number}
      </div>
      <div style={{
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginTop: 3,
      }}>
        {label}
      </div>
    </div>
  );
}

// --- Edge item ---

function EdgeItem({ onClick, children }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: 'var(--wpds-dimension-padding-sm) var(--wpds-dimension-padding-md)',
        fontSize: 'var(--wpds-font-size-sm)',
        lineHeight: 1.5,
        borderRadius: 'var(--wpds-border-radius-lg)',
        cursor: 'pointer',
      }}
    >
      {children}
    </div>
  );
}

function FileRef({ children, style: s }) {
  return (
    <span style={{
      ...monoStyle,
      fontSize: 11.5,
      display: 'block',
      wordBreak: 'break-all',
      overflowWrap: 'anywhere',
      lineHeight: 1.5,
      ...s,
    }}>
      {children}
    </span>
  );
}

function CallbackRef({ children }) {
  return (
    <span style={{
      fontSize: 'var(--wpds-font-size-md)',
      fontWeight: 'var(--wpds-font-weight-medium)',
      display: 'block',
      marginBottom: 2,
    }}>
      {children}
    </span>
  );
}

function EdgeMeta({ children }) {
  return (
    <Stack direction="row" gap="sm" wrap="wrap" style={{ marginTop: 'var(--wpds-dimension-gap-xs)' }}>
      {children}
    </Stack>
  );
}

function MetaLabel({ children }) {
  return (
    <span style={{
      fontSize: 10.5,
      ...monoStyle,
    }}>
      {children}
    </span>
  );
}

function ScopeRef({ children }) {
  return (
    <span style={{
      fontSize: 10.5,
      fontStyle: 'italic',
      ...monoStyle,
    }}>
      {children}
    </span>
  );
}

function DocComment({ children }) {
  return (
    <span style={{
      fontSize: 'var(--wpds-font-size-xs)',
      fontStyle: 'italic',
      display: 'block',
      marginTop: 'var(--wpds-dimension-gap-xs)',
      padding: 'var(--wpds-dimension-padding-xs) var(--wpds-dimension-padding-sm)',
      borderLeft: '2px solid #e0e0e0',
      borderRadius: '0 var(--wpds-border-radius-md) var(--wpds-border-radius-md) 0',
      lineHeight: 1.45,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}>
      {children}
    </span>
  );
}

// --- Body sub-components ---

function HookBody({ d, cy, onEdgeClick }) {
  const fireEdges = cy.edges(`[target="${d.id}"][edgeType="fires"]`);
  const listenEdges = cy.edges(`[target="${d.id}"][edgeType="listens"]`);
  const totalConn = d.listen_count + d.fire_count;

  const sortedListens = listenEdges
    .toArray()
    .sort((a, b) => (a.data().priority || 10) - (b.data().priority || 10));
  const shownListens = sortedListens.slice(0, LISTEN_TRUNCATION_LIMIT);

  const [fireView, setFireView] = useState(EDGE_VIEW);
  const [listenView, setListenView] = useState(EDGE_VIEW);

  const fireData = fireEdges.toArray().map(e => {
    const src = e.source().data();
    const ed = e.data();
    return {
      id: ed.id,
      nodeId: src.id,
      title: src.path || src.name,
      description: [scopeLabel(ed), `line ${ed.line}`].filter(Boolean).join(' \u00b7 '),
      files: src.type === 'class' && src.files?.length > 0 ? src.files.join(', ') : null,
      docComment: ed.docComment,
    };
  });

  const listenData = shownListens.map(e => {
    const src = e.source().data();
    const ed = e.data();
    return {
      id: ed.id,
      nodeId: src.id,
      title: ed.callback || src.path || src.name,
      description: [
        ed.callback ? (src.path || src.name) : null,
        scopeLabel(ed),
        `pri ${ed.priority || 10}`,
        `line ${ed.line}`,
      ].filter(Boolean).join(' \u00b7 '),
      files: src.type === 'class' && src.files?.length > 0 ? src.files.join(', ') : null,
      docComment: ed.docComment,
    };
  });

  function handleEdgeSelect(items) {
    return (ids) => {
      if (ids.length > 0) {
        const item = items.find(i => i.id === ids[0]);
        if (item) onEdgeClick(item.nodeId);
      }
    };
  }

  return (
    <>
      <StatsGrid cols={3}>
        <StatCell number={d.fire_count} label="FIRES" />
        <StatCell number={d.listen_count} label="LISTENS" />
        <StatCell number={totalConn} label="TOTAL" />
      </StatsGrid>

      {fireData.length > 0 && (
        <section style={{ marginBottom: 'var(--wpds-dimension-gap-2xl)' }}>
          <Text variant="body-sm" render={<h4 />} style={sectionHeadingStyle}>Fired by ({fireData.length})</Text>
          <DataViews
            data={fireData}
            fields={edgeFields}
            view={fireView}
            onChangeView={setFireView}
            getItemId={(item) => item.id}
            onChangeSelection={handleEdgeSelect(fireData)}
            selection={[]}
            defaultLayouts={{ list: {} }}
            paginationInfo={{ totalItems: fireData.length, totalPages: 1 }}
          >
            <DataViews.Layout />
          </DataViews>
        </section>
      )}

      {listenData.length > 0 && (
        <section>
          <Text variant="body-sm" render={<h4 />} style={sectionHeadingStyle}>Listened by ({listenEdges.length})</Text>
          <DataViews
            data={listenData}
            fields={edgeFields}
            view={listenView}
            onChangeView={setListenView}
            getItemId={(item) => item.id}
            onChangeSelection={handleEdgeSelect(listenData)}
            selection={[]}
            defaultLayouts={{ list: {} }}
            paginationInfo={{ totalItems: listenData.length, totalPages: 1 }}
          >
            <DataViews.Layout />
          </DataViews>
          {sortedListens.length > LISTEN_TRUNCATION_LIMIT && (
            <Text variant="body-sm" style={{
              display: 'block',
              fontSize: 'var(--wpds-font-size-xs)',
              textAlign: 'center',
              padding: `var(--wpds-dimension-padding-sm) ${PANEL_INSET} 0`,
              opacity: 0.6,
            }}>
              ... showing {LISTEN_TRUNCATION_LIMIT} of {sortedListens.length}
            </Text>
          )}
        </section>
      )}
    </>
  );
}

function FileBody({ d, cy, onEdgeClick }) {
  const fires = cy.edges(`[source="${d.id}"][edgeType="fires"]`);
  const listens = cy.edges(`[source="${d.id}"][edgeType="listens"]`);

  const [fireView, setFireView] = useState(EDGE_VIEW);
  const [listenView, setListenView] = useState(EDGE_VIEW);

  const fireData = fires.toArray().map(e => {
    const tgt = e.target().data();
    const ed = e.data();
    return {
      id: ed.id,
      nodeId: tgt.id,
      title: tgt.name,
      description: [scopeLabel(ed), `line ${ed.line}`].filter(Boolean).join(' \u00b7 '),
      files: null,
      docComment: ed.docComment,
    };
  });

  const listenData = listens.toArray().map(e => {
    const tgt = e.target().data();
    const ed = e.data();
    return {
      id: ed.id,
      nodeId: tgt.id,
      title: ed.callback || tgt.name,
      description: [
        ed.callback ? tgt.name : null,
        scopeLabel(ed),
        `pri ${ed.priority || 10}`,
        `line ${ed.line}`,
      ].filter(Boolean).join(' \u00b7 '),
      files: null,
      docComment: ed.docComment,
    };
  });

  function handleEdgeSelect(items) {
    return (ids) => {
      if (ids.length > 0) {
        const item = items.find(i => i.id === ids[0]);
        if (item) onEdgeClick(item.nodeId);
      }
    };
  }

  return (
    <>
      <StatsGrid cols={2}>
        <StatCell number={fires.length} label="FIRES" />
        <StatCell number={listens.length} label="LISTENS" />
      </StatsGrid>

      {fireData.length > 0 && (
        <section style={{ marginBottom: 'var(--wpds-dimension-gap-2xl)' }}>
          <Text variant="body-sm" render={<h4 />} style={sectionHeadingStyle}>Fires ({fireData.length})</Text>
          <DataViews
            data={fireData}
            fields={edgeFields}
            view={fireView}
            onChangeView={setFireView}
            getItemId={(item) => item.id}
            onChangeSelection={handleEdgeSelect(fireData)}
            selection={[]}
            defaultLayouts={{ list: {} }}
            paginationInfo={{ totalItems: fireData.length, totalPages: 1 }}
          >
            <DataViews.Layout />
          </DataViews>
        </section>
      )}

      {listenData.length > 0 && (
        <section>
          <Text variant="body-sm" render={<h4 />} style={sectionHeadingStyle}>Listens to ({listenData.length})</Text>
          <DataViews
            data={listenData}
            fields={edgeFields}
            view={listenView}
            onChangeView={setListenView}
            getItemId={(item) => item.id}
            onChangeSelection={handleEdgeSelect(listenData)}
            selection={[]}
            defaultLayouts={{ list: {} }}
            paginationInfo={{ totalItems: listenData.length, totalPages: 1 }}
          >
            <DataViews.Layout />
          </DataViews>
        </section>
      )}
    </>
  );
}

function ClassBody({ d, cy, onEdgeClick }) {
  const classFires = cy.edges(`[source="${d.id}"][edgeType="fires"]`);
  const classListens = cy.edges(`[source="${d.id}"][edgeType="listens"]`);

  const [fireView, setFireView] = useState(EDGE_VIEW);
  const [listenView, setListenView] = useState(EDGE_VIEW);

  const fireData = classFires.toArray().map(e => {
    const tgt = e.target().data();
    const ed = e.data();
    return {
      id: ed.id,
      nodeId: tgt.id,
      title: tgt.name,
      description: [scopeLabel(ed), `line ${ed.line}`].filter(Boolean).join(' \u00b7 '),
      files: null,
      docComment: ed.docComment,
    };
  });

  const listenData = classListens.toArray().map(e => {
    const tgt = e.target().data();
    const ed = e.data();
    return {
      id: ed.id,
      nodeId: tgt.id,
      title: ed.callback || tgt.name,
      description: [
        ed.callback ? tgt.name : null,
        scopeLabel(ed),
        `pri ${ed.priority || 10}`,
        `line ${ed.line}`,
      ].filter(Boolean).join(' \u00b7 '),
      files: null,
      docComment: ed.docComment,
    };
  });

  function handleEdgeSelect(items) {
    return (ids) => {
      if (ids.length > 0) {
        const item = items.find(i => i.id === ids[0]);
        if (item) onEdgeClick(item.nodeId);
      }
    };
  }

  return (
    <>
      {d.files && d.files.length > 0 && (
        <section style={{ marginBottom: 'var(--wpds-dimension-gap-2xl)' }}>
          <Text variant="body-sm" render={<h4 />} style={sectionHeadingStyle}>Files ({d.files.length})</Text>
          {d.files.map((f) => (
            <div key={f} style={{
              padding: `var(--wpds-dimension-padding-sm) ${PANEL_INSET}`,
              borderRadius: 'var(--wpds-border-radius-lg)',
            }}>
              <FileRef>{f}</FileRef>
            </div>
          ))}
        </section>
      )}

      <StatsGrid cols={2}>
        <StatCell number={classFires.length} label="FIRES" />
        <StatCell number={classListens.length} label="LISTENS" />
      </StatsGrid>

      {fireData.length > 0 && (
        <section style={{ marginBottom: 'var(--wpds-dimension-gap-2xl)' }}>
          <Text variant="body-sm" render={<h4 />} style={sectionHeadingStyle}>Fires ({fireData.length})</Text>
          <DataViews
            data={fireData}
            fields={edgeFields}
            view={fireView}
            onChangeView={setFireView}
            getItemId={(item) => item.id}
            onChangeSelection={handleEdgeSelect(fireData)}
            selection={[]}
            defaultLayouts={{ list: {} }}
            paginationInfo={{ totalItems: fireData.length, totalPages: 1 }}
          >
            <DataViews.Layout />
          </DataViews>
        </section>
      )}

      {listenData.length > 0 && (
        <section>
          <Text variant="body-sm" render={<h4 />} style={sectionHeadingStyle}>Listens to ({listenData.length})</Text>
          <DataViews
            data={listenData}
            fields={edgeFields}
            view={listenView}
            onChangeView={setListenView}
            getItemId={(item) => item.id}
            onChangeSelection={handleEdgeSelect(listenData)}
            selection={[]}
            defaultLayouts={{ list: {} }}
            paginationInfo={{ totalItems: listenData.length, totalPages: 1 }}
          >
            <DataViews.Layout />
          </DataViews>
        </section>
      )}
    </>
  );
}
