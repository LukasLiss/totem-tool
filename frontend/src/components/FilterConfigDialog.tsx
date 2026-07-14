import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type FilterRule,
  type FilterType,
  type TimeRangeParams,
  type ObjectTypesParams,
  type ActivityParams,
} from "@/contexts/FilterStackContext";

function OptionTagSelector({
  options,
  selected,
  color,
  fgColor,
  onToggle,
}: {
  options:  string[];
  selected: Set<string>;
  color:    string;
  fgColor:  string;
  onToggle: (opt: string) => void;
}) {
  if (options.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
        No options available — load an event log file first.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map(opt => {
        const active = selected.has(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            style={{
              padding:      "4px 12px",
              borderRadius: 16,
              border:       `1px solid ${active ? color : "var(--border)"}`,
              background:   active ? color : "transparent",
              color:        active ? fgColor : "var(--foreground)",
              fontSize:     13,
              fontWeight:   active ? 600 : 400,
              cursor:       "pointer",
              transition:   "all 0.12s",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function FilterConfigDialog({
  open,
  onClose,
  filterType,
  existingRule,
  availableObjectTypes,
  availableActivities,
  onSubmit,
  accentBg,
  accentFg,
  icon,
  titleLabel,
  hasFile,
}: {
  open:                 boolean;
  onClose:              () => void;
  filterType:           FilterType;
  existingRule:         FilterRule | undefined;
  availableObjectTypes: string[];
  availableActivities:  string[];
  onSubmit:             (params: FilterRule["params"]) => void;
  accentBg:             string;
  accentFg:             string;
  icon:                 React.ReactElement;
  titleLabel:           string;
  hasFile:              boolean;
}) {
  const [afterDate,  setAfterDate]  = useState("");
  const [beforeDate, setBeforeDate] = useState("");
  const [selected,   setSelected]   = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    if (existingRule) {
      if (existingRule.type === "time_range") {
        const p = existingRule.params as TimeRangeParams;
        setAfterDate(p.after   != null ? new Date(p.after  * 1000).toISOString().slice(0, 16) : "");
        setBeforeDate(p.before != null ? new Date(p.before * 1000).toISOString().slice(0, 16) : "");
        setSelected(new Set());
      } else if (existingRule.type === "object_types") {
        setSelected(new Set((existingRule.params as ObjectTypesParams).include));
      } else if (existingRule.type === "activity") {
        setSelected(new Set((existingRule.params as ActivityParams).include));
      }
    } else {
      setAfterDate("");
      setBeforeDate("");
      setSelected(new Set());
    }
  }, [open, existingRule]);

  function toggleOption(opt: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(opt) ? next.delete(opt) : next.add(opt);
      return next;
    });
  }

  function handleSubmit() {
    let params: FilterRule["params"];
    switch (filterType) {
      case "time_range":
        params = {
          after:  afterDate  ? Math.floor(new Date(afterDate).getTime()  / 1000) : undefined,
          before: beforeDate ? Math.floor(new Date(beforeDate).getTime() / 1000) : undefined,
        };
        break;
      case "object_types":
      case "activity":
        params = { include: [...selected] };
        break;
    }
    onSubmit(params);
    onClose();
  }

  const tagOptions = filterType === "object_types" ? availableObjectTypes : availableActivities;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle style={{ display: "flex", alignItems: "center", gap: 8, color: accentBg }}>
            {icon}
            {existingRule ? `Edit ${titleLabel}` : `Add ${titleLabel}`}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 pt-1">
          {filterType === "time_range" && (
            !hasFile ? (
              <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                Select an event log first to configure a time range filter.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="f-after">After (optional)</Label>
                  <Input id="f-after" type="datetime-local" value={afterDate}
                    onChange={e => setAfterDate(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="f-before">Before (optional)</Label>
                  <Input id="f-before" type="datetime-local" value={beforeDate}
                    onChange={e => setBeforeDate(e.target.value)} />
                </div>
              </>
            )
          )}

          {(filterType === "object_types" || filterType === "activity") && (
            <div className="flex flex-col gap-2">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Label>
                  {filterType === "object_types" ? "Object types to keep" : "Activities to keep"}
                </Label>
                {selected.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    style={{
                      fontSize: 12, color: "var(--muted-foreground)",
                      cursor: "pointer", background: "none", border: "none",
                    }}
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto", paddingTop: 4 }}>
                <OptionTagSelector
                  options={tagOptions}
                  selected={selected}
                  color={accentBg}
                  fgColor={accentFg}
                  onToggle={toggleOption}
                />
              </div>
              {selected.size > 0 && (
                <p style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                  {selected.size} of {tagOptions.length} selected
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!hasFile}
            style={{ background: accentBg, borderColor: accentBg, color: accentFg }}
          >
            {existingRule ? "Update" : "Add"} Filter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
