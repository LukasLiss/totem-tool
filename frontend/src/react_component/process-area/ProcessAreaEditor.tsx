/**
 * Interactive editor for a process-area composition.
 *
 * The board shows the levels top-down (highest level first, as the
 * visualizer draws them). Object types are chips that can be dragged
 * between process areas; dropping one on the free space of a level makes it
 * a process area of its own. Whole areas can be dragged by their handle onto
 * another level or onto another area (merge). Every drag has a menu
 * equivalent ("Move to…") so the editor also works without a mouse.
 *
 * The inspector on the right edits the selected area: its name and which
 * activities belong to it. The composition is named in the header; saving
 * stores it as a project asset that other components can refer to.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CircleAlert,
  GripVertical,
  Info,
  Layers,
  MoreHorizontal,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Textarea } from '@/components/ui/textarea';
import { extractAssetApiError, type ProjectAsset } from '@/api/assetsApi';
import { createProcessAreaAsset, updateProcessAreaAsset } from '@/api/processAreaAssetsApi';
import { useProcessAreaAssetsStore } from '@/store/processAreaAssetsStore';
import { useUndoRedo } from '@/editors/shared/useUndoRedo';

import {
  AREA_NAME_MAX_LENGTH,
  activityOwners,
  allAreas,
  cloneComposition,
  compositionProblems,
  compositionStats,
  defaultActivitiesForArea,
  findArea,
  insertLevel,
  locateObjectType,
  moveArea,
  moveObjectType,
  relatedActivities,
  removeLevel,
  renameArea,
  renameComposition,
  resetAllActivities,
  resetAreaActivities,
  setAreaActivities,
  setDescription,
  withoutEmptyLevels,
  type CompositionArea,
  type DropTarget,
  type ProcessAreaComposition,
} from './composition';

export type ProcessAreaEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Composition the editor starts from (a copy is edited). */
  initial: ProcessAreaComposition;
  /** The discovered composition, for "Start over from the discovery". */
  discovered?: ProcessAreaComposition | null;
  objectTypeToActivities: Record<string, string[]>;
  allActivities: string[];
  typeColors: Record<string, string>;
  /** Needed for saving to the project assets. */
  projectId?: number | null;
  /** Stored asset this composition was loaded from (save updates it). */
  assetId?: number | null;
  /** Use the composition without saving it. */
  onApply: (composition: ProcessAreaComposition) => void;
  /** Saved as a project asset (also applied). */
  onSaved: (composition: ProcessAreaComposition, asset: ProjectAsset) => void;
};

type Dragged = { kind: 'type'; objectType: string } | { kind: 'area'; areaId: string };

const DRAG_MIME = 'application/x-totem-process-area';

function targetKey(target: DropTarget): string {
  if (target.kind === 'area') return `area:${target.areaId}`;
  if (target.kind === 'newArea') return `level:${target.levelIndex}`;
  return 'unassigned';
}

