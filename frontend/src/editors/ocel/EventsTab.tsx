import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createEvent,
  deleteEvent,
  editorErrorMessage,
  EditorEvent,
  EditorObjectRef,
  listEvents,
  Page,
  SessionSummary,
  updateEvent,
} from "@/api/ocelEditorApi";
import {
  AttributeEditor,
  attributesToRows,
  AttributeRow,
  EmptyRow,
  formatTimestamp,
  localInputToUnix,
  PaginationFooter,
  rowsToAttributes,
  Sort,
  SortableHeader,
  tableClass,
  tableWrapClass,
  tdClass,
  theadClass,
  thClass,
  toggleSort,
  unixToLocalInput,
  useDebounced,
} from "./shared";

type EventDraft = {
  originalId: string | null; // null → creating a new event
  id: string;
  activity: string;
  timestampLocal: string;
  attributeRows: AttributeRow[];
  objects: { object_id: string; qualifier: string }[];
};

function emptyDraft(): EventDraft {
  return {
    originalId: null,
    id: "",
    activity: "",
    timestampLocal: unixToLocalInput(Math.floor(Date.now() / 1000)),
    attributeRows: [],
    objects: [],
  };
}

function draftFromEvent(event: EditorEvent): EventDraft {
  return {
    originalId: event.id,
    id: event.id,
    activity: event.activity,
    timestampLocal: unixToLocalInput(event.timestamp),
    attributeRows: attributesToRows(event.attributes),
    objects: event.objects.map((rel) => ({
      object_id: rel.object_id,
      qualifier: rel.qualifier ?? "",
    })),
  };
}

/**
 * The E2O table: one row per event, one column per object type listing the
 * related objects, exactly like the LaTeX export. Data is fetched page by
 * page from the backend; filters and sorting are applied server-side.
 */
