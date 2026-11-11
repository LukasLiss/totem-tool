/**
 * ProcessAreaAssetsView — the "Process Areas" page of the project asset
 * store. Lists the stored process-area compositions with their named areas
 * and lets the user open one in the Process Area view, rename, download or
 * delete it. Compositions are created and edited in the Process Area view
 * ("Adjust" → "Save to project assets").
 */
import { useContext, useMemo, useState } from "react";
import { AlertCircle, Download, ExternalLink, Layers, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  deleteAsset,
  downloadAsset,
  extractAssetApiError,
  updateAsset,
  type ProjectAsset,
} from "@/api/assetsApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import { compositionStats, fromAssetContent, compositionToLayers } from "@/react_component/process-area/composition";
import { useProcessAreaAssets, useProcessAreaAssetsStore } from "@/store/processAreaAssetsStore";

const MAX_AREA_BADGES = 6;

export function ProcessAreaAssetsView() {
  const { selectedFile } = useContext(SelectedFileContext);
  const { setViewMode } = useContext(DashboardContext);
  const projectId: number | undefined = selectedFile?.project;
  const { assets, loading, error, loaded, reload } = useProcessAreaAssets(projectId);
  const [renaming, setRenaming] = useState<ProjectAsset | null>(null);
  const [deleting, setDeleting] = useState<ProjectAsset | null>(null);

  const rows = useMemo(
    () =>
      assets.map((asset) => {
        const composition = fromAssetContent(asset.content_json, { name: asset.name, assetId: asset.id });
        const layers = compositionToLayers(composition);
        return {
          asset,
          stats: compositionStats(composition),
          description: composition.description,
          // Bottom level first: the core business areas lead.
          areas: [...layers].reverse().flatMap((layer) => layer.areas.map((area) => ({ ...area, level: layer.level }))),
        };
      }),
    [assets],
  );

  const download = async (asset: ProjectAsset) => {
    try {
      const { blob, filename } = await downloadAsset(asset.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(extractAssetApiError(err).message);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SidebarTrigger className="m-2" />
      <main className="flex-1 p-4 pt-0">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <div className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">Process Areas</h1>
              <p className="text-sm text-muted-foreground">
                Named process-area compositions of the current project. The Variants Explorer and
                the OC alignments can use their areas by name.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!projectId}
              onClick={() => setViewMode({ type: "analysis", component: "processArea" })}
            >
              <Layers />
              Create in the Process Area view
            </Button>
          </div>

          {!projectId ? (
            <EmptyState
              title="No project selected"
              description="Upload or select an event log to manage its project's process areas."
            />
          ) : loading && !loaded ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : error ? (
            <Card className="border-destructive/40">
              <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="size-4" />
                  <span>{error}</span>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No stored process areas"
              description="Open the Process Area view, click “Adjust” to move object types between areas and levels, name the areas, and save the composition to the project assets."
            />
          ) : (
            <Card className="overflow-hidden py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Process areas</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Last changed</TableHead>
                    <TableHead className="w-[1%] whitespace-nowrap text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ asset, stats, areas, description }) => (
                    <TableRow key={asset.id} className="align-top" data-testid="process-area-asset-row">
                      <TableCell className="max-w-[220px] whitespace-normal">
                        <div className="font-medium">{asset.name}</div>
                        {description ? (
                          <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[420px] whitespace-normal">
                        <div className="flex flex-wrap gap-1">
                          {areas.slice(0, MAX_AREA_BADGES).map((area) => (
                            <Badge
                              key={area.id}
                              variant="secondary"
                              className="font-normal"
                              title={`${area.objectTypes.join(", ")} · level ${area.level} · ${area.activities.length} activities`}
                            >
                              {area.name}
                            </Badge>
                          ))}
                          {areas.length > MAX_AREA_BADGES ? (
                            <Badge variant="outline" className="font-normal">
                              +{areas.length - MAX_AREA_BADGES} more
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {stats.levels} level{stats.levels === 1 ? "" : "s"} · {stats.objectTypes} object types
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
                            title="Open in the Process Area view"
                            aria-label={`Open ${asset.name}`}
                            onClick={() =>
                              setViewMode({ type: "analysis", component: "processArea", openAssetId: asset.id })
                            }
                          >
                            <ExternalLink className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            title="Rename"
                            aria-label={`Rename ${asset.name}`}
                            onClick={() => setRenaming(asset)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            title="Download JSON"
                            aria-label={`Download ${asset.name}`}
                            onClick={() => void download(asset)}
                          >
                            <Download className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            title="Delete"
                            aria-label={`Delete ${asset.name}`}
                            onClick={() => setDeleting(asset)}
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
        </div>
      </main>
      <RenameDialog asset={renaming} onClose={() => setRenaming(null)} />
      <DeleteDialog asset={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function RenameDialog({ asset, onClose }: { asset: ProjectAsset | null; onClose: () => void }) {
  const upsert = useProcessAreaAssetsStore((state) => state.upsert);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastAssetId, setLastAssetId] = useState<number | null>(null);
  if (asset && asset.id !== lastAssetId) {
    setLastAssetId(asset.id);
    setName(asset.name);
    setError(null);
  }

  const submit = async () => {
    if (!asset) return;
    if (!name.trim()) {
      setError("Enter a name.");
      return;
    }
    setBusy(true);
    try {
      upsert(await updateAsset({ assetId: asset.id, name: name.trim() }));
      toast.success("Composition renamed");
      setLastAssetId(null);
      onClose();
    } catch (err) {
      setError(extractAssetApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={asset !== null}
      onOpenChange={(open) => {
        if (!open) {
          setLastAssetId(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename composition</DialogTitle>
          <DialogDescription>Components that use this composition keep using it under the new name.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="pa-asset-name">Name</Label>
          <Input
            id="pa-asset-name"
            value={name}
            maxLength={100}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ asset, onClose }: { asset: ProjectAsset | null; onClose: () => void }) {
  const remove = useProcessAreaAssetsStore((state) => state.remove);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (!asset) return;
    setBusy(true);
    try {
      await deleteAsset(asset.id);
      remove(asset.project, asset.id);
      toast.success(`Deleted "${asset.name}"`);
      onClose();
    } catch (err) {
      toast.error(extractAssetApiError(err).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={asset !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{asset?.name}”?</DialogTitle>
          <DialogDescription>
            Dashboard components that use this composition fall back to the discovered process areas.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <div className="mb-2 rounded-md border bg-muted p-2">
          <Layers className="size-5 text-muted-foreground" />
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

export default ProcessAreaAssetsView;
