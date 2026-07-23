/**
 * Bridge between the visual editors and the project model asset store.
 *
 * Gives an editor:
 *  - "Save to project": store the current model as a `ProjectAsset`. If the
 *    model was opened from an existing asset, offers to UPDATE that asset in
 *    place or save a new one.
 *  - "Open from project": pick one of the project's assets of this type
 *    (searchable, newest first) and load its stored `content_json`.
 *  - Auto-open: when the assets view routes here with `openAssetId`, the model
 *    is fetched and loaded on mount.
 *
 * The store keeps only the canonical model JSON (`"schema"`), including the
 * optional `layout` block the editors write, so models round-trip through the
 * project without losing positions.
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DashboardContext } from '@/contexts/DashboardContext';
import { SelectedFileContext } from '@/contexts/SelectedFileContext';
import {
  createAsset,
  extractAssetApiError,
  getAsset,
  listAssets,
  updateAsset,
  type AssetType,
  type ProjectAsset,
} from '@/api/assetsApi';

type UseProjectAssetBridgeArgs = {
  assetType: AssetType;
  /** Current model name, used to prefill the save dialog. */
  modelName: string;
  /** Build the canonical asset JSON for the current model. */
  serializeAsset: () => Record<string, unknown>;
  /** Load a stored asset's content into the editor. */
  onOpen: (content: Record<string, unknown>, name: string) => void | Promise<void>;
};

type UseProjectAssetBridge = {
  /** Whether a project is selected — actions are hidden otherwise. */
  available: boolean;
  onSaveToProject: () => void;
  onOpenFromProject: () => void;
  /** Dialogs to render inside the editor tree. */
  dialogs: React.ReactNode;
};

const assetLabel = (assetType: AssetType) => (assetType === 'TOTEM' ? 'TOTeM' : 'OCCN');

export async function openProjectAsset(
  asset: ProjectAsset,
  onOpen: (content: Record<string, unknown>, name: string) => void | Promise<void>,
): Promise<{ id: number; name: string }> {
  await onOpen(asset.content_json, asset.name);
  return { id: asset.id, name: asset.name };
}

