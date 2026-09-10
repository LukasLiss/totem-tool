/**
 * Dialogs for the stored-query store used by the SQL editor and the query
 * field: pick an existing stored query (copy its text or link it) and save
 * the current text as a new / existing stored query.
 */

import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Link2, Copy } from "lucide-react";
import { toast } from "sonner";
import {
  createQueryAsset,
  extractAssetApiError,
  listQueryAssets,
  queryAssetDescription,
  queryAssetSql,
  updateQueryAsset,
  type ProjectAsset,
} from "@/api/assetsApi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

function ErrorLine({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <AlertCircle className="size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pick a stored query                                                 */
/* ------------------------------------------------------------------ */

export interface StoredQueryPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: number;
  /** insert the query text as a local copy */
  onUseCopy?: (asset: ProjectAsset) => void;
  /** link the stored query (edits in the store apply here too) */
  onLink?: (asset: ProjectAsset) => void;
}

export function StoredQueryPickerDialog({
  open,
  onOpenChange,
  projectId,
  onUseCopy,
  onLink,
}: StoredQueryPickerDialogProps) {
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!projectId) {
      setAssets([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    listQueryAssets(projectId)
      .then((data) => {
        if (alive) setAssets(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (alive) setError(extractAssetApiError(err).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, projectId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Stored queries</DialogTitle>
          <DialogDescription>
            {onLink
              ? "Insert a copy of a stored query, or link it so that changes made in the query store apply here as well."
              : "Insert a copy of a stored query."}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {!projectId ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Select an event log to browse its project's stored queries.
            </p>
          ) : loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : error ? (
            <ErrorLine message={error} />
          ) : assets.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No stored queries yet. Save one from the SQL editor or the SQL Queries page.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {assets.map((asset) => (
                <li
                  key={asset.id}
                  className="flex items-start gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{asset.name}</p>
                    {queryAssetDescription(asset) && (
                      <p className="truncate text-xs text-muted-foreground">
                        {queryAssetDescription(asset)}
                      </p>
                    )}
                    <pre className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
                      {queryAssetSql(asset)}
                    </pre>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    {onUseCopy && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5"
                        onClick={() => {
                          onUseCopy(asset);
                          onOpenChange(false);
                        }}
                      >
                        <Copy className="size-3.5" /> Use copy
                      </Button>
                    )}
                    {onLink && (
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 gap-1.5"
                        onClick={() => {
                          onLink(asset);
                          onOpenChange(false);
                        }}
                      >
                        <Link2 className="size-3.5" /> Link
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Save as stored query                                                */
/* ------------------------------------------------------------------ */

export interface SaveStoredQueryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: number;
  query: string;
  /** suggested name (e.g. the widget's query name) */
  defaultName?: string;
  /** when set, the dialog updates this asset instead of creating a new one */
  existing?: ProjectAsset | null;
  onSaved?: (asset: ProjectAsset) => void;
}

export function SaveStoredQueryDialog({
  open,
  onOpenChange,
  projectId,
  query,
  defaultName = "",
  existing = null,
  onSaved,
}: SaveStoredQueryDialogProps) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? defaultName);
    setDescription(existing ? queryAssetDescription(existing) : "");
    setError(null);
  }, [open, defaultName, existing]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!projectId) {
        setError("Select an event log first.");
        return;
      }
      if (!name.trim()) {
        setError("Enter a name for the stored query.");
        return;
      }
      if (!query.trim()) {
        setError("The query is empty.");
        return;
      }
      setSaving(true);
      setError(null);
      try {
        const asset = existing
          ? await updateQueryAsset({
              assetId: existing.id,
              name: name.trim(),
              query,
              description: description.trim(),
              current: existing.content_json,
            })
          : await createQueryAsset({
              projectId,
              name: name.trim(),
              query,
              description: description.trim(),
            });
        toast.success(existing ? "Stored query updated" : "Query stored");
        onSaved?.(asset);
        onOpenChange(false);
      } catch (err) {
        setError(extractAssetApiError(err).message);
      } finally {
        setSaving(false);
      }
    },
    [projectId, name, query, description, existing, onSaved, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{existing ? "Update stored query" : "Store query"}</DialogTitle>
            <DialogDescription>
              {existing
                ? `Overwrite "${existing.name}" with the current query text.`
                : "Save the current query in the project's query store so it can be reused and linked from dashboards."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="stored-query-name">Name</Label>
              <Input
                id="stored-query-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Events per activity"
                disabled={saving}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="stored-query-description">Description (optional)</Label>
              <Textarea
                id="stored-query-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What the query returns, e.g. one row per activity with its event count."
                disabled={saving}
                rows={2}
              />
            </div>
            <pre className="max-h-32 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px]">
              {query}
            </pre>
            {error && <ErrorLine message={error} />}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !projectId}>
              {saving ? "Saving" : existing ? "Update" : "Store"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
