import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCcw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { mapTypesToColors } from '../utils/objectColors';

type TotemApiResponse = {
  tempgraph: {
    nodes?: string[];
    [relation: string]: string[] | string[][];
  };
  type_relations?: Array<string[]>;
  all_event_types?: string[];
  object_type_to_event_types?: Record<string, string[]>;
};

type ProcessAreaDefinition = {
  id: string;
  level: number;
  label: string;
  objectTypes: string[];
};

type ProcessLayer = {
  level: number;
  areas: ProcessAreaDefinition[];
};

type TotemVisualizerProps = {
  eventLogId?: number | string | null;
  height?: string | number;
  backendBaseUrl?: string;
};

const DEFAULT_BACKEND = 'http://127.0.0.1:8000';

function resolveHeight(height: string | number) {
  return typeof height === 'number' ? `${height}px` : height;
}

function normaliseHex(hex: string) {
  if (!hex) return '#1F2937';
  if (hex.startsWith('#')) return hex;
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`;
  return '#1F2937';
}

function lighten(hex: string, factor = 0.7) {
  const sanitized = normaliseHex(hex).replace('#', '');
  if (sanitized.length !== 6) return '#E2E8F0';
  const clamp = (value: number) => Math.min(255, Math.max(0, value));
  const r = parseInt(sanitized.slice(0, 2), 16);
  const g = parseInt(sanitized.slice(2, 4), 16);
  const b = parseInt(sanitized.slice(4, 6), 16);
  const mix = (channel: number) => clamp(Math.round(channel + (255 - channel) * factor));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function computeLevelAssignments(data: TotemApiResponse): Map<string, number> {
  const nodes = new Set<string>();
  const adjacency = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();

  const ensureNode = (node: string | undefined | null) => {
    if (!node) return;
    nodes.add(node);
    if (!adjacency.has(node)) adjacency.set(node, new Set());
    if (!indegree.has(node)) indegree.set(node, 0);
  };

  (data.tempgraph?.nodes ?? []).forEach((node) => ensureNode(node));

  const addEdge = (source?: string, target?: string) => {
    if (!source || !target) return;
    ensureNode(source);
    ensureNode(target);
    const neighbours = adjacency.get(source)!;
    if (!neighbours.has(target)) {
      neighbours.add(target);
      indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
  };

  const dependentEdges = data.tempgraph?.D as string[][];
  if (Array.isArray(dependentEdges)) {
    dependentEdges.forEach((pair) => {
      if (Array.isArray(pair) && pair.length >= 2) {
        addEdge(pair[0], pair[1]);
      }
    });
  }

  const dependentInverseEdges = (data.tempgraph as Record<string, unknown>)?.Di as string[][];
  if (Array.isArray(dependentInverseEdges)) {
    dependentInverseEdges.forEach((pair) => {
      if (Array.isArray(pair) && pair.length >= 2) {
        addEdge(pair[1], pair[0]);
      }
    });
  }

  nodes.forEach((node) => ensureNode(node));

  const queue: string[] = [];
  indegree.forEach((value, node) => {
    if (value === 0) {
      queue.push(node);
    }
  });

  const levels = new Map<string, number>();
  const visited = new Set<string>();

  queue.forEach((node) => {
    if (!levels.has(node)) {
      levels.set(node, 0);
    }
  });

  while (queue.length > 0) {
    const node = queue.shift()!;
    visited.add(node);
    const currentLevel = levels.get(node) ?? 0;

    adjacency.get(node)?.forEach((neighbour) => {
      const proposed = currentLevel + 1;
      const previous = levels.get(neighbour) ?? 0;
      if (proposed > previous) {
        levels.set(neighbour, proposed);
      }
      const remaining = (indegree.get(neighbour) ?? 0) - 1;
      indegree.set(neighbour, remaining);
      if (remaining <= 0 && !visited.has(neighbour)) {
        queue.push(neighbour);
      }
    });
  }

  const sortedFallback = Array.from(nodes).sort((a, b) => a.localeCompare(b));
  sortedFallback.forEach((node) => {
    if (!levels.has(node)) {
      levels.set(node, 0);
    }
  });

  const levelValues = Array.from(levels.values());
  const minLevel = levelValues.length > 0 ? Math.min(...levelValues) : 0;
  if (minLevel !== 0 && Number.isFinite(minLevel)) {
    levels.forEach((value, key) => {
      levels.set(key, value - minLevel);
    });
  }

  return levels;
}

function computeProcessAreas(
  levels: Map<string, number>,
  typeRelations?: Array<string[]>,
): ProcessAreaDefinition[] {
  const nodesByLevel = new Map<number, string[]>();
  levels.forEach((level, node) => {
    const numericLevel = Number.isFinite(level) ? level : 0;
    if (!nodesByLevel.has(numericLevel)) {
      nodesByLevel.set(numericLevel, []);
    }
    nodesByLevel.get(numericLevel)!.push(node);
  });

  const adjacency = new Map<string, Set<string>>();
  typeRelations?.forEach((relation) => {
    if (!Array.isArray(relation)) return;
    for (let i = 0; i < relation.length; i += 1) {
      for (let j = i + 1; j < relation.length; j += 1) {
        const a = relation[i];
        const b = relation[j];
        if (!a || !b) continue;
        if (!adjacency.has(a)) adjacency.set(a, new Set());
        if (!adjacency.has(b)) adjacency.set(b, new Set());
        adjacency.get(a)!.add(b);
        adjacency.get(b)!.add(a);
      }
    }
  });

  const areas: ProcessAreaDefinition[] = [];
  const sortedLevels = Array.from(nodesByLevel.keys()).sort((a, b) => a - b);

  sortedLevels.forEach((level) => {
    const nodes = nodesByLevel.get(level)?.slice().sort((a, b) => a.localeCompare(b)) ?? [];
    const seen = new Set<string>();
    let areaIndex = 0;

    nodes.forEach((node) => {
      if (seen.has(node)) return;
      const stack = [node];
      const group: string[] = [];

      while (stack.length > 0) {
        const current = stack.pop()!;
        if (seen.has(current)) continue;
        seen.add(current);
        group.push(current);
        adjacency.get(current)?.forEach((neighbour) => {
          if (!seen.has(neighbour) && (levels.get(neighbour) ?? level) === level) {
            stack.push(neighbour);
          }
        });
      }

      group.sort((a, b) => a.localeCompare(b));
      const alphabetIndex = String.fromCharCode(65 + (areaIndex % 26));
      const repetition = areaIndex >= 26 ? Math.floor(areaIndex / 26) + 1 : '';
      const suffix = group.length > 0 ? `-${alphabetIndex}${repetition}` : '';
      areas.push({
        id: `process-area-${level}-${areaIndex}`,
        level,
        label: `Process Area ${level}${suffix}`,
        objectTypes: group,
      });
      areaIndex += 1;
    });

    if (nodes.length === 0 && !areas.some((area) => area.level === level)) {
      areas.push({
        id: `process-area-${level}-empty`,
        level,
        label: `Process Area ${level}`,
        objectTypes: [],
      });
    }
  });

  return areas;
}

function buildLayers(data: TotemApiResponse): ProcessLayer[] {
  const levels = computeLevelAssignments(data);
  if (levels.size === 0) return [];
  const areas = computeProcessAreas(levels, data.type_relations);
  const areasByLevel = new Map<number, ProcessAreaDefinition[]>();

  areas.forEach((area) => {
    if (!areasByLevel.has(area.level)) {
      areasByLevel.set(area.level, []);
    }
    areasByLevel.get(area.level)!.push(area);
  });

  areasByLevel.forEach((entries) => {
    entries.sort((a, b) => a.label.localeCompare(b.label));
  });

  const sortedLevels = Array.from(areasByLevel.keys()).sort((a, b) => b - a);
  return sortedLevels.map((level) => ({
    level,
    areas: areasByLevel.get(level) ?? [],
  }));
}

function TotemVisualizer({
  eventLogId,
  height = '100%',
  backendBaseUrl = DEFAULT_BACKEND,
}: TotemVisualizerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawTotem, setRawTotem] = useState<TotemApiResponse | null>(null);

  const layers = useMemo(() => (rawTotem ? buildLayers(rawTotem) : []), [rawTotem]);
  const typeColorMap = useMemo(
    () => mapTypesToColors(rawTotem?.tempgraph?.nodes ?? []),
    [rawTotem?.tempgraph?.nodes],
  );

  const fetchTotem = useCallback(async () => {
    if (!eventLogId) {
      setRawTotem(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch(
        `${backendBaseUrl}/api/eventlogs/${eventLogId}/discover_totem/`,
        {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Backend responded with ${response.status}`);
      }

      const payload: TotemApiResponse = await response.json();
      setRawTotem(payload);
    } catch (err) {
      console.error('[TotemVisualizer] Failed to load Totem data', err);
      setError(err instanceof Error ? err.message : 'Failed to load Totem data');
      setRawTotem(null);
    } finally {
      setLoading(false);
    }
  }, [backendBaseUrl, eventLogId]);

  useEffect(() => {
    fetchTotem();
  }, [fetchTotem]);

  const computedHeight = resolveHeight(height);
  const hasLayers = layers.length > 0;

  return (
    <div className="relative flex-1" style={{ height: computedHeight, width: '100%' }}>
      {!eventLogId && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-5 shadow-md">
            <Badge variant="outline">Totem Visualizer</Badge>
            <p className="text-sm text-slate-600">Select an event log to discover its Totem model.</p>
          </div>
        </div>
      )}

      <div
        style={{
          position: 'relative',
          height: '100%',
          width: '100%',
          overflow: 'auto',
          padding: '32px 32px 72px',
          boxSizing: 'border-box',
          background: '#FFFFFF',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <Button
            variant="outline"
            onClick={fetchTotem}
            disabled={!eventLogId || loading}
            className="flex items-center gap-2"
          >
            <RefreshCcw className="h-4 w-4" />
            Reload
          </Button>
        </div>

        {error && (
          <div
            style={{
              marginBottom: 24,
              padding: '12px 14px',
              borderRadius: 12,
              border: '1px solid rgba(248, 113, 113, 0.4)',
              background: 'rgba(254, 226, 226, 0.65)',
              color: '#991B1B',
              fontSize: 14,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <span>{error}</span>
            <Button size="sm" variant="ghost" onClick={fetchTotem} disabled={loading}>
              Retry
            </Button>
          </div>
        )}

        {hasLayers ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {layers.map((layer) => (
              <section
                key={`layer-${layer.level}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 24,
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      gap: 14,
                      flexWrap: 'wrap',
                      flex: 1,
                    }}
                  >
                    {layer.areas.map((area) => (
                      <div
                        key={area.id}
                        style={{
                          flex: '0 0 280px',
                          minHeight: 150,
                          borderRadius: 24,
                          background: 'rgba(59, 130, 246, 0.16)',
                          border: '1px solid rgba(37, 99, 235, 0.35)',
                          boxShadow: 'inset 0 0 0 1px rgba(37, 99, 235, 0.12)',
                          padding: '16px 20px 20px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 14,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'baseline',
                            justifyContent: 'space-between',
                            gap: 12,
                            color: '#1D4ED8',
                          }}
                        >
                          <span style={{ fontSize: 16, fontWeight: 600 }}>{area.label}</span>
                          <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.8 }}>
                            {area.objectTypes.length > 0
                              ? `${area.objectTypes.length} type${area.objectTypes.length === 1 ? '' : 's'}`
                              : 'No types'}
                          </span>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 10,
                            alignItems: 'flex-start',
                          }}
                        >
                          {area.objectTypes.length > 0 ? (
                            area.objectTypes.map((objectType) => {
                              const baseColor = typeColorMap[objectType];
                              return (
                                <span
                                  key={objectType}
                                  style={{
                                    padding: '6px 10px',
                                    borderRadius: 12,
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: '#0F172A',
                                    background: lighten(baseColor, 0.78),
                                    border: `1px solid ${lighten(baseColor, 0.55)}`,
                                  }}
                                >
                                  {objectType}
                                </span>
                              );
                            })
                          ) : (
                            <span
                              style={{
                                fontSize: 13,
                                color: 'rgba(29, 78, 216, 0.6)',
                                fontStyle: 'italic',
                              }}
                            >
                              No object types assigned yet
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <header
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: 3,
                      color: '#0F172A',
                      minWidth: 120,
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                      Level {layer.level}
                    </span>
                    <span style={{ fontSize: 12, color: '#64748B', textAlign: 'right' }}>
                      {layer.areas.reduce((acc, area) => acc + area.objectTypes.length, 0)} object
                      type{layer.areas.reduce((acc, area) => acc + area.objectTypes.length, 0) === 1 ? '' : 's'}
                    </span>
                  </header>
                </div>
              </section>
            ))}
          </div>
        ) : (
          !loading && (
            <div
              style={{
                marginTop: 48,
                borderRadius: 16,
                border: '1px dashed #CBD5F5',
                background: '#FFFFFF',
                padding: '40px 48px',
                textAlign: 'center',
                color: '#475569',
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                No process areas discovered yet
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.6 }}>
                Run Totem discovery for the selected event log to populate process layers and object types.
              </p>
            </div>
          )
        )}
      </div>

      {loading && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-white/60 backdrop-blur-sm">
          <div className="rounded-md border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-600 shadow-lg">
            Discovering Totem model…
          </div>
        </div>
      )}
    </div>
  );
}

export default TotemVisualizer;
