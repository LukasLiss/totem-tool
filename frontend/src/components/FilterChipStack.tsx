/**
 * The global filter in the top bar: a summary of what the filters leave
 * (events and objects, with a bar for the share of events), one chip per
 * filter type — filled with a short summary and ✕ while set, a dashed
 * "+ <type>" while not — and an Apply button while there are changes.
 * Clicking a chip opens the type's dialog (FilterConfigDialog). On narrow
 * windows only the summary shows, with the chips in a popover.
 *
 * Applying stays explicit: every view reloads its data on it.
 */
import React, { useContext, useEffect, useState } from "react";
import axios from "axios";
import { Calendar, CheckCheck, Filter, Layers, Plus, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  type FilterRule,
  type FilterType,
  type TimeRangeParams,
  type ObjectTypesParams,
  type ActivityParams,
} from "@/contexts/FilterStackContext";
import { useFilterStack } from "@/contexts/filterStackHooks";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { FilterConfigDialog } from "./FilterConfigDialog";
import { useFilterStore, type FilterStats } from "@/store/filterStore";
import {
  applyGlobalFilterRules,
  LARGE_LOG_EVENT_LIMIT,
  proposeLargeLogFilter,
} from "@/store/applyGlobalFilter";
import { toast } from "sonner";
import {
  GLOBAL_FILTER_KEY,
  getProjectViewSetting,
  putProjectViewSetting,
} from "@/api/projectApi";

const FILTER_TYPE_ORDER: FilterType[] = ["time_range", "object_types", "activity"];

const TYPE_CONFIG: Record<FilterType, { icon: React.ReactElement; label: string }> = {
  time_range:   { icon: <Calendar className="size-3.5 shrink-0" />, label: "Time range"   },
  object_types: { icon: <Layers   className="size-3.5 shrink-0" />, label: "Object types" },
  activity:     { icon: <Zap      className="size-3.5 shrink-0" />, label: "Activities"   },
};

/** The chips' shared shape: 32 px tall, round, small text (the height of the other bar controls). */
const CHIP = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium whitespace-nowrap";

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    month: "short", day: "numeric",
  });
}

function getSlotLabel(rule: FilterRule): string {
  switch (rule.type) {
    case "time_range": {
      const p = rule.params as TimeRangeParams;
      if (p.after != null && p.before != null) return `${fmtDate(p.after)} – ${fmtDate(p.before)}`;
      if (p.after  != null) return `After ${fmtDate(p.after)}`;
      if (p.before != null) return `Before ${fmtDate(p.before)}`;
      return "Any time";
    }
    case "object_types": {
      const { include } = rule.params as ObjectTypesParams;
      return include.length === 0 ? "No object types" : `Object types (${include.length})`;
    }
    case "activity": {
      const { include } = rule.params as ActivityParams;
      return include.length === 0 ? "No activities" : `Activities (${include.length})`;
    }
  }
}

/** What a rule does, without its id: two rules that filter alike compare equal. */
const ruleKey = (rule: FilterRule | undefined) =>
  rule ? JSON.stringify({ type: rule.type, enabled: rule.enabled, params: rule.params }) : "";

const fmtStat = (n: number) => n.toLocaleString();

/** A thin bar with the share left (0–1), right after the count it belongs to. */
function ShareBar({ share, what }: { share: number; what: string }) {
  const pct = Math.round(share * 100);
  return (
    <span
      className="relative mx-1.5 inline-block h-1 w-8 shrink-0 overflow-hidden rounded-full bg-muted-foreground/20 align-middle"
      title={`${what}: ${pct}% left`}
      aria-label={`${what}: ${pct}% left`}
    >
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-foreground transition-[width] duration-500"
        style={{ width: `${Math.max(2, pct)}%` }}
      />
    </span>
  );
}

