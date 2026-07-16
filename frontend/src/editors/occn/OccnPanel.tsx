import { useEffect, useState } from 'react';
import { Plus, Shapes, Trash2, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EDITOR_PALETTE, lightenHex } from '@/editors/shared/colors';
import {
  ColorSwatches,
  PanelEmptyState,
  PanelField,
  PanelSection,
  PanelSelect,
} from '@/editors/shared/panel';
import type { OccnMarkerGroup } from '@/editors/shared/model-types';
import { cn } from '@/lib/utils';

import { groupsUsingArc } from './model';
import {
  groupRefEquals,
  type BindingsMap,
  type BindingSide,
  type GroupRef,
  type OccnEdge,
  type OccnNode,
} from './types';

export type OccnPanelApi = {
  addObjectType: () => void;
  renameObjectType: (oldName: string, newName: string) => void;
  recolorObjectType: (name: string, color: string) => void;
  deleteObjectType: (name: string) => void;
  setActiveType: (name: string) => void;
  renameActivity: (oldName: string, newName: string) => void;
  deleteActivity: (name: string) => void;
  retypeArc: (edgeId: string, newType: string) => void;
  deleteArc: (edgeId: string) => void;
  addGroup: (activity: string, side: BindingSide) => void;
  deleteGroup: (ref: GroupRef) => void;
  addMarker: (ref: GroupRef, related: string, objectType: string) => void;
  removeMarker: (ref: GroupRef, markerIndex: number) => void;
  updateMarker: (
    ref: GroupRef,
    markerIndex: number,
    patch: { min?: number; max?: number; key?: number },
  ) => void;
};

/** Input that keeps local state and commits on blur / Enter. */
function NameInput({
  value,
  onCommit,
  ariaLabel,
}: {
  value: string;
  onCommit: (next: string) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };
  return (
    <Input
      value={draft}
      aria-label={ariaLabel}
      className="h-8"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        if (event.key === 'Escape') setDraft(value);
      }}
    />
  );
}

function TypeBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{
        background: lightenHex(color, 0.82),
        border: `1px solid ${color}`,
        color: '#0F172A',
      }}
      title={label}
    >
      <span
        className="inline-block size-2 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Notation legend
// ---------------------------------------------------------------------------

function LegendRow({ glyph, text }: { glyph: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
      <span className="flex w-9 shrink-0 justify-center">{glyph}</span>
      <span>{text}</span>
    </div>
  );
}

export function NotationLegend() {
  const dot = (shape: 'circle' | 'square', x: number) =>
    shape === 'circle' ? (
      <circle cx={x} cy={8} r={5} fill="#60A5FA" stroke="#0F172A" strokeWidth={1.3} />
    ) : (
      <rect x={x - 5} y={3} width={10} height={10} fill="#60A5FA" stroke="#0F172A" strokeWidth={1.3} />
    );
  return (
    <PanelSection title="Notation">
      <LegendRow
        glyph={<svg width={36} height={16}>{dot('circle', 18)}</svg>}
        text="Circle marker: binds exactly one object."
      />
      <LegendRow
        glyph={<svg width={36} height={16}>{dot('square', 18)}</svg>}
        text="Square marker: (min,max) objects, * = unbounded."
      />
      <LegendRow
        glyph={
          <svg width={36} height={16}>
            <line x1={9} y1={8} x2={27} y2={8} stroke="rgba(15,23,42,0.7)" strokeWidth={1.2} />
            {dot('circle', 9)}
            {dot('circle', 27)}
          </svg>
        }
        text="Connected markers form one AND group (fire together)."
      />
      <LegendRow
        glyph={
          <svg width={36} height={16}>
            {dot('circle', 9)}
            {dot('circle', 27)}
          </svg>
        }
        text="Separate groups are XOR alternatives."
      />
      <LegendRow
        glyph={
          <svg width={36} height={16}>
            <rect x={12} y={2} width={13} height={12} rx={3} fill="#0F172A" />
            <text x={18.5} y={8.5} textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight={700} fill="#fff">
              1
            </text>
          </svg>
        }
        text="Markers sharing a key in a group bind disjoint objects."
      />
      <div className="text-[11px] text-muted-foreground/80">
        New arcs automatically get a singleton output group at the source and a
        singleton input group at the target — merge or edit them here.
      </div>
    </PanelSection>
  );
}

