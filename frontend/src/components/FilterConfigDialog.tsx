import React, { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
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

type OptionItem = { name: string; count: number };

function OptionList({
  options,
  selected,
  search,
  onToggle,
}: {
  options:  OptionItem[];
  selected: Set<string>;
  search:   string;
  onToggle: (name: string) => void;
}) {
  if (options.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--muted-foreground)", padding: "8px 0" }}>
        No options available — load an event log file first.
      </p>
    );
  }

  const filtered = search
    ? options.filter(o => o.name.toLowerCase().includes(search.toLowerCase()))
    : options;

  if (filtered.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--muted-foreground)", padding: "8px 0" }}>
        No matches for "{search}".
      </p>
    );
  }

  const maxCount = Math.max(...options.map(o => o.count), 1);

  return (
    <div>
      {filtered.map((opt, i) => {
        const active = selected.has(opt.name);
        return (
          <div
            key={opt.name}
            onClick={() => onToggle(opt.name)}
            style={{
              cursor:       "pointer",
              padding:      "8px 0 6px",
              borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width:          18,
                height:         18,
                borderRadius:   4,
                flexShrink:     0,
                border:         `1.5px solid ${active ? "var(--primary)" : "var(--border)"}`,
                background:     active ? "var(--primary)" : "transparent",
                display:        "flex",
                alignItems:     "center",
                justifyContent: "center",
                transition:     "background 0.1s, border-color 0.1s",
              }}>
                {active && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path
                      d="M1 4L3.5 6.5L9 1"
                      stroke="var(--primary-foreground)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>

              <span style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {opt.name}
              </span>

              <span style={{ fontSize: 12, color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                {opt.count.toLocaleString()}
              </span>
            </div>
            <div style={{ marginLeft: 28, marginTop: 5, height: 2, background: "var(--border)", borderRadius: 1 }}>
              <div style={{
                height:     "100%",
                width:      `${(opt.count / maxCount) * 100}%`,
                background: active ? "var(--primary)" : "var(--muted-foreground)",
                borderRadius: 1,
                transition: "background 0.1s",
              }} />
            </div>
          </div>
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
  icon,
  titleLabel,
  hasFile,
}: {
  open:                 boolean;
  onClose:              () => void;
  filterType:           FilterType;
  existingRule:         FilterRule | undefined;
  availableObjectTypes: OptionItem[];
  availableActivities:  OptionItem[];
  onSubmit:             (params: FilterRule["params"]) => void;
  icon:                 React.ReactElement;
  titleLabel:           string;
  hasFile:              boolean;
}) {
  const [afterDate,  setAfterDate]  = useState("");
  const [beforeDate, setBeforeDate] = useState("");
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [search,     setSearch]     = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setSearch("");
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

  useEffect(() => {
    if (open && filterType !== "time_range") {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open, filterType]);

  function toggleOption(name: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
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

  const options     = filterType === "object_types" ? availableObjectTypes : availableActivities;
  const isList      = filterType !== "time_range";
  const searchLabel = filterType === "object_types" ? "Search object types…" : "Search activities…";
  const countLabel  = filterType === "object_types" ? "object types" : "activities";

  const allSelected  = options.length > 0 && options.every(o => selected.has(o.name));
  const someSelected = !allSelected && options.some(o => selected.has(o.name));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(options.map(o => o.name)));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[440px]" style={{ padding: 0, gap: 0, overflow: "hidden" }}>

        <DialogHeader style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)" }}>
          <DialogTitle style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 16 }}>
            <span style={{ display: "flex", alignItems: "center", color: "var(--primary)" }}>
              {React.cloneElement(icon, { size: 18 } as React.HTMLAttributes<SVGElement>)}
            </span>
            {existingRule ? `Edit ${titleLabel}` : titleLabel}
          </DialogTitle>
          {isList && hasFile && (
            <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: 0 }}>
              {options.length} {countLabel} in this log
              {selected.size > 0 && ` · ${selected.size} selected`}
            </p>
          )}
        </DialogHeader>

        <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
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

          {isList && (
            <>
              <div style={{ position: "relative" }}>
                <Search
                  size={14}
                  style={{
                    position: "absolute", left: 10, top: "50%",
                    transform: "translateY(-50%)", color: "var(--muted-foreground)",
                    pointerEvents: "none",
                  }}
                />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder={searchLabel}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{
                    width:        "100%",
                    paddingLeft:  32,
                    paddingRight: 12,
                    paddingTop:   8,
                    paddingBottom: 8,
                    fontSize:     13,
                    border:       "1px solid var(--border)",
                    borderRadius: 6,
                    background:   "transparent",
                    color:        "var(--foreground)",
                    outline:      "none",
                    boxSizing:    "border-box",
                  }}
                />
              </div>
              {options.length > 0 && (
                <div
                  onClick={toggleAll}
                  style={{
                    display:       "flex",
                    alignItems:    "center",
                    gap:           10,
                    cursor:        "pointer",
                    paddingBottom: 10,
                    borderBottom:  "1px solid var(--border)",
                  }}
                >
                  <div style={{
                    width:          18,
                    height:         18,
                    borderRadius:   4,
                    flexShrink:     0,
                    border:         `1.5px solid ${(allSelected || someSelected) ? "var(--primary)" : "var(--border)"}`,
                    background:     (allSelected || someSelected) ? "var(--primary)" : "transparent",
                    display:        "flex",
                    alignItems:     "center",
                    justifyContent: "center",
                    transition:     "background 0.1s, border-color 0.1s",
                  }}>
                    {allSelected && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="var(--primary-foreground)"
                          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    {someSelected && (
                      <svg width="10" height="2" viewBox="0 0 10 2" fill="none">
                        <path d="M1 1H9" stroke="var(--primary-foreground)"
                          strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    )}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Select all</span>
                </div>
              )}

              <div style={{ maxHeight: 260, overflowY: "auto" }}>
                <OptionList
                  options={options}
                  selected={selected}
                  search={search}
                  onToggle={toggleOption}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter style={{
          padding:        "12px 24px",
          borderTop:      "1px solid var(--border)",
          display:        "flex",
          justifyContent: "space-between",
          alignItems:     "center",
        }}>
          {isList ? (
            <Button
              variant="ghost"
              onClick={() => setSelected(new Set())}
              disabled={selected.size === 0}
              style={{ padding: "0 4px", fontSize: 13 }}
            >
              Reset
            </Button>
          ) : <span />}

          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!hasFile}
              style={{ background: "var(--primary)", borderColor: "var(--primary)", color: "var(--primary-foreground)" }}
            >
              Apply
            </Button>
          </div>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}