/** What the filters leave: events and objects, each with a bar for its share. */
function FilterSummary({
  stats,
  hasFile,
  filterCount,
  showIcon = true,
}: {
  stats: FilterStats;
  hasFile: boolean;
  filterCount?: number;
  /** Off inside the framed bar, whose "Filters" label carries the icon. */
  showIcon?: boolean;
}) {
  const known = hasFile && stats.eventBefore > 0;
  const filtered = known && (stats.eventAfter < stats.eventBefore || stats.objectAfter < stats.objectBefore);
  return (
    <span className="flex min-w-0 items-center gap-2">
      {showIcon && <Filter className="size-3.5 shrink-0" />}
      {!known ? (
        <span>{hasFile ? "Filter" : "No event log"}</span>
      ) : filtered ? (
        <span className="tabular-nums">
          <b>{fmtStat(stats.eventAfter)}</b>
          <span className="text-muted-foreground"> / {fmtStat(stats.eventBefore)} events</span>
          <ShareBar share={stats.eventPct} what="Events" />
          <span className="text-muted-foreground">· </span>
          <b>{fmtStat(stats.objectAfter)}</b>
          <span className="text-muted-foreground"> / {fmtStat(stats.objectBefore)} objects</span>
          <ShareBar share={stats.objectPct} what="Objects" />
        </span>
      ) : (
        <span className="tabular-nums text-muted-foreground">
          All {fmtStat(stats.eventBefore)} events · {fmtStat(stats.objectBefore)} objects
        </span>
      )}
      {filterCount != null && filterCount > 0 && (
        <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground">
          {filterCount} {filterCount === 1 ? "filter" : "filters"}
        </span>
      )}
    </span>
  );
}

