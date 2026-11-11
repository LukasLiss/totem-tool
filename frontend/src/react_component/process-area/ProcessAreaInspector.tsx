/**
 * Pieces of the in-canvas process-area editing that are not part of the
 * canvas itself: the docked inspector of the selected area (name, object
 * types, activities), the "Move to…" menu that is the keyboard/click
 * alternative to dragging, and the guarded remove-level button.
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, MoreHorizontal, RotateCcw, Search, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import {
  AREA_NAME_MAX_LENGTH,
  allAreas,
  defaultActivitiesForArea,
  locateObjectType,
  relatedActivities,
  type CompositionArea,
  type DropTarget,
  type ProcessAreaComposition,
} from './composition';

export function RemoveLevelButton({
  levelIndex,
  typeCount,
  disabled,
  onConfirm,
  className = 'ml-auto h-7 w-7 text-muted-foreground hover:text-destructive',
}: {
  levelIndex: number;
  typeCount: number;
  disabled: boolean;
  onConfirm: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      data-totem-control
      disabled={disabled}
      title={disabled ? 'A composition needs at least one level' : `Remove level ${levelIndex}`}
      aria-label={`Remove level ${levelIndex}`}
      onClick={typeCount === 0 ? onConfirm : undefined}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
  if (typeCount === 0 || disabled) return button;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <p className="text-sm font-medium">Remove level {levelIndex}?</p>
        <p className="text-xs text-muted-foreground">
          {typeCount === 1 ? 'Its object type moves' : `Its ${typeCount} object types move`} to “Not in any
          process area”, where you can drag {typeCount === 1 ? 'it' : 'them'} somewhere else. Levels above move down
          by one.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            Remove level
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Keyboard / click alternative to dragging an object type. */
export function MoveTypeMenu({
  objectType,
  draft,
  onMove,
}: {
  objectType: string;
  draft: ProcessAreaComposition;
  onMove: (target: DropTarget) => void;
}) {
  const from = locateObjectType(draft, objectType);
  const areas = allAreas(draft);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Move ${objectType}`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuLabel className="text-xs">Move “{objectType}” to…</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>A new process area on…</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {draft.levels
              .map((_, i) => i)
              .reverse()
              .map((i) => (
                <DropdownMenuItem key={i} onSelect={() => onMove({ kind: 'newArea', levelIndex: i })}>
                  Level {i}
                </DropdownMenuItem>
              ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {areas.length > 0 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>An existing process area</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-auto">
              {areas.map((area) => (
                <DropdownMenuItem
                  key={area.id}
                  disabled={from?.kind === 'area' && from.areaId === area.id}
                  onSelect={() => onMove({ kind: 'area', areaId: area.id })}
                >
                  <span className="truncate">{area.name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">L{area.levelIndex}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={from?.kind === 'unassigned'} onSelect={() => onMove({ kind: 'unassigned' })}>
          Not in any process area
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AreaInspector({
  area,
  levelIndex,
  draft,
  owners,
  objectTypeToActivities,
  allActivities,
  typeColors,
  onClose,
  onRename,
  onRenameFocus,
  onSetActivities,
  onResetActivities,
  onMoveType,
  onMoveArea,
}: {
  area: CompositionArea;
  levelIndex: number;
  draft: ProcessAreaComposition;
  owners: Map<string, string[]>;
  objectTypeToActivities: Record<string, string[]>;
  allActivities: string[];
  typeColors: Record<string, string>;
  onClose: () => void;
  onRename: (name: string) => void;
  onRenameFocus: () => void;
  onSetActivities: (activities: string[]) => void;
  onResetActivities: () => void;
  onMoveType: (objectType: string, target: DropTarget) => void;
  onMoveArea: (target: DropTarget) => void;
}) {
  const [query, setQuery] = useState('');
  const [showOthers, setShowOthers] = useState(false);
  const related = relatedActivities(area.objectTypes, objectTypeToActivities);
  const relatedSet = new Set(related);
  const chosen = new Set(area.activities);
  const others = [...new Set([...allActivities, ...area.activities])]
    .filter((a) => !relatedSet.has(a))
    .sort((a, b) => a.localeCompare(b));
  const defaults = defaultActivitiesForArea(draft, area.id, objectTypeToActivities);
  const isDefault =
    defaults.length === area.activities.length && defaults.every((a) => chosen.has(a));
  const needle = query.trim().toLocaleLowerCase();
  const matches = (activity: string) => !needle || activity.toLocaleLowerCase().includes(needle);
  const duplicateName = allAreas(draft).some(
    (other) => other.id !== area.id && other.name.trim().toLocaleLowerCase() === area.name.trim().toLocaleLowerCase(),
  );

  const toggle = (activity: string, on: boolean) => {
    const next = new Set(area.activities);
    if (on) next.add(activity);
    else next.delete(activity);
    onSetActivities([...next]);
  };

  const renderActivity = (activity: string) => {
    const elsewhere = (owners.get(activity) ?? []).filter((name) => name !== area.name);
    const id = `pa-activity-${area.id}-${activity}`;
    return (
      <li key={activity} className="flex items-start gap-2 py-1">
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 h-3.5 w-3.5 accent-[var(--primary)]"
          checked={chosen.has(activity)}
          onChange={(event) => toggle(activity, event.target.checked)}
        />
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-xs leading-snug">
          <span className="break-words">{activity}</span>
          {elsewhere.length > 0 ? (
            <span className="ml-1 text-[10px] text-muted-foreground" title={`Also in ${elsewhere.join(', ')}`}>
              · also in {elsewhere.length === 1 ? elsewhere[0] : `${elsewhere.length} areas`}
            </span>
          ) : null}
        </label>
      </li>
    );
  };

  const shownRelated = related.filter(matches);
  const shownOthers = others.filter(matches);

  return (
    <div className="space-y-4" data-testid="pa-area-inspector">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Process area · level {levelIndex}
          </p>
          <p className="truncate text-sm font-semibold">{area.name || 'Unnamed'}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close inspector">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-1">
        <Label htmlFor="pa-area-name" className="text-xs">
          Name
        </Label>
        <Input
          id="pa-area-name"
          value={area.name}
          maxLength={AREA_NAME_MAX_LENGTH}
          onFocus={onRenameFocus}
          onChange={(event) => onRename(event.target.value)}
          aria-invalid={!area.name.trim() || duplicateName}
        />
        <p className={`text-[11px] ${!area.name.trim() || duplicateName ? 'text-destructive' : 'text-muted-foreground'}`}>
          {!area.name.trim()
            ? 'A name is required.'
            : duplicateName
              ? 'Another process area already has this name.'
              : 'Other components (e.g. the Variants Explorer) list the area under this name.'}
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Object types</Label>
          <span className="text-[11px] text-muted-foreground">drag on the board, or use ⋯</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {area.objectTypes.map((objectType) => (
            <span
              key={objectType}
              className="inline-flex items-center gap-1 rounded-full border bg-background py-0.5 pl-2 pr-0.5 text-xs"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: typeColors[objectType] ?? '#94A3B8' }} />
              {objectType}
              <MoveTypeMenu objectType={objectType} draft={draft} onMove={(target) => onMoveType(objectType, target)} />
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {levelIndex < draft.levels.length - 1 ? (
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => onMoveArea({ kind: 'newArea', levelIndex: levelIndex + 1 })}>
              <ArrowUp className="h-3.5 w-3.5" /> Level {levelIndex + 1}
            </Button>
          ) : null}
          {levelIndex > 0 ? (
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => onMoveArea({ kind: 'newArea', levelIndex: levelIndex - 1 })}>
              <ArrowDown className="h-3.5 w-3.5" /> Level {levelIndex - 1}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">
            Activities <span className="text-muted-foreground">({area.activities.length})</span>
          </Label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={onResetActivities}
            disabled={isDefault}
            title="Every activity of these object types that no lower process area claims"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Defaults
          </Button>
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Process executions of this area are connected through events of the checked activities.
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter activities"
            className="h-8 pl-7 text-xs"
            aria-label="Filter activities"
          />
        </div>

        <div className="rounded-md border">
          <div className="flex items-center gap-2 border-b bg-muted/40 px-2 py-1">
            <span className="flex-1 text-[11px] font-medium">Of these object types ({related.length})</span>
            <button
              type="button"
              className="text-[11px] text-primary hover:underline"
              onClick={() => onSetActivities([...new Set([...area.activities, ...related])])}
            >
              all
            </button>
            <button
              type="button"
              className="text-[11px] text-primary hover:underline"
              onClick={() => onSetActivities(area.activities.filter((a) => !relatedSet.has(a)))}
            >
              none
            </button>
          </div>
          <ul className="max-h-64 overflow-auto px-2 py-1" data-testid="pa-related-activities">
            {shownRelated.length > 0 ? (
              shownRelated.map(renderActivity)
            ) : (
              <li className="py-1 text-xs italic text-muted-foreground">No matching activities.</li>
            )}
          </ul>
        </div>

        <div className="rounded-md border">
          <button
            type="button"
            className="flex w-full items-center gap-2 bg-muted/40 px-2 py-1 text-left text-[11px] font-medium"
            onClick={() => setShowOthers((v) => !v)}
            aria-expanded={showOthers || Boolean(needle)}
          >
            <span className="flex-1">
              Other activities of the log ({others.length})
              {others.some((a) => chosen.has(a)) ? ` · ${others.filter((a) => chosen.has(a)).length} checked` : ''}
            </span>
            <span className="text-muted-foreground">{showOthers || needle ? 'hide' : 'show'}</span>
          </button>
          {showOthers || needle ? (
            <ul className="max-h-48 overflow-auto px-2 py-1">
              {shownOthers.length > 0 ? (
                shownOthers.map(renderActivity)
              ) : (
                <li className="py-1 text-xs italic text-muted-foreground">No matching activities.</li>
              )}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