export function EventsTab({
  sessionId,
  summary,
  onLogChanged,
}: {
  sessionId: string;
  summary: SessionSummary;
  onLogChanged: () => void;
}) {
  const [data, setData] = useState<Page<EditorEvent> | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<Sort>({ by: "timestamp", dir: "asc" });
  const [search, setSearch] = useState("");
  const [activityFilter, setActivityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search);
  const objectTypes = summary.object_types;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listEvents(sessionId, {
        page,
        page_size: pageSize,
        sort_by: sort.by,
        sort_dir: sort.dir,
        search: debouncedSearch || undefined,
        activity: activityFilter || undefined,
        object_type: typeFilter || undefined,
      });
      setData(result);
      // When deletes shrink the result below the current page, snap back.
      const pageCount = Math.max(1, Math.ceil(result.total / result.page_size));
      if (page > pageCount) setPage(pageCount);
    } catch (error) {
      toast.error(`Failed to load events: ${editorErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, [sessionId, page, pageSize, sort, debouncedSearch, activityFilter, typeFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, activityFilter, typeFilter, pageSize]);

  const objectsByType = useMemo(() => {
    const map = new Map<string, Map<string, string[]>>();
    for (const event of data?.items ?? []) {
      const perType = new Map<string, string[]>();
      for (const rel of event.objects) {
        const list = perType.get(rel.object_type ?? "") ?? [];
        list.push(rel.object_id);
        perType.set(rel.object_type ?? "", list);
      }
      map.set(event.id, perType);
    }
    return map;
  }, [data]);

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.id.trim() || !draft.activity.trim() || !draft.timestampLocal) {
      toast.error("Event id, activity and timestamp are required.");
      return;
    }
    const payload = {
      id: draft.id.trim(),
      activity: draft.activity.trim(),
      timestamp: localInputToUnix(draft.timestampLocal),
      attributes: rowsToAttributes(draft.attributeRows),
      objects: draft.objects
        .filter((rel) => rel.object_id.trim())
        .map((rel) => ({
          object_id: rel.object_id.trim(),
          qualifier: rel.qualifier.trim() || null,
        })) as EditorObjectRef[],
    };
    setSaving(true);
    try {
      if (draft.originalId === null) {
        await createEvent(sessionId, payload);
        toast.success(`Event ${payload.id} created`);
      } else {
        await updateEvent(sessionId, draft.originalId, payload);
        toast.success(`Event ${payload.id} updated`);
      }
      setDraft(null);
      await refresh();
      onLogChanged();
    } catch (error) {
      toast.error(editorErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (eventId: string) => {
    setDeleting(eventId);
    try {
      await deleteEvent(sessionId, eventId);
      toast.success(`Event ${eventId} deleted`);
      await refresh();
      onLogChanged();
    } catch (error) {
      toast.error(editorErrorMessage(error));
    } finally {
      setDeleting(null);
    }
  };

  const colSpan = 4 + objectTypes.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search id or activity…"
          aria-label="Search events"
          className="h-8 w-52"
        />
        <select
          value={activityFilter}
          onChange={(event) => setActivityFilter(event.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
          aria-label="Filter by activity"
        >
          <option value="">All activities</option>
          {summary.activities.map((activity) => (
            <option key={activity} value={activity}>
              {activity}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
          aria-label="Filter by object type"
        >
          <option value="">All object types</option>
          {objectTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <Button size="sm" className="ml-auto h-8" onClick={() => setDraft(emptyDraft())}>
          <Plus className="size-4" /> Add event
        </Button>
      </div>

      <div className={tableWrapClass}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th className={thClass}>
                <SortableHeader label="ID" column="id" sort={sort} onSort={(c) => setSort(toggleSort(sort, c))} />
              </th>
              <th className={thClass}>
                <SortableHeader label="Activity" column="activity" sort={sort} onSort={(c) => setSort(toggleSort(sort, c))} />
              </th>
              <th className={thClass}>
                <SortableHeader label="Timestamp" column="timestamp" sort={sort} onSort={(c) => setSort(toggleSort(sort, c))} />
              </th>
              {objectTypes.map((type) => (
                <th key={type} className={`${thClass} normal-case`}>
                  {type}
                </th>
              ))}
              <th className={`${thClass} w-20 text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody className={loading ? "opacity-50" : ""}>
            {data && data.items.length === 0 && (
              <EmptyRow colSpan={colSpan}>
                {data.total === 0 && !debouncedSearch && !activityFilter && !typeFilter
                  ? "No events yet — add objects first, then create events that reference them."
                  : "No events match the current filters."}
              </EmptyRow>
            )}
            {data?.items.map((event) => (
              <tr key={event.id} className="hover:bg-muted/40">
                <td className={`${tdClass} font-mono text-xs`}>{event.id}</td>
                <td className={tdClass}>
                  {event.activity}
                  {Object.keys(event.attributes).length > 0 && (
                    <span
                      className="ml-2 text-xs text-muted-foreground"
                      title={Object.entries(event.attributes)
                        .map(([k, v]) => `${k} = ${v}`)
                        .join("\n")}
                    >
                      {Object.entries(event.attributes)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(", ")}
                    </span>
                  )}
                </td>
                <td className={`${tdClass} whitespace-nowrap tabular-nums`}>
                  {formatTimestamp(event.timestamp)}
                </td>
                {objectTypes.map((type) => (
                  <td key={type} className={`${tdClass} font-mono text-xs`}>
                    {(objectsByType.get(event.id)?.get(type) ?? []).join(", ")}
                  </td>
                ))}
                <td className={`${tdClass} whitespace-nowrap text-right`}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Edit event ${event.id}`}
                    onClick={() => setDraft(draftFromEvent(event))}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive"
                    aria-label={`Delete event ${event.id}`}
                    disabled={deleting === event.id}
                    onClick={() => handleDelete(event.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && (
        <PaginationFooter
          page={data.page}
          pageSize={data.page_size}
          total={data.total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.originalId === null ? "Add event" : `Edit event ${draft?.originalId}`}</DialogTitle>
            <DialogDescription>
              Events reference existing objects — create the objects in the Objects tab first.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ocel-event-id">Event id</Label>
                  <Input
                    id="ocel-event-id"
                    value={draft.id}
                    onChange={(event) => setDraft({ ...draft, id: event.target.value })}
                    placeholder="e1"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ocel-event-ts">Timestamp</Label>
                  <Input
                    id="ocel-event-ts"
                    type="datetime-local"
                    value={draft.timestampLocal}
                    onChange={(event) => setDraft({ ...draft, timestampLocal: event.target.value })}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ocel-event-activity">Activity</Label>
                <Input
                  id="ocel-event-activity"
                  value={draft.activity}
                  list="ocel-event-activities"
                  onChange={(event) => setDraft({ ...draft, activity: event.target.value })}
                  placeholder="receive order"
                />
                <datalist id="ocel-event-activities">
                  {summary.activities.map((activity) => (
                    <option key={activity} value={activity} />
                  ))}
                </datalist>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Related objects (E2O)</Label>
                {draft.objects.map((rel, index) => (
                  <div key={index} className="flex items-center gap-1.5">
                    <Input
                      value={rel.object_id}
                      placeholder="object id"
                      aria-label="Related object id"
                      className="h-8 flex-1 font-mono"
                      onChange={(event) => {
                        const next = [...draft.objects];
                        next[index] = { ...rel, object_id: event.target.value };
                        setDraft({ ...draft, objects: next });
                      }}
                    />
                    <Input
                      value={rel.qualifier}
                      placeholder="qualifier (optional)"
                      aria-label="Qualifier"
                      className="h-8 flex-1"
                      onChange={(event) => {
                        const next = [...draft.objects];
                        next[index] = { ...rel, qualifier: event.target.value };
                        setDraft({ ...draft, objects: next });
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground"
                      aria-label="Remove related object"
                      onClick={() =>
                        setDraft({ ...draft, objects: draft.objects.filter((_, i) => i !== index) })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 self-start"
                  onClick={() =>
                    setDraft({ ...draft, objects: [...draft.objects, { object_id: "", qualifier: "" }] })
                  }
                >
                  <Plus className="size-4" /> Add related object
                </Button>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Attributes</Label>
                <AttributeEditor
                  rows={draft.attributeRows}
                  onChange={(rows) => setDraft({ ...draft, attributeRows: rows })}
                  knownKeys={summary.event_attribute_columns}
                  idPrefix="ocel-event"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : draft?.originalId === null ? "Create event" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default EventsTab;
