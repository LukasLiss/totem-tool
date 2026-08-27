import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteRelation,
  editorErrorMessage,
  EditorRelation,
  listRelations,
  Page,
  setRelation,
} from "@/api/ocelEditorApi";
import {
  EmptyRow,
  PaginationFooter,
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

/**
 * The O2O relations table with an inline add/edit row. A relation is
 * identified by (source, target); saving an existing pair updates its
 * qualifier (upsert semantics in the backend).
 */
export function RelationsTab({
  sessionId,
  onLogChanged,
}: {
  sessionId: string;
  onLogChanged: () => void;
}) {
  const [data, setData] = useState<Page<EditorRelation> | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<Sort>({ by: "source", dir: "asc" });
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ source: "", target: "", qualifier: "" });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listRelations(sessionId, {
        page,
        page_size: pageSize,
        sort_by: sort.by,
        sort_dir: sort.dir,
        search: debouncedSearch || undefined,
      });
      setData(result);
      const pageCount = Math.max(1, Math.ceil(result.total / result.page_size));
      if (page > pageCount) setPage(pageCount);
    } catch (error) {
      toast.error(`Failed to load relations: ${editorErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, [sessionId, page, pageSize, sort, debouncedSearch]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, pageSize]);

  const handleSave = async () => {
    if (!form.source.trim() || !form.target.trim()) {
      toast.error("Source and target object ids are required.");
      return;
    }
    setSaving(true);
    try {
      await setRelation(sessionId, {
        source: form.source.trim(),
        target: form.target.trim(),
        qualifier: form.qualifier.trim() || null,
      });
      toast.success(`Relation ${form.source.trim()} → ${form.target.trim()} saved`);
      setForm({ source: "", target: "", qualifier: "" });
      await refresh();
      onLogChanged();
    } catch (error) {
      toast.error(editorErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (relation: EditorRelation) => {
    const key = `${relation.source}→${relation.target}`;
    setDeleting(key);
    try {
      await deleteRelation(sessionId, relation.source, relation.target);
      toast.success(`Relation ${relation.source} → ${relation.target} deleted`);
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
          placeholder="Search relations…"
          aria-label="Search relations"
          className="h-8 w-52"
        />
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Input
            value={form.source}
            onChange={(event) => setForm({ ...form, source: event.target.value })}
            placeholder="source object"
            aria-label="Source object id"
            className="h-8 w-36 font-mono"
          />
          <span className="text-muted-foreground">→</span>
          <Input
            value={form.target}
            onChange={(event) => setForm({ ...form, target: event.target.value })}
            placeholder="target object"
            aria-label="Target object id"
            className="h-8 w-36 font-mono"
          />
          <Input
            value={form.qualifier}
            onChange={(event) => setForm({ ...form, qualifier: event.target.value })}
            placeholder="qualifier (optional)"
            aria-label="Qualifier"
            className="h-8 w-40"
          />
          <Button size="sm" className="h-8" onClick={handleSave} disabled={saving}>
            <Plus className="size-4" /> {saving ? "Saving…" : "Add / update"}
          </Button>
        </div>
      </div>

      <div className={tableWrapClass}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th className={thClass}>
                <SortableHeader label="Source" column="source" sort={sort} onSort={(c) => setSort(toggleSort(sort, c))} />
              </th>
              <th className={thClass}>Source type</th>
              <th className={thClass}>
                <SortableHeader label="Target" column="target" sort={sort} onSort={(c) => setSort(toggleSort(sort, c))} />
              </th>
              <th className={thClass}>Target type</th>
              <th className={thClass}>
                <SortableHeader label="Qualifier" column="qualifier" sort={sort} onSort={(c) => setSort(toggleSort(sort, c))} />
              </th>
              <th className={`${thClass} w-20 text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody className={loading ? "opacity-50" : ""}>
            {data && data.items.length === 0 && (
              <EmptyRow colSpan={6}>
                {data.total === 0 && !debouncedSearch
                  ? "No object-to-object relations yet — add one with the form above."
                  : "No relations match the current search."}
              </EmptyRow>
            )}
            {data?.items.map((relation) => {
              const key = `${relation.source}→${relation.target}`;
              return (
                <tr key={key} className="hover:bg-muted/40">
                  <td className={`${tdClass} font-mono text-xs`}>{relation.source}</td>
                  <td className={tdClass}>{relation.source_type ?? ""}</td>
                  <td className={`${tdClass} font-mono text-xs`}>{relation.target}</td>
                  <td className={tdClass}>{relation.target_type ?? ""}</td>
                  <td className={tdClass}>{relation.qualifier ?? ""}</td>
                  <td className={`${tdClass} whitespace-nowrap text-right`}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Edit relation ${key}`}
                      onClick={() =>
                        setForm({
                          source: relation.source,
                          target: relation.target,
                          qualifier: relation.qualifier ?? "",
                        })
                      }
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive"
                      aria-label={`Delete relation ${key}`}
                      disabled={deleting === key}
                      onClick={() => handleDelete(relation)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              );
            })}
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
    </div>
  );
}

export default RelationsTab;
