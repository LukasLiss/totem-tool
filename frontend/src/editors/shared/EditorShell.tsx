import { ReactNode, useState } from 'react';
import {
  Download,
  FilePlus2,
  Redo2,
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

/**
 * Shared frame for the three model editors: header with model name and
 * file actions, canvas area and an optional properties side panel.
 * Keeps the look and feel consistent across TOTeM / OCCN / OCPN.
 */
export function EditorShell({
  title,
  description,
  modelName,
  onModelNameChange,
  onNew,
  onImport,
  onExport,
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3">
        <div className="min-w-44">
          <div className="font-semibold leading-tight">{title}</div>
          <div className="text-muted-foreground text-xs">{description}</div>
        </div>
        <Separator orientation="vertical" className="hidden sm:block h-8" />
        <Input
          value={modelName}
          onChange={(event) => onModelNameChange(event.target.value)}
          placeholder="Model name"
          aria-label="Model name"
          className="h-8 w-56 max-w-full"
        />
        <div className="ml-auto flex items-center gap-1">
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
          <Button variant="outline" size="sm" className="h-8" onClick={() => setConfirmNewOpen(true)}>
            <FilePlus2 />
            New
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={onImport}>
            <Upload />
            Load JSON
          </Button>
          <Button size="sm" className="h-8" onClick={onExport}>
            <Download />
            Save JSON
          </Button>
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
          <div className="w-72 shrink-0 border-l bg-background/50 overflow-y-auto">
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
