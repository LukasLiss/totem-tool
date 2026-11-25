/**
 * TextBoxEditDialog — where a Text Box is edited (opened from its edit-mode
 * tile): the formatting toolbar on top, below it the text in a card of the
 * tile's exact size (see TextBoxEditor's `frame`), so it is written exactly
 * as it will look. Changes are a draft and only reach the widget on Apply.
 */

import React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TextBoxEditor } from "./TextBoxEditor";
import type { ProjectDashboard } from "./useProjectDashboards";
import type { RichTextDoc } from "./richText";
import { resolveTextBoxFormat, type TextBoxFormat } from "./textBoxFormat";

export interface TextBoxEdit {
  /** The edited document; null when the text wasn't changed. */
  doc: RichTextDoc | null;
  /** Changed box-level settings (background colour, vertical alignment). */
  format: Partial<TextBoxFormat>;
}

interface TextBoxEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The tile's size in px when the popup opened. */
  frame: { width: number; height: number };
  doc: RichTextDoc;
  format: TextBoxFormat;
  idPrefix: string;
  dashboards?: ProjectDashboard[];
  onApply: (edit: TextBoxEdit) => void;
}

/** The popup's body; mounted on every open, so the draft starts from the applied text. */
function EditBody({ frame, doc, format, idPrefix, dashboards, onApply, onCancel }: Omit<
  TextBoxEditDialogProps,
  "open" | "onOpenChange" | "onApply"
> & { onApply: (edit: TextBoxEdit) => void; onCancel: () => void }) {
  const [draftDoc, setDraftDoc] = React.useState<RichTextDoc | null>(null);
  const [draftFormat, setDraftFormat] = React.useState(format);
  const [formatPatch, setFormatPatch] = React.useState<Partial<TextBoxFormat>>({});

  return (
    <>
      <DialogHeader className="border-b px-6 pt-6 pb-4">
        <DialogTitle>Edit text</DialogTitle>
        <DialogDescription>
          The text is shown at the size of its tile, so it wraps exactly as on the dashboard.
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1">
        <TextBoxEditor
          doc={draftDoc ?? doc}
          format={draftFormat}
          onDocChange={setDraftDoc}
          onFormatChange={(patch) => {
            setDraftFormat((current) => resolveTextBoxFormat({ ...current, ...patch }));
            setFormatPatch((current) => ({ ...current, ...patch }));
          }}
          idPrefix={idPrefix}
          dashboards={dashboards}
          frame={frame}
        />
      </div>
      <DialogFooter className="border-t px-6 py-4">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onApply({ doc: draftDoc, format: formatPatch })}>Apply</Button>
      </DialogFooter>
    </>
  );
}

export function TextBoxEditDialog({ open, onOpenChange, onApply, ...body }: TextBoxEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* As large as the chart settings popups, so most tiles fit at full size. */}
      <DialogContent className="flex h-[min(88vh,calc(min(1200px,94vw)*0.75))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1200px,94vw)]">
        <EditBody
          {...body}
          onApply={(edit) => {
            onApply(edit);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export default TextBoxEditDialog;