// ---------------------------------------------------------------------------
// Overview (nothing selected)
// ---------------------------------------------------------------------------

export function OverviewPanel({
  types,
  activeType,
  isEmpty,
  api,
}: {
  types: Array<{ name: string; color: string }>;
  activeType: string | null;
  isEmpty: boolean;
  api: OccnPanelApi;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div>
      <PanelSection
        title="Object types"
        action={
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={api.addObjectType}
          >
            <Plus className="size-3.5" />
            Add type
          </Button>
        }
      >
        {types.length === 0 && (
          <div className="text-xs text-muted-foreground">
            No object types yet. Every type gets START/END activities and a
            color used for its arcs and markers.
          </div>
        )}
        {types.map((type) => {
          const isExpanded = expanded === type.name;
          return (
            <div
              key={type.name}
              className={cn(
                'rounded-lg border',
                isExpanded ? 'border-ring/50' : 'border-transparent',
              )}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                onClick={() => {
                  setExpanded(isExpanded ? null : type.name);
                  api.setActiveType(type.name);
                }}
              >
                <span
                  className="inline-block size-3 shrink-0 rounded-full border border-black/10"
                  style={{ background: type.color }}
                />
                <span className="truncate">{type.name}</span>
                {activeType === type.name && (
                  <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
                    active
                  </Badge>
                )}
              </button>
              {isExpanded && (
                <div className="flex flex-col gap-2 px-2 pb-2">
                  <PanelField label="Name">
                    <NameInput
                      value={type.name}
                      ariaLabel={`Rename type ${type.name}`}
                      onCommit={(next) => {
                        api.renameObjectType(type.name, next);
                        setExpanded(next);
                      }}
                    />
                  </PanelField>
                  <PanelField label="Color">
                    <ColorSwatches
                      colors={EDITOR_PALETTE}
                      value={type.color}
                      onChange={(color) => api.recolorObjectType(type.name, color)}
                    />
                  </PanelField>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7"
                    onClick={() => api.deleteObjectType(type.name)}
                  >
                    <Trash2 className="size-3.5" />
                    Delete type
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </PanelSection>
      <NotationLegend />
      {isEmpty && (
        <PanelEmptyState
          icon={<Shapes className="size-8" />}
          title="Build an object-centric causal net"
          lines={[
            'Add an object type — its START ▶ and END ■ appear on the canvas.',
            'Add activities and drag between handles to create typed arcs.',
            'Select an activity to edit its input / output marker groups.',
            'Or load the example to see the notation in action.',
          ]}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marker group editing
// ---------------------------------------------------------------------------

function MarkerRow({
  refGroup,
  markerIndex,
  marker,
  side,
  typeColors,
  api,
}: {
  refGroup: GroupRef;
  markerIndex: number;
  marker: OccnMarkerGroup[number];
  side: BindingSide;
  typeColors: Record<string, string>;
  api: OccnPanelApi;
}) {
  const [related, objectType, [min, max], key] = marker;
  const unbounded = max === -1;
  const color = typeColors[objectType] ?? '#64748B';

  const numberChange =
    (field: 'min' | 'max' | 'key') => (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number.parseInt(event.target.value, 10);
      if (Number.isNaN(value)) return;
      api.updateMarker(refGroup, markerIndex, { [field]: value });
    };

  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-muted/50 p-1.5">
      <div className="flex items-center gap-1">
        <TypeBadge
          label={`${side === 'img' ? 'from' : 'to'} ${related} · ${objectType}`}
          color={color}
        />
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-5 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label="Remove marker"
          onClick={() => api.removeMarker(refGroup, markerIndex)}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">min</span>
          <Input
            type="number"
            min={1}
            value={min}
            onChange={numberChange('min')}
            className="h-7 px-1.5 text-xs"
            aria-label="Minimum objects"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">max</span>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={min}
              value={unbounded ? '' : max}
              placeholder="∞"
              disabled={unbounded}
              onChange={numberChange('max')}
              className="h-7 w-full px-1.5 text-xs"
              aria-label="Maximum objects"
            />
            <Button
              type="button"
              variant={unbounded ? 'default' : 'outline'}
              size="sm"
              className="h-7 w-7 shrink-0 p-0 text-xs"
              title="Unbounded (∞)"
              aria-pressed={unbounded}
              onClick={() =>
                api.updateMarker(refGroup, markerIndex, {
                  max: unbounded ? Math.max(min, 1) : -1,
                })
              }
            >
              ∞
            </Button>
          </div>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">key</span>
          <Input
            type="number"
            min={0}
            value={key}
            onChange={numberChange('key')}
            className="h-7 px-1.5 text-xs"
            aria-label="Marker key (0 = none)"
            title="Markers of a group with the same key bind disjoint objects (0 = no constraint)"
          />
        </label>
      </div>
    </div>
  );
}

function GroupBox({
  refGroup,
  group,
  side,
  freeArcs,
  typeColors,
  focused,
  api,
}: {
  refGroup: GroupRef;
  group: OccnMarkerGroup;
  side: BindingSide;
  /** Incident arcs (as [related, objectType]) not yet used by this group. */
  freeArcs: Array<[string, string]>;
  typeColors: Record<string, string>;
  focused: boolean;
  api: OccnPanelApi;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-lg border p-2',
        focused && 'ring-2 ring-blue-400/70',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Group {refGroup.groupIndex + 1}</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-destructive"
          aria-label="Delete group"
          onClick={() => api.deleteGroup(refGroup)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {group.map((marker, markerIndex) => (
        <MarkerRow
          key={`${markerIndex}-${marker[0]}-${marker[1]}`}
          refGroup={refGroup}
          markerIndex={markerIndex}
          marker={marker}
          side={side}
          typeColors={typeColors}
          api={api}
        />
      ))}
      {freeArcs.length > 0 && (
        <PanelSelect
          value=""
          ariaLabel="Add marker on arc"
          options={[
            { value: '', label: '+ Add marker…' },
            ...freeArcs.map(([related, objectType]) => ({
              value: JSON.stringify([related, objectType]),
              label: `${side === 'img' ? 'from' : 'to'} ${related} (${objectType})`,
            })),
          ]}
          onChange={(value) => {
            if (!value) return;
            const [related, objectType] = JSON.parse(value) as [string, string];
            api.addMarker(refGroup, related, objectType);
          }}
        />
      )}
    </div>
  );
}

function GroupsSection({
  activity,
  side,
  groups,
  incidentArcs,
  typeColors,
  focusedGroup,
  api,
}: {
  activity: string;
  side: BindingSide;
  groups: OccnMarkerGroup[];
  /** [related activity, objectType] of every incident arc on this side. */
  incidentArcs: Array<[string, string]>;
  typeColors: Record<string, string>;
  focusedGroup: GroupRef | null;
  api: OccnPanelApi;
}) {
  return (
    <PanelSection
      title={side === 'img' ? 'Input groups' : 'Output groups'}
      action={
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => api.addGroup(activity, side)}
        >
          <Plus className="size-3.5" />
          Group
        </Button>
      }
    >
      {groups.length === 0 && (
        <div className="text-xs text-muted-foreground">
          {incidentArcs.length === 0
            ? `No ${side === 'img' ? 'incoming' : 'outgoing'} arcs yet — connect one on the canvas first.`
            : 'No groups. Each group is an AND of its markers; multiple groups are XOR alternatives.'}
        </div>
      )}
      {groups.map((group, groupIndex) => {
        const refGroup: GroupRef = { activity, side, groupIndex };
        const freeArcs = incidentArcs.filter(
          ([related, objectType]) =>
            !group.some((m) => m[0] === related && m[1] === objectType),
        );
        return (
          <GroupBox
            key={groupIndex}
            refGroup={refGroup}
            group={group}
            side={side}
            freeArcs={freeArcs}
            typeColors={typeColors}
            focused={groupRefEquals(refGroup, focusedGroup)}
            api={api}
          />
        );
      })}
    </PanelSection>
  );
}

// ---------------------------------------------------------------------------
// Activity panel
// ---------------------------------------------------------------------------

export function ActivityPanel({
  node,
  bindings,
  edges,
  typeColors,
  focusedGroup,
  api,
}: {
  node: OccnNode;
  bindings: BindingsMap;
  edges: OccnEdge[];
  typeColors: Record<string, string>;
  focusedGroup: GroupRef | null;
  api: OccnPanelApi;
}) {
  const name = node.id;
  const kind = node.data.kind;
  const b = bindings[name] ?? { img: [], omg: [] };
  const incoming: Array<[string, string]> = edges
    .filter((edge) => edge.target === name)
    .map((edge) => [edge.source, edge.data?.objectType ?? '']);
  const outgoing: Array<[string, string]> = edges
    .filter((edge) => edge.source === name)
    .map((edge) => [edge.target, edge.data?.objectType ?? '']);

  return (
    <div>
      <PanelSection title={kind === 'activity' ? 'Activity' : `${kind === 'start' ? 'Start' : 'End'} activity`}>
        {kind === 'activity' ? (
          <PanelField label="Name">
            <NameInput
              value={name}
              ariaLabel="Activity name"
              onCommit={(next) => api.renameActivity(name, next)}
            />
          </PanelField>
        ) : (
          <div className="flex flex-col gap-1.5">
            <TypeBadge label={name} color={typeColors[node.data.objectType ?? ''] ?? '#64748B'} />
            <div className="text-xs text-muted-foreground">
              Managed via its object type — rename or delete the type in the
              overview panel.
            </div>
          </div>
        )}
      </PanelSection>

      {kind === 'start' ? (
        <div className="border-b px-4 py-2 text-xs text-muted-foreground">
          Start activities only produce obligations — they have no input groups.
        </div>
      ) : (
        <GroupsSection
          activity={name}
          side="img"
          groups={b.img}
          incidentArcs={incoming}
          typeColors={typeColors}
          focusedGroup={focusedGroup}
          api={api}
        />
      )}

      {kind === 'end' ? (
        <div className="border-b px-4 py-2 text-xs text-muted-foreground">
          End activities only consume obligations — they have no output groups.
        </div>
      ) : (
        <GroupsSection
          activity={name}
          side="omg"
          groups={b.omg}
          incidentArcs={outgoing}
          typeColors={typeColors}
          focusedGroup={focusedGroup}
          api={api}
        />
      )}

      {kind === 'activity' && (
        <div className="px-4 py-3">
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={() => api.deleteActivity(name)}
          >
            <Trash2 className="size-3.5" />
            Delete activity
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Arc panel
// ---------------------------------------------------------------------------

export function ArcPanel({
  edge,
  nodesById,
  bindings,
  types,
  typeColors,
  api,
}: {
  edge: OccnEdge;
  nodesById: Record<string, OccnNode>;
  bindings: BindingsMap;
  types: Array<{ name: string; color: string }>;
  typeColors: Record<string, string>;
  api: OccnPanelApi;
}) {
  const objectType = edge.data?.objectType ?? '';
  const sourceKind = nodesById[edge.source]?.data.kind ?? 'activity';
  const targetKind = nodesById[edge.target]?.data.kind ?? 'activity';
  const typeLocked = sourceKind !== 'activity' || targetKind !== 'activity';
  const arc = { source: edge.source, target: edge.target, objectType };
  const imgUses = groupsUsingArc(bindings, arc, 'img');
  const omgUses = groupsUsingArc(bindings, arc, 'omg');

  return (
    <div>
      <PanelSection title="Dependency arc">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <span className="max-w-full truncate font-medium">{edge.source}</span>
          <span className="text-muted-foreground">→</span>
          <span className="max-w-full truncate font-medium">{edge.target}</span>
        </div>
        <TypeBadge label={objectType} color={typeColors[objectType] ?? '#64748B'} />
        <PanelField label="Object type">
          <PanelSelect
            value={objectType}
            disabled={typeLocked}
            ariaLabel="Arc object type"
            options={types.map((type) => ({ value: type.name, label: type.name }))}
            onChange={(value) => {
              if (value && value !== objectType) api.retypeArc(edge.id, value);
            }}
          />
        </PanelField>
        {typeLocked && (
          <div className="text-[11px] text-muted-foreground">
            Arcs at START/END activities are fixed to the activity's object type.
          </div>
        )}
      </PanelSection>
      <PanelSection title="Bindings on this arc">
        <div className="text-xs text-muted-foreground">
          Used by {imgUses} input group{imgUses === 1 ? '' : 's'} of "{edge.target}"
          and {omgUses} output group{omgUses === 1 ? '' : 's'} of "{edge.source}".
        </div>
        <div className="text-[11px] text-muted-foreground/80">
          Deleting the arc removes these markers (emptied groups are dropped).
        </div>
      </PanelSection>
      <div className="px-4 py-3">
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={() => api.deleteArc(edge.id)}
        >
          <Trash2 className="size-3.5" />
          Delete arc
        </Button>
      </div>
    </div>
  );
}