export function ProcessAreaEditor({
  open,
  onOpenChange,
  initial,
  discovered,
  objectTypeToActivities,
  allActivities,
  typeColors,
  projectId,
  assetId,
  onApply,
  onSaved,
}: ProcessAreaEditorProps) {
  const [draft, setDraft] = useState<ProcessAreaComposition>(() => cloneComposition(initial));
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const history = useUndoRedo<ProcessAreaComposition>(200);
  const upsertAsset = useProcessAreaAssetsStore((state) => state.upsert);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // A fresh copy every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setDraft(cloneComposition(initial));
    setSelectedAreaId(null);
    setNameError(null);
    history.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Apply an edit, recording the previous state for undo. */
  const commit = useCallback(
    (update: (current: ProcessAreaComposition) => ProcessAreaComposition) => {
      setDraft((current) => {
        const next = update(current);
        if (next !== current) history.record(current);
        return next;
      });
    },
    [history],
  );

  /**
   * Text edits record one undo step per focus, not one per keystroke, and
   * only once something actually changed.
   */
  const textEditStartRef = useRef<ProcessAreaComposition | null>(null);
  const recordOnFocus = useCallback(() => {
    textEditStartRef.current = draft;
  }, [draft]);
  const editText = useCallback(
    (update: (current: ProcessAreaComposition) => ProcessAreaComposition) => {
      if (textEditStartRef.current) {
        history.record(textEditStartRef.current);
        textEditStartRef.current = null;
      }
      setDraft(update);
    },
    [history],
  );

  const undo = useCallback(() => {
    const previous = history.undo(draft);
    if (previous) setDraft(previous);
  }, [history, draft]);
  const redo = useCallback(() => {
    const next = history.redo(draft);
    if (next) setDraft(next);
  }, [history, draft]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable="true"]')) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    },
    [undo, redo],
  );

  const problems = useMemo(() => compositionProblems(draft), [draft]);
  const errors = problems.filter((p) => p.severity === 'error');
  const problemAreaIds = useMemo(
    () => new Set(errors.map((p) => p.areaId).filter((id): id is string => Boolean(id))),
    [errors],
  );
  const owners = useMemo(() => activityOwners(draft), [draft]);
  const stats = compositionStats(draft);
  const selected = selectedAreaId ? findArea(draft, selectedAreaId) : null;

  // Drop the selection when its area disappears (merged, dissolved, undone).
  useEffect(() => {
    if (selectedAreaId && !findArea(draft, selectedAreaId)) setSelectedAreaId(null);
  }, [draft, selectedAreaId]);

  /* ---------------- moves ---------------- */

  const moveType = useCallback(
    (objectType: string, target: DropTarget) =>
      commit((c) => moveObjectType(c, objectType, target, objectTypeToActivities)),
    [commit, objectTypeToActivities],
  );
  const moveWholeArea = useCallback(
    (areaId: string, target: DropTarget) => commit((c) => moveArea(c, areaId, target)),
    [commit],
  );

  const canDrop = useCallback(
    (target: DropTarget): boolean => {
      if (!dragged) return false;
      if (dragged.kind === 'type') {
        const from = locateObjectType(draft, dragged.objectType);
        if (target.kind === 'area') return !(from?.kind === 'area' && from.areaId === target.areaId);
        if (target.kind === 'unassigned') return from?.kind !== 'unassigned';
        return true;
      }
      const located = findArea(draft, dragged.areaId);
      if (!located) return false;
      if (target.kind === 'area') return target.areaId !== dragged.areaId;
      if (target.kind === 'newArea') return target.levelIndex !== located.levelIndex;
      return true;
    },
    [dragged, draft],
  );

  const dropProps = (target: DropTarget) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!canDrop(target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      const key = targetKey(target);
      if (hoverTarget !== key) setHoverTarget(key);
    },
    onDragLeave: (event: React.DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setHoverTarget((current) => (current === targetKey(target) ? null : current));
    },
    onDrop: (event: React.DragEvent) => {
      if (!dragged || !canDrop(target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (dragged.kind === 'type') moveType(dragged.objectType, target);
      else moveWholeArea(dragged.areaId, target);
      setDragged(null);
      setHoverTarget(null);
    },
  });

  const startDrag = (item: Dragged) => (event: React.DragEvent) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(item));
    // Firefox only starts a drag with some text data.
    event.dataTransfer.setData('text/plain', item.kind === 'type' ? item.objectType : 'process area');
    setDragged(item);
  };
  const endDrag = () => {
    setDragged(null);
    setHoverTarget(null);
  };

  const isHover = (target: DropTarget) => hoverTarget === targetKey(target) && canDrop(target);

  /* ---------------- apply / save ---------------- */

  const finalComposition = () => withoutEmptyLevels({ ...draft, name: draft.name.trim() });

  const apply = () => {
    onApply(finalComposition());
    onOpenChange(false);
  };

  const save = async (asNew: boolean) => {
    if (!projectId) return;
    const composition = finalComposition();
    setSaving(true);
    setNameError(null);
    try {
      const asset =
        assetId && !asNew
          ? await updateProcessAreaAsset({ assetId, composition })
          : await createProcessAreaAsset({ projectId, composition });
      upsertAsset(asset);
      toast.success(`Saved process areas "${asset.name}" to the project assets.`);
      onSaved({ ...composition, source: { kind: 'asset', assetId: asset.id } }, asset);
      onOpenChange(false);
    } catch (error) {
      const parsed = extractAssetApiError(error);
      const fieldName = parsed.fields?.name;
      if (fieldName) {
        setNameError(Array.isArray(fieldName) ? String(fieldName[0]) : String(fieldName));
        nameInputRef.current?.focus();
      } else {
        toast.error(`Saving failed: ${parsed.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const blocked = errors.length > 0;
  const levelCount = draft.levels.length;

  /* ---------------- render ---------------- */

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[90vh] w-[min(1440px,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        onKeyDown={onKeyDown}
        data-testid="process-area-editor"
      >
        {/* ── header ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-end gap-3 border-b px-5 py-4 pr-12">
          <div className="min-w-0 flex-1 basis-[280px] space-y-1.5">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4 text-primary" />
              Adjust process areas
            </DialogTitle>
            <DialogDescription className="text-xs">
              Drag object types between process areas, or onto the free space of a level to give them
              a process area of their own. Drag an area by its handle to move it to another level.
            </DialogDescription>
          </div>
          <div className="w-full max-w-sm space-y-1">
            <Label htmlFor="pa-composition-name" className="text-xs">
              Composition name
            </Label>
            <Input
              id="pa-composition-name"
              ref={nameInputRef}
              value={draft.name}
              placeholder="e.g. Order-to-delivery areas"
              onFocus={recordOnFocus}
              onChange={(event) => {
                setNameError(null);
                editText((c) => renameComposition(c, event.target.value));
              }}
              aria-invalid={nameError !== null || !draft.name.trim()}
              maxLength={100}
            />
            {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={undo}
              disabled={!history.canUndo}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={redo}
              disabled={!history.canRedo}
              title="Redo (Ctrl+Shift+Z)"
              aria-label="Redo"
            >
              <Redo2 className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem
                  onSelect={() => commit((c) => resetAllActivities(c, objectTypeToActivities))}
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset all activities to defaults
                </DropdownMenuItem>
                {discovered ? (
                  <DropdownMenuItem
                    onSelect={() =>
                      commit((c) => ({ ...cloneComposition(discovered), name: c.name, description: c.description }))
                    }
                  >
                    <Layers className="h-4 w-4" />
                    Start over from the discovered areas
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* ── body ───────────────────────────────────────────────── */}
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-h-0 overflow-auto bg-muted/30 p-4" data-testid="process-area-board">
            <AddLevelButton
              label="Add level on top"
              onClick={() => commit((c) => insertLevel(c, c.levels.length))}
            />
            {draft.levels
              .map((level, levelIndex) => ({ level, levelIndex }))
              .reverse()
              .map(({ level, levelIndex }) => {
                const typeCount = level.areas.reduce((n, a) => n + a.objectTypes.length, 0);
                const newAreaTarget: DropTarget = { kind: 'newArea', levelIndex };
                return (
                  <div key={level.key}>
                    <section
                      aria-label={`Level ${levelIndex}`}
                      data-testid={`pa-level-${levelIndex}`}
                      className={`rounded-lg border bg-background p-3 transition-colors ${
                        isHover(newAreaTarget) ? 'border-primary ring-2 ring-primary/30' : ''
                      }`}
                      {...dropProps(newAreaTarget)}
                    >
                      <header className="mb-2 flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide">Level {levelIndex}</span>
                        <span className="text-xs text-muted-foreground">
                          {level.areas.length} area{level.areas.length === 1 ? '' : 's'} · {typeCount} object type
                          {typeCount === 1 ? '' : 's'}
                        </span>
                        {levelIndex === 0 ? (
                          <span className="text-[11px] text-muted-foreground">(core business objects)</span>
                        ) : null}
                        <RemoveLevelButton
                          levelIndex={levelIndex}
                          typeCount={typeCount}
                          disabled={levelCount <= 1}
                          onConfirm={() => commit((c) => removeLevel(c, levelIndex))}
                        />
                      </header>
                      <div className="flex flex-wrap items-stretch gap-3">
                        {level.areas.map((area) => (
                          <AreaCard
                            key={area.id}
                            area={area}
                            levelIndex={levelIndex}
                            draft={draft}
                            typeColors={typeColors}
                            selected={area.id === selectedAreaId}
                            invalid={problemAreaIds.has(area.id)}
                            hover={isHover({ kind: 'area', areaId: area.id })}
                            dimmed={dragged?.kind === 'area' && dragged.areaId === area.id}
                            draggedType={dragged?.kind === 'type' ? dragged.objectType : null}
                            dropProps={dropProps({ kind: 'area', areaId: area.id })}
                            onSelect={() => setSelectedAreaId(area.id)}
                            onAreaDragStart={startDrag({ kind: 'area', areaId: area.id })}
                            onTypeDragStart={(objectType) => startDrag({ kind: 'type', objectType })}
                            onDragEnd={endDrag}
                            onMoveType={moveType}
                            onMoveArea={(target) => moveWholeArea(area.id, target)}
                          />
                        ))}
                        <div
                          className={`flex min-h-[64px] min-w-[180px] flex-1 items-center justify-center rounded-md border-2 border-dashed px-3 text-center text-xs transition-colors ${
                            dragged && canDrop(newAreaTarget)
                              ? isHover(newAreaTarget)
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-primary/40 text-primary/80'
                              : 'border-muted-foreground/20 text-muted-foreground'
                          }`}
                          data-testid={`pa-new-area-${levelIndex}`}
                        >
                          {dragged?.kind === 'area'
                            ? `Move the process area to level ${levelIndex}`
                            : level.areas.length === 0
                              ? 'Empty level — drop an object type here to create a process area'
                              : 'Drop an object type here to create a new process area'}
                        </div>
                      </div>
                    </section>
                    <AddLevelButton
                      subtle={levelIndex > 0}
                      label={levelIndex > 0 ? `Insert level between ${levelIndex} and ${levelIndex - 1}` : 'Add level at the bottom'}
                      onClick={() => commit((c) => insertLevel(c, levelIndex))}
                    />
                  </div>
                );
              })}

            <section
              aria-label="Object types in no process area"
              data-testid="pa-unassigned"
              className={`mt-2 rounded-lg border border-dashed bg-background p-3 transition-colors ${
                isHover({ kind: 'unassigned' }) ? 'border-primary ring-2 ring-primary/30' : ''
              }`}
              {...dropProps({ kind: 'unassigned' })}
            >
              <header className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide">Not in any process area</span>
                <span className="text-xs text-muted-foreground">
                  Drop here to take an object type out of every process area.
                </span>
              </header>
              <div className="flex min-h-[32px] flex-wrap gap-1.5">
                {draft.unassigned.length === 0 ? (
                  <span className="text-xs italic text-muted-foreground">
                    Every object type belongs to a process area.
                  </span>
                ) : (
                  draft.unassigned.map((objectType) => (
                    <ObjectTypeChip
                      key={objectType}
                      objectType={objectType}
                      color={typeColors[objectType]}
                      draft={draft}
                      dragging={dragged?.kind === 'type' && dragged.objectType === objectType}
                      onDragStart={startDrag({ kind: 'type', objectType })}
                      onDragEnd={endDrag}
                      onMove={(target) => moveType(objectType, target)}
                    />
                  ))
                )}
              </div>
            </section>
          </div>

          {/* ── inspector ───────────────────────────────────────── */}
          <aside className="min-h-0 overflow-auto border-t p-4 md:border-l md:border-t-0" data-testid="pa-inspector">
            {selected ? (
              <AreaInspector
                key={selected.area.id}
                area={selected.area}
                levelIndex={selected.levelIndex}
                draft={draft}
                owners={owners}
                objectTypeToActivities={objectTypeToActivities}
                allActivities={allActivities}
                typeColors={typeColors}
                onClose={() => setSelectedAreaId(null)}
                onRename={(name) => editText((c) => renameArea(c, selected.area.id, name))}
                onRenameFocus={recordOnFocus}
                onSetActivities={(activities) =>
                  commit((c) => setAreaActivities(c, selected.area.id, activities))
                }
                onResetActivities={() =>
                  commit((c) => resetAreaActivities(c, selected.area.id, objectTypeToActivities))
                }
                onMoveType={moveType}
                onMoveArea={(target) => moveWholeArea(selected.area.id, target)}
              />
            ) : (
              <CompositionOverview
                draft={draft}
                stats={stats}
                problems={problems}
                onDescriptionFocus={recordOnFocus}
                onDescription={(text) => editText((c) => setDescription(c, text))}
                onSelectArea={setSelectedAreaId}
              />
            )}
          </aside>
        </div>

        {/* ── footer ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
          <div className="min-w-0 flex-1 text-xs" role="status">
            {blocked ? (
              <span className="flex items-center gap-1.5 text-destructive">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                {errors[0].message}
                {errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {stats.areas} process area{stats.areas === 1 ? '' : 's'} on {stats.levels} level
                {stats.levels === 1 ? '' : 's'}
                {assetId ? ' · editing a stored composition' : ''}
              </span>
            )}
          </div>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={apply}
            disabled={blocked}
            title="Show these process areas without saving them"
          >
            Apply without saving
          </Button>
          {assetId ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void save(true)}
              disabled={blocked || saving || !projectId}
            >
              Save as new
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={() => void save(false)}
            disabled={blocked || saving || !projectId}
            title={projectId ? undefined : 'Select an event log of a project first'}
            data-testid="pa-save"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : assetId ? 'Save changes' : 'Save to project assets'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== */
/* Board pieces                                                       */
/* ================================================================== */

function AddLevelButton({ label, onClick, subtle = false }: { label: string; onClick: () => void; subtle?: boolean }) {
  return (
    <div className={`group flex justify-center ${subtle ? 'py-1' : 'py-2'}`}>
      <button
        type="button"
        onClick={onClick}
        className={`flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-[11px] text-muted-foreground transition hover:border-primary hover:bg-background hover:text-primary focus-visible:opacity-100 ${
          subtle ? 'opacity-40 group-hover:opacity-100' : ''
        }`}
      >
        <Plus className="h-3 w-3" />
        {label}
      </button>
    </div>
  );
}

function RemoveLevelButton({
  levelIndex,
  typeCount,
  disabled,
  onConfirm,
}: {
  levelIndex: number;
  typeCount: number;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="ml-auto h-7 w-7 text-muted-foreground hover:text-destructive"
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

type DropHandlers = {
  onDragOver: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
};

function AreaCard({
  area,
  levelIndex,
  draft,
  typeColors,
  selected,
  invalid,
  hover,
  dimmed,
  draggedType,
  dropProps,
  onSelect,
  onAreaDragStart,
  onTypeDragStart,
  onDragEnd,
  onMoveType,
  onMoveArea,
}: {
  area: CompositionArea;
  levelIndex: number;
  draft: ProcessAreaComposition;
  typeColors: Record<string, string>;
  selected: boolean;
  invalid: boolean;
  hover: boolean;
  dimmed: boolean;
  draggedType: string | null;
  dropProps: DropHandlers;
  onSelect: () => void;
  onAreaDragStart: (event: React.DragEvent) => void;
  onTypeDragStart: (objectType: string) => (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onMoveType: (objectType: string, target: DropTarget) => void;
  onMoveArea: (target: DropTarget) => void;
}) {
  return (
    <div
      role="group"
      aria-label={`Process area ${area.name}`}
      data-testid="pa-area"
      data-area-name={area.name}
      onClick={onSelect}
      className={`flex min-w-[200px] max-w-[360px] cursor-pointer flex-col gap-2 rounded-md border bg-blue-50/60 p-2.5 shadow-sm transition dark:bg-blue-950/30 ${
        selected ? 'border-primary ring-2 ring-primary/40' : 'border-blue-200 dark:border-blue-900'
      } ${hover ? 'border-primary bg-primary/10 ring-2 ring-primary/40' : ''} ${invalid ? 'border-destructive' : ''} ${
        dimmed ? 'opacity-40' : ''
      }`}
      {...dropProps}
    >
      <div className="flex items-center gap-1">
        <span
          draggable
          onDragStart={onAreaDragStart}
          onDragEnd={onDragEnd}
          onClick={(event) => event.stopPropagation()}
          className="cursor-grab rounded p-0.5 text-muted-foreground hover:bg-blue-100 active:cursor-grabbing dark:hover:bg-blue-900"
          title="Drag to move this process area to another level, or onto another area to merge them"
          aria-hidden
          data-testid="pa-area-handle"
        >
          <GripVertical className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={area.name}>
          {area.name.trim() || <span className="italic text-destructive">Unnamed</span>}
        </span>
        <AreaMenu area={area} levelIndex={levelIndex} draft={draft} onMoveArea={onMoveArea} onSelect={onSelect} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {area.objectTypes.map((objectType) => (
          <ObjectTypeChip
            key={objectType}
            objectType={objectType}
            color={typeColors[objectType]}
            draft={draft}
            dragging={draggedType === objectType}
            onDragStart={onTypeDragStart(objectType)}
            onDragEnd={onDragEnd}
            onMove={(target) => onMoveType(objectType, target)}
          />
        ))}
      </div>
      <div className="mt-auto flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className={area.activities.length === 0 ? 'text-amber-700 dark:text-amber-400' : ''}>
          {area.activities.length} activit{area.activities.length === 1 ? 'y' : 'ies'}
        </span>
        <span aria-hidden>·</span>
        <span className="underline-offset-2 group-hover:underline">{selected ? 'editing' : 'click to edit'}</span>
      </div>
    </div>
  );
}

function AreaMenu({
  area,
  levelIndex,
  draft,
  onMoveArea,
  onSelect,
}: {
  area: CompositionArea;
  levelIndex: number;
  draft: ProcessAreaComposition;
  onMoveArea: (target: DropTarget) => void;
  onSelect: () => void;
}) {
  const others = allAreas(draft).filter((a) => a.id !== area.id);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          aria-label={`Actions for ${area.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onSelect={onSelect}>Rename and edit activities…</DropdownMenuItem>
        {levelIndex < draft.levels.length - 1 ? (
          <DropdownMenuItem onSelect={() => onMoveArea({ kind: 'newArea', levelIndex: levelIndex + 1 })}>
            <ArrowUp className="h-4 w-4" />
            Move up to level {levelIndex + 1}
          </DropdownMenuItem>
        ) : null}
        {levelIndex > 0 ? (
          <DropdownMenuItem onSelect={() => onMoveArea({ kind: 'newArea', levelIndex: levelIndex - 1 })}>
            <ArrowDown className="h-4 w-4" />
            Move down to level {levelIndex - 1}
          </DropdownMenuItem>
        ) : null}
        {draft.levels.length > 2 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to level…</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {draft.levels.map((_, i) => (
                <DropdownMenuItem
                  key={i}
                  disabled={i === levelIndex}
                  onSelect={() => onMoveArea({ kind: 'newArea', levelIndex: i })}
                >
                  Level {i}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        {others.length > 0 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Merge into…</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-auto">
              {others.map((other) => (
                <DropdownMenuItem key={other.id} onSelect={() => onMoveArea({ kind: 'area', areaId: other.id })}>
                  {other.name} <span className="ml-auto text-[10px] text-muted-foreground">L{other.levelIndex}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => onMoveArea({ kind: 'unassigned' })}
        >
          <Trash2 className="h-4 w-4" />
          Dissolve process area
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ObjectTypeChip({
  objectType,
  color,
  draft,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  objectType: string;
  color?: string;
  draft: ProcessAreaComposition;
  dragging: boolean;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onMove: (target: DropTarget) => void;
}) {
  return (
    <span
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-testid="pa-object-type"
      data-object-type={objectType}
      className={`inline-flex max-w-full cursor-grab items-center gap-1 rounded-full border bg-background py-0.5 pl-2 pr-0.5 text-xs font-medium shadow-sm active:cursor-grabbing ${
        dragging ? 'opacity-40' : ''
      }`}
      title={`${objectType} — drag to move`}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color ?? '#94A3B8' }} aria-hidden />
      <span className="truncate">{objectType}</span>
      <MoveTypeMenu objectType={objectType} draft={draft} onMove={onMove} />
    </span>
  );
}

/** Keyboard / click alternative to dragging an object type. */
function MoveTypeMenu({
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

/* ================================================================== */
/* Inspector                                                          */
/* ================================================================== */

function AreaInspector({
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

function CompositionOverview({
  draft,
  stats,
  problems,
  onDescription,
  onDescriptionFocus,
  onSelectArea,
}: {
  draft: ProcessAreaComposition;
  stats: { levels: number; areas: number; objectTypes: number };
  problems: ReturnType<typeof compositionProblems>;
  onDescription: (text: string) => void;
  onDescriptionFocus: () => void;
  onSelectArea: (areaId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Composition</p>
        <p className="truncate text-sm font-semibold">{draft.name.trim() || 'Unnamed composition'}</p>
        <p className="text-xs text-muted-foreground">
          {stats.areas} process areas · {stats.levels} levels · {stats.objectTypes} object types
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="pa-composition-description" className="text-xs">
          Description <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="pa-composition-description"
          value={draft.description}
          onFocus={onDescriptionFocus}
          onChange={(event) => onDescription(event.target.value)}
          rows={3}
          placeholder="What this composition is for"
          className="text-xs"
        />
      </div>

      {problems.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Checks</p>
          <ul className="space-y-1">
            {problems.map((problem, index) => (
              <li key={index}>
                <button
                  type="button"
                  disabled={!problem.areaId}
                  onClick={() => problem.areaId && onSelectArea(problem.areaId)}
                  className={`flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left text-xs enabled:hover:bg-muted ${
                    problem.severity === 'error' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {problem.severity === 'error' ? (
                    <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  {problem.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Info className="h-3.5 w-3.5" /> How to
        </p>
        <ul className="list-disc space-y-1 pl-4">
          <li>Drag an object type onto another process area to add it there.</li>
          <li>Drag it onto the dashed space of a level to make it a process area of its own.</li>
          <li>Drag an area by its <GripVertical className="inline h-3 w-3" /> handle to another level, or onto another area to merge.</li>
          <li>Use <span className="font-medium">+ Add level</span> between levels; remove a level with its bin.</li>
          <li>Click an area to rename it and choose its activities.</li>
        </ul>
      </div>
    </div>
  );
}

export default ProcessAreaEditor;
