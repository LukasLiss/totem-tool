import { useState, useEffect, useCallback, useMemo, useId } from 'react';
import axios from 'axios';
import {
  ReactFlow,
  useReactFlow,
  type Node,
  type Edge,
  Background,
  Controls,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { getTotemLayoutedElements } from '../utils/TotemLayouting';
import { buildLayers } from './TotemVisualizer';
import TotemAreaNode from './TotemAreaNode';
import TotemObjectNode from './TotemObjectNode';
import TotemEdge from './TotemEdge';

export type TotemVisualizerControls = {
  processAreaScale: number;
  onProcessAreaScaleChange: (value: number) => void;
  autoZoomEnabled: boolean;
  onAutoZoomToggle: () => void;
  minScale: number;
  maxScale: number;
  scaleStep: number;
};

type TotemVisualizerProps = {
  eventLogId?: number | string | null;
  height?: string | number;
  backendBaseUrl?: string;
  reloadSignal?: number;
  title?: string;
  topInset?: number;
  embedded?: boolean;
  onControlsReady?: (controls: TotemVisualizerControls) => void;
};

const nodeTypes = {
  totemArea: TotemAreaNode,
  totemObject: TotemObjectNode,
};

const edgeTypes = {
  totemEdge: TotemEdge,
};

const DEFAULT_BACKEND = 'http://127.0.0.1:8000';

function normaliseHex(hex: string) {
  if (!hex) return '#3B82F6';
  if (hex.startsWith('#')) return hex;
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`;
  return '#3B82F6';
}

export default function NewTotemVisualizer({
  eventLogId,
  height = '100%',
  backendBaseUrl = DEFAULT_BACKEND,
  reloadSignal,
  onControlsReady,
}: TotemVisualizerProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(false);
  const { fitView } = useReactFlow();

  const loadData = useCallback(async () => {
    if (!eventLogId) return;
    setLoading(true);
    try {
      const response = await axios.get(`${backendBaseUrl}/api/files/${eventLogId}/discover_mlpa/`);
      const data = response.data;
      
      const initialNodes: Node[] = [];
      const initialEdges: Edge[] = [];
      
      const objectTypeColors: Record<string, string> = {};
      // Simplistic coloring based on index for now, or use mapped colors if available
      const colors = ['#3b82f6', '#10b981', '#06b6d4', '#f59e0b', '#8b5cf6', '#f43f5e'];
      
      let colorIdx = 0;
      
      const parsedLayers = buildLayers(data, true);
      
      if (parsedLayers) {
        parsedLayers.forEach((layer) => {
          layer.areas.forEach((area) => {
            // Process Area Node
            initialNodes.push({
              id: area.id,
              type: 'totemArea',
              position: { x: 0, y: 0 },
              data: {
                label: area.label,
                level: layer.level,
                objectTypeCount: area.objectTypes.length,
              },
            });
            
            // Object Type Nodes
            area.objectTypes.forEach((objType: string) => {
              if (!objectTypeColors[objType]) {
                objectTypeColors[objType] = colors[colorIdx % colors.length];
                colorIdx++;
              }
              
              initialNodes.push({
                id: objType,
                type: 'totemObject',
                position: { x: 0, y: 0 },
                parentId: area.id,
                extent: 'parent',
                data: {
                  label: objType,
                  color: objectTypeColors[objType],
                },
              });
            });
          });
        });
      }

      if (data.tempgraph) {
        ['P', 'D', 'I', 'A'].forEach(relation => {
          const links = data.tempgraph[relation];
          if (links) {
            links.forEach((link: any, idx: number) => {
              // Sometimes link is [source, target], sometimes it's an object?
              // The API usually returns arrays of [source, target] for relations.
              if (Array.isArray(link) && link.length >= 2) {
                const source = link[0];
                const target = link[1];
                initialEdges.push({
                  id: `${relation}-${source}-${target}-${idx}`,
                  source,
                  target,
                  type: 'totemEdge',
                  data: {
                    relation,
                    color: '#0f172a', // Edge color
                  }
                });
              }
            });
          }
        });
      }

      const layouted = await getTotemLayoutedElements(initialNodes, initialEdges);
      setNodes(layouted.nodes);
      setEdges(layouted.edges);
      
      setTimeout(() => {
        fitView({ padding: 0.2, duration: 800 });
      }, 100);

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [eventLogId, backendBaseUrl]);

  useEffect(() => {
    loadData();
  }, [loadData, reloadSignal]);

  useEffect(() => {
    if (onControlsReady) {
      onControlsReady({
        processAreaScale: 1,
        onProcessAreaScaleChange: () => {},
        autoZoomEnabled: true,
        onAutoZoomToggle: () => {},
        minScale: 0.2,
        maxScale: 2,
        scaleStep: 0.1,
      });
    }
  }, [onControlsReady]);

  return (
    <div style={{ width: '100%', height: typeof height === 'number' ? `${height}px` : height, background: '#FAFAFA' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
        nodesConnectable={false}
        elementsSelectable={true}
        nodesDraggable={true} // Allow dragging for layout adjustments
      >
        <Background color="#ccc" gap={24} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
