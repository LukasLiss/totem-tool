import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type MultiSelectPopoverProps = {
  /** Accessible name of the trigger, e.g. "Business object types". */
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  /** Shown on the trigger when nothing is selected. */
  placeholder?: string;
  /** Shown on the trigger when every option is selected. */
  allLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  /** Marks options that are not selectable any more (e.g. filtered away). */
  emptyText?: string;
};

/**
 * A compact "n of m selected" trigger that opens a searchable checkbox list
 * with select-all / clear shortcuts. Keeps the selection order stable
 * (sorted) so it can be persisted and compared.
 */
export function MultiSelectPopover({
  label,
  options,
  selected,
  onChange,
  placeholder = "Select…",
  allLabel,
  disabled = false,
  loading = false,
  className,
  emptyText = "No options available",
}: MultiSelectPopoverProps) {
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter((option) => option.toLowerCase().includes(needle)) : options;
  }, [options, query]);

  const commit = (next: Set<string>) => {
    onChange(options.filter((option) => next.has(option)));
  };
  const toggle = (option: string) => {
    const next = new Set(selectedSet);
    if (next.has(option)) next.delete(option);
    else next.add(option);
    commit(next);
  };

  let triggerText = placeholder;
  if (loading) triggerText = "Loading…";
  else if (selected.length > 0 && selected.length === options.length && allLabel) triggerText = allLabel;
  else if (selected.length === 1) triggerText = selected[0];
  else if (selected.length > 1) triggerText = `${selected.length} of ${options.length} selected`;

  return (
    <Popover onOpenChange={(open) => { if (!open) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || loading}
          aria-label={label}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className="truncate">{triggerText}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] p-2">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${label.toLowerCase()}`}
            aria-label={`Search ${label.toLowerCase()}`}
            className="h-8 pl-7 text-sm"
          />
        </div>
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {selected.length} of {options.length} selected
          </span>
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => commit(new Set(options))}>
              All
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => commit(new Set())}>
              None
            </Button>
          </div>
        </div>
        <ul role="listbox" aria-multiselectable aria-label={label} className="max-h-60 space-y-0.5 overflow-y-auto">
          {visible.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              {options.length === 0 ? emptyText : "No matches"}
            </li>
          ) : (
            visible.map((option) => {
              const checked = selectedSet.has(option);
              return (
                <li key={option}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggle(option)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                      checked && "font-medium",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                      aria-hidden
                    >
                      {checked ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="truncate">{option}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export default MultiSelectPopover;
