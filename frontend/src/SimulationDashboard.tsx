import React, { useState, useEffect, useContext, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import {
  fetchProcessAreas,
  fetchSimulationDetails,
  fetchSimulationProgress,
  runSimulation,
  fetchGraphEditDistance,
  saveSimulatedLog,
  downloadSimulatedLog,
  ProcessAreaInfo,
  ProcessAreasResponse,
  SimulationConfig,
  SimulationOverrides,
  SimulationResult,
  SimulationDetailsResponse,
  SimulationMode,
  SimulationProgress,
  VariantConstraints,
  CalendarProbability,
  CooldownDistribution,
  AllocationStrategy,
  PaperEvaluationResult,
} from "@/api/simulationApi";
import { toast } from "sonner";
import { ArrivalDistributionEditor } from "@/components/simulation/ArrivalDistributionEditor";
import {
  ResourceCalendarEditor,
  CalendarOverrideGroup,
} from "@/components/simulation/ResourceCalendarEditor";
import { ConstraintsEditorPanel } from "@/components/simulation/ConstraintsEditor";
import { CooldownEditor } from "@/components/simulation/CooldownEditor";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Stepper,
  StepperItem,
  StepperNav,
  StepperTrigger,
  StepperIndicator,
  StepperSeparator,
  StepperTitle,
} from "@/components/ui/stepper";

/** Collapsible card wrapper: shows title + description when collapsed. */
const CollapsibleSection: React.FC<{
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, description, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center gap-3 cursor-pointer group">
          <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
            {open ? "\u25BC" : "\u25B6"}
          </span>
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-base">{title}</span>
            {!open && (
              <span className="text-xs text-muted-foreground ml-2">{description}</span>
            )}
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
};

// Frontend cache for process areas data per file
const processAreasCache: Record<number, ProcessAreasResponse> = {};
const simulationDetailsCache: Record<string, SimulationDetailsResponse> = {};

type Phase = "configure" | "details" | "running" | "results";

// Steps for the animated progress indicator
const DETAILS_STEPS = [
  "Loading event log",
  "Filtering event log by process area",
  "Mining variants and arrival distributions",
  "Discovering resource constraints",
  "Discovering resource calendars",
  "Computing resource cooldowns and allocation strategy",
];

const RUN_STEPS = [
  "Loading event log",
  "Building simulation model from configuration",
  "Generating arrival schedule",
  "Simulating events",
  "Preparing actual log for comparison",
  "Computing evaluation metrics",
  "Preparing simulated event log",
];