/** One filter type: filled with its summary and ✕ while set, dashed "+ <type>" while not. */
function FilterChip({
  type,
  rule,
  changed,
  onOpen,
  onRemove,
}: {
  type: FilterType;
  rule: FilterRule | undefined;
  /** Differs from the applied filters: marked with a dot until Apply. */
  changed: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { icon, label } = TYPE_CONFIG[type];
  const dot = changed && (
    <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-background" />
  );

  if (!rule) {
    return (
      <button
        type="button"
        onClick={onOpen}
        title={`Add a ${label.toLowerCase()} filter`}
        className={cn(CHIP, "relative border border-dashed border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground")}
      >
        <Plus className="size-3.5 shrink-0" />
        {label}
        {dot}
      </button>
    );
  }

  const text = getSlotLabel(rule);
  return (
    <span
      className={cn(CHIP, "relative bg-primary pl-0 pr-1 text-primary-foreground", !rule.enabled && "opacity-55")}
    >
      <button
        type="button"
        onClick={onOpen}
        title={`Edit: ${text}`}
        className="flex h-full min-w-0 items-center gap-1.5 rounded-l-full pl-3"
      >
        {icon}
        <span className="max-w-[140px] truncate">{text}</span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label.toLowerCase()} filter`}
        title={`Remove ${label.toLowerCase()} filter`}
        className="flex size-6 items-center justify-center rounded-full opacity-80 hover:bg-primary-foreground/15 hover:opacity-100"
      >
        <X className="size-3.5" />
      </button>
      {dot}
    </span>
  );
}

const DEFAULT_STATS: FilterStats = {
  objectPct: 1, eventPct: 1,
  objectBefore: 0, objectAfter: 0,
  eventBefore: 0, eventAfter: 0,
};

export default function FilterChipStack() {
  const { filters, addFilter, removeFilter, replaceFilters } = useFilterStack();
  const { selectedFile } = useContext(SelectedFileContext);
  const fileId: number | undefined = selectedFile?.id;
  const isMobile = useIsMobile();
  const projectId: number | undefined = selectedFile?.project as number | undefined;

  const [dialogOpen,    setDialogOpen]    = useState(false);
  const [activeType,    setActiveType]    = useState<FilterType>("object_types");
  const [editingRule,   setEditingRule]   = useState<FilterRule | undefined>();
  const [objectTypes,   setObjectTypes]   = useState<{ name: string; count: number }[]>([]);
  const [activities,    setActivities]    = useState<{ name: string; count: number }[]>([]);
  const [applying,      setApplying]      = useState(false);
  // The applied rules and the survival stats live in the filter store so
  // other components (e.g. the process-area filter action) can apply a
  // filter too and this header stays in sync.
  const storeStats   = useFilterStore((s) => s.stats);
  const appliedRules = useFilterStore((s) => s.appliedRules);
  const stats: FilterStats = storeStats ?? DEFAULT_STATS;
  const appliedKey = JSON.stringify(appliedRules);


  useEffect(() => {
    if (!fileId) {
      useFilterStore.getState().clear();
      useFilterStore.getState().setStats(null);
      setObjectTypes([]);
      setActivities([]);
      return;
    }

    const sessionKey = `totem_filters_${fileId}`;
    let stale = false;
    // Set once the restore has decided, so the statistics request below knows
    // whether it is allowed to publish unfiltered counts.
    let restoredRules: FilterRule[] | null = null;

    /** The filter saved with the project, or null. */
    const savedProjectFilter = async (): Promise<FilterRule[] | null> => {
      if (projectId == null) return null;
      try {
        const value = await getProjectViewSetting(projectId, GLOBAL_FILTER_KEY);
        const rules = (value as { rules?: unknown } | null)?.rules;
        return Array.isArray(rules) && rules.length > 0 ? (rules as FilterRule[]) : null;
      } catch {
        // Never block opening a project on this: fall back to the tab cache.
        return null;
      }
    };

    /** The per-tab cache, which predates the project-level filter. */
    const cachedFilter = (): FilterRule[] | null => {
      try {
        const stored = sessionStorage.getItem(sessionKey);
        const rules = stored ? JSON.parse(stored) : null;
        return Array.isArray(rules) && rules.length > 0 ? rules : null;
      } catch {
        return null;
      }
    };

    void (async () => {
      // The project's own filter wins over the tab cache: it is what an
      // exported project carries, and what a colleague opening the same
      // project should see.
      const rules = (await savedProjectFilter()) ?? cachedFilter();
      if (stale) return;
      restoredRules = rules;

      if (rules) {
        replaceFilters(["time_range", "object_types", "activity"], rules);
        applyGlobalFilterRules(fileId, rules).catch(() => {});
        return;
      }

      // `clear()` bumps the filter version, which makes every component abort
      // and resend its request — for nothing when no filter is applied.
      if (useFilterStore.getState().isApplied) useFilterStore.getState().clear();
      useFilterStore.getState().setStats(null);
      // A large log gets a time-range filter straight away: the analyses on
      // the overview page would otherwise run over the whole log, which can
      // take minutes. The user sees the rule as a chip in the bar and can
      // change or remove it like any other filter. Only reached when the
      // project saved no filter of its own — otherwise this would silently
      // discard the one an exported project was published with.
      const rule = await proposeLargeLogFilter(fileId).catch(() => null);
      if (!rule || stale) return;
      const proposed = replaceFilters(["time_range"], [rule]);
      try {
        await applyGlobalFilterRules(fileId, proposed);
        sessionStorage.setItem(sessionKey, JSON.stringify(proposed));
      } catch {
        return;
      }
      if (stale) return;
      restoredRules = proposed;
      toast.info("Large event log: showing the first events only", {
        description:
          `This log has more than ${LARGE_LOG_EVENT_LIMIT.toLocaleString()} events, so a global time-range ` +
          "filter was applied to keep the analyses responsive. Adjust or remove it in the filter bar.",
        duration: 10000,
      });
    })();

    axios.get<{ name: string; count: number }[]>(`/api/files/${fileId}/object_types/`, { _skipGlobalFilter: true })
      .then(({ data }) => setObjectTypes(Array.isArray(data) ? data : []))
      .catch(() => { toast.error("Object types could not be loaded"); setObjectTypes([]); });
    axios.get<{ name: string; count: number }[]>(`/api/files/${fileId}/activities/`, { _skipGlobalFilter: true })
      .then(({ data }) => setActivities(Array.isArray(data) ? data : []))
      .catch(() => { toast.error("Activities could not be loaded"); setActivities([]); });

    axios.get<{ num_objects: number; num_events: number }>(
      `/api/files/${fileId}/statistics/`, { _skipGlobalFilter: true }
    ).then(({ data }) => {
      if ((!restoredRules || restoredRules.length === 0) && !useFilterStore.getState().isApplied) {
        useFilterStore.getState().setStats({
          objectPct:    1,
          eventPct:     1,
          objectBefore: data.num_objects,
          objectAfter:  data.num_objects,
          eventBefore:  data.num_events,
          eventAfter:   data.num_events,
        });
      }
    }).catch(() => {});
    return () => { stale = true; };
  }, [fileId, projectId]);

  const currentKey = JSON.stringify(filters);
  const dirty = currentKey !== appliedKey;

  const ruleForType = (type: FilterType) => filters.find(f => f.type === type);
  const appliedRuleForType = (type: FilterType) => appliedRules.find(f => f.type === type);

  function openSlot(type: FilterType) {
    const existing = ruleForType(type);
    setActiveType(type);
    setEditingRule(existing);
    setDialogOpen(true);
  }

  function handleSubmit(params: FilterRule["params"]) {
    if (editingRule) removeFilter(editingRule.id);
    const emptyInclude =
      (activeType === "object_types" || activeType === "activity") &&
      (params as { include: string[] }).include.length === 0;
    if (!emptyInclude) {
      addFilter({ type: activeType, enabled: true, params });
    }
  }

  async function applyFilters() {
    if (!fileId) return;
    setApplying(true);
    try {
      await applyGlobalFilterRules(fileId, filters);
      try {
        if (filters.length > 0) {
          sessionStorage.setItem(`totem_filters_${fileId}`, JSON.stringify(filters));
        } else {
          sessionStorage.removeItem(`totem_filters_${fileId}`);
        }
      } catch {
        /* ignore storage quota or serialization errors */
      }
      // Saved on the project as well as in the tab: this is what survives a
      // new tab, another machine, and an export. `null` removes the entry, so
      // clearing the stack really clears it rather than storing an empty one.
      if (projectId != null) {
        putProjectViewSetting(
          projectId,
          GLOBAL_FILTER_KEY,
          filters.length > 0 ? { rules: filters } : null,
        ).catch(() => {
          // The filter is applied either way; only its persistence failed.
          toast.error("The filter was applied but could not be saved to the project");
        });
      }
    } catch {
      toast.error("Filter could not be applied");
    } finally {
      setApplying(false);
    }
  }

  async function handleApply() {
    if (applying || !dirty) return;
    await applyFilters();
  }

  const chips = FILTER_TYPE_ORDER.map((type) => (
    <FilterChip
      key={type}
      type={type}
      rule={ruleForType(type)}
      changed={ruleKey(ruleForType(type)) !== ruleKey(appliedRuleForType(type))}
      onOpen={() => openSlot(type)}
      onRemove={() => {
        const r = ruleForType(type);
        if (r) removeFilter(r.id);
      }}
    />
  ));

  // Shown while there are changes (and while they are being applied).
  const applyButton = (dirty || applying) && (
    <Button
      type="button"
      size="sm"
      onClick={handleApply}
      disabled={applying || !fileId}
      className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-xs"
      title="Apply the filters to every view"
    >
      {applying ? (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        <CheckCheck className="size-3.5" />
      )}
      {applying ? "Applying…" : "Apply"}
    </Button>
  );

  const dialog = (
    <FilterConfigDialog
      open={dialogOpen}
      onClose={() => setDialogOpen(false)}
      filterType={activeType}
      existingRule={editingRule}
      availableObjectTypes={objectTypes}
      availableActivities={activities}
      onSubmit={handleSubmit}
      icon={TYPE_CONFIG[activeType].icon}
      titleLabel={TYPE_CONFIG[activeType].label}
      hasFile={!!fileId}
      fileId={fileId}
    />
  );

  if (isMobile) {
    // Narrow: the summary (with the number of filters) opens the chips in a popover.
    return (
      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(CHIP, "relative min-w-0 border border-border bg-background hover:bg-muted")}
              title="Filters"
            >
              <FilterSummary stats={stats} hasFile={!!fileId} filterCount={filters.length} />
              {dirty && (
                <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-background" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-auto flex-col items-start gap-2 p-3">
            {chips}
            {applyButton}
          </PopoverContent>
        </Popover>
        {dialog}
      </div>
    );
  }

  // One frame around the whole filter (label, summary, chips, Apply), so it
  // reads as one control: the global filter of every view.
  return (
    <div className="py-1">
      <div className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-muted/40 py-1 pl-3 pr-1">
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold">
          <Filter className="size-3.5 shrink-0" />
          Filters
        </span>
        <div className="mx-1.5 h-5 w-px shrink-0 bg-border" />
        <span className="shrink-0 text-xs">
          <FilterSummary stats={stats} hasFile={!!fileId} showIcon={false} />
        </span>
        <div className="mx-1.5 h-5 w-px shrink-0 bg-border" />
        {chips}
        {applyButton}
      </div>
      {dialog}
    </div>
  );
}
