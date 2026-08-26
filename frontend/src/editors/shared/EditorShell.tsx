import { ReactNode, useState } from 'react';
import {
  Download,
  FilePlus2,
  FolderOpen,
  Redo2,
  Save,
  Undo2,
  Upload,
  Wand2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type ToolbarAction = {
  onClick: () => void;
  disabled?: boolean;
};

type EditorShellProps = {
  /** Editor heading, e.g. "TOTeM Model Editor". */
  title: string;
  /** Short subtitle shown under the heading. */
  description: string;
  /** Editable model name used for the exported filename. */
  modelName: string;
  onModelNameChange: (name: string) => void;
  /** Clear the canvas and start from scratch (called after user confirms). */
  onNew: () => void;
  /** Import a model from a JSON file. */
  onImport: () => void;
  /** Export the current model as a JSON file. */
  onExport: () => void;
  /** Optional: store the current model in the project model asset store. */
  onSaveToProject?: () => void;
  /** Optional: load a model from the project model asset store. */
  onOpenFromProject?: () => void;
  /** Optional automatic layout of the current graph. */
  onAutoLayout?: () => void;
  /** Optional example model to demonstrate the notation. */
  onLoadExample?: () => void;
  undo?: ToolbarAction;
  redo?: ToolbarAction;
  /** Element palette / canvas toolbar, rendered on the left above the canvas. */
  toolbar?: ReactNode;
  /** Main canvas content. */
  children: ReactNode;
  /** Properties panel on the right. */
  sidePanel?: ReactNode;
};

function ToolbarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* span keeps the tooltip working when the button is disabled */}
        <span className="inline-flex">
          <Button variant="ghost" size="icon" className="size-8" onClick={onClick} disabled={disabled}>
            {children}
            <span className="sr-only">{label}</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** File action button: icon-only below `md` (the tooltip still names it). */
function FileButton({
  label,
  onClick,
  variant,
  children,
}: {
  label: string;
  onClick: () => void;
  variant?: 'outline';
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={variant} size="sm" className="h-8 max-md:w-8 max-md:px-0" onClick={onClick}>
          {children}
          <span className="max-md:sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Shared frame for the three model editors: header with model name and
 * file actions, canvas area and an optional properties side panel.
 * Keeps the look and feel consistent across TOTeM / OCCN / OCPN.
 *
 * The header is responsive: it wraps into multiple rows on narrow screens,
 * the model-name input shrinks and the file buttons collapse to icons, so
 * every action stays visible and clickable on small monitors.
 */
export function EditorShell({
  title,
  description,
  modelName,
  onModelNameChange,
  onNew,
  onImport,
  onExport,
  onSaveToProject,
  onOpenFromProject,
  onAutoLayout,
  onLoadExample,
  undo,
  redo,
  toolbar,
  children,
  sidePanel,
}: EditorShellProps) {
  const [confirmNewOpen, setConfirmNewOpen] = useState(false);

  return (
    <div className="flex flex-col w-full h-full min-h-0 bg-card text-card-foreground rounded-xl border shadow-sm overflow-hidden">
      {/* Block wrapper on purpose: if the wrapping flex row were itself the
          column-flex item, the browser would size it pre-wrap and a wrapped
          second row would paint over (and block clicks into) the canvas. */}
      <div className="shrink-0 border-b px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 max-w-full">
            <div className="truncate font-semibold leading-tight">{title}</div>
            <div className="hidden truncate text-muted-foreground text-xs sm:block">
              {description}
            </div>
          </div>
          <Separator orientation="vertical" className="hidden sm:block h-8" />
          <Input
            value={modelName}
            onChange={(event) => onModelNameChange(event.target.value)}
            placeholder="Model name"
            aria-label="Model name"
            className="h-8 w-32 min-w-24 max-w-full flex-1 lg:w-56 lg:flex-none"
          />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
            {(undo || redo) && (
              <>
                {undo && (
                  <ToolbarButton label="Undo (Ctrl+Z)" onClick={undo.onClick} disabled={undo.disabled}>
                    <Undo2 />
                  </ToolbarButton>
                )}
                {redo && (
                  <ToolbarButton label="Redo (Ctrl+Y)" onClick={redo.onClick} disabled={redo.disabled}>
                    <Redo2 />
                  </ToolbarButton>
                )}
                <Separator orientation="vertical" className="mx-1 h-6" />
              </>
            )}
            {onAutoLayout && (
              <ToolbarButton label="Auto layout" onClick={onAutoLayout}>
                <Wand2 />
              </ToolbarButton>
            )}
            {onLoadExample && (
              <Button variant="ghost" size="sm" className="h-8" onClick={onLoadExample}>
                Example
              </Button>
            )}
            <Separator orientation="vertical" className="mx-1 h-6" />
            <FileButton label="New" variant="outline" onClick={() => setConfirmNewOpen(true)}>
              <FilePlus2 />
            </FileButton>
            {onOpenFromProject && (
              <FileButton label="Open from project" variant="outline" onClick={onOpenFromProject}>
                <FolderOpen />
              </FileButton>
            )}
            <FileButton label="Load JSON" variant="outline" onClick={onImport}>
              <Upload />
            </FileButton>
            {onSaveToProject && (
              <FileButton label="Save to project" variant="outline" onClick={onSaveToProject}>
                <Save />
              </FileButton>
            )}
            <FileButton label="Save JSON" onClick={onExport}>
              <Download />
            </FileButton>
          </div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="relative flex-1 min-w-0">
          {toolbar && (
            <div className="absolute left-3 top-3 z-10 flex flex-col gap-1 rounded-lg border bg-background/95 p-1 shadow-sm backdrop-blur">
              {toolbar}
            </div>
          )}
          {children}
        </div>
        {sidePanel && (
          <div className="w-60 lg:w-72 shrink-0 border-l bg-background/50 overflow-y-auto">
            {sidePanel}
          </div>
        )}
      </div>

      <Dialog open={confirmNewOpen} onOpenChange={setConfirmNewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start a new model?</DialogTitle>
            <DialogDescription>
              This clears the current canvas. Unsaved changes are lost — use
              “Save JSON” first if you want to keep them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmNewOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmNewOpen(false);
                onNew();
              }}
            >
              Start new model
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default EditorShell;
