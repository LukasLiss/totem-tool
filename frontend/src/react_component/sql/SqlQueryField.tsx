/**
 * SqlQueryField — the query input used by SQL-driven dashboard components.
 *
 * A compact highlighted text box for typing a query directly, an expand
 * icon at its right end that opens the full SQL editor in a popup, and a
 * link icon to bind the field to a stored query from the project's query
 * store. While linked, the box shows the stored text read-only and a chip
 * with the stored query's name; unlinking keeps a local copy.
 */

import React, { useState } from "react";
import { Link2, Maximize2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { queryAssetSql } from "@/api/assetsApi";
import type { ExpectedResult } from "@/react_component/SqlQueryEditor";
import type { LinkedQuery } from "./linkedQuery";
import { SqlHighlightedTextarea } from "./SqlHighlightedTextarea";
import { SqlQueryEditorDialog } from "./SqlQueryEditorDialog";
import { StoredQueryPickerDialog } from "./StoredQueryDialogs";
import { toLinkedQuery } from "./linkedQuery";
import { useStoredQuery } from "./useStoredQuery";

export interface SqlQueryFieldProps {
  value: string;
  onChange: (query: string) => void;
  linkedQuery?: LinkedQuery | null;
  onLinkChange?: (link: LinkedQuery | null) => void;
  fileId?: number;
  projectId?: number;
  expectedResult?: ExpectedResult | null;
  placeholder?: string;
  /** dialog title, e.g. "Bar chart query" */
  editorTitle?: string;
  className?: string;
  id?: string;
}

export function SqlQueryField({
  value,
  onChange,
  linkedQuery = null,
  onLinkChange,
  fileId,
  projectId,
  expectedResult = null,
  placeholder = "SELECT …",
  editorTitle = "Edit query",
  className,
  id,
}: SqlQueryFieldProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const stored = useStoredQuery(linkedQuery?.id);
  const linked = Boolean(linkedQuery);
  const shown = linked ? (stored.asset ? queryAssetSql(stored.asset) : value) : value;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="relative">
        <SqlHighlightedTextarea
          id={id}
          value={shown}
          onChange={linked ? undefined : onChange}
          readOnly={linked}
          placeholder={placeholder}
          textClassName="px-2.5 py-1.5 pr-16 text-[12px] leading-[19px]"
          className={cn(
            "min-h-[76px] max-h-[200px] rounded-md border shadow-xs",
            linked ? "bg-muted/40" : "bg-background"
          )}
        />
        <div className="absolute right-1.5 top-1.5 flex gap-0.5">
          {onLinkChange && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-6"
              title={linked ? "Unlink stored query (keep a local copy)" : "Link a stored query"}
              aria-label={linked ? "Unlink stored query" : "Link a stored query"}
              onClick={() => {
                if (linked) {
                  onChange(shown);
                  onLinkChange(null);
                } else {
                  setPickerOpen(true);
                }
              }}
            >
              {linked ? <Unlink className="size-3.5" /> : <Link2 className="size-3.5" />}
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-6"
            title="Open in SQL editor"
            aria-label="Open in SQL editor"
            onClick={() => setEditorOpen(true)}
          >
            <Maximize2 className="size-3.5" />
          </Button>
        </div>
      </div>
      {linked && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <Link2 className="size-3" />
            {stored.asset?.name ?? linkedQuery?.name}
          </Badge>
          {stored.error ? (
            <span className="text-destructive">{stored.error}</span>
          ) : (
            <span>changes in the query store apply here</span>
          )}
        </div>
      )}

      <SqlQueryEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        fileId={fileId}
        projectId={projectId}
        query={shown}
        linkedQuery={onLinkChange ? linkedQuery : null}
        expectedResult={expectedResult}
        title={editorTitle}
        onApply={(query, link) => {
          onChange(query);
          if (onLinkChange && (link?.id ?? null) !== (linkedQuery?.id ?? null)) {
            onLinkChange(link);
          }
        }}
      />
      {onLinkChange && (
        <StoredQueryPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          projectId={projectId}
          onUseCopy={(asset) => onChange(queryAssetSql(asset))}
          onLink={(asset) => {
            onChange(queryAssetSql(asset));
            onLinkChange(toLinkedQuery(asset));
          }}
        />
      )}
    </div>
  );
}

export default SqlQueryField;
