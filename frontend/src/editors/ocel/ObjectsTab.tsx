import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
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
  createObject,
  deleteObject,
  editorErrorMessage,
  EditorObject,
  listObjects,
  Page,
  SessionSummary,
  updateObject,
} from "@/api/ocelEditorApi";
import {
  AttributeEditor,
  attributesToRows,
  AttributeRow,
  EmptyRow,
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
  useDebounced,
} from "./shared";

type ObjectDraft = {
  originalId: string | null; // null → creating a new object
  id: string;
  type: string;
};

/**
 * The object table: id, type, attribute summary and event usage. Attribute
 * editing is integrated directly into the table — expanding a row (chevron)
 * opens an inline attribute editor, since attributes are edited rarely and
 * don't deserve a full dialog.
 */
export function ObjectsTab({
  sessionId,
  summary,
  onLogChanged,
}: {
  sessionId: string;
  summary: SessionSummary;
  onLogChanged: () => void;
}) {
  const [data, setData] = useState<Page<EditorObject> | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<Sort>({ by: "id", dir: "asc" });
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [draft, setDraft] = useState<ObjectDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<AttributeRow[]>([]);
  const [savingAttributes, setSavingAttributes] = useState(false);

  const debouncedSearch = useDebounced(search);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listObjects(sessionId, {
        page,
        page_size: pageSize,
        sort_by: sort.by,
        sort_dir: sort.dir,
        search: debouncedSearch || undefined,
        object_type: typeFilter || undefined,
      });
      setData(result);
      const pageCount = Math.max(1, Math.ceil(result.total / result.page_size));
      if (page > pageCount) setPage(pageCount);
    } catch (error) {
      toast.error(`Failed to load objects: ${editorErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, [sessionId, page, pageSize, sort, debouncedSearch, typeFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, typeFilter, pageSize]);

  const toggleExpanded = (object: EditorObject) => {
    if (expandedId === object.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(object.id);
    setExpandedRows(attributesToRows(object.attributes));
  };

  const handleSaveAttributes = async (objectId: string) => {
    setSavingAttributes(true);
    try {
      await updateObject(sessionId, objectId, {
        attributes: rowsToAttributes(expandedRows),
      });
      toast.success(`Attributes of ${objectId} saved`);
      setExpandedId(null);
      await refresh();
      onLogChanged();
    } catch (error) {
      toast.error(editorErrorMessage(error));
    } finally {
      setSavingAttributes(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!draft) return;
    if (!draft.id.trim() || !draft.type.trim()) {
      toast.error("Object id and type are required.");
      return;
    }
    setSaving(true);
    try {
      if (draft.originalId === null) {
        await createObject(sessionId, { id: draft.id.trim(), type: draft.type.trim() });
        toast.success(`Object ${draft.id.trim()} created`);
      } else {
        await updateObject(sessionId, draft.originalId, {
          id: draft.id.trim(),
          type: draft.type.trim(),
        });
        toast.success(`Object ${draft.id.trim()} updated`);
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

  const handleDelete = async (objectId: string) => {
    setDeleting(objectId);
    try {
      await deleteObject(sessionId, objectId);
      toast.success(`Object ${objectId} deleted`);
      await refresh();
      onLogChanged();
    } catch (error) {
      toast.error(editorErrorMessage(error));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search id or type…"
          aria-label="Search objects"
          className="h-8 w-52"
        />
        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
          aria-label="Filter by object type"
        >
          <option value="">All object types</option>
          {summary.object_types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          className="ml-auto h-8"
          onClick={() => setDraft({ originalId: null, id: "", type: "" })}
        >
          <Plus className="size-4" /> Add object
        </Button>
      </div>

      <div className={tableWrapClass}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th className={`${thClass} w-8`} />
              <th className={thClass}>
                <SortableHeader label="ID" column="id" sort={sort} onSort={(c) => setSort(toggleSort(sort, c))} />
              </th>
              <th className={thClass}>
                <SortableHeader label="Type" column="type" sort={sort} onSort={(c) => setSort(toggleSort(sort, c))} />
              </th>
              <th className={thClass}>Attributes</th>
              <th className={thClass}>Events</th>
              <th className={`${thClass} w-20 text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody className={loading ? "opacity-50" : ""}>
            {data && data.items.length === 0 && (
              <EmptyRow colSpan={6}>
                {data.total === 0 && !debouncedSearch && !typeFilter
                  ? "No objects yet — objects are the first thing to create in a new log."
                  : "No objects match the current filters."}
              </EmptyRow>
            )}
            {data?.items.map((object) => (
              <Fragment key={object.id}>
                <tr className="hover:bg-muted/40">
                  <td className={tdClass}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`${expandedId === object.id ? "Collapse" : "Expand"} attributes of ${object.id}`}
                      aria-expanded={expandedId === object.id}
                      onClick={() => toggleExpanded(object)}
                    >
                      {expandedId === object.id ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </Button>
                  </td>
                  <td className={`${tdClass} font-mono text-xs`}>{object.id}</td>
                  <td className={tdClass}>{object.type}</td>
                  <td className={`${tdClass} max-w-64 truncate text-xs text-muted-foreground`}>
                    {Object.entries(object.attributes)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(", ") || "—"}
                  </td>
                  <td className={`${tdClass} tabular-nums`}>{object.event_count ?? 0}</td>
                  <td className={`${tdClass} whitespace-nowrap text-right`}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Edit object ${object.id}`}
                      onClick={() =>
                        setDraft({ originalId: object.id, id: object.id, type: object.type })
                      }
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive"
                      aria-label={`Delete object ${object.id}`}
                      disabled={deleting === object.id}
                      onClick={() => handleDelete(object.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </td>
                </tr>
                {expandedId === object.id && (
                  <tr className="bg-muted/30">
                    <td className={tdClass} />
                    <td colSpan={5} className={`${tdClass} py-3`}>
                      <div className="flex max-w-xl flex-col gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          Attributes of {object.id}
                        </span>
                        <AttributeEditor
                          rows={expandedRows}
                          onChange={setExpandedRows}
                          knownKeys={summary.object_attribute_columns}
                          idPrefix={`ocel-object-${object.id}`}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="h-8"
                            disabled={savingAttributes}
                            onClick={() => handleSaveAttributes(object.id)}
                          >
                            {savingAttributes ? "Saving…" : "Save attributes"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => setExpandedId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {draft?.originalId === null ? "Add object" : `Edit object ${draft?.originalId}`}
            </DialogTitle>
            <DialogDescription>
              Renaming an object updates every event and relation that references it.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ocel-object-id">Object id</Label>
                <Input
                  id="ocel-object-id"
                  value={draft.id}
                  onChange={(event) => setDraft({ ...draft, id: event.target.value })}
                  placeholder="o1"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ocel-object-type">Object type</Label>
                <Input
                  id="ocel-object-type"
                  value={draft.type}
                  list="ocel-object-types"
                  onChange={(event) => setDraft({ ...draft, type: event.target.value })}
                  placeholder="order"
                />
                <datalist id="ocel-object-types">
                  {summary.object_types.map((type) => (
                    <option key={type} value={type} />
                  ))}
                </datalist>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveDraft} disabled={saving}>
              {saving ? "Saving…" : draft?.originalId === null ? "Create object" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ObjectsTab;
