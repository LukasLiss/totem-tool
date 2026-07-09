import { useState } from 'react';
import { MousePointerClick, Pencil, Plus, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ColorSwatches,
  CommitInput,
  PanelEmptyState,
  PanelField,
  PanelSection,
  PanelSelect,
} from '@/editors/shared/panel';
import { EDITOR_PALETTE } from '@/editors/shared/colors';
import { cn } from '@/lib/utils';

import {
  FALLBACK_TYPE_COLOR,
  type ActivityFlowNode,
  type ArcFlowEdge,
  type ControlFlowNode,
  type OcdfgObjectType,
} from './types';

// ---------------------------------------------------------------------------
// Selection descriptor computed by the editor
// ---------------------------------------------------------------------------

export type OcdfgSelection =
  | { kind: 'activity'; node: ActivityFlowNode }
  | { kind: 'control'; node: ControlFlowNode }
  | {
      kind: 'arc';
      edge: ArcFlowEdge;
      sourceLabel: string;
      targetLabel: string;
      /** True when an endpoint is a START/END node (type follows that node). */
      typeLocked: boolean;
    };

type SidePanelProps = {
  objectTypes: OcdfgObjectType[];
  activeType: string | null;
  arcCounts: Record<string, number>;
  selection: OcdfgSelection | null;
  onSetActiveType: (name: string) => void;
  onAddType: () => void;
  onRenameType: (oldName: string, newName: string) => boolean;
  onChangeTypeColor: (name: string, color: string) => void;
  onDeleteType: (name: string) => void;
  onChangeActivityLabel: (activityId: string, label: string) => void;
  onChangeArcType: (arcId: string, objectType: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
};

// ---------------------------------------------------------------------------
// Notation legend
// ---------------------------------------------------------------------------

function LegendRow({ glyph, text }: { glyph: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
      <span className="flex w-9 shrink-0 items-center justify-center">{glyph}</span>
      <span>{text}</span>
    </div>
  );
}

function NotationLegend() {
  const accent = '#10B981';
  return (
    <PanelSection title="Notation">
      <LegendRow
        glyph={
          <svg width={22} height={22} viewBox="0 0 22 22">
            <circle cx={11} cy={11} r={9} fill={accent} stroke={accent} strokeWidth={2} />
            <polygon points="8,6.5 16,11 8,15.5" fill="#fff" />
          </svg>
        }
        text="START node — where objects of a type begin"
      />
      <LegendRow
        glyph={
          <svg width={22} height={22} viewBox="0 0 22 22">
            <circle cx={11} cy={11} r={9} fill={accent} stroke={accent} strokeWidth={2} />
            <rect x={7.5} y={7.5} width={7} height={7} fill="#fff" />
          </svg>
        }
        text="END node — where objects of a type finish"
      />
      <LegendRow
        glyph={
          <svg width={36} height={14} viewBox="0 0 36 14">
            <line x1={1} y1={7} x2={30} y2={7} stroke={accent} strokeWidth={2.5} />
            <polygon points="35,7 28,3.5 28,10.5" fill={accent} />
          </svg>
        }
        text="Arc color: object type of the directly-follows relation"
      />
      <LegendRow
        glyph={
          <svg width={30} height={22} viewBox="0 0 30 22">
            <path
              d="M 8,8 C 14,-4 26,4 18,12"
              fill="none"
              stroke={accent}
              strokeWidth={2.5}
            />
            <polygon points="18,14 14,7 22,8" fill={accent} />
          </svg>
        }
        text="Self-loops: an activity directly follows itself"
      />
      <LegendRow
        glyph={
          <span className="flex gap-1">
            <span className="size-[7px] rounded-full" style={{ background: '#10B981' }} />
            <span className="size-[7px] rounded-full" style={{ background: '#2563EB' }} />
          </span>
        }
        text="Dots: object types an activity touches"
      />
    </PanelSection>
  );
}

// ---------------------------------------------------------------------------
// Object type manager (default panel)
// ---------------------------------------------------------------------------

function ObjectTypeManager({
  objectTypes,
  activeType,
  arcCounts,
  onSetActiveType,
  onAddType,
  onRenameType,
  onChangeTypeColor,
  onDeleteType,
}: Pick<
  SidePanelProps,
  | 'objectTypes'
  | 'activeType'
  | 'arcCounts'
  | 'onSetActiveType'
  | 'onAddType'
  | 'onRenameType'
  | 'onChangeTypeColor'
  | 'onDeleteType'
>) {
  const [editing, setEditing] = useState<string | null>(null);
  const editingType = objectTypes.find((t) => t.name === editing) ?? null;

  return (
    <PanelSection
      title="Object types"
      action={
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onAddType}>
          <Plus className="size-3.5" />
          Add type
        </Button>
      }
    >
      {objectTypes.length === 0 && (
        <div className="text-xs text-muted-foreground">
          No object types yet — every arc belongs to one. Drawing an arc or
          adding a START/END node creates one automatically.
        </div>
      )}
      {objectTypes.map((type) => {
        const isActive = type.name === activeType;
        const isEditing = type.name === editing;
        return (
          <div key={type.name} className="flex flex-col gap-2">
            <div
              className={cn(
                'flex items-center gap-2 rounded-md px-1.5 py-1',
                isActive && 'ring-2 ring-blue-500/40 bg-blue-50/50',
              )}
            >
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ background: type.color }}
              />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                title="Make this the active type for new arcs and START/END nodes"
                onClick={() => onSetActiveType(type.name)}
              >
                {type.name}
              </button>
              <span className="text-[11px] text-muted-foreground">
                {arcCounts[type.name] ?? 0} arc{(arcCounts[type.name] ?? 0) === 1 ? '' : 's'}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={`Edit type ${type.name}`}
                onClick={() => setEditing(isEditing ? null : type.name)}
              >
                {isEditing ? <X className="size-3.5" /> : <Pencil className="size-3.5" />}
              </Button>
            </div>
            {isEditing && editingType && (
              <div className="flex flex-col gap-2 rounded-md border bg-background/60 p-2">
                <PanelField label="Name">
                  <CommitInput
                    value={editingType.name}
                    ariaLabel="Object type name"
                    onCommit={(name) => {
                      if (onRenameType(editingType.name, name)) setEditing(name.trim());
                    }}
                  />
                </PanelField>
                <PanelField label="Color">
                  <ColorSwatches
                    colors={EDITOR_PALETTE}
                    value={editingType.color}
                    onChange={(color) => onChangeTypeColor(editingType.name, color)}
                  />
                </PanelField>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setEditing(null);
                    onDeleteType(editingType.name);
                  }}
                >
                  Delete type & its arcs
                </Button>
              </div>
            )}
          </div>
        );
      })}
      {objectTypes.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          New arcs and START/END nodes use the highlighted active type.
        </div>
      )}
    </PanelSection>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function OcdfgSidePanel(props: SidePanelProps) {
  const { selection, objectTypes } = props;

  if (!selection) {
    return (
      <div>
        <ObjectTypeManager {...props} />
        <NotationLegend />
        <PanelEmptyState
          icon={<MousePointerClick className="size-6" />}
          title="Nothing selected"
          lines={[
            'Add activities and START/END nodes from the toolbar.',
            'Drag between handles to draw typed arcs.',
            'Select an element to edit its properties.',
          ]}
        />
      </div>
    );
  }

  if (selection.kind === 'activity') {
    const { node } = selection;
    return (
      <div>
        <PanelSection title="Activity">
          <PanelField label="Name">
            <CommitInput
              value={node.data.label}
              placeholder="Activity name"
              ariaLabel="Activity name"
              onCommit={(label) => props.onChangeActivityLabel(node.id, label)}
            />
          </PanelField>
          <Button variant="destructive" size="sm" onClick={() => props.onDeleteNode(node.id)}>
            Delete activity
          </Button>
        </PanelSection>
      </div>
    );
  }

  if (selection.kind === 'control') {
    const { node } = selection;
    return (
      <div>
        <PanelSection title={node.data.kind === 'start' ? 'START node' : 'END node'}>
          <div>
            <Badge
              variant="outline"
              style={{ borderColor: node.data.color, color: node.data.color }}
            >
              <span
                className="mr-1 size-2 rounded-full"
                style={{ background: node.data.color }}
              />
              {node.data.objectType}
            </Badge>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {node.data.kind === 'start'
              ? 'Objects of this type start here — arcs only leave a START node.'
              : 'Objects of this type finish here — arcs only enter an END node.'}
          </div>
          <Button variant="destructive" size="sm" onClick={() => props.onDeleteNode(node.id)}>
            Delete {node.data.kind === 'start' ? 'START' : 'END'} node
          </Button>
        </PanelSection>
      </div>
    );
  }

  const { edge } = selection;
  const color = edge.data?.color ?? FALLBACK_TYPE_COLOR;
  return (
    <div>
      <PanelSection title={edge.source === edge.target ? 'Arc (self-loop)' : 'Arc'}>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-medium">{selection.sourceLabel}</span>
          <span className="text-muted-foreground">→</span>
          <span className="font-medium">{selection.targetLabel}</span>
        </div>
        <PanelField label="Object type">
          {selection.typeLocked ? (
            <div>
              <Badge variant="outline" style={{ borderColor: color, color }}>
                <span className="mr-1 size-2 rounded-full" style={{ background: color }} />
                {edge.data?.objectType || 'unknown type'}
              </Badge>
            </div>
          ) : (
            <PanelSelect
              value={edge.data?.objectType ?? ''}
              ariaLabel="Object type of the arc"
              onChange={(value) => props.onChangeArcType(edge.id, value)}
              options={objectTypes.map((t) => ({ value: t.name, label: t.name }))}
            />
          )}
        </PanelField>
        {selection.typeLocked && (
          <div className="text-[11px] text-muted-foreground">
            Arcs at a START/END node always belong to that node's object type.
          </div>
        )}
        <div className="text-[11px] text-muted-foreground">
          Double-click the arc to add a bend point; drag it to route the arc,
          double-click the point to remove it.
        </div>
        <Button variant="destructive" size="sm" onClick={() => props.onDeleteEdge(edge.id)}>
          Delete arc
        </Button>
      </PanelSection>
    </div>
  );
}
