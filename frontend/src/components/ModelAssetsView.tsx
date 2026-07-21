import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AlertCircle, Box, Filter, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AssetType,
  ProjectAsset,
  deleteAsset,
  extractAssetApiError,
  listAssets,
  uploadAsset,
} from "@/api/assetsApi";
import { Badge } from "@/components/ui/badge";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";

type AssetFilter = "ALL" | AssetType;

const EXPECTED_SCHEMA_BY_TYPE: Record<AssetType, string> = {
  TOTEM: "totem",
  OCCN: "occn",
};

interface AssetTableFilters {
  type: AssetFilter;
  changedFrom: string;
  changedTo: string;
}

const DEFAULT_TABLE_FILTERS: AssetTableFilters = {
  type: "ALL",
  changedFrom: "",
  changedTo: "",
};

export function ModelAssetsView() {
  const { selectedFile } = useContext(SelectedFileContext);
  const projectId = selectedFile?.project;
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [filters, setFilters] = useState<AssetTableFilters>(DEFAULT_TABLE_FILTERS);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [assetToDelete, setAssetToDelete] = useState<ProjectAsset | null>(null);

  const loadAssets = useCallback(async () => {
    if (!projectId) {
      setAssets([]);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await listAssets({
        projectId,
      });
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

  const filteredAssets = useMemo(
    () => filterAssets(assets, filters),
    [assets, filters]
  );

  return (
    <div className="flex min-h-screen flex-col">
      <SidebarTrigger className="m-2" />
      <main className="flex-1 p-4 pt-0">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <div className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">Model Assets</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <AssetFilterMenu
                filters={filters}
                onApply={setFilters}
                disabled={!projectId}
              />
              <UploadAssetDialog
                projectId={projectId}
                open={isUploadOpen}
                onOpenChange={setIsUploadOpen}
                onUploaded={async () => {
                  await loadAssets();
                }}
              />
            </div>
          </div>

          {!projectId ? (
            <EmptyState
              title="No project selected"
              description="Upload or select an event log to manage model assets."
            />
          ) : isLoading ? (
            <AssetsLoadingState />
          ) : errorMessage ? (
            <ErrorState message={errorMessage} onRetry={loadAssets} />
          ) : assets.length === 0 ? (
            <EmptyState
              title="No model assets"
              description="Stored TOTeM and OCCN models will appear here."
            />
          ) : filteredAssets.length === 0 ? (
            <EmptyState
              title="No matching model assets"
              description="No stored model assets match the current filters."
            />
          ) : (
            <AssetList assets={filteredAssets} onDeleteClick={setAssetToDelete} />
          )}
          <DeleteAssetDialog
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

function AssetFilterMenu({
  filters,
  onApply,
  disabled,
}: {
  filters: AssetTableFilters;
  onApply: (filters: AssetTableFilters) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<AssetTableFilters>(filters);
  const hasActiveFilters = isFiltered(filters);
  const hasInvalidDateRange = Boolean(
    draftFilters.changedFrom &&
      draftFilters.changedTo &&
      draftFilters.changedFrom > draftFilters.changedTo
  );

  useEffect(() => {
    if (open) setDraftFilters(filters);
  }, [filters, open]);

  const applyFilters = () => {
    onApply(draftFilters);
    setOpen(false);
  };

  const clearFilters = () => {
    setDraftFilters(DEFAULT_TABLE_FILTERS);
    onApply(DEFAULT_TABLE_FILTERS);
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant={hasActiveFilters ? "secondary" : "outline"}
          disabled={disabled}
          title="Filter model assets"
        >
          <Filter />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-4">
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="model-asset-filter-type">Type</Label>
            <Select
              value={draftFilters.type}
              onValueChange={(value) =>
                setDraftFilters((current) => ({
                  ...current,
                  type: value as AssetFilter,
                }))
              }
            >
              <SelectTrigger id="model-asset-filter-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="TOTEM">TOTeM</SelectItem>
                <SelectItem value="OCCN">OCCN</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="model-asset-filter-from">Last changed from</Label>
            <Input
              id="model-asset-filter-from"
              type="date"
              value={draftFilters.changedFrom}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  changedFrom: event.target.value,
                }))
              }
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="model-asset-filter-to">Last changed to</Label>
            <Input
              id="model-asset-filter-to"
              type="date"
              value={draftFilters.changedTo}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  changedTo: event.target.value,
                }))
              }
            />
          </div>

          {hasInvalidDateRange && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="size-4" />
              <span>Start date must be on or before end date.</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={clearFilters}>
              Clear
            </Button>
            <Button type="button" onClick={applyFilters} disabled={hasInvalidDateRange}>
              Apply filter
            </Button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UploadAssetDialog({
  projectId,
  open,
  onOpenChange,
  onUploaded,
}: {
  projectId?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("TOTEM");
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const resetForm = () => {
    setName("");
    setAssetType("TOTEM");
    setFile(null);
    setFormError(null);
    setIsSubmitting(false);
    setFileInputKey((value) => value + 1);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) {
      setFormError("Select a project before uploading a model asset.");
      return;
    }
    if (!name.trim()) {
      setFormError("Enter an asset name.");
      return;
    }
    if (!file) {
      setFormError("Choose a model file.");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      await validateModelAssetFile(file, assetType);
      await uploadAsset({
        projectId,
        name: name.trim(),
        assetType,
        file,
      });
      toast.success("Model asset uploaded");
      onOpenChange(false);
      resetForm();
      await onUploaded();
    } catch (error) {
      setFormError(extractAssetApiError(error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" disabled={!projectId}>
          <Plus />
          Upload
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Upload Model Asset</DialogTitle>
            <DialogDescription>
              Store a model asset in the current project.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="model-asset-name">Name</Label>
              <Input
                id="model-asset-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Baseline model"
                disabled={isSubmitting}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="model-asset-type">Type</Label>
              <Select
                value={assetType}
                onValueChange={(value) => setAssetType(value as AssetType)}
                disabled={isSubmitting}
              >
                <SelectTrigger id="model-asset-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TOTEM">TOTeM</SelectItem>
                  <SelectItem value="OCCN">OCCN</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="model-asset-file">Model file</Label>
              <Input
                key={fileInputKey}
                id="model-asset-file"
                type="file"
                disabled={isSubmitting}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>

            {formError && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="size-4" />
                <span>{formError}</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !projectId}>
              {isSubmitting ? "Uploading" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssetList({
  assets,
  onDeleteClick,
}: {
  assets: ProjectAsset[];
  onDeleteClick: (asset: ProjectAsset) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border bg-background">
      <div className="min-w-[650px]">
        <div className="grid grid-cols-[minmax(220px,1.7fr)_110px_170px_90px] border-b bg-muted/40 px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
          <span>Name</span>
          <span>Type</span>
          <span>Last changed</span>
          <span>Actions</span>
        </div>
        <div className="divide-y">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="grid grid-cols-[minmax(220px,1.7fr)_110px_170px_90px] items-center px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium" title={asset.name}>
                  {asset.name}
                </div>
              </div>
              <Badge variant="secondary">{formatAssetType(asset.asset_type)}</Badge>
              <span className="text-muted-foreground">
                {formatDate(asset.updated_at)}
              </span>
              <div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  title={`Delete ${asset.name}`}
                  onClick={() => onDeleteClick(asset)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function filterAssets(assets: ProjectAsset[], filters: AssetTableFilters) {
  return assets.filter((asset) => {
    if (filters.type !== "ALL" && asset.asset_type !== filters.type) {
      return false;
    }

    const changedAt = getDateOnly(asset.updated_at);
    if (filters.changedFrom && (!changedAt || changedAt < filters.changedFrom)) {
      return false;
    }
    if (filters.changedTo && (!changedAt || changedAt > filters.changedTo)) {
      return false;
    }

    return true;
  });
}

function isFiltered(filters: AssetTableFilters) {
  return (
    filters.type !== DEFAULT_TABLE_FILTERS.type ||
    filters.changedFrom !== DEFAULT_TABLE_FILTERS.changedFrom ||
    filters.changedTo !== DEFAULT_TABLE_FILTERS.changedTo
  );
}

function AssetsLoadingState() {
  return (
    <div className="space-y-2 rounded-md border bg-background p-4">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <div className="mb-2 rounded-md border bg-muted p-2">
          <Box className="size-5 text-muted-foreground" />
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function DeleteAssetDialog({
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
      toast.success("Model asset deleted");
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
          <DialogTitle>Delete Model Asset</DialogTitle>
          <DialogDescription>
            Delete {asset ? `"${asset.name}"` : "this model asset"} from the current project.
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

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="size-4" />
          <span>{message}</span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

function formatAssetType(assetType: AssetType) {
  return assetType === "TOTEM" ? "TOTeM" : "OCCN";
}

async function validateModelAssetFile(file: File, assetType: AssetType) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("Model file content must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model asset JSON must be an object.");
  }

  const schema = (parsed as Record<string, unknown>).schema;
  if (typeof schema !== "string") {
    throw new Error("Model asset JSON must declare a schema.");
  }

  const expectedSchema = EXPECTED_SCHEMA_BY_TYPE[assetType];
  if (schema !== expectedSchema) {
    throw new Error(
      `Expected schema "${expectedSchema}" for ${formatAssetType(assetType)} assets.`
    );
  }
}

function getDateOnly(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default ModelAssetsView;
