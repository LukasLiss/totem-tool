import React, { useState } from "react";
import { Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResourceDemand, ResourceDistEntry, VariantDetail } from "@/api/simulationApi";

type Props = {
  variants: VariantDetail[];
  demand: Record<number, ResourceDemand>;
  resourceTypes: string[];
  onChange: (variantId: number, demand: ResourceDemand) => void;
};

const pct = (p: number) => Math.round(p * 1000) / 10;

export const cloneDemand = (d: ResourceDemand): ResourceDemand => JSON.parse(JSON.stringify(d));

/** (count, weight) pairs of a count distribution, by ascending count. */
function sortedCounts(entry: ResourceDistEntry): [number, number][] {
  return Object.entries(entry.count_distribution ?? {})
    .map(([count, p]) => [Number(count), p] as [number, number])
    .sort((a, b) => a[0] - b[0]);
}

/** Comparable form of a demand: only cells with positive weight count, as in the run. */
function canonical(d: ResourceDemand): string {
  const cells: string[] = [];
  for (const [act, types] of Object.entries(d)) {
    for (const [rt, entry] of Object.entries(types)) {
      for (const [count, p] of sortedCounts(entry)) {
        if (p > 0) cells.push(JSON.stringify([act, rt, count, p.toFixed(6)]));
      }
    }
  }
  return cells.sort().join("|");
}

/** Activities of a variant in sequence order, plus any that only carry demand. */
function variantActivities(variant: VariantDetail, demand: ResourceDemand): string[] {
  return [...new Set([...variant.activity_sequence, ...Object.keys(demand)])];
}

export const ResourceDemandEditor: React.FC<Props> = ({ variants, demand, resourceTypes, onChange }) => {
  const applyToAll = (activity: string, resType: string, entry: ResourceDistEntry) => {
    variants.forEach((v) => {
      const current = demand[v.id] ?? {};
      if (!variantActivities(v, current).includes(activity)) return;
      onChange(v.id, {
        ...current,
        [activity]: {
          ...(current[activity] ?? {}),
          [resType]: { count_distribution: { ...entry.count_distribution } },
        },
      });
    });
  };

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          How many resources of each type one occurrence of an activity needs, per
          variant. Each count has a probability and the simulation draws one count
          per occurrence; use count 0 for occurrences that need none of the type.
          Probabilities that do not sum to 100 % are normalised for the run; a
          resource type removed from an activity is not needed by it.
        </p>
        {variants.map((v) => (
          <VariantDemand
            key={v.id}
            variant={v}
            demand={demand[v.id] ?? {}}
            resourceTypes={resourceTypes}
            onChange={(d) => onChange(v.id, d)}
            onApplyToAll={applyToAll}
          />
        ))}
      </CardContent>
    </Card>
  );
};