/** Step progress indicator driven by backend status updates. */
const StepProgress: React.FC<{ steps: string[]; active: number; percent?: number }> = ({
  steps,
  active,
  percent,
}) => (
  <Card>
    <CardContent className="py-4">
      <div className="space-y-2">
        {steps.map((step, idx) => (
          <div key={idx} className="flex items-center gap-2 text-xs">
            {idx < active ? (
              <span className="w-4 h-4 rounded-full bg-primary flex items-center justify-center text-white text-[10px]">✓</span>
            ) : idx === active ? (
              <span className="w-4 h-4 rounded-full border-2 border-primary animate-pulse" />
            ) : (
              <span className="w-4 h-4 rounded-full border border-muted-foreground/30" />
            )}
            <span className={idx <= active ? "text-foreground" : "text-muted-foreground"}>
              {step}
              {idx === active && percent != null && (
                <span className="text-muted-foreground">
                  {" "}— {percent}% of simulated time elapsed
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </CardContent>
  </Card>
);

/**
 * Wizard-style step indicator across the top of the dashboard.
 * Maps the current simulation `phase` onto discrete steps (Basics -> Details ->
 * Results). **/

const SimulationStepper: React.FC<{
  phase: Phase;
  mode: SimulationMode;
  onGoConfigure: () => void;
  onGoDetails: () => void;
}> = ({ phase, mode, onGoConfigure, onGoDetails }) => {
  const steps: { key: string; title: string }[] =
    mode === "advanced"
      ? [
          { key: "configure", title: "Basics" },
          { key: "results", title: "Results" },
        ]
      : [
          { key: "configure", title: "Basics" },
          { key: "details", title: "Details" },
          { key: "results", title: "Results" },
        ];

  // "running" is a transient state that belongs to the final (Results) step.
  const phaseKey = phase === "running" ? "results" : phase;
  const activeIdx = steps.findIndex((s) => s.key === phaseKey);
  const activeStep = (activeIdx < 0 ? 0 : activeIdx) + 1;

  const handleValueChange = (step: number) => {
    const target = steps[step - 1];
    if (!target) return;
    if (target.key === "configure") onGoConfigure();
    else if (target.key === "details") onGoDetails();
  };

  return (
    <Stepper value={activeStep} onValueChange={handleValueChange} className="mb-2">
      <StepperNav className="gap-3">
        {steps.map((step, idx) => {
          const stepNumber = idx + 1;
          return (
            <StepperItem
              key={step.key}
              step={stepNumber}
              loading={phase === "running" && stepNumber === activeStep}
              // Only completed steps (before the active one) are navigable.
              disabled={phase === "running" || stepNumber > activeStep}
              className="items-start not-last:flex-1"
            >
              <StepperTrigger className="flex-col gap-1.5">
                <StepperIndicator>{stepNumber}</StepperIndicator>
                <StepperTitle className="text-center">{step.title}</StepperTitle>
              </StepperTrigger>
              {idx < steps.length - 1 && <StepperSeparator className="mt-[11px]" />}
            </StepperItem>
          );
        })}
      </StepperNav>
    </Stepper>
  );
};

// Render a unix timestamp (seconds, UTC) as a `yyyy-MM-ddTHH:mm` string
const unixToDatetimeLocal = (unix: number): string => {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
};

// Parse a datetime-local string as a UTC instant -> unix seconds.
const datetimeLocalToUnix = (s: string): number | null => {
  if (!s) return null;
  const ms = Date.parse(`${s}:00Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
};

export const SimulationDashboard: React.FC = () => {
  const { selectedFile } = useContext(SelectedFileContext);
  const fileId = selectedFile?.id;

  // Phase management
  const [phase, setPhase] = useState<Phase>("configure");

  // Process area data from backend
  const [processAreasData, setProcessAreasData] = useState<ProcessAreasResponse | null>(null);
  const [loadingAreas, setLoadingAreas] = useState(false);
  const [loadError, setLoadError] = useState("");

  // Simulation mode
  const [mode, setMode] = useState<SimulationMode>("simple");

  // Configuration state
  const [selectedObjectTypes, setSelectedObjectTypes] = useState<string[]>([]);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [resourcePool, setResourcePool] = useState<Record<string, number>>({});
  const [simDurationDays, setSimDurationDays] = useState(7);
  const [tickSize, setTickSize] = useState(60);
  const [simStartUnix, setSimStartUnix] = useState<number | null>(null);
  const [violationDegree, setViolationDegree] = useState(0.0);
  const [lookbackLength, setLookbackLength] = useState<number | null>(null);
  const [modelActivityDurations, setModelActivityDurations] = useState(true);

  // Constraint mining config
  const [supportThreshold, setSupportThreshold] = useState(0.8);
  const [minVariantFrequency, setMinVariantFrequency] = useState(0.05);
  const [minVariantExecutions, setMinVariantExecutions] = useState(5);

  // Simulation details (variants, arrivals, constraints)
  const [details, setDetails] = useState<SimulationDetailsResponse | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");

  // Live step progress of the in-flight details/run request (polled from backend)
  const [detailsProgress, setDetailsProgress] = useState<SimulationProgress>({ steps: DETAILS_STEPS, current: 0 });
  const [runProgress, setRunProgress] = useState<SimulationProgress>({ steps: RUN_STEPS, current: 0 });

  // Poll the backend for step progress while a request is in flight.
  // Returns a stop function; late poll responses after stop are discarded.
  const startProgressPolling = (
    progressId: string,
    fallbackSteps: string[],
    setProgress: React.Dispatch<React.SetStateAction<SimulationProgress>>,
  ) => {
    setProgress({ steps: fallbackSteps, current: 0 });
    let stopped = false;
    let inFlight = false;
    const interval = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      const p = await fetchSimulationProgress(progressId);
      inFlight = false;
      if (!stopped && p && p.steps.length > 0) setProgress(p);
    }, 500);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  };

  // Editable constraints (per-variant + user global + mined fallback pool)
  const [editedConstraints, setEditedConstraints] = useState<Record<number, VariantConstraints>>({});
  const [globalConstraints, setGlobalConstraints] = useState<VariantConstraints>({});
  const [fallbackConstraints, setFallbackConstraints] = useState<VariantConstraints>({});

  // Resource calendars: one editable calendar per resource type (the default for
  // every resource of that type), plus optional custom calendars for explicitly
  // chosen sets of individual resources.
  const [typeCalendars, setTypeCalendars] = useState<Record<string, CalendarProbability>>({});
  const [discoveredTypeCalendars, setDiscoveredTypeCalendars] = useState<Record<string, CalendarProbability>>({});
  const [calendarOverrides, setCalendarOverrides] = useState<CalendarOverrideGroup[]>([]);

  // Cooldowns and allocation strategy
  const [cooldowns, setCooldowns] = useState<CooldownDistribution>({});
  const [allocationStrategy, setAllocationStrategy] = useState<AllocationStrategy>({});

  // Simulation results
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState("");

  // Stale closure prevention
  const fileIdRef = useRef<number | undefined>(fileId);
  useEffect(() => {
    fileIdRef.current = fileId;
  }, [fileId]);

  // Load process areas when file changes (with cache)
  useEffect(() => {
    if (!fileId) {
      setProcessAreasData(null);
      setPhase("configure");
      return;
    }

    if (processAreasCache[fileId]) {
      setProcessAreasData(processAreasCache[fileId]);
      setLoadingAreas(false);
      return;
    }

    const currentFileId = fileId;
    setLoadingAreas(true);
    setLoadError("");

    fetchProcessAreas(fileId)
      .then((data) => {
        if (fileIdRef.current !== currentFileId) return;
        processAreasCache[fileId] = data;
        setProcessAreasData(data);
        setLoadingAreas(false);
      })
      .catch((err) => {
        if (fileIdRef.current !== currentFileId) return;
        setLoadError(err.message);
        setLoadingAreas(false);
      });
  }, [fileId]);

  // Reset configuration when file changes
  useEffect(() => {
    setSelectedObjectTypes([]);
    setSelectedActivities([]);
    setResourcePool({});
    setResult(null);
    setDetails(null);
    setEditedConstraints({});
    setGlobalConstraints({});
    setFallbackConstraints({});
    setTypeCalendars({});
    setDiscoveredTypeCalendars({});
    setCalendarOverrides([]);
    setCooldowns({});
    setAllocationStrategy({});
    setPhase("configure");
  }, [fileId]);

  // Seed the simulation time window to the whole-log span as a baseline
  useEffect(() => {
    if (processAreasData?.log_duration_days) {
      setSimDurationDays(processAreasData.log_duration_days);
    }
    if (processAreasData?.log_start_unix != null) {
      setSimStartUnix(processAreasData.log_start_unix);
    }
  }, [processAreasData]);

  // Refine simulation start time & time window to the data from the filtered log
  useEffect(() => {
    if (!details) return;
    if (details.log_duration_days != null) {
      setSimDurationDays(details.log_duration_days);
    }
    if (details.log_start_unix != null) {
      setSimStartUnix(details.log_start_unix);
    }
  }, [details]);

  // Compute which activities are relevant based on selected object types
  const relevantActivities = useMemo(() => {
    if (!processAreasData?.object_type_to_activities) return new Set<string>();
    const relevant = new Set<string>();
    for (const ot of selectedObjectTypes) {
      const acts = processAreasData.object_type_to_activities[ot] || [];
      acts.forEach((a) => relevant.add(a));
    }
    return relevant;
  }, [selectedObjectTypes, processAreasData]);

  // Compute orphaned activities
  const orphanedActivities = useMemo(() => {
    if (!processAreasData?.object_type_to_activities || selectedObjectTypes.length === 0) {
      return new Set<string>();
    }
    const orphaned = new Set<string>();
    for (const act of selectedActivities) {
      if (!relevantActivities.has(act)) {
        orphaned.add(act);
      }
    }
    return orphaned;
  }, [selectedActivities, relevantActivities, processAreasData, selectedObjectTypes]);

  // Compute resource suggestions
  const resourceSuggestions = useMemo(() => {
    if (!processAreasData?.process_areas) return [];
    const selectedLevels = new Set<number>();
    for (const pa of processAreasData.process_areas) {
      if (pa.object_types.some((ot) => selectedObjectTypes.includes(ot))) {
        selectedLevels.add(pa.level);
      }
    }
    const minSelectedLevel = selectedLevels.size > 0 ? Math.min(...selectedLevels) : 0;
    const suggestions = new Set<string>();
    for (const pa of processAreasData.process_areas) {
      if (pa.level >= minSelectedLevel) {
        for (const ot of pa.object_types) {
          if (!selectedObjectTypes.includes(ot)) {
            suggestions.add(ot);
          }
        }
      }
    }
    return Array.from(suggestions).sort();
  }, [selectedObjectTypes, processAreasData]);

  // Select a predefined process area
  const selectProcessArea = (pa: ProcessAreaInfo) => {
    setSelectedObjectTypes(pa.object_types);
    setSelectedActivities(pa.activities);
    const counts = processAreasData?.object_type_counts ?? {};
    const pool: Record<string, number> = {};
    if (processAreasData?.process_areas) {
      for (const otherPa of processAreasData.process_areas) {
        if (otherPa.level >= pa.level) {
          for (const ot of otherPa.object_types) {
            if (!pa.object_types.includes(ot)) {
              // Match the source log: use the actual object count of this type
              // as the available resource count.
              pool[ot] = counts[ot] ?? 3;
            }
          }
        }
      }
    }
    setResourcePool(pool);
  };

  const toggleObjectType = (ot: string) => {
    setSelectedObjectTypes((prev) => {
      const wasSelected = prev.includes(ot);
      if (!wasSelected) {
        // Selecting this OT — remove it from resource pool
        setResourcePool((pool) => {
          const next = { ...pool };
          delete next[ot];
          return next;
        });
      }
      return wasSelected ? prev.filter((t) => t !== ot) : [...prev, ot];
    });
  };

  const toggleActivity = (act: string) => {
    setSelectedActivities((prev) =>
      prev.includes(act) ? prev.filter((a) => a !== act) : [...prev, act]
    );
  };

  const updateResourceCount = (resType: string, count: number) => {
    setResourcePool((prev) => ({ ...prev, [resType]: Math.max(0, count) }));
  };

  const addResourceType = (resType: string) => {
    if (!resourcePool[resType]) {
      const count = processAreasData?.object_type_counts?.[resType] ?? 3;
      setResourcePool((prev) => ({ ...prev, [resType]: count }));
    }
  };

  const removeResourceType = (resType: string) => {
    setResourcePool((prev) => {
      const next = { ...prev };
      delete next[resType];
      return next;
    });
  };

  // Load simulation details (includes calendars, cooldowns, allocation strategy)
  const handleLoadDetails = async () => {
    if (!fileId) return;

    const resourceTypes = Object.keys(resourcePool).filter((k) => resourcePool[k] > 0);
    const cacheKey = `${fileId}_${[...selectedObjectTypes].sort().join(",")}_${[...selectedActivities].sort().join(",")}_${resourceTypes.sort().join(",")}_${supportThreshold}_${minVariantFrequency}_${minVariantExecutions}`;

    setDetailsLoading(true);
    setDetailsError("");

    try {
      let data: SimulationDetailsResponse;
      if (simulationDetailsCache[cacheKey]) {
        data = simulationDetailsCache[cacheKey];
      } else {
        const progressId = crypto.randomUUID();
        const stopPolling = startProgressPolling(progressId, DETAILS_STEPS, setDetailsProgress);
        try {
          data = await fetchSimulationDetails({
            file_id: fileId,
            object_types: selectedObjectTypes,
            activities: selectedActivities,
            resource_types: resourceTypes.length > 0 ? resourceTypes : undefined,
            support_threshold: supportThreshold,
            min_variant_frequency: minVariantFrequency,
            min_variant_executions: minVariantExecutions,
            progress_id: progressId,
          });
        } finally {
          stopPolling();
        }
        if (fileIdRef.current !== fileId) return;
        simulationDetailsCache[cacheKey] = data;
      }

      setDetails(data);

      // Initialize editable constraints from the variants that were mined on
      // their own. Fallback variants are left absent (undefined) so they inherit
      // the pool until the user edits one, which promotes it to its own set.
      const initialConstraints: Record<number, VariantConstraints> = {};
      data.variants.forEach((v) => {
        if (!v.uses_fallback) initialConstraints[v.id] = { ...v.constraints };
      });
      setEditedConstraints(initialConstraints);
      setFallbackConstraints(data.fallback_constraints || {});

      // Store raw discovered type calendars for reference display (heatmap background)
      setDiscoveredTypeCalendars(data.type_calendars || {});

      // Initialize the editable calendars from the discovered probabilities:
      // Types without any discovered data fall back to a plain Mon–Fri 08:00–17:00 default.
      const WEEK = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
      const defaultWeekdayHours = Array.from({ length: 24 }, (_, h) => (h >= 8 && h < 17 ? 1 : 0));
      const defaultWeekendHours = Array(24).fill(0);
      const cloneCalendar = (src: CalendarProbability): CalendarProbability => {
        const out: CalendarProbability = {};
        for (const day of WEEK) out[day] = [...(src[day] || Array(24).fill(0))];
        return out;
      };
      const hasData = (cal?: CalendarProbability) =>
        !!cal && WEEK.some((d) => (cal[d] || []).some((v) => v > 0));

      const mergedTypeCalendars: Record<string, CalendarProbability> = {};
      for (const rt of resourceTypes) {
        const discovered = data.type_calendars?.[rt];
        mergedTypeCalendars[rt] = hasData(discovered)
          ? cloneCalendar(discovered!)
          : {
              Monday: [...defaultWeekdayHours], Tuesday: [...defaultWeekdayHours],
              Wednesday: [...defaultWeekdayHours], Thursday: [...defaultWeekdayHours],
              Friday: [...defaultWeekdayHours], Saturday: [...defaultWeekendHours],
              Sunday: [...defaultWeekendHours],
            };
      }
      setTypeCalendars(mergedTypeCalendars);
      setCalendarOverrides([]);

      // Set cooldowns and allocation strategy
      setCooldowns(data.cooldown_distribution || {});
      setAllocationStrategy(data.allocation_strategy || {});

      setDetailsLoading(false);
      setPhase("details");
    } catch (err: any) {
      if (fileIdRef.current !== fileId) return;
      setDetailsError(err.message || "Failed to load details");
      setDetailsLoading(false);
    }
  };

  // Constraint editing
  // A deep copy of the current fallback pool, used to seed a fallback variant the
  // first time it is edited (it then detaches from the pool).
  const clonePool = () =>
    Object.fromEntries(
      Object.entries(fallbackConstraints).map(([act, inner]) => [act, { ...inner }])
    );

  // A fallback variant has no own entry until edited; editing it here promotes it
  // to a variant-specific set (seeded from the pool) that no longer follows it.
  const seedVariant = (
    prev: Record<number, VariantConstraints>,
    variantId: number
  ): VariantConstraints =>
    prev[variantId] !== undefined ? { ...prev[variantId] } : clonePool();

  const addConstraint = (variantId: number, act1: string, act2: string, type: string) => {
    setEditedConstraints((prev) => {
      const varConstraints = seedVariant(prev, variantId);
      if (!varConstraints[act1]) varConstraints[act1] = {};
      varConstraints[act1] = { ...varConstraints[act1], [act2]: type };
      return { ...prev, [variantId]: varConstraints };
    });
  };

  const removeConstraint = (variantId: number, act1: string, act2: string) => {
    setEditedConstraints((prev) => {
      const varConstraints = seedVariant(prev, variantId);
      if (varConstraints[act1]) {
        const acts = { ...varConstraints[act1] };
        delete acts[act2];
        if (Object.keys(acts).length === 0) delete varConstraints[act1];
        else varConstraints[act1] = acts;
      }
      return { ...prev, [variantId]: varConstraints };
    });
  };

  // Run simulation
  const handleRunSimulation = async () => {
    if (!fileId) return;
    setPhase("running");
    setSimError("");

    // Once the details phase has been loaded, carry the reviewed/edited values
    // so the backend simulates with them instead of re-discovering everything.
    let overrides: SimulationOverrides | undefined;
    if (details) {
      const arrivalDistributions: Record<number, Record<string, Record<string, number>>> = {};
      details.variants.forEach((v) => {
        arrivalDistributions[v.id] = v.arrival_distribution.avg_arrivals_per_hour || {};
      });
      // Expand the custom calendar groups into a per-resource-instance map keyed
      // by simulated resource id (e.g. "Worker_1"), which the engine gates on.
      const resourceCalendars: Record<string, CalendarProbability> = {};
      calendarOverrides.forEach((group) => {
        group.resourceIds.forEach((rid) => {
          resourceCalendars[rid] = group.calendar;
        });
      });
      // Build the per-variant payload: a customized variant (own entry) sends it;
      // an untouched fallback variant sends the shared pool. The backend merge then
      // covers every variant.
      const constraintsPayload: Record<number, VariantConstraints> = {};
      details.variants.forEach((v) => {
        constraintsPayload[v.id] =
          editedConstraints[v.id] !== undefined
            ? editedConstraints[v.id]
            : v.uses_fallback
              ? fallbackConstraints
              : {};
      });
      overrides = {
        constraints: constraintsPayload,
        global_constraints: globalConstraints,
        arrival_distributions: arrivalDistributions,
        cooldowns,
        allocation_strategy: allocationStrategy,
        type_calendars: typeCalendars,
        resource_calendars: resourceCalendars,
      };
    }

    const progressId = crypto.randomUUID();
    const config: SimulationConfig = {
      file_id: fileId,
      object_types: selectedObjectTypes,
      activities: selectedActivities,
      resource_pool: resourcePool,
      sim_duration_days: simDurationDays,
      tick_size_s: tickSize,
      sim_start_unix: simStartUnix,
      model_activity_durations: modelActivityDurations,
      resource_constraint_violation_degree: violationDegree,
      constraint_lookback_length: lookbackLength,
      mode,
      overrides,
      progress_id: progressId,
    };

    const stopPolling = startProgressPolling(progressId, RUN_STEPS, setRunProgress);
    try {
      const res = await runSimulation(config);
      if (fileIdRef.current !== fileId) return;
      setResult(res);
      setPhase("results");
    } catch (err: any) {
      if (fileIdRef.current !== fileId) return;
      setSimError(err.message || "Simulation failed");
      setPhase("details");
    } finally {
      stopPolling();
    }
  };

  const canLoadDetails = selectedObjectTypes.length > 0 && selectedActivities.length > 0;
  const canRun =
    canLoadDetails &&
    Object.keys(resourcePool).length > 0 &&
    Object.values(resourcePool).some((v) => v > 0);

  // --- Render ---

  if (!fileId) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              Please select an event log file to configure the simulation.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loadingAreas) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-muted-foreground">Loading process areas...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <p className="text-destructive">Error: {loadError}</p>
            <Button className="mt-4" onClick={() => window.location.reload()}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Simulation Dashboard</h1>
        {(phase === "details" || phase === "results") && (
          <Button variant="outline" onClick={() => { setPhase("configure"); setDetails(null); }}>
            Back to Configuration
          </Button>
        )}
      </div>

      {/* Wizard step indicator */}
      <SimulationStepper
        phase={phase}
        mode={mode}
        onGoConfigure={() => { setPhase("configure"); setDetails(null); }}
        onGoDetails={() => setPhase("details")}
      />

      {/* Mode Selection */}
      {phase === "configure" && (
        <Card>
          <CardHeader><CardTitle>Simulation Mode</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <button
                className={`flex-1 p-4 rounded border-2 text-left transition-colors ${
                  mode === "simple" ? "border-primary bg-primary/5" : "border-muted hover:border-primary/50"
                }`}
                onClick={() => setMode("simple")}
              >
                <div className="font-medium">Simple Simulation</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Variant-based playout. Uses discovered variants and their arrival distribution.
                </p>
              </button>
              <button
                className={`flex-1 p-4 rounded border-2 text-left transition-colors ${
                  mode === "advanced" ? "border-primary bg-primary/5" : "border-muted hover:border-primary/50"
                }`}
                onClick={() => setMode("advanced")}
              >
                <div className="font-medium">Advanced Simulation</div>
                <p className="text-sm text-muted-foreground mt-1">
                  State-space playout with connected component distribution.
                </p>
                <Badge variant="outline" className="mt-2">Experimental</Badge>
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Phase: Configuration */}
      {phase === "configure" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Process Area Selection */}
          <Card>
            <CardHeader><CardTitle>Process Area</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {/* Predefined Process Areas */}
              {processAreasData?.process_areas && processAreasData.process_areas.length > 0 && (
                <div>
                  <Label className="text-sm font-medium">Suggested Process Areas (MLPA)</Label>
                  <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                    {processAreasData.process_areas.map((pa, idx) => (
                      <button
                        key={idx}
                        className="w-full text-left p-2 rounded border hover:bg-accent transition-colors"
                        onClick={() => selectProcessArea(pa)}
                      >
                        <div className="text-xs text-muted-foreground">Level {pa.level}</div>
                        <div className="text-sm">{pa.object_types.join(", ")}</div>
                        <div className="text-xs text-muted-foreground mt-1">{pa.activities.length} activities</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              {/* Object Types */}
              <div>
                <Label className="text-sm font-medium">Object Types</Label>
                <div className="mt-2 flex flex-wrap gap-1">
                  {processAreasData?.all_object_types.map((ot) => (
                    <Badge
                      key={ot}
                      variant={selectedObjectTypes.includes(ot) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleObjectType(ot)}
                    >
                      {ot}
                    </Badge>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Activities with relevance + orphan indicator */}
              <div>
                <Label className="text-sm font-medium">Activities</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-primary/60 mr-1"></span>
                  Relevant to selected object types
                  {orphanedActivities.size > 0 && (
                    <>
                      {" "}|{" "}
                      <span className="inline-block w-2 h-2 rounded-full bg-destructive/60 mr-1"></span>
                      Orphaned (no longer associated with any selected object type)
                    </>
                  )}
                </p>
                <div className="mt-2 flex flex-wrap gap-1 max-h-52 overflow-y-auto">
                  {processAreasData?.all_activities.map((act) => {
                    const isSelected = selectedActivities.includes(act);
                    const isRelevant = relevantActivities.has(act);
                    const isOrphaned = orphanedActivities.has(act);
                    return (
                      <Badge
                        key={act}
                        variant={isSelected ? "default" : "outline"}
                        className={`cursor-pointer ${
                          isOrphaned
                            ? "bg-destructive/80 hover:bg-destructive/60 text-destructive-foreground border-destructive"
                            : !isSelected && isRelevant
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : !isSelected && !isRelevant
                            ? "opacity-50"
                            : ""
                        }`}
                        onClick={() => toggleActivity(act)}
                      >
                        {act}
                      </Badge>
                    );
                  })}
                </div>
                <div className="flex gap-2 mt-2">
                  {selectedObjectTypes.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedActivities(Array.from(relevantActivities))}
                    >
                      Select all relevant
                    </Button>
                  )}
                  {orphanedActivities.size > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() =>
                        setSelectedActivities((prev) => prev.filter((a) => !orphanedActivities.has(a)))
                      }
                    >
                      Remove orphaned ({orphanedActivities.size})
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Right Column: Resources + Parameters */}
          <div className="space-y-6">
            {/* Resource Pool */}
            <Card>
              <CardHeader><CardTitle>Resource Pool</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(resourcePool).map(([resType, count]) => (
                  <div key={resType} className="flex items-center gap-2">
                    <span className="text-sm flex-1 min-w-0 truncate">{resType}</span>
                    <Input
                      type="number"
                      min={0}
                      value={count}
                      onChange={(e) => updateResourceCount(resType, parseInt(e.target.value) || 0)}
                      className="w-20"
                    />
                    <Button variant="ghost" size="sm" onClick={() => removeResourceType(resType)}>x</Button>
                  </div>
                ))}

                {resourceSuggestions.filter((ot) => !resourcePool[ot] && !selectedObjectTypes.includes(ot)).length > 0 && (
                  <div className="pt-2">
                    <Label className="text-xs text-muted-foreground">
                      Suggested (same/higher MLPA level):
                    </Label>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {resourceSuggestions
                        .filter((ot) => !resourcePool[ot] && !selectedObjectTypes.includes(ot))
                        .map((ot) => (
                          <Badge key={ot} variant="outline" className="cursor-pointer text-xs" onClick={() => addResourceType(ot)}>
                            + {ot}
                          </Badge>
                        ))}
                    </div>
                  </div>
                )}

                {processAreasData?.all_object_types
                  .filter((ot) => !resourcePool[ot] && !resourceSuggestions.includes(ot) && !selectedObjectTypes.includes(ot))
                  .length ? (
                  <div className="pt-2">
                    <Label className="text-xs text-muted-foreground">Other:</Label>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {processAreasData.all_object_types
                        .filter((ot) => !resourcePool[ot] && !resourceSuggestions.includes(ot) && !selectedObjectTypes.includes(ot))
                        .map((ot) => (
                          <Badge key={ot} variant="outline" className="cursor-pointer text-xs opacity-60" onClick={() => addResourceType(ot)}>
                            + {ot}
                          </Badge>
                        ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* Simulation Parameters */}
            <Card>
              <CardHeader><CardTitle>Simulation Parameters</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="tick-size">Tick size (seconds)</Label>
                  <Input id="tick-size" type="number" min={1} value={tickSize}
                    onChange={(e) => setTickSize(parseInt(e.target.value) || 60)} />
                </div>

                <div className="flex items-start gap-3">
                  <Switch id="model-durations" className="mt-1"
                    checked={modelActivityDurations}
                    onCheckedChange={setModelActivityDurations} />
                  <div>
                    <Label htmlFor="model-durations">Model activity durations</Label>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Delay each activity by inter-activity times learned from the log
                      so cycle times are realistic. Disable to fire activities
                      immediately (events collapse onto tick boundaries).
                    </p>
                  </div>
                </div>

                <div>
                  <Label>Constraint violation degree: {violationDegree.toFixed(2)}</Label>
                  <Slider value={[violationDegree]} onValueChange={([v]) => setViolationDegree(v)}
                    min={0} max={1} step={0.05} className="mt-2" />
                  <p className="text-xs text-muted-foreground mt-1">0 = strict, 1 = ignore all</p>
                </div>

                <div>
                  <Label htmlFor="lookback">Constraint lookback (empty = all events)</Label>
                  <Input id="lookback" type="number" min={1} placeholder="All events"
                    value={lookbackLength ?? ""}
                    onChange={(e) => setLookbackLength(e.target.value ? parseInt(e.target.value) : null)} />
                </div>

                <Separator />

                {/* Constraint Mining Configuration */}
                <div>
                  <Label className="text-sm font-medium">Constraint Mining</Label>
                  <p className="text-xs text-muted-foreground mt-1 mb-3">
                    Parameters for discovering resource constraints from the event log.
                    Variants below either frequency threshold use the pooled fallback pool.
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label htmlFor="support-threshold" className="text-xs">Support threshold</Label>
                      <Input id="support-threshold" type="number" min={0} max={1} step={0.05}
                        value={supportThreshold}
                        onChange={(e) => setSupportThreshold(parseFloat(e.target.value) || 0.8)}
                        className="mt-1" />
                      <p className="text-[10px] text-muted-foreground mt-0.5">Min relation consistency</p>
                    </div>
                    <div>
                      <Label className="text-xs">Variant frequency: {(minVariantFrequency * 100).toFixed(0)}%</Label>
                      <Slider value={[minVariantFrequency]} onValueChange={([v]) => setMinVariantFrequency(v)}
                        min={0} max={1} step={0.01} className="mt-3" />
                      <p className="text-[10px] text-muted-foreground mt-0.5">Min share of all cases</p>
                    </div>
                    <div>
                      <Label htmlFor="min-variant-exec" className="text-xs">Min executions</Label>
                      <Input id="min-variant-exec" type="number" min={1} step={1}
                        value={minVariantExecutions}
                        onChange={(e) => setMinVariantExecutions(parseInt(e.target.value) || 1)}
                        className="mt-1" />
                      <p className="text-[10px] text-muted-foreground mt-0.5">Min cases per variant</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            {detailsLoading && (
              <StepProgress steps={detailsProgress.steps} active={detailsProgress.current} />
            )}
            {mode === "simple" ? (
              <Button className="w-full" size="lg" disabled={!canLoadDetails || detailsLoading}
                onClick={handleLoadDetails}>
                {detailsLoading ? "Loading details..." : "Load Simulation Details"}
              </Button>
            ) : (
              <Button className="w-full" size="lg" disabled={!canRun} onClick={handleRunSimulation}>
                Run Advanced Simulation
              </Button>
            )}
            {detailsError && <p className="text-destructive text-sm">{detailsError}</p>}
            {simError && <p className="text-destructive text-sm">{simError}</p>}
          </div>
        </div>
      )}

      {/* Phase: Details (Simple mode) */}
      {phase === "details" && details && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground">
              {details.num_variants} variant(s) discovered. Review and adjust parameters below.
            </p>
            <Button size="lg" disabled={!canRun} onClick={handleRunSimulation}>
              Run Simulation
            </Button>
          </div>

          {/* Configuration Summary */}
            <Card>
              <CardHeader><CardTitle>Configuration Summary</CardTitle></CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Mode:</span>{" "}
                    <span className="font-medium">{mode === "simple" ? "Simple" : "Advanced"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Duration:</span>{" "}
                    <span className="font-medium">{simDurationDays} days</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Tick:</span>{" "}
                    <span className="font-medium">{tickSize}s</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Violation degree:</span>{" "}
                    <span className="font-medium">{violationDegree.toFixed(2)}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Object Types:</span>{" "}
                    <span className="font-medium">{selectedObjectTypes.join(", ")}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Resource Pool:</span>{" "}
                    <span className="font-medium">
                      {Object.entries(resourcePool).filter(([, c]) => c > 0).map(([t, c]) => `${t} (${c})`).join(", ") || "\u2014"}
                    </span>
                  </div>
                  <div className="col-span-2 md:col-span-4">
                    <span className="text-muted-foreground">Activities ({selectedActivities.length}):</span>{" "}
                    <span className="font-medium">{selectedActivities.join(", ")}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

          {/* Simulation Time */}
          <Card>
            <CardHeader><CardTitle>Simulation Time</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="sim-duration">Duration (days)</Label>
                  <Input id="sim-duration" type="number" min={1} value={simDurationDays}
                    onChange={(e) => setSimDurationDays(parseInt(e.target.value) || 7)} />
                  {details.log_duration_days != null && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Process-area log spans {details.log_duration_days} day
                      {details.log_duration_days === 1 ? "" : "s"}
                      {simDurationDays === details.log_duration_days ? " (matched)" : ""}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="sim-start">Simulation start (UTC)</Label>
                  <div className="flex items-center gap-2">
                    <Input id="sim-start" type="datetime-local"
                      value={simStartUnix != null ? unixToDatetimeLocal(simStartUnix) : ""}
                      onChange={(e) => setSimStartUnix(datetimeLocalToUnix(e.target.value))} />
                    {details.log_start_unix != null && (
                      <Button type="button" variant="outline" size="sm"
                        onClick={() => setSimStartUnix(details.log_start_unix)}>
                        Reset
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Both default to the filtered process-area log. Changing the start
                shifts the simulated timeline; absolute-time comparison metrics only
                stay meaningful when it overlaps the original log.
              </p>
            </CardContent>
          </Card>

          {/* Arrival Distribution Editor */}
          <CollapsibleSection title="Arrival Distribution" description={`${details.num_variants} variant(s), configure arrival rates`}>
            <ArrivalDistributionEditor
              variants={details.variants}
              onArrivalUpdate={(variantId, weekday, hour, value) => {
                setDetails((prev) => {
                  if (!prev) return prev;
                  const updated = { ...prev };
                  updated.variants = updated.variants.map((v) => {
                    if (v.id !== variantId) return v;
                    const arrival = { ...v.arrival_distribution };
                    const hourly = { ...(arrival.avg_arrivals_per_hour || {}) };
                    const dayData = { ...(hourly[weekday] || {}) };
                    dayData[hour.toString()] = value;
                    hourly[weekday] = dayData;
                    arrival.avg_arrivals_per_hour = hourly;
                    return { ...v, arrival_distribution: arrival };
                  });
                  return updated;
                });
              }}
            />
          </CollapsibleSection>

          {/* Resource Calendar */}
          <CollapsibleSection title="Resource Calendar" description="Type calendars + custom calendars for specific resources">
            <ResourceCalendarEditor
              resourcePool={resourcePool}
              typeCalendars={typeCalendars}
              discoveredTypeCalendars={discoveredTypeCalendars}
              overrides={calendarOverrides}
              onTypeCalendarUpdate={(resourceType, weekday, hours) => {
                setTypeCalendars((prev) => ({
                  ...prev,
                  [resourceType]: { ...prev[resourceType], [weekday]: hours },
                }));
              }}
              setOverrides={setCalendarOverrides}
            />
          </CollapsibleSection>

          {/* Cooldown Editor */}
          {Object.keys(cooldowns).length > 0 && (
            <CollapsibleSection title="Resource Cooldowns" description={`${Object.keys(cooldowns).length} activity cooldown(s)`}>
              <CooldownEditor
                cooldowns={cooldowns}
                onUpdate={(activity, resourceType, selectMin, selectMax) => {
                  setCooldowns((prev) => {
                    const updated = { ...prev };
                    updated[activity] = { ...updated[activity] };
                    updated[activity][resourceType] = {
                      ...updated[activity][resourceType],
                      select_min_s: selectMin,
                      select_max_s: selectMax,
                    };
                    return updated;
                  });
                }}
              />
            </CollapsibleSection>
          )}

          {/* Allocation Strategy */}
          {Object.keys(allocationStrategy).length > 0 && (
            <CollapsibleSection title="Resource Allocation Strategy" description="FIFO / LIFO / Random per resource type">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground mb-3">
                    How resources are assigned when multiple are available for an activity.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {Object.entries(allocationStrategy)
                      .filter(([resType]) => resourcePool[resType] && resourcePool[resType] > 0)
                      .sort(([a], [b]) => a.localeCompare(b)).map(([resType, strategy]) => (
                      <div key={resType} className="flex items-center gap-2">
                        <span className="text-sm flex-1 min-w-0 truncate">{resType}</span>
                        <select
                          className="text-xs border rounded px-2 py-1 bg-background"
                          value={strategy}
                          onChange={(e) => {
                            setAllocationStrategy((prev) => ({ ...prev, [resType]: e.target.value }));
                          }}
                        >
                          <option value="FIFO">FIFO</option>
                          <option value="LIFO">LIFO</option>
                          <option value="random">Random</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </CollapsibleSection>
          )}

          {/* Constraints Editor */}
          <CollapsibleSection title="Resource Constraints" description={`Per-variant + global activity constraints`}>
            <ConstraintsEditorPanel
              variants={details.variants}
              editedConstraints={editedConstraints}
              activities={selectedActivities}
              onAdd={addConstraint}
              onRemove={removeConstraint}
              globalConstraints={globalConstraints}
              onAddGlobal={(act1, act2, type) => {
                setGlobalConstraints((prev) => {
                  const updated = { ...prev };
                  if (!updated[act1]) updated[act1] = {};
                  updated[act1] = { ...updated[act1], [act2]: type };
                  return updated;
                });
              }}
              onRemoveGlobal={(act1, act2) => {
                setGlobalConstraints((prev) => {
                  const updated = { ...prev };
                  if (updated[act1]) {
                    const acts = { ...updated[act1] };
                    delete acts[act2];
                    if (Object.keys(acts).length === 0) delete updated[act1];
                    else updated[act1] = acts;
                  }
                  return updated;
                });
              }}
              fallbackConstraints={fallbackConstraints}
              onAddFallback={(act1, act2, type) => {
                setFallbackConstraints((prev) => {
                  const updated = { ...prev };
                  if (!updated[act1]) updated[act1] = {};
                  updated[act1] = { ...updated[act1], [act2]: type };
                  return updated;
                });
              }}
              onRemoveFallback={(act1, act2) => {
                setFallbackConstraints((prev) => {
                  const updated = { ...prev };
                  if (updated[act1]) {
                    const acts = { ...updated[act1] };
                    delete acts[act2];
                    if (Object.keys(acts).length === 0) delete updated[act1];
                    else updated[act1] = acts;
                  }
                  return updated;
                });
              }}
            />
          </CollapsibleSection>

          {/* Resource Distribution */}
          <CollapsibleSection title="Resource Distribution" description="Mean/min/max resource counts per activity" defaultOpen={false}>
            <Card>
              <CardContent className="pt-4 space-y-4">
                {details.variants.map((variant) => (
                  <div key={variant.id} className="border rounded p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline">Variant {variant.id + 1}</Badge>
                      <span className="text-xs text-muted-foreground">Support: {variant.support}</span>
                    </div>
                    {Object.keys(variant.resource_distribution).length > 0 ? (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-1">Activity</th>
                            <th className="text-left py-1">Resource Type</th>
                            <th className="text-right py-1">Mean</th>
                            <th className="text-left py-1">Count Distribution</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(variant.resource_distribution).map(([act, resTypes]) =>
                            Object.entries(resTypes).map(([resType, stats], idx) => {
                              const dist = stats.count_distribution ?? {};
                              const entries = Object.entries(dist)
                                .map(([count, prob]) => [Number(count), prob] as [number, number])
                                .sort((a, b) => a[0] - b[0]);
                              const mean = entries.reduce((s, [count, prob]) => s + count * prob, 0);
                              return (
                                <tr key={`${act}-${resType}`} className="border-b last:border-0">
                                  {idx === 0 && (
                                    <td className="py-1 font-medium" rowSpan={Object.keys(resTypes).length}>{act}</td>
                                  )}
                                  <td className="py-1">{resType}</td>
                                  <td className="text-right py-1">{mean.toFixed(2)}</td>
                                  <td className="py-1">
                                    {entries
                                      .map(([count, prob]) => `${count}: ${(prob * 100).toFixed(0)}%`)
                                      .join(" · ")}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-xs text-muted-foreground">No resource data</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </CollapsibleSection>

          {/* Run button at bottom */}
          <Button className="w-full" size="lg" disabled={!canRun} onClick={handleRunSimulation}>
            Run Simulation
          </Button>
          {simError && <p className="text-destructive text-sm">{simError}</p>}
        </div>
      )}

      {/* Phase: Running */}
      {phase === "running" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="py-8 flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
              <p className="text-muted-foreground font-medium">Simulation running...</p>
              <p className="text-xs text-muted-foreground">
                Mode: {mode} | Duration: {simDurationDays} days | Tick: {tickSize}s
              </p>
            </CardContent>
          </Card>
          <StepProgress
            steps={runProgress.steps}
            active={runProgress.current}
            percent={runProgress.percent}
          />
        </div>
      )}

      {/* Phase: Results */}
      {phase === "results" && result && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Simulation Results</h2>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPhase("details")}>
                Back to Details
              </Button>
              <Button onClick={handleRunSimulation}>
                Re-run Simulation
              </Button>
            </div>
          </div>

          {/* Keep / download the simulated event log */}
          <SimulatedLogCard simRunId={result.sim_run_id} filename={result.simulated_filename} />

          <SimulationResults result={result} />
        </>
      )}
    </div>
  );
};

// Lets the user download the simulated log or keep it as an event log. The
// simulated run is held server-side as a temp file and only persisted into the
// user's event log collection when they explicitly keep it here.
const SimulatedLogCard: React.FC<{ simRunId?: string; filename?: string }> = ({
  simRunId,
  filename,
}) => {
  const { setSelectedFile } = useContext(SelectedFileContext);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!simRunId) return null;
  const displayName = filename || "simulated_log.json";

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadSimulatedLog(simRunId, displayName);
    } catch (err) {
      toast.error("Download failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleKeep = async () => {
    setSaving(true);
    try {
      const savedFile = await saveSimulatedLog(simRunId);
      setSaved(true);
      setSelectedFile(savedFile);
      toast.success("Simulated log added to your event logs", {
        description: savedFile.file.split("/").pop(),
      });
    } catch (err) {
      toast.error("Could not keep simulated log", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="py-3 flex items-center justify-between">
        <div className="text-sm">
          <span className="text-muted-foreground">Simulated event log: </span>
          <span className="font-medium">{displayName}</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            {saved
              ? "Added to your event logs."
              : "Not added to your event logs yet — keep it to use it for further analysis."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={downloading} onClick={handleDownload}>
            Download OCEL 2.0 JSON
          </Button>
          <Button size="sm" disabled={saving || saved} onClick={handleKeep}>
            {saved ? "Kept as Event Log" : saving ? "Saving…" : "Keep as Event Log"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

// Secondary line on a summary card comparing the simulated figure against the
// matching value from the original (filtered) log.
const OriginalComparison: React.FC<{ simulated: number; original?: number }> = ({
  simulated,
  original,
}) => {
  if (original == null) return null;
  const diff = simulated - original;
  const sign = diff > 0 ? "+" : "";
  return (
    <p className="text-xs text-muted-foreground mt-1">
      Original: {original.toLocaleString()}
      {diff !== 0 && (
        <span className={diff > 0 ? "text-amber-600" : "text-sky-600"}>
          {" "}({sign}
          {diff.toLocaleString()})
        </span>
      )}
    </p>
  );
};

// --- Results sub-component ---
const SimulationResults: React.FC<{ result: SimulationResult }> = ({ result }) => {
  // Comparison values from the original (filtered) log
  const counts = result.evaluation?.counts ?? [];
  const originalExecutions = counts.find((c) => c.metric === "n_executions")?.actual;
  const originalEvents = counts.find((c) => c.metric === "n_events")?.actual;
  const originalObjects = result.evaluation?.object_centric.object_counts.reduce(
    (sum, o) => sum + o.actual,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold">
              {result.finished_instances}
              {result.spawned_instances != null && (
                <span className="text-xl text-muted-foreground">
                  {" "}/ {result.spawned_instances}
                </span>
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              Finished Instances
              {result.completion_ratio != null &&
                ` (${(result.completion_ratio * 100).toFixed(1)}%)`}
            </p>
            <OriginalComparison
              simulated={result.finished_instances}
              original={originalExecutions}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold">{result.simulated_events}</p>
            <p className="text-sm text-muted-foreground">Simulated Events</p>
            <OriginalComparison simulated={result.simulated_events} original={originalEvents} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold">{result.simulated_objects}</p>
            <p className="text-sm text-muted-foreground">Simulated Objects</p>
            <OriginalComparison simulated={result.simulated_objects} original={originalObjects} />
          </CardContent>
        </Card>
      </div>

      {/* Multi-perspective evaluation (Chapela-Campa BPM 2023 + OC extras) */}
      {result.evaluation && <EvaluationMetricsCard metrics={result.evaluation} simRunId={result.sim_run_id} />}
      {result.evaluation_error && (
        <Card>
          <CardContent className="pt-4 text-sm text-destructive">
            Failed to compute evaluation metrics: {result.evaluation_error}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

// --- Evaluation metrics card ---

const fmt = (v: number, digits = 3) =>
  Number.isFinite(v) ? v.toFixed(digits) : "—";

const fmtSeconds = (s: number) => {
  if (!Number.isFinite(s)) return "—";
  if (s < 60) return `${s.toFixed(1)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(2)}h`;
  return `${(s / 86400).toFixed(2)}d`;
};

const MetricRow: React.FC<{ name: string; value: number | null; hint?: string }> = ({
  name,
  value,
  hint,
}) => (
  <div className="flex items-baseline justify-between gap-3 border-b last:border-0 py-1.5">
    <div className="flex flex-col min-w-0">
      <span className="text-sm font-medium truncate">{name}</span>
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </div>
    <span className="font-mono text-sm">
      {value === null || value === undefined ? "—" : fmt(value)}
    </span>
  </div>
);

const COUNT_LABELS: Record<string, string> = {
  n_executions: "Executions",
  n_events: "Events",
  n_variants: "Variants",
  avg_events_per_execution: "Avg. events / execution",
  avg_events_per_variant: "Avg. events / variant",
  avg_executions_per_variant: "Avg. executions / variant",
};

type GedState = { status: "loading" | "done" | "error"; value: number | null; error?: string };

const EvaluationMetricsCard: React.FC<{ metrics: PaperEvaluationResult; simRunId?: string }> = ({ metrics, simRunId }) => {
  const { counts, control_flow, temporal, congestion, object_centric, resources, runtime } = metrics;

  // The Graph Edit Distance is expensive (tens of seconds), so it is fetched
  // lazily after the cheap metrics are already on screen.
  const [ged, setGed] = useState<GedState>({ status: "loading", value: null });
  useEffect(() => {
    if (!simRunId) {
      setGed({ status: "error", value: null, error: "no run id" });
      return;
    }
    let cancelled = false;
    setGed({ status: "loading", value: null });
    fetchGraphEditDistance(simRunId)
      .then((v) => !cancelled && setGed({ status: "done", value: v }))
      .catch((e) => !cancelled && setGed({ status: "error", value: null, error: String(e?.message ?? e) }));
    return () => {
      cancelled = true;
    };
  }, [simRunId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evaluation Metrics</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Multi-perspective distance between actual log and simulation. Lower = better match.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Counts & sizes */}
        {counts.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2">Counts &amp; Sizes</h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1">Metric</th>
                  <th className="text-right py-1">Actual</th>
                  <th className="text-right py-1">Simulated</th>
                  <th className="text-right py-1">|Δ|</th>
                  <th className="text-right py-1">Rel. Δ</th>
                </tr>
              </thead>
              <tbody>
                {counts.map((c) => (
                  <tr key={c.metric} className="border-b last:border-0">
                    <td className="py-1 font-medium">{COUNT_LABELS[c.metric] ?? c.metric}</td>
                    <td className="text-right py-1 font-mono">{fmt(c.actual, 2)}</td>
                    <td className="text-right py-1 font-mono">{fmt(c.simulated, 2)}</td>
                    <td className="text-right py-1 font-mono">{fmt(c.abs_diff, 2)}</td>
                    <td className="text-right py-1 font-mono">
                      {c.rel_diff === null ? "—" : (c.rel_diff * 100).toFixed(1) + "%"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Control flow */}
        <div>
          <h4 className="text-sm font-semibold mb-2">Control Flow</h4>
          <MetricRow
            name="N-Gram Distance absolute (n=2)"
            value={control_flow.n_gram_distance_absolute}
            hint="[0, 1] — sum of |freq diffs| of 2-grams, count-normalized"
          />
          <MetricRow
            name="N-Gram Distance relative (n=2)"
            value={control_flow.n_gram_distance_relative}
            hint="[0, 1] — sum of |relative freq diffs| of 2-grams"
          />
        </div>

        {/* Temporal */}
        <div>
          <h4 className="text-sm font-semibold mb-2">Temporal Performance</h4>
          <MetricRow
            name="Absolute Event Distribution"
            value={temporal.absolute_event_distribution}
            hint="Scaled EMD over (date, hour) — trend"
          />
          <MetricRow
            name="Circadian Event Distribution"
            value={temporal.circadian_event_distribution}
            hint="Avg. scaled EMD per weekday × hour — seasonality"
          />
          <MetricRow
            name="Relative Event Distribution"
            value={temporal.relative_event_distribution}
            hint="Scaled EMD relative to case start"
          />
        </div>

        {/* Congestion */}
        <div>
          <h4 className="text-sm font-semibold mb-2">Congestion</h4>
          <MetricRow
            name="Cycle Time Distribution"
            value={congestion.cycle_time_distribution}
            hint="EMD on hourly cycle-time histogram (hours)"
          />
          <MetricRow
            name="Inter-Arrival Time Distribution"
            value={congestion.interarrival_time_distribution}
            hint="EMD on gaps between consecutive arrivals (hours)"
          />
          <MetricRow
            name="Execution Arrival Rate"
            value={congestion.execution_arrival_rate}
            hint="Wasserstein on hourly arrival counts (timing only)"
          />
          <MetricRow
            name="Execution Arrival Count"
            value={congestion.execution_arrival_count}
            hint="L1 of hourly arrival histograms (count-preserving)"
          />
          <MetricRow
            name="Variant Arrival Distribution"
            value={congestion.variant_arrival_distribution}
            hint="Support-weighted EMD per variant arrivals (timing only)"
          />
          <MetricRow
            name="Variant Arrival Count"
            value={congestion.variant_arrival_count}
            hint="L1 of per-variant arrival histograms (count-preserving)"
          />
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div className="p-2 bg-muted rounded">
              <div className="text-[10px] text-muted-foreground uppercase">Cycle time — actual</div>
              <div className="font-mono mt-1">
                mean: {fmtSeconds(congestion.cycle_time_actual.mean_s)} ·
                std: {fmtSeconds(congestion.cycle_time_actual.std_s)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                n={congestion.cycle_time_actual.count}
              </div>
            </div>
            <div className="p-2 bg-muted rounded">
              <div className="text-[10px] text-muted-foreground uppercase">Cycle time — simulated</div>
              <div className="font-mono mt-1">
                mean: {fmtSeconds(congestion.cycle_time_simulated.mean_s)} ·
                std: {fmtSeconds(congestion.cycle_time_simulated.std_s)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                n={congestion.cycle_time_simulated.count}
              </div>
            </div>
          </div>
        </div>

        {/* Object-centric */}
        <div>
          <h4 className="text-sm font-semibold mb-2">Object-Centric</h4>

          {object_centric.object_counts.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground mb-1">Object counts per type</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-1">Type</th>
                    <th className="text-right py-1">Actual</th>
                    <th className="text-right py-1">Simulated</th>
                    <th className="text-right py-1">|Δ|</th>
                  </tr>
                </thead>
                <tbody>
                  {object_centric.object_counts.map((c) => (
                    <tr key={c.type} className="border-b last:border-0">
                      <td className="py-1 font-medium">{c.type}</td>
                      <td className="text-right py-1 font-mono">{c.actual}</td>
                      <td className="text-right py-1 font-mono">{c.simulated}</td>
                      <td className="text-right py-1 font-mono">{c.abs_diff}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {object_centric.lifecycle.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground mb-1">
                Object lifecycle distance (EMD)
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-1">Type</th>
                    <th className="text-right py-1">#Events EMD</th>
                    <th className="text-right py-1">Time EMD</th>
                  </tr>
                </thead>
                <tbody>
                  {object_centric.lifecycle.map((l) => (
                    <tr key={l.type} className="border-b last:border-0">
                      <td className="py-1 font-medium">{l.type}</td>
                      <td className="text-right py-1 font-mono">{fmt(l.length_emd, 2)}</td>
                      <td className="text-right py-1 font-mono">
                        {fmtSeconds(l.time_s_emd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {object_centric.cardinality.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground mb-1">
                Cardinality distance per object-type pair (anchor → related, EMD; only non-zero)
              </p>
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b">
                      <th className="text-left py-1">Anchor</th>
                      <th className="text-left py-1">Related</th>
                      <th className="text-right py-1">EMD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {object_centric.cardinality.slice(0, 25).map((c, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1">{c.anchor}</td>
                        <td className="py-1">{c.related}</td>
                        <td className="text-right py-1 font-mono">{fmt(c.emd, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-baseline justify-between gap-3 border-b last:border-0 py-1.5">
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium truncate">Object Graph Edit Distance</span>
              <span className="text-[10px] text-muted-foreground">
                {ged.status === "error"
                  ? `Support-weighted GED across variant graphs — ${ged.error}`
                  : "Support-weighted GED across variant graphs (computed lazily)"}
              </span>
            </div>
            <span className="font-mono text-sm">
              {ged.status === "loading" ? (
                <span className="text-muted-foreground">computing…</span>
              ) : ged.status === "done" && ged.value !== null ? (
                fmt(ged.value)
              ) : (
                "—"
              )}
            </span>
          </div>
        </div>

        {/* Resources */}
        {resources.per_type.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2">Resources</h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1">Type</th>
                  <th className="text-right py-1">#Resources A/S</th>
                  <th className="text-right py-1">#Events A/S</th>
                  <th className="text-right py-1">Events EMD</th>
                  <th className="text-right py-1">Util A/S</th>
                </tr>
              </thead>
              <tbody>
                {resources.per_type.map((r) => (
                  <tr key={r.type} className="border-b last:border-0">
                    <td className="py-1 font-medium">{r.type}</td>
                    <td className="text-right py-1 font-mono">
                      {r.n_actual} / {r.n_simulated}
                    </td>
                    <td className="text-right py-1 font-mono">
                      {r.events_actual} / {r.events_simulated}
                    </td>
                    <td className="text-right py-1 font-mono">{fmt(r.events_per_resource_emd, 2)}</td>
                    <td className="text-right py-1 font-mono">
                      {r.mean_utilization_actual === null
                        ? "—"
                        : (r.mean_utilization_actual * 100).toFixed(1) + "%"}{" "}
                      /{" "}
                      {r.mean_utilization_simulated === null
                        ? "—"
                        : (r.mean_utilization_simulated * 100).toFixed(1) + "%"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-muted-foreground mt-2">
              Util = busy_time / observation_window. Busy time is estimated from the discovered
              resource cooldowns; "—" means no cooldown info available.
            </p>
          </div>
        )}

        {/* Runtime */}
        <div>
          <h4 className="text-sm font-semibold mb-2">Runtime</h4>
          <div className="p-2 bg-muted rounded flex justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Simulation</span>
            <span className="font-mono">{fmtSeconds(runtime.simulation_s)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default SimulationDashboard;
