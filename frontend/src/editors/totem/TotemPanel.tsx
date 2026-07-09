import { useEffect, useState } from 'react';
import { ArrowLeftRight, Plus, Shapes, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EDITOR_PALETTE } from '@/editors/shared/colors';
import {
  EVENT_CARDINALITIES,
  LOG_CARDINALITIES,
  TEMPORAL_RELATIONS,
  TEMPORAL_RELATION_LABELS,
  type EventCardinality,
  type LogCardinality,
  type TemporalRelation,
} from '@/editors/shared/model-types';
import {
  ColorSwatches,
  PanelEmptyState,
  PanelField,
  PanelSection,
  PanelSelect,
} from '@/editors/shared/panel';

import type {
  TotemRelationEdgeData,
  TotemRelationEdgeType,
  TotemTypeNodeType,
} from './types';

// ---------------------------------------------------------------------------
// Notation legend
// ---------------------------------------------------------------------------

function LegendLine({ children }: { children: React.ReactNode }) {
  return (
    <svg width="52" height="16" viewBox="0 0 52 16" className="shrink-0">
      <line x1="2" y1="8" x2="50" y2="8" stroke="#0F172A" strokeWidth="1.4" />
      {children}
    </svg>
  );
}

function LegendRow({ glyph, text }: { glyph: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {glyph}
      <span>{text}</span>
    </div>
  );
}

export function NotationLegend() {
  return (
    <PanelSection title="Notation">
      <LegendRow
        glyph={
          <LegendLine>
            <rect x="41" y="3.5" width="9" height="9" fill="#0F172A" />
          </LegendLine>
        }
        text="■ during: lifespans lie within the marked type"
      />
      <LegendRow
        glyph={
          <LegendLine>
            <path d="M 50 8 L 39 2.5 L 39 13.5 Z" fill="#0F172A" />
          </LegendLine>
        }
        text="▶ precedes: lifespans end before the marked type"
      />
      <LegendRow
        glyph={
          <LegendLine>
            <path
              d="M 8 2 L 8 14 M 13 2 L 13 14 M 39 2 L 39 14 M 44 2 L 44 14"
              stroke="#0F172A"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </LegendLine>
        }
        text="∥ parallel: no temporal constraint"
      />
      <LegendRow
        glyph={
          <LegendLine>
            <rect x="18" y="1" width="16" height="14" rx="3" fill="white" />
            <text x="26" y="12" fontSize="10" fill="#334155" textAnchor="middle">
              1..*
            </text>
          </LegendLine>
        }
        text="text = log cardinality (near its target type)"
      />
      <LegendRow
        glyph={
          <LegendLine>
            <rect x="10" y="1.5" width="32" height="13" rx="6.5" fill="#0F172A" />
            <text x="26" y="11" fontSize="8" fill="white" textAnchor="middle">
              0..* – 1
            </text>
          </LegendLine>
        }
        text="pill = event cardinalities (both directions)"
      />
    </PanelSection>
  );
}

// ---------------------------------------------------------------------------
// Overview (nothing selected)
// ---------------------------------------------------------------------------

