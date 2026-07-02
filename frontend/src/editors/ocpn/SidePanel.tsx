import { useEffect, useState } from 'react';
import { MousePointerClick, Pencil, Plus, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  ColorSwatches,
  PanelEmptyState,
  PanelField,
  PanelSection,
  PanelSelect,
} from '@/editors/shared/panel';
import { EDITOR_PALETTE } from '@/editors/shared/colors';
import { cn } from '@/lib/utils';

import {
  FALLBACK_TYPE_COLOR,
  type ArcFlowEdge,
  type OcpnObjectType,
  type PlaceFlowNode,
  type TransitionFlowNode,
} from './types';

// ---------------------------------------------------------------------------
// Selection descriptor computed by the editor
// ---------------------------------------------------------------------------

export type OcpnSelection =
  | { kind: 'place'; node: PlaceFlowNode }
  | { kind: 'transition'; node: TransitionFlowNode }
  | {
      kind: 'arc';
      edge: ArcFlowEdge;
      sourceLabel: string;
      targetLabel: string;
      objectType: string;
      color: string;
    };

type SidePanelProps = {
  objectTypes: OcpnObjectType[];
  activeType: string | null;
  placeCounts: Record<string, number>;
  selection: OcpnSelection | null;
  onSetActiveType: (name: string) => void;
  onAddType: () => void;
  onRenameType: (oldName: string, newName: string) => boolean;
  onChangeTypeColor: (name: string, color: string) => void;
  onDeleteType: (name: string) => void;
  onChangePlaceType: (placeId: string, objectType: string) => void;
  onSetPlaceFlag: (placeId: string, flag: 'initial' | 'final', value: boolean) => void;
  onChangeTransitionLabel: (transitionId: string, label: string) => void;
  onSetTransitionSilent: (transitionId: string, silent: boolean) => void;
  onSetArcVariable: (arcId: string, variable: boolean) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
};

/** Input that keeps a local draft and commits on blur / Enter. */
function CommitInput({
  value,
  onCommit,
  placeholder,
  disabled,
  ariaLabel,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Input
      className="h-8"
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
          (event.target as HTMLInputElement).blur();
        }
        if (event.key === 'Escape') setDraft(value);
      }}
    />
  );
}

