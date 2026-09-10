import { useState } from 'react';
import { AlertCircle, Save } from 'lucide-react';
import { toast } from 'sonner';

import {
  AssetType,
  extractAssetApiError,
  saveDiscoveredModel,
} from '@/api/assetsApi';
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
import { Label } from '@/components/ui/label';

const MODEL_TYPE_LABELS: Record<AssetType, string> = {
  TOTEM: 'TOTeM model',
  OCCN: 'OC Causal Net',
  OCPN: 'OC Petri Net',
  OCDFG: 'OC-DFG',
};

export interface SaveModelAssetButtonProps {
  /** Event log the model was discovered from. */
  fileId?: number | string | null;
  modelType: AssetType;
  /** Discovery settings currently in effect (tau, threshold, …). */
  params?: Record<string, unknown>;
  /**
   * The component's global-filter toggle state. When true (default) the save
   * request carries the active global filter, so the stored model matches
   * the filtered view the component shows.
   */
  filterEnabled?: boolean;
  disabled?: boolean;
  /** Compact icon-only trigger (for floating control pills). */
  iconOnly?: boolean;
  className?: string;
  buttonVariant?: 'outline' | 'ghost' | 'secondary' | 'default';
  buttonSize?: 'sm' | 'icon' | 'default';
}

/**
 * "Save to model assets" button + naming dialog for the discovery
 * components (TOTeM miner, OCCN, OC-DFG, OCPN). Discovery and storage run on
 * the backend via `POST /api/files/<id>/save_discovered_model/`, so the
 * button only needs the event log id and the discovery settings in effect.
 */
export function SaveModelAssetButton({
  fileId,
  modelType,
  params,
  filterEnabled = true,
  disabled = false,
  iconOnly = false,
  className,
  buttonVariant = 'outline',
  buttonSize,
}: SaveModelAssetButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const typeLabel = MODEL_TYPE_LABELS[modelType];

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setName('');
      setFormError(null);
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!fileId) return;
    if (!name.trim()) {
      setFormError('Enter a name for the model asset.');
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      await saveDiscoveredModel({
        fileId,
        name: name.trim(),
        modelType,
        params,
        applyGlobalFilter: filterEnabled,
      });
      toast.success(`${typeLabel} saved to the project's model assets`);
      handleOpenChange(false);
    } catch (error) {
      setFormError(extractAssetApiError(error).message);
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={buttonVariant}
        size={buttonSize ?? (iconOnly ? 'icon' : 'sm')}
        className={className}
        disabled={disabled || !fileId}
        onClick={() => setOpen(true)}
        title={`Save the discovered ${typeLabel} to the project's model assets`}
        aria-label={`Save the discovered ${typeLabel} to the project's model assets`}
      >
        <Save className={iconOnly ? 'h-4 w-4' : 'mr-1 h-4 w-4'} />
        {!iconOnly && 'Save to assets'}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          // The dialog can be mounted inside a React Flow canvas — keep
          // pointer/mouse events from panning the graph behind it.
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Save {typeLabel} to Model Assets</DialogTitle>
              <DialogDescription>
                Stores the model discovered from the current event log in the
                project's model asset store, using the discovery settings
                currently in effect.
                {filterEnabled
                  ? ' An active global filter is applied, so the saved model matches the filtered view.'
                  : ' The global filter is off for this component, so the model is mined from the unfiltered log.'}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="save-model-asset-name">Name</Label>
                <Input
                  id="save-model-asset-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={`Discovered ${typeLabel}`}
                  disabled={isSubmitting}
                  autoFocus
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
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving (runs discovery)…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default SaveModelAssetButton;