export function useProjectAssetBridge({
  assetType,
  modelName,
  serializeAsset,
  onOpen,
}: UseProjectAssetBridgeArgs): UseProjectAssetBridge {
  const { selectedFile } = useContext(SelectedFileContext);
  const { viewMode } = useContext(DashboardContext);
  const projectId: number | undefined = selectedFile?.project;

  // The asset this model was opened from, so "Save to project" can update it.
  const [openedAsset, setOpenedAsset] = useState<{ id: number; name: string } | null>(null);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);

  const [openOpen, setOpenOpen] = useState(false);
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [search, setSearch] = useState('');

  // Keep the latest onOpen without forcing the auto-open effect to re-run.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const loadIntoEditor = useCallback(
    async (asset: ProjectAsset) => {
      const opened = await openProjectAsset(asset, onOpenRef.current);
      setOpenedAsset(opened);
    },
    [],
  );

  // Auto-open a specific asset when routed here from the Model Assets view.
  const autoOpenedRef = useRef<number | null>(null);
  useEffect(() => {
    if (viewMode.type !== 'editor') return;
    const targetId = viewMode.openAssetId;
    if (!targetId || autoOpenedRef.current === targetId) return;
    autoOpenedRef.current = targetId;
    void (async () => {
      try {
        const asset = await getAsset(targetId);
        await loadIntoEditor(asset);
        toast.success(`Loaded "${asset.name}".`);
      } catch (error) {
        toast.error(extractAssetApiError(error).message);
      }
    })();
  }, [viewMode, loadIntoEditor]);

  const onSaveToProject = useCallback(() => {
    if (!projectId) {
      toast.error('Select a project (event log) before saving to the project.');
      return;
    }
    setSaveName(openedAsset?.name ?? modelName);
    setSaveOpen(true);
  }, [projectId, modelName, openedAsset]);

  const saveAsNew = useCallback(async () => {
    if (!projectId) return;
    const name = saveName.trim();
    if (!name) {
      toast.error('Enter a name for the model asset.');
      return;
    }
    setSaving(true);
    try {
      const created = await createAsset({
        projectId,
        name,
        assetType,
        contentJson: serializeAsset(),
      });
      setOpenedAsset({ id: created.id, name: created.name });
      toast.success(`Saved "${name}" to the project.`);
      setSaveOpen(false);
    } catch (error) {
      toast.error(extractAssetApiError(error).message);
    } finally {
      setSaving(false);
    }
  }, [projectId, saveName, assetType, serializeAsset]);

  const updateExisting = useCallback(async () => {
    if (!openedAsset) return;
    const name = saveName.trim();
    if (!name) {
      toast.error('Enter a name for the model asset.');
      return;
    }
    setSaving(true);
    try {
      const updated = await updateAsset({
        assetId: openedAsset.id,
        name,
        contentJson: serializeAsset(),
      });
      setOpenedAsset({ id: updated.id, name: updated.name });
      toast.success(`Updated "${updated.name}" in the project.`);
      setSaveOpen(false);
    } catch (error) {
      toast.error(extractAssetApiError(error).message);
    } finally {
      setSaving(false);
    }
  }, [openedAsset, saveName, serializeAsset]);

  const onOpenFromProject = useCallback(async () => {
    if (!projectId) {
      toast.error('Select a project (event log) before opening from the project.');
      return;
    }
    setSearch('');
    setOpenOpen(true);
    setLoadingList(true);
    try {
      const list = await listAssets({ projectId, assetType });
      setAssets(list);
    } catch (error) {
      toast.error(extractAssetApiError(error).message);
      setOpenOpen(false);
    } finally {
      setLoadingList(false);
    }
  }, [projectId, assetType]);

  const chooseAsset = useCallback(
    async (asset: ProjectAsset) => {
      try {
        await loadIntoEditor(asset);
        setOpenOpen(false);
        toast.success(`Loaded "${asset.name}".`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not open the asset.');
      }
    },
    [loadIntoEditor],
  );

  // Newest first, filtered by the search box (case-insensitive name match).
  const visibleAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return assets
      .filter((asset) => (query ? asset.name.toLowerCase().includes(query) : true))
      .slice()
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [assets, search]);

  const label = assetLabel(assetType);

  const dialogs = useMemo(
    () => (
      <>
        <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Save to project</DialogTitle>
              <DialogDescription>
                Store this {label} model in the current project. The name must be
                unique within the project.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              placeholder="Asset name"
              aria-label="Asset name"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void (openedAsset ? updateExisting() : saveAsNew());
                }
              }}
            />
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="outline" onClick={() => setSaveOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <div className="flex gap-2">
                {openedAsset && (
                  <Button
                    variant="outline"
                    onClick={() => void saveAsNew()}
                    disabled={saving}
                  >
                    Save as new
                  </Button>
                )}
                <Button
                  onClick={() => void (openedAsset ? updateExisting() : saveAsNew())}
                  disabled={saving}
                >
                  {saving
                    ? 'Saving…'
                    : openedAsset
                      ? `Update "${openedAsset.name}"`
                      : 'Save'}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={openOpen} onOpenChange={setOpenOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Open from project</DialogTitle>
              <DialogDescription>
                Load a {label} model stored in the current project.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name"
              aria-label="Search model assets by name"
              disabled={loadingList}
            />
            <div className="max-h-[min(60vh,20rem)] overflow-y-auto rounded-md border">
              {loadingList ? (
                <div className="p-4 text-sm text-muted-foreground">Loading…</div>
              ) : visibleAssets.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  {assets.length === 0
                    ? `No ${label} models in this project yet.`
                    : 'No models match your search.'}
                </div>
              ) : (
                <ul className="divide-y">
                  {visibleAssets.map((asset) => (
                    <li key={asset.id}>
                      <button
                        type="button"
                        onClick={() => chooseAsset(asset)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium" title={asset.name}>
                          {asset.name}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatShortDate(asset.updated_at)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenOpen(false)}>
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    ),
    [
      saveOpen,
      saveName,
      saving,
      openedAsset,
      updateExisting,
      saveAsNew,
      openOpen,
      loadingList,
      assets,
      visibleAssets,
      search,
      label,
      chooseAsset,
    ],
  );

  return {
    available: Boolean(projectId),
    onSaveToProject,
    onOpenFromProject,
    dialogs,
  };
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}
