/**
 * The SQL editor in a popup. Components with a query field open it via the
 * expand icon; the user edits/tests the query and applies it back. The
 * consumer's `expectedResult` is shown next to the live result so the user
 * can match column names and order.
 */

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import SqlQueryEditor, {
  SQL_QUERY_DEFAULT,
  type ExpectedResult,
  type LinkedQuery,
} from "@/react_component/SqlQueryEditor";

export interface SqlQueryEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileId?: number;
  projectId?: number;
  /** query text when the dialog opens */
  query: string;
  linkedQuery?: LinkedQuery | null;
  expectedResult?: ExpectedResult | null;
  title?: string;
  description?: string;
  /** called with the edited query (and link) when the user applies */
  onApply: (query: string, linkedQuery: LinkedQuery | null) => void;
}

export function SqlQueryEditorDialog({
  open,
  onOpenChange,
  fileId,
  projectId,
  query,
  linkedQuery = null,
  expectedResult = null,
  title = "Edit query",
  description = "Write and test the query, then apply it to the component.",
  onApply,
}: SqlQueryEditorDialogProps) {
  const [draft, setDraft] = useState(query || SQL_QUERY_DEFAULT);
  const [draftLink, setDraftLink] = useState<LinkedQuery | null>(linkedQuery);
  const [rowLimit, setRowLimit] = useState(25);

  useEffect(() => {
    if (open) {
      setDraft(query || SQL_QUERY_DEFAULT);
      setDraftLink(linkedQuery ?? null);
    }
  }, [open, query, linkedQuery]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] flex-col gap-3 p-4 sm:max-w-[min(1200px,94vw)]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          <SqlQueryEditor
            value={{ name: "", query: draft, rowLimit }}
            onChange={(patch) => {
              if (patch.query !== undefined) setDraft(patch.query);
              if (patch.rowLimit !== undefined) setRowLimit(patch.rowLimit);
            }}
            isEditMode
            fileId={fileId}
            projectId={projectId}
            expectedResult={expectedResult}
            linkedQuery={draftLink}
            onLinkChange={setDraftLink}
            hideName
            className="rounded-md"
          />
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              onApply(draft, draftLink);
              onOpenChange(false);
            }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SqlQueryEditorDialog;
