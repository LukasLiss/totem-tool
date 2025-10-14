import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  Panel,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  layoutOCDFG,
  type DfgNode,
  type DfgLink,
} from '../utils/GraphLayouter';
import { mapTypesToColors } from '../utils/objectColors';
import OcdfgEdge from './OcdfgEdge';
import OcdfgTerminalNode from './OcdfgTerminalNode';
import OcdfgDefaultNode from './OcdfgDefaultNode';

// Define specific types for the data we expect from the backend
interface DfgData {
  dfg: {
    nodes: DfgNode[];
    links: DfgLink[];
  };
}

function OCDFGVisualizer() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [typeColors, setTypeColors] = useState<Record<string, string>>({});
  const { fitView } = useReactFlow();
  const edgeTypes = useMemo(() => ({ ocdfg: OcdfgEdge }), []);
  const nodeTypes = useMemo(
    () => ({
      ocdfgStart: OcdfgTerminalNode,
      ocdfgEnd: OcdfgTerminalNode,
      ocdfgDefault: OcdfgDefaultNode,
    }),
    [],
  );

  const onNodesChange = useCallback((c) => setNodes((nds) => applyNodeChanges(c, nds)), []);
  const onEdgesChange = useCallback((c) => setEdges((eds) => applyEdgeChanges(c, eds)), []);

  useEffect(() => {
    fetch('http://127.0.0.1:8000/api/ocdfg/')
      .then((response) => response.json())
      .then((data: DfgData) => {
        const { nodes: dfgNodes, links: dfgLinks } = data.dfg;

        const allTypes = Array.from(
          new Set(dfgNodes.flatMap(node => node.types ?? [])),
        );
        const colors = mapTypesToColors(allTypes);
        setTypeColors(colors);
        const groupCounts: Record<string, number> = {};
        dfgLinks.forEach(link => {
          const key = `${link.source}->${link.target}`;
          groupCounts[key] = (groupCounts[key] ?? 0) + 1;
        });
        const groupIndex: Record<string, number> = {};
        const incomingCounts: Record<string, number> = {};
        const outgoingCounts: Record<string, number> = {};
        dfgLinks.forEach(link => {
          incomingCounts[link.target] = (incomingCounts[link.target] ?? 0) + 1;
          outgoingCounts[link.source] = (outgoingCounts[link.source] ?? 0) + 1;
        });

        const nodeVariantMap: Record<string, 'start' | 'end' | 'center' | undefined> = {};

        // Create standard React Flow nodes (no custom types)
        const initialNodes: Node[] = dfgNodes.map((node) => {
          const isStart = (incomingCounts[node.id] ?? 0) === 0;
          const isEnd = !isStart && (outgoingCounts[node.id] ?? 0) === 0;
          const fillColor = (node.types?.[0] && colors[node.types[0]]) || '#2563EB';
          const variant: 'start' | 'end' | 'center' = isStart ? 'start' : (isEnd ? 'end' : 'center');
          const cleanLabel = (node.label || node.id || '').trim();
          const approxLines = cleanLabel.length === 0
            ? 1
            : Math.max(1, Math.ceil(cleanLabel.length / 22));
          const baseHeight = Math.max(60, approxLines * 22);
          const minHeight = baseHeight + 0; // include vertical padding allowance
          const sharedData = {
            label: node.label || node.id,
            types: node.types ?? [],
            colors,
            fillColor,
            nodeVariant: variant,
            isStart,
          };
          const terminalLabel = (node.types && node.types.length > 0)
            ? node.types[0]
            : (cleanLabel.replace(/\s+(start|end)$/i, '').trim() || node.id);

          if (isStart) {
            nodeVariantMap[node.id] = 'start';
            return {
              id: node.id,
              type: 'ocdfgStart' as const,
              data: { ...sharedData, label: terminalLabel, sizePreset: 'terminal' },
              width: 80,
              height: 80,
              style: {
                width: 80,
                height: 80,
                padding: 0,
                border: 'none',
                boxShadow: 'none',
                background: 'transparent',
              },
              position: { x: 0, y: 0 }, // Position set by layout manager
            };
          }

          if (isEnd) {
            nodeVariantMap[node.id] = 'end';
            return {
              id: node.id,
              type: 'ocdfgEnd' as const,
              data: { ...sharedData, label: terminalLabel, sizePreset: 'terminal' },
              width: 80,
              height: 80,
              style: {
                width: 80,
                height: 80,
                padding: 0,
                border: 'none',
                boxShadow: 'none',
                background: 'transparent',
              },
              position: { x: 0, y: 0 },
            };
          }

          nodeVariantMap[node.id] = 'center';
          return {
            id: node.id,
            type: 'ocdfgDefault' as const,
            data: sharedData,
            position: { x: 0, y: 0 }, // Position will be set by the layout manager
            style: {
              background: '#FFFFFF',
              color: '#000000',
              border: '1px solid #000000',
              borderRadius: 12,
              padding: 14,
              minHeight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-primary, Inter, sans-serif)',
              fontWeight: 500,
              letterSpacing: '-0.01em',
              boxShadow: 'none',
              minWidth: 180,
            },
          };
        });

        initialNodes.forEach((node) => {
          const variant = (node.data as { nodeVariant?: 'start' | 'end' | 'center' } | undefined)?.nodeVariant;
          if (variant === 'start' || variant === 'end' || variant === 'center') {
            nodeVariantMap[node.id] = variant;
          }
        });

        const initialEdges: Edge[] = dfgLinks.map((link, index) => {
          const key = `${link.source}->${link.target}`;
          const currentIndex = groupIndex[key] ?? 0;
          groupIndex[key] = currentIndex + 1;
          return {
            id: `e${index}-${link.source}-${link.target}`,
            source: link.source,
            target: link.target,
            type: 'ocdfg',
            data: {
              owners: link.owners ?? [],
              colors,
              parallelIndex: currentIndex,
              parallelCount: groupCounts[key],
              sourceVariant: nodeVariantMap[link.source],
              targetVariant: nodeVariantMap[link.target],
            },
          } as Edge;
        });

        // Pass the elements to the layout manager to generate positions
        layoutOCDFG({
          renderNodes: initialNodes,
          renderEdges: initialEdges,
          dfgNodes,
          dfgLinks,
        }).then(({ nodes, edges }) => {
          setNodes(nodes);
          setEdges(edges);
          window.requestAnimationFrame(() => fitView());
        }).catch(console.error);
      })
      .catch(console.error);
  }, [fitView]);
  
  // The relayout button reuses the central layout manager
  const onLayout = useCallback(() => {
    const currentDfgNodes: DfgNode[] = nodes.map(n => ({
      id: n.id,
      label: (n.data as { label?: string }).label ?? n.id,
      types: (n.data as { types?: string[] }).types ?? [],
    }));
    const currentDfgLinks: DfgLink[] = edges.map(e => ({
      source: e.source!,
      target: e.target!,
      owners: (e.data as { owners?: string[] })?.owners ?? [],
    }));
    layoutOCDFG({
      renderNodes: nodes,
      renderEdges: edges,
      dfgNodes: currentDfgNodes,
      dfgLinks: currentDfgLinks,
    }).then(({ nodes, edges }) => {
        setNodes(nodes);
        setEdges(edges);
        window.requestAnimationFrame(() => fitView());
    }).catch(console.error);
  }, [nodes, edges, fitView]);

  return (
    <div style={{ height: 'calc(100vh - 50px)', width: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        edgeTypes={edgeTypes}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.25}
        maxZoom={2.5}
      >
        <Controls />
        <Background />
        <Panel position="top-right">
          <button onClick={onLayout}>Relayout</button>
        </Panel>
      </ReactFlow>

      {Object.keys(typeColors).length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            background: 'rgba(255,255,255,0.87)',
            border: '1px solid #E2E8F0',
            borderRadius: 12,
            padding: '12px 16px',
            boxShadow: '0 12px 24px rgba(15, 23, 42, 0.12)',
            backdropFilter: 'blur(12px)',
            fontFamily: 'var(--font-primary, Inter, sans-serif)',
            maxHeight: '50%',
            overflowY: 'auto',
            minWidth: 240,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A', marginBottom: 8 }}>
            Object Types
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Object.entries(typeColors).map(([type, color]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: color,
                    border: '1px solid rgba(15, 23, 42, 0.12)',
                    boxShadow: '0 4px 8px rgba(15, 23, 42, 0.18)',
                  }}
                />
                <span style={{ fontSize: 13, color: '#475569', letterSpacing: '-0.01em' }}>{type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default OCDFGVisualizer;
