import { useCallback, useContext, useEffect, useState } from "react";
import { AlertCircle, Image as ImageIcon, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  IMAGE_ASSET_ACCEPT,
  ImageAsset,
  deleteImageAsset,
  extractImageAssetApiError,
  imageAssetSrc,
  listImageAssets,
  renameImageAsset,
  uploadImageAsset,
} from "@/api/imageAssetsApi";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";

export function ImageAssetsView() {
  const { selectedFile } = useContext(SelectedFileContext);
  const projectId = selectedFile?.project;
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [assetToRename, setAssetToRename] = useState<ImageAsset | null>(null);
  const [assetToDelete, setAssetToDelete] = useState<ImageAsset | null>(null);

  const loadAssets = useCallback(async () => {
    if (!projectId) {
      setAssets([]);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await listImageAssets(projectId);
      setAssets(Array.isArray(data) ? data : []);
    } catch (error) {
      setAssets([]);
      setErrorMessage(extractImageAssetApiError(error).message);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  return (
    <div className="flex min-h-screen flex-col">
      <SidebarTrigger className="m-2" />
      <main className="flex-1 p-4 pt-0">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <div className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">Images</h1>
              <p className="text-sm text-muted-foreground">
                Project images (png, jpeg, jpg, svg) for use in dashboard image
                components.
              </p>
            </div>
            <UploadImageDialog
              projectId={projectId}
              open={isUploadOpen}
              onOpenChange={setIsUploadOpen}
              onUploaded={loadAssets}
            />
          </div>

          {!projectId ? (
            <EmptyState
              title="No project selected"
              description="Upload or select an event log to manage project images."
            />
          ) : isLoading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
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
              title="No images"
              description="Uploaded project images will appear here."
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {assets.map((asset) => (
                <ImageAssetCard
                  key={asset.id}
                  asset={asset}
                  onRenameClick={() => setAssetToRename(asset)}
                  onDeleteClick={() => setAssetToDelete(asset)}
                />
              ))}
            </div>
          )}

          <RenameImageDialog
            asset={assetToRename}
            onOpenChange={(open) => {
              if (!open) setAssetToRename(null);
            }}
            onRenamed={async () => {
              setAssetToRename(null);
              await loadAssets();
            }}
          />
          <DeleteImageDialog
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

function ImageAssetCard({
  asset,
  onRenameClick,
  onDeleteClick,
}: {
  asset: ImageAsset;
  onRenameClick: () => void;
  onDeleteClick: () => void;
}) {
  const src = imageAssetSrc(asset.url);
  return (
    <div className="group flex flex-col overflow-hidden rounded-md border bg-background">
      <div className="flex h-32 items-center justify-center overflow-hidden bg-white">
        {src ? (
          <img
            src={src}
            alt={asset.name}
            className="h-full w-full object-contain"
          />
        ) : (
          <ImageIcon className="size-8 text-muted-foreground" />
        )}
      </div>
      <div className="flex items-center justify-between gap-1 border-t px-2 py-1.5">
        <span className="truncate text-sm font-medium" title={asset.name}>
          {asset.name}
        </span>
        <div className="flex shrink-0">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground hover:text-foreground"
            title={`Rename ${asset.name}`}
            aria-label={`Rename ${asset.name}`}
            onClick={onRenameClick}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground hover:text-destructive"
            title={`Delete ${asset.name}`}
            aria-label={`Delete ${asset.name}`}
            onClick={onDeleteClick}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function UploadImageDialog({
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
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const resetForm = () => {
    setName("");
    setFile(null);
    setFormError(null);
    setIsSubmitting(false);
    setFileInputKey((value) => value + 1);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) resetForm();
  };

  const handleFileChange = (selected: File | null) => {
    setFile(selected);
    setFormError(null);
    // Default the asset name to the file name (without extension) so a quick
    // upload needs no typing.
    if (selected && !name.trim()) {
      setName(selected.name.replace(/\.[^.]+$/, ""));
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) {
      setFormError("Select a project before uploading an image.");
      return;
    }
    if (!file) {
      setFormError("Choose an image file (png, jpeg, jpg, svg).");
      return;
    }
    if (!name.trim()) {
      setFormError("Enter an image name.");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      await uploadImageAsset({ projectId, name: name.trim(), file });
      toast.success("Image uploaded");
      handleOpenChange(false);
      await onUploaded();
    } catch (error) {
      setFormError(extractImageAssetApiError(error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" disabled={!projectId}>
          <Plus />
          Upload
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Upload Image</DialogTitle>
            <DialogDescription>
              Store an image (png, jpeg, jpg, svg) in the current project.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="image-asset-file">Image file</Label>
              <Input
                key={fileInputKey}
                id="image-asset-file"
                type="file"
                accept={IMAGE_ASSET_ACCEPT}
                disabled={isSubmitting}
                onChange={(event) =>
                  handleFileChange(event.target.files?.[0] ?? null)
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="image-asset-name">Name</Label>
              <Input
                id="image-asset-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Company logo"
                disabled={isSubmitting}
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
              onClick={() => handleOpenChange(false)}
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

function RenameImageDialog({
  asset,
  onOpenChange,
  onRenamed,
}: {
  asset: ImageAsset | null;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setName(asset?.name ?? "");
    setFormError(null);
  }, [asset]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!asset) return;
    if (!name.trim()) {
      setFormError("Enter an image name.");
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      await renameImageAsset(asset.id, name.trim());
      toast.success("Image renamed");
      await onRenamed();
    } catch (error) {
      setFormError(extractImageAssetApiError(error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={Boolean(asset)} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Rename Image</DialogTitle>
            <DialogDescription>
              Rename {asset ? `"${asset.name}"` : "this image"}.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="image-asset-rename">Name</Label>
              <Input
                id="image-asset-rename"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={isSubmitting}
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
            <Button type="submit" disabled={isSubmitting || !asset}>
              {isSubmitting ? "Renaming" : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteImageDialog({
  asset,
  onOpenChange,
  onDeleted,
}: {
  asset: ImageAsset | null;
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
      await deleteImageAsset(asset.id);
      toast.success("Image deleted");
      await onDeleted();
    } catch (error) {
      setDeleteError(extractImageAssetApiError(error).message);
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
          <DialogTitle>Delete Image</DialogTitle>
          <DialogDescription>
            Delete {asset ? `"${asset.name}"` : "this image"} from the current
            project. Dashboard components using it will show a placeholder.
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
          <ImageIcon className="size-5 text-muted-foreground" />
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

export default ImageAssetsView;
