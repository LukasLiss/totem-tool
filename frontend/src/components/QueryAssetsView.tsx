/**
 * QueryAssetsView — the "SQL Queries" page of the project asset store.
 * Lists the project's stored queries and lets the user create, edit
 * (name, description and SQL in the full editor), and delete them.
 * Dashboard components that link a stored query pick up edits made here.
 */

import { useCallback, useContext, useEffect, useState } from "react";
import { AlertCircle, FileCode2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createQueryAsset,
  deleteAsset,
  extractAssetApiError,
  listQueryAssets,
  queryAssetDescription,
  queryAssetSql,
  updateQueryAsset,
  type ProjectAsset,
} from "@/api/assetsApi";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import SqlQueryEditor, { SQL_QUERY_DEFAULT } from "@/react_component/SqlQueryEditor";

export function QueryAssetsView({ initialAssetId }: { initialAssetId?: number }) {
  const { selectedFile } = useContext(SelectedFileContext);
  const projectId: number | undefined = selectedFile?.project;
  const fileId: number | undefined = selectedFile?.id;
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProjectAsset | "new" | null>(null);
  const [assetToDelete, setAssetToDelete] = useState<ProjectAsset | null>(null);
  const [openedInitial, setOpenedInitial] = useState(false);

  const loadAssets = useCallback(async () => {
    if (!projectId) {
      setAssets([]);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await listQueryAssets(projectId);
      setAssets(Array.isArray(data) ? data : []);
    } catch (error) {
      setAssets([]);
      setErrorMessage(extractAssetApiError(error).message);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  // Deep link (e.g. from a dashboard widget): open the asset once loaded.
  useEffect(() => {
    if (openedInitial || !initialAssetId || assets.length === 0) return;
    const asset = assets.find((a) => a.id === initialAssetId);
    if (asset) {
      setEditing(asset);
      setOpenedInitial(true);
    }
  }, [assets, initialAssetId, openedInitial]);

  return (
    <div className="flex min-h-screen flex-col">
      <SidebarTrigger className="m-2" />
      <main className="flex-1 p-4 pt-0">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <div className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">SQL Queries</h1>
              <p className="text-sm text-muted-foreground">
                Stored queries of the current project. Dashboard components can link a
                stored query; editing it here updates every linked component.
              </p>
            </div>
            <Button type="button" disabled={!projectId} onClick={() => setEditing("new")}>
              <Plus />
              New query
            </Button>
          </div>

          {!projectId ? (
            <EmptyState
              title="No project selected"
              description="Upload or select an event log to manage its project's stored queries."
            />
          ) : isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : errorMessage ? (
            <Card className="border-destructive/40">
              <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="size-4" />
                  <span>{errorMessage}</span>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={loadAssets}>
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : assets.length === 0 ? (
            <EmptyState
              title="No stored queries"
              description="Create one here, or store a query from the SQL editor."
            />
          ) : (
            <Card className="overflow-hidden py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Query</TableHead>
                    <TableHead>Last changed</TableHead>
                    <TableHead className="w-[1%] whitespace-nowrap text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.map((asset) => (
                    <TableRow key={asset.id} className="align-top">
                      <TableCell className="font-medium">{asset.name}</TableCell>
                      <TableCell className="max-w-[240px] whitespace-normal text-muted-foreground">
                        {queryAssetDescription(asset) || "—"}
                      </TableCell>
                      <TableCell className="max-w-[360px]">
                        <pre className="max-h-16 overflow-hidden whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
                          {queryAssetSql(asset)}
                        </pre>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(asset.updated_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Edit ${asset.name}`}
                            title="Edit"
                            onClick={() => setEditing(asset)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Delete ${asset.name}`}
                            title="Delete"
                            onClick={() => setAssetToDelete(asset)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          <EditQueryDialog
            target={editing}
            projectId={projectId}
            fileId={fileId}
            onOpenChange={(open) => {
              if (!open) setEditing(null);
            }}
            onSaved={async () => {
              setEditing(null);
              await loadAssets();
            }}
          />

          <DeleteQueryDialog
            asset={assetToDelete}
            onOpenChange={(open) => {
              if (!open) setAssetToDelete(null);
            }}
            onDeleted={async () => {
              setAssetToDelete(null);
              await loadAssets();
            }}
          />
        </div>
      </main>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function EditQueryDialog({
  target,
  projectId,
  fileId,
  onOpenChange,
  onSaved,
}: {
  target: ProjectAsset | "new" | null;
  projectId?: number;
  fileId?: number;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const asset = target === "new" ? null : target;
  const open = target !== null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState(SQL_QUERY_DEFAULT);
  const [rowLimit, setRowLimit] = useState(25);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(asset?.name ?? "");
    setDescription(asset ? queryAssetDescription(asset) : "");
    setQuery(asset ? queryAssetSql(asset) : SQL_QUERY_DEFAULT);
    setFormError(null);
  }, [open, asset]);

  const handleSave = async () => {
    if (!projectId) {
      setFormError("Select an event log first.");
      return;
    }
    if (!name.trim()) {
      setFormError("Enter a query name.");
      return;
    }
    if (!query.trim()) {
      setFormError("The query is empty.");
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      if (asset) {
        await updateQueryAsset({
          assetId: asset.id,
          name: name.trim(),
          query,
          description: description.trim(),
          current: asset.content_json,
        });
        toast.success("Stored query updated");
      } else {
        await createQueryAsset({
          projectId,
          name: name.trim(),
          query,
          description: description.trim(),
        });
        toast.success("Query stored");
      }
      await onSaved();
    } catch (error) {
      setFormError(extractAssetApiError(error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] flex-col gap-3 p-4 sm:max-w-[min(1200px,94vw)]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{asset ? "Edit stored query" : "New stored query"}</DialogTitle>
          <DialogDescription>
            {asset
              ? "Changes apply to every dashboard component linked to this query."
              : "Store a reusable query in the project's asset store."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid shrink-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="grid gap-1.5">
            <Label htmlFor="query-asset-name">Name</Label>
            <Input
              id="query-asset-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Events per activity"
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="query-asset-description">Description (optional)</Label>
            <Input
              id="query-asset-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One row per activity with its event count."
              disabled={isSubmitting}
            />
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <SqlQueryEditor
            value={{ name, query, rowLimit }}
            onChange={(patch) => {
              if (patch.query !== undefined) setQuery(patch.query);
              if (patch.rowLimit !== undefined) setRowLimit(patch.rowLimit);
            }}
            isEditMode
            fileId={fileId}
            hideName
            className="rounded-md"
          />
        </div>
        {formError && (
          <div className="flex shrink-0 items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="size-4" />
            <span>{formError}</span>
          </div>
        )}
        <DialogFooter className="shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSubmitting || !projectId}>
            {isSubmitting ? "Saving" : asset ? "Save changes" : "Store query"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteQueryDialog({
  asset,
  onOpenChange,
  onDeleted,
}: {
  asset: ProjectAsset | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!asset) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteAsset(asset.id);
      toast.success("Stored query deleted");
      await onDeleted();
    } catch (error) {
      setDeleteError(extractAssetApiError(error).message);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(asset)}
      onOpenChange={(open) => {
        if (!open) setDeleteError(null);
        onOpenChange(open);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete stored query</DialogTitle>
          <DialogDescription>
            Delete {asset ? `"${asset.name}"` : "this query"} from the project. Dashboard
            components linked to it fall back to their own copy of the query text.
          </DialogDescription>
        </DialogHeader>
        {deleteError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="size-4" />
            <span>{deleteError}</span>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting || !asset}
          >
            {isDeleting ? "Deleting" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <div className="mb-2 rounded-md border bg-muted p-2">
          <FileCode2 className="size-5 text-muted-foreground" />
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

export default QueryAssetsView;
