import { AlertCircle, RefreshCw, Workflow } from "lucide-react";

import type { ProjectAsset } from "@/api/assetsApi";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import { formatLastChanged } from "./selection";

export interface TotemAssetSelectorProps {
  projectId: number | null | undefined;
  assets: ProjectAsset[];
  selectedAssetId: number | null;
  loading: boolean;
  error: string | null;
  onSelectAsset: (assetId: number | null) => void;
  onRetry: () => void;
  onOpenModelAssets?: () => void;
  disabled?: boolean;
}

const SELECT_ID = "totem-conformance-asset";

export function TotemAssetSelector({
  projectId,
  assets,
  selectedAssetId,
  loading,
  error,
  onSelectAsset,
  onRetry,
  onOpenModelAssets,
  disabled = false,
}: TotemAssetSelectorProps) {
  const hasProject = typeof projectId === "number" && projectId > 0;

  return (
    <div className="space-y-2">
      <Label htmlFor={SELECT_ID}>TOTeM model</Label>

      {!hasProject ? (
        <Select disabled>
          <SelectTrigger id={SELECT_ID}>
            <SelectValue placeholder="Select an event log first" />
          </SelectTrigger>
        </Select>
      ) : loading ? (
        <Skeleton className="h-9 w-full" aria-label="Loading TOTeM models" />
      ) : error ? (
        <div
          role="alert"
          className="flex min-h-12 items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
        >
          <AlertCircle className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1 text-sm text-destructive">
            {error}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw />
            Retry
          </Button>
        </div>
      ) : assets.length === 0 ? (
        <div className="flex min-h-12 flex-wrap items-center gap-3 rounded-md border border-dashed px-3 py-2">
          <Workflow className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm text-muted-foreground">
            No TOTeM models in this project.
          </span>
          {onOpenModelAssets && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenModelAssets}
            >
              Model Assets
            </Button>
          )}
        </div>
      ) : (
        <Select
          value={selectedAssetId === null ? undefined : String(selectedAssetId)}
          onValueChange={(value) => onSelectAsset(Number(value))}
          disabled={disabled}
        >
          <SelectTrigger id={SELECT_ID}>
            <SelectValue placeholder="Select a stored TOTeM model" />
          </SelectTrigger>
          <SelectContent>
            {assets.map((asset) => (
              <SelectItem key={asset.id} value={String(asset.id)}>
                <span className="flex min-w-0 items-center gap-3">
                  <span className="truncate">{asset.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatLastChanged(asset.updated_at)}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export default TotemAssetSelector;