const VariantDemand: React.FC<{
  variant: VariantDetail;
  demand: ResourceDemand;
  resourceTypes: string[];
  onChange: (demand: ResourceDemand) => void;
  onApplyToAll: (activity: string, resType: string, entry: ResourceDistEntry) => void;
}> = ({ variant, demand, resourceTypes, onChange, onApplyToAll }) => {
  const [open, setOpen] = useState(false);
  const activities = variantActivities(variant, demand);
  const edited = canonical(demand) !== canonical(variant.resource_distribution);

  const setEntry = (act: string, rt: string, entry: ResourceDistEntry | null) => {
    const types = { ...(demand[act] ?? {}) };
    if (entry) types[rt] = entry;
    else delete types[rt];
    onChange({ ...demand, [act]: types });
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded p-3">
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
            <span className="text-xs text-muted-foreground">{open ? "▼" : "▶"}</span>
            <Badge variant="outline">Variant {variant.id + 1}</Badge>
            <span className="text-xs text-muted-foreground">Support: {variant.support}</span>
            {edited && (
              <Badge variant="secondary" className="text-[10px]">edited</Badge>
            )}
          </div>
        </CollapsibleTrigger>
        {edited && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => onChange(cloneDemand(variant.resource_distribution))}
          >
            Reset to discovered
          </Button>
        )}
      </div>

      <CollapsibleContent className="mt-3 space-y-3">
        {activities.map((act) => {
          const types = demand[act] ?? {};
          const missing = resourceTypes.filter((rt) => !(rt in types));
          return (
            <div key={act} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate" title={act}>{act}</span>
                {missing.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]">
                        + Resource type
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {missing.map((rt) => (
                        <DropdownMenuItem
                          key={rt}
                          onClick={() => setEntry(act, rt, { count_distribution: { "1": 1 } })}
                        >
                          {rt}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {Object.keys(types).length === 0 ? (
                <p className="text-[10px] text-muted-foreground italic">No resources needed</p>
              ) : (
                Object.entries(types)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([rt, entry]) => (
                    <DemandRow
                      key={rt}
                      resType={rt}
                      entry={entry}
                      onChange={(e) => setEntry(act, rt, e)}
                      onRemove={() => setEntry(act, rt, null)}
                      onApplyToAll={() => onApplyToAll(act, rt, entry)}
                    />
                  ))
              )}
            </div>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
};

/** One resource type's count distribution for an activity. */
const DemandRow: React.FC<{
  resType: string;
  entry: ResourceDistEntry;
  onChange: (entry: ResourceDistEntry) => void;
  onRemove: () => void;
  onApplyToAll: () => void;
}> = ({ resType, entry, onChange, onRemove, onApplyToAll }) => {
  const [newCount, setNewCount] = useState("");
  const counts = sortedCounts(entry);
  const sum = counts.reduce((s, [, p]) => s + p, 0);
  const mean = sum > 0 ? counts.reduce((s, [c, p]) => s + c * p, 0) / sum : 0;
  const normalised = sum > 0 && Math.abs(sum - 1) > 1e-6;

  const setWeight = (count: number, p: number | null) => {
    const dist = { ...entry.count_distribution };
    if (p === null) delete dist[String(count)];
    else dist[String(count)] = p;
    onChange({ count_distribution: dist });
  };

  const parsedNew = Number.parseInt(newCount, 10);
  const canAdd =
    Number.isInteger(parsedNew) && parsedNew >= 0 && !(String(parsedNew) in entry.count_distribution);

  const sumNote =
    sum <= 0
      ? " · Σ 0 %: not needed in the run"
      : normalised
        ? ` · Σ ${pct(sum)} %: normalised for the run`
        : "";

  return (
    <div className="text-xs bg-muted/30 rounded px-2 py-1.5 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-[10px] shrink-0">{resType}</Badge>
        <span className="text-[10px] text-muted-foreground">
          Mean {mean.toFixed(2)}
          {sumNote}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            title="Copy this distribution to every variant that contains the activity"
            onClick={onApplyToAll}
          >
            Copy to all variants
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive"
            title="The activity then needs no resource of this type"
            onClick={onRemove}
          >
            Remove type
          </Button>
        </div>
      </div>
      {counts.length > 0 && (
        <div className="grid grid-cols-[3.5rem_6.5rem_4rem_1.25rem] items-center gap-x-2 gap-y-1 w-fit">
          <span className="text-[10px] text-muted-foreground">Count</span>
          <span className="text-[10px] text-muted-foreground">Probability</span>
          <span className="text-[10px] text-muted-foreground">{normalised && "In the run"}</span>
          <span />
          {counts.map(([count, p]) => (
            <React.Fragment key={count}>
              <span className="tabular-nums">{count}</span>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={pct(p)}
                  onChange={(e) => setWeight(count, Math.max(0, parseFloat(e.target.value) || 0) / 100)}
                  className="h-6 text-xs md:text-xs"
                />
                <span className="text-muted-foreground">%</span>
              </div>
              <span className="text-muted-foreground tabular-nums">
                {normalised && `${pct(p / sum)} %`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                title="Remove this count"
                aria-label={`Remove count ${count}`}
                onClick={() => setWeight(count, null)}
              >
                <Trash2 className="size-3" />
              </Button>
            </React.Fragment>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={0}
          step={1}
          placeholder="Count"
          value={newCount}
          onChange={(e) => setNewCount(e.target.value)}
          className="h-6 w-20 text-xs md:text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[10px]"
          disabled={!canAdd}
          onClick={() => {
            setWeight(parsedNew, Math.max(0, 1 - sum));
            setNewCount("");
          }}
        >
          + Add count
        </Button>
      </div>
    </div>
  );
};

export default ResourceDemandEditor;