export function OverviewPanel({
  nodes,
  relationCount,
  onAddType,
  onSelectNode,
}: {
  nodes: TotemTypeNodeType[];
  relationCount: (nodeId: string) => number;
  onAddType: () => void;
  onSelectNode: (nodeId: string) => void;
}) {
  return (
    <div>
      <PanelSection
        title="Object types"
        action={
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onAddType}>
            <Plus className="size-3.5" />
            Add
          </Button>
        }
      >
        {nodes.length === 0 ? (
          <div className="text-xs text-muted-foreground">No object types yet.</div>
        ) : (
          <div className="flex flex-col gap-1">
            {nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => onSelectNode(node.id)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: node.data.color }}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{node.data.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {relationCount(node.id)} rel.
                </span>
              </button>
            ))}
          </div>
        )}
      </PanelSection>
      <NotationLegend />
      {nodes.length === 0 && (
        <PanelEmptyState
          icon={<Shapes className="size-8" />}
          title="Build a TOTeM model"
          lines={[
            'Add object types with the + button on the canvas.',
            'Drag between node handles to relate two types.',
            'Select a relation to set its temporal relation and cardinalities.',
            'Or load the built-in example from the header.',
          ]}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Object type selected
// ---------------------------------------------------------------------------

export function TypePanel({
  node,
  relationCount,
  isNameTaken,
  onRename,
  onColorChange,
  onDelete,
}: {
  node: TotemTypeNodeType;
  relationCount: number;
  isNameTaken: (name: string, exceptNodeId: string) => boolean;
  onRename: (nodeId: string, name: string) => void;
  onColorChange: (nodeId: string, color: string) => void;
  onDelete: (nodeId: string) => void;
}) {
  const [draft, setDraft] = useState(node.data.name);
  useEffect(() => {
    setDraft(node.data.name);
  }, [node.id, node.data.name]);

  const commitName = () => {
    const name = draft.trim();
    if (name === node.data.name) {
      setDraft(node.data.name);
      return;
    }
    if (!name) {
      toast.error('Object type names cannot be empty.');
      setDraft(node.data.name);
      return;
    }
    if (isNameTaken(name, node.id)) {
      toast.error(`An object type named "${name}" already exists.`);
      setDraft(node.data.name);
      return;
    }
    onRename(node.id, name);
  };

  const swatches = EDITOR_PALETTE.includes(node.data.color)
    ? EDITOR_PALETTE
    : [...EDITOR_PALETTE, node.data.color];

  return (
    <div>
      <PanelSection title="Object type">
        <PanelField label="Name">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              } else if (event.key === 'Escape') {
                setDraft(node.data.name);
              }
            }}
            className="h-8"
            aria-label="Object type name"
          />
        </PanelField>
        <PanelField label="Color">
          <ColorSwatches
            colors={swatches}
            value={node.data.color}
            onChange={(color) => onColorChange(node.id, color)}
          />
        </PanelField>
        <div className="text-xs text-muted-foreground">
          {relationCount === 0
            ? 'Not related to any other type yet.'
            : `Part of ${relationCount} relation${relationCount === 1 ? '' : 's'}.`}
        </div>
      </PanelSection>
      <div className="px-4 py-3">
        <Button variant="destructive" size="sm" onClick={() => onDelete(node.id)}>
          <Trash2 className="size-3.5" />
          Delete object type
        </Button>
        <div className="mt-1.5 text-xs text-muted-foreground">
          Deleting also removes its relations.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relation selected
// ---------------------------------------------------------------------------

function temporalOptionLabel(
  relation: TemporalRelation,
  sourceName: string,
  targetName: string,
): string {
  return TEMPORAL_RELATION_LABELS[relation]
    .replace('at target', `at ${targetName}`)
    .replace('at source', `at ${sourceName}`);
}

function DirectionSection({
  title,
  log,
  event,
  onLogChange,
  onEventChange,
}: {
  title: string;
  log: LogCardinality;
  event: EventCardinality;
  onLogChange: (value: LogCardinality) => void;
  onEventChange: (value: EventCardinality) => void;
}) {
  return (
    <PanelSection title={title}>
      <PanelField label="Log cardinality">
        <PanelSelect
          value={log}
          onChange={(value) => onLogChange(value as LogCardinality)}
          options={LOG_CARDINALITIES.map((value) => ({ value, label: value }))}
          ariaLabel={`Log cardinality ${title}`}
        />
      </PanelField>
      <PanelField label="Event cardinality">
        <PanelSelect
          value={event}
          onChange={(value) => onEventChange(value as EventCardinality)}
          options={EVENT_CARDINALITIES.map((value) => ({ value, label: value }))}
          ariaLabel={`Event cardinality ${title}`}
        />
      </PanelField>
    </PanelSection>
  );
}

export function RelationPanel({
  edge,
  sourceName,
  targetName,
  onDataChange,
  onSwapDirection,
  onDelete,
}: {
  edge: TotemRelationEdgeType;
  sourceName: string;
  targetName: string;
  onDataChange: (edgeId: string, data: TotemRelationEdgeData) => void;
  onSwapDirection: (edgeId: string) => void;
  onDelete: (edgeId: string) => void;
}) {
  const data = edge.data;
  if (!data) return null;

  return (
    <div>
      <PanelSection title={`Relation ${sourceName} ↔ ${targetName}`}>
        <PanelField label="Temporal relation">
          <PanelSelect
            value={data.temporal}
            onChange={(value) =>
              onDataChange(edge.id, { ...data, temporal: value as TemporalRelation })
            }
            options={TEMPORAL_RELATIONS.map((relation) => ({
              value: relation,
              label: temporalOptionLabel(relation, sourceName, targetName),
            }))}
            ariaLabel="Temporal relation"
          />
        </PanelField>
      </PanelSection>
      <DirectionSection
        title={`${sourceName} → ${targetName}`}
        log={data.sourceToTarget.log}
        event={data.sourceToTarget.event}
        onLogChange={(log) =>
          onDataChange(edge.id, { ...data, sourceToTarget: { ...data.sourceToTarget, log } })
        }
        onEventChange={(event) =>
          onDataChange(edge.id, { ...data, sourceToTarget: { ...data.sourceToTarget, event } })
        }
      />
      <DirectionSection
        title={`${targetName} → ${sourceName}`}
        log={data.targetToSource.log}
        event={data.targetToSource.event}
        onLogChange={(log) =>
          onDataChange(edge.id, { ...data, targetToSource: { ...data.targetToSource, log } })
        }
        onEventChange={(event) =>
          onDataChange(edge.id, { ...data, targetToSource: { ...data.targetToSource, event } })
        }
      />
      <div className="flex flex-col items-start gap-2 px-4 py-3">
        <Button variant="ghost" size="sm" onClick={() => onSwapDirection(edge.id)}>
          <ArrowLeftRight className="size-3.5" />
          Swap reading direction
        </Button>
        <Button variant="destructive" size="sm" onClick={() => onDelete(edge.id)}>
          <Trash2 className="size-3.5" />
          Delete relation
        </Button>
      </div>
    </div>
  );
}