function LabeledSwitch({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

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
        text="Initial place (source, part of M_init)"
      />
      <LegendRow
        glyph={
          <svg width={22} height={22} viewBox="0 0 22 22">
            <circle cx={11} cy={11} r={9} fill={accent} stroke={accent} strokeWidth={2} />
            <rect x={7.5} y={7.5} width={7} height={7} fill="#fff" />
          </svg>
        }
        text="Final place (sink, part of M_final)"
      />
      <LegendRow
        glyph={
          <svg width={36} height={14} viewBox="0 0 36 14">
            <line x1={1} y1={7} x2={35} y2={7} stroke={accent} strokeWidth={7} />
            <line x1={1} y1={7} x2={35} y2={7} stroke="#fff" strokeWidth={2.5} />
          </svg>
        }
        text="Double line: variable arc (set of objects)"
      />
      <LegendRow
        glyph={
          <svg width={28} height={18} viewBox="0 0 28 18">
            <rect x={2} y={2} width={24} height={14} rx={5} fill="#0F172A" />
          </svg>
        }
        text="Filled: silent transition (τ, no label)"
      />
      <LegendRow
        glyph={
          <span className="flex gap-1">
            <span className="size-[7px] rounded-full" style={{ background: '#10B981' }} />
            <span className="size-[7px] rounded-full" style={{ background: '#2563EB' }} />
          </span>
        }
        text="Dots: object types a transition touches"
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
  placeCounts,
  onSetActiveType,
  onAddType,
  onRenameType,
  onChangeTypeColor,
  onDeleteType,
}: Pick<
  SidePanelProps,
  | 'objectTypes'
  | 'activeType'
  | 'placeCounts'
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
          No object types yet — every place needs one. Adding a place creates
          one automatically.
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
                title="Make this the active type for new places"
                onClick={() => onSetActiveType(type.name)}
              >
                {type.name}
              </button>
              <span className="text-[11px] text-muted-foreground">
                {placeCounts[type.name] ?? 0} pl.
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
                  Delete type & places
                </Button>
              </div>
            )}
          </div>
        );
      })}
      {objectTypes.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          New places use the highlighted active type.
        </div>
      )}
    </PanelSection>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function OcpnSidePanel(props: SidePanelProps) {
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
            'Add places and transitions from the toolbar.',
            'Drag between handles to draw arcs.',
            'Select an element to edit its properties.',
          ]}
        />
      </div>
    );
  }

  if (selection.kind === 'place') {
    const { node } = selection;
    return (
      <div>
        <PanelSection title="Place">
          <PanelField label="Id">
            <div className="rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs">
              {node.id}
            </div>
          </PanelField>
          <PanelField label="Object type">
            <PanelSelect
              value={node.data.objectType}
              ariaLabel="Object type of the place"
              onChange={(value) => props.onChangePlaceType(node.id, value)}
              options={objectTypes.map((t) => ({ value: t.name, label: t.name }))}
            />
          </PanelField>
          <LabeledSwitch
            label="Initial (source)"
            checked={node.data.initial}
            onCheckedChange={(checked) => props.onSetPlaceFlag(node.id, 'initial', checked)}
          />
          <LabeledSwitch
            label="Final (sink)"
            checked={node.data.final}
            onCheckedChange={(checked) => props.onSetPlaceFlag(node.id, 'final', checked)}
          />
          <Button variant="destructive" size="sm" onClick={() => props.onDeleteNode(node.id)}>
            Delete place
          </Button>
        </PanelSection>
      </div>
    );
  }

  if (selection.kind === 'transition') {
    const { node } = selection;
    return (
      <div>
        <PanelSection title="Transition">
          <PanelField label="Label">
            <CommitInput
              value={node.data.label}
              disabled={node.data.silent}
              placeholder={node.data.silent ? 'τ (silent)' : 'Activity name'}
              ariaLabel="Transition label"
              onCommit={(label) => props.onChangeTransitionLabel(node.id, label)}
            />
          </PanelField>
          <LabeledSwitch
            label="Silent (τ)"
            checked={node.data.silent}
            onCheckedChange={(checked) => props.onSetTransitionSilent(node.id, checked)}
          />
          {node.data.silent && (
            <div className="text-[11px] text-muted-foreground">
              Silent transitions have no activity label — the label is kept and
              restored when the switch is turned off.
            </div>
          )}
          <Button variant="destructive" size="sm" onClick={() => props.onDeleteNode(node.id)}>
            Delete transition
          </Button>
        </PanelSection>
      </div>
    );
  }

  const { edge } = selection;
  return (
    <div>
      <PanelSection title="Arc">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-medium">{selection.sourceLabel}</span>
          <span className="text-muted-foreground">→</span>
          <span className="font-medium">{selection.targetLabel}</span>
        </div>
        <div>
          <Badge
            variant="outline"
            style={{
              borderColor: selection.color || FALLBACK_TYPE_COLOR,
              color: selection.color || FALLBACK_TYPE_COLOR,
            }}
          >
            <span
              className="mr-1 size-2 rounded-full"
              style={{ background: selection.color || FALLBACK_TYPE_COLOR }}
            />
            {selection.objectType || 'unknown type'}
          </Badge>
        </div>
        <LabeledSwitch
          label="Variable arc (set of objects)"
          checked={edge.data?.variable === true}
          onCheckedChange={(checked) => props.onSetArcVariable(edge.id, checked)}
        />
        <div className="text-[11px] text-muted-foreground">
          Well-formedness: all arcs between this transition and places of the
          same object type share the variable flag.
        </div>
        <Button variant="destructive" size="sm" onClick={() => props.onDeleteEdge(edge.id)}>
          Delete arc
        </Button>
      </PanelSection>
    </div>
  );
}
