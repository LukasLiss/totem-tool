import React, { useState, useEffect, useContext, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import {
  fetchProcessAreas,
  fetchSimulationDetails,
  runSimulation,
  ProcessAreaInfo,
  ProcessAreasResponse,
  SimulationConfig,
  SimulationResult,
  SimulationDetailsResponse,
  SimulationMode,
  VariantConstraints,
  CalendarProbability,
  CooldownDistribution,
  AllocationStrategy,
} from "@/api/simulationApi";
import { ArrivalDistributionEditor } from "@/components/simulation/ArrivalDistributionEditor";
import { ResourceCalendarEditor } from "@/components/simulation/ResourceCalendarEditor";
import { ConstraintsEditorPanel } from "@/components/simulation/ConstraintsEditor";
import { CooldownEditor } from "@/components/simulation/CooldownEditor";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// Frontend cache for process areas data per file
const processAreasCache: Record<number, ProcessAreasResponse> = {};
const simulationDetailsCache: Record<string, SimulationDetailsResponse> = {};

type Phase = "configure" | "details" | "running" | "results";

export const SimulationDashboard: React.FC = () => {
  const { selectedFile, setSelectedFile } = useContext(SelectedFileContext);
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
  const [violationDegree, setViolationDegree] = useState(0.0);
  const [lookbackLength, setLookbackLength] = useState<number | null>(null);

  // Constraint mining config
  const [supportThreshold, setSupportThreshold] = useState(0.8);
  const [minOccurrencesWithin, setMinOccurrencesWithin] = useState(5);
  const [minOccurrencesAcross, setMinOccurrencesAcross] = useState(10);

  // Simulation details (variants, arrivals, constraints)
  const [details, setDetails] = useState<SimulationDetailsResponse | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");

  // Editable constraints
  const [editedConstraints, setEditedConstraints] = useState<Record<number, VariantConstraints>>({});

  // Resource calendars (from details response)
  const [typeCalendars, setTypeCalendars] = useState<Record<string, CalendarProbability>>({});
  const [resourceCalendars, setResourceCalendars] = useState<Record<string, CalendarProbability>>({});

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
    setTypeCalendars({});
    setResourceCalendars({});
    setCooldowns({});
    setAllocationStrategy({});
    setPhase("configure");
  }, [fileId]);

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
    const pool: Record<string, number> = {};
    if (processAreasData?.process_areas) {
      for (const otherPa of processAreasData.process_areas) {
        if (otherPa.level >= pa.level) {
          for (const ot of otherPa.object_types) {
            if (!pa.object_types.includes(ot)) {
              pool[ot] = 3;
            }
          }
        }
      }
    }
    setResourcePool(pool);
  };

  const toggleObjectType = (ot: string) => {
    setSelectedObjectTypes((prev) =>
      prev.includes(ot) ? prev.filter((t) => t !== ot) : [...prev, ot]
    );
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
      setResourcePool((prev) => ({ ...prev, [resType]: 3 }));
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
    const cacheKey = `${fileId}_${[...selectedObjectTypes].sort().join(",")}_${[...selectedActivities].sort().join(",")}_${resourceTypes.sort().join(",")}_${supportThreshold}_${minOccurrencesWithin}_${minOccurrencesAcross}`;

    setDetailsLoading(true);
    setDetailsError("");

    try {
      let data: SimulationDetailsResponse;
      if (simulationDetailsCache[cacheKey]) {
        data = simulationDetailsCache[cacheKey];
      } else {
        data = await fetchSimulationDetails({
          file_id: fileId,
          object_types: selectedObjectTypes,
          activities: selectedActivities,
          resource_types: resourceTypes.length > 0 ? resourceTypes : undefined,
          support_threshold: supportThreshold,
          min_occurrences_within: minOccurrencesWithin,
          min_occurrences_across: minOccurrencesAcross,
        });
        if (fileIdRef.current !== fileId) return;
        simulationDetailsCache[cacheKey] = data;
      }

      setDetails(data);

      // Initialize editable constraints from variants
      const initialConstraints: Record<number, VariantConstraints> = {};
      data.variants.forEach((v) => {
        initialConstraints[v.id] = { ...v.constraints };
      });
      setEditedConstraints(initialConstraints);

      // Initialize calendars for all pool types, using discovered data or defaults
      const defaultWeekdayHours = Array.from({ length: 24 }, (_, h) => (h >= 8 && h < 17 ? 1 : 0));
      const defaultWeekendHours = Array(24).fill(0);
      const mergedTypeCalendars: Record<string, CalendarProbability> = {};
      for (const rt of resourceTypes) {
        if (data.type_calendars?.[rt]) {
          mergedTypeCalendars[rt] = data.type_calendars[rt];
        } else {
          mergedTypeCalendars[rt] = {
            Monday: [...defaultWeekdayHours], Tuesday: [...defaultWeekdayHours],
            Wednesday: [...defaultWeekdayHours], Thursday: [...defaultWeekdayHours],
            Friday: [...defaultWeekdayHours], Saturday: [...defaultWeekendHours],
            Sunday: [...defaultWeekendHours],
          };
        }
      }
      setTypeCalendars(mergedTypeCalendars);
      setResourceCalendars(data.resource_calendars || {});

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
  const addConstraint = (variantId: number, act1: string, act2: string, type: string) => {
    setEditedConstraints((prev) => {
      const varConstraints = { ...prev[variantId] };
      if (!varConstraints[act1]) varConstraints[act1] = {};
      varConstraints[act1] = { ...varConstraints[act1], [act2]: type };
      return { ...prev, [variantId]: varConstraints };
    });
  };

  const removeConstraint = (variantId: number, act1: string, act2: string) => {
    setEditedConstraints((prev) => {
      const varConstraints = { ...prev[variantId] };
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

    const config: SimulationConfig = {
      file_id: fileId,
      object_types: selectedObjectTypes,
      activities: selectedActivities,
      resource_pool: resourcePool,
      sim_duration_days: simDurationDays,
      tick_size_s: tickSize,
      resource_constraint_violation_degree: violationDegree,
      constraint_lookback_length: lookbackLength,
      mode,
    };

    try {
      const res = await runSimulation(config);
      if (fileIdRef.current !== fileId) return;
      setResult(res);
      setPhase("results");
    } catch (err: any) {
      if (fileIdRef.current !== fileId) return;
      setSimError(err.message || "Simulation failed");
      setPhase("details");
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

                {resourceSuggestions.filter((ot) => !resourcePool[ot]).length > 0 && (
                  <div className="pt-2">
                    <Label className="text-xs text-muted-foreground">
                      Suggested (same/higher MLPA level, not selected):
                    </Label>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {resourceSuggestions
                        .filter((ot) => !resourcePool[ot])
                        .map((ot) => (
                          <Badge key={ot} variant="outline" className="cursor-pointer text-xs" onClick={() => addResourceType(ot)}>
                            + {ot}
                          </Badge>
                        ))}
                    </div>
                  </div>
                )}

                {processAreasData?.all_object_types
                  .filter((ot) => !resourcePool[ot] && !resourceSuggestions.includes(ot))
                  .length ? (
                  <div className="pt-2">
                    <Label className="text-xs text-muted-foreground">Other:</Label>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {processAreasData.all_object_types
                        .filter((ot) => !resourcePool[ot] && !resourceSuggestions.includes(ot))
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
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="sim-duration">Duration (days)</Label>
                    <Input id="sim-duration" type="number" min={1} value={simDurationDays}
                      onChange={(e) => setSimDurationDays(parseInt(e.target.value) || 7)} />
                  </div>
                  <div>
                    <Label htmlFor="tick-size">Tick size (seconds)</Label>
                    <Input id="tick-size" type="number" min={1} value={tickSize}
                      onChange={(e) => setTickSize(parseInt(e.target.value) || 60)} />
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
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label htmlFor="support-threshold" className="text-xs">Support threshold</Label>
                      <Input id="support-threshold" type="number" min={0} max={1} step={0.05}
                        value={supportThreshold}
                        onChange={(e) => setSupportThreshold(parseFloat(e.target.value) || 0.8)}
                        className="mt-1" />
                      <p className="text-[10px] text-muted-foreground mt-0.5">Min fraction of cases</p>
                    </div>
                    <div>
                      <Label htmlFor="min-occ-within" className="text-xs">Min occ. within</Label>
                      <Input id="min-occ-within" type="number" min={1} step={1}
                        value={minOccurrencesWithin}
                        onChange={(e) => setMinOccurrencesWithin(parseInt(e.target.value) || 5)}
                        className="mt-1" />
                      <p className="text-[10px] text-muted-foreground mt-0.5">Within a single case</p>
                    </div>
                    <div>
                      <Label htmlFor="min-occ-across" className="text-xs">Min occ. across</Label>
                      <Input id="min-occ-across" type="number" min={1} step={1}
                        value={minOccurrencesAcross}
                        onChange={(e) => setMinOccurrencesAcross(parseInt(e.target.value) || 10)}
                        className="mt-1" />
                      <p className="text-[10px] text-muted-foreground mt-0.5">Across all cases</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Action Buttons */}
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
            <CardHeader className="pb-2"><CardTitle className="text-sm">Configuration Summary</CardTitle></CardHeader>
            <CardContent>
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
                    {Object.entries(resourcePool).filter(([, c]) => c > 0).map(([t, c]) => `${t} (${c})`).join(", ") || "—"}
                  </span>
                </div>
                <div className="col-span-2 md:col-span-4">
                  <span className="text-muted-foreground">Activities ({selectedActivities.length}):</span>{" "}
                  <span className="font-medium">{selectedActivities.join(", ")}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Arrival Distribution Editor */}
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

          {/* Resource Calendar */}
          <ResourceCalendarEditor
            resourcePool={resourcePool}
            typeCalendars={typeCalendars}
            resourceCalendars={resourceCalendars}
            onTypeCalendarUpdate={(resourceType, weekday, hours) => {
              setTypeCalendars((prev) => ({
                ...prev,
                [resourceType]: { ...prev[resourceType], [weekday]: hours },
              }));
            }}
            onResourceCalendarUpdate={(resourceId, weekday, hours) => {
              setResourceCalendars((prev) => ({
                ...prev,
                [resourceId]: { ...prev[resourceId], [weekday]: hours },
              }));
            }}
          />

          {/* Cooldown Editor */}
          {Object.keys(cooldowns).length > 0 && (
            <CooldownEditor
              cooldowns={cooldowns}
              onUpdate={(activity, resourceType, meanDuration, stdDuration) => {
                setCooldowns((prev) => {
                  const updated = { ...prev };
                  updated[activity] = { ...updated[activity] };
                  updated[activity][resourceType] = {
                    ...updated[activity][resourceType],
                    mean_duration_s: meanDuration,
                    std_duration_s: stdDuration,
                  };
                  return updated;
                });
              }}
            />
          )}

          {/* Allocation Strategy */}
          {Object.keys(allocationStrategy).length > 0 && (
            <Card>
              <CardHeader><CardTitle>Resource Allocation Strategy</CardTitle></CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3">
                  How resources are assigned when multiple are available for an activity.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {Object.entries(allocationStrategy).sort(([a], [b]) => a.localeCompare(b)).map(([resType, strategy]) => (
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
          )}

          {/* Constraints Editor */}
          <ConstraintsEditorPanel
            variants={details.variants}
            editedConstraints={editedConstraints}
            activities={selectedActivities}
            onAdd={addConstraint}
            onRemove={removeConstraint}
          />

          {/* Resource Distribution - Collapsible */}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-start text-muted-foreground">
                + Additional Information (Resource Distribution per Activity)
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Card className="mt-2">
                <CardHeader><CardTitle className="text-sm">Resource Distribution per Activity</CardTitle></CardHeader>
                <CardContent className="space-y-4">
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
                              <th className="text-right py-1">Min</th>
                              <th className="text-right py-1">Max</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(variant.resource_distribution).map(([act, resTypes]) =>
                              Object.entries(resTypes).map(([resType, stats], idx) => (
                                <tr key={`${act}-${resType}`} className="border-b last:border-0">
                                  {idx === 0 && (
                                    <td className="py-1 font-medium" rowSpan={Object.keys(resTypes).length}>{act}</td>
                                  )}
                                  <td className="py-1">{resType}</td>
                                  <td className="text-right py-1">{stats.mean_count.toFixed(2)}</td>
                                  <td className="text-right py-1">{stats.min_count}</td>
                                  <td className="text-right py-1">{stats.max_count}</td>
                                </tr>
                              ))
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
            </CollapsibleContent>
          </Collapsible>

          {/* Run button at bottom */}
          <Button className="w-full" size="lg" disabled={!canRun} onClick={handleRunSimulation}>
            Run Simulation
          </Button>
          {simError && <p className="text-destructive text-sm">{simError}</p>}
        </div>
      )}

      {/* Phase: Running */}
      {phase === "running" && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="text-muted-foreground">Simulation running...</p>
            <p className="text-xs text-muted-foreground">
              Mode: {mode} | Duration: {simDurationDays} days | Tick: {tickSize}s
            </p>
          </CardContent>
        </Card>
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

          {/* Switch to simulated event log */}
          {result.simulated_file && (
            <Card>
              <CardContent className="py-3 flex items-center justify-between">
                <div className="text-sm">
                  <span className="text-muted-foreground">Simulated event log saved: </span>
                  <span className="font-medium">{result.simulated_file.file.split("/").pop()}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedFile(result.simulated_file);
                  }}
                >
                  Open as Event Log
                </Button>
              </CardContent>
            </Card>
          )}

          <SimulationResults result={result} />
        </>
      )}
    </div>
  );
};

// --- Results sub-component ---
const SimulationResults: React.FC<{ result: SimulationResult }> = ({ result }) => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardContent className="pt-6 text-center">
          <p className="text-3xl font-bold">{result.finished_instances}</p>
          <p className="text-sm text-muted-foreground">Finished Instances</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6 text-center">
          <p className="text-3xl font-bold">{result.simulated_events}</p>
          <p className="text-sm text-muted-foreground">Simulated Events</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6 text-center">
          <p className="text-3xl font-bold">{result.simulated_objects}</p>
          <p className="text-sm text-muted-foreground">Simulated Objects</p>
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader><CardTitle>Event Comparison</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center p-4 bg-muted rounded">
            <p className="text-2xl font-bold">{result.evaluation.event_count.original}</p>
            <p className="text-sm text-muted-foreground">Original</p>
          </div>
          <div className="text-center p-4 bg-muted rounded">
            <p className="text-2xl font-bold">{result.evaluation.event_count.simulated}</p>
            <p className="text-sm text-muted-foreground">Simulated</p>
          </div>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Activity Frequencies (normalized)</CardTitle></CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-4">Activity</th>
              <th className="text-right py-2 px-2">Original</th>
              <th className="text-right py-2 px-2">Simulated</th>
              <th className="text-right py-2 pl-2">Diff</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(result.evaluation.activity_frequencies).map(([act, vals]) => (
              <tr key={act} className="border-b last:border-0">
                <td className="py-1.5 pr-4 font-medium">{act}</td>
                <td className="text-right py-1.5 px-2">{vals.original.toFixed(4)}</td>
                <td className="text-right py-1.5 px-2">{vals.simulated.toFixed(4)}</td>
                <td className="text-right py-1.5 pl-2">
                  <span className={vals.diff > 0.05 ? "text-destructive" : vals.diff > 0.02 ? "text-yellow-600" : "text-green-600"}>
                    {vals.diff.toFixed(4)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Object Type Counts</CardTitle></CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-4">Object Type</th>
              <th className="text-right py-2 px-2">Original</th>
              <th className="text-right py-2 pl-2">Simulated</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(result.evaluation.object_type_counts).map(([ot, vals]) => (
              <tr key={ot} className="border-b last:border-0">
                <td className="py-1.5 pr-4 font-medium">{ot}</td>
                <td className="text-right py-1.5 px-2">{vals.original}</td>
                <td className="text-right py-1.5 pl-2">{vals.simulated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Variants</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center p-3 bg-muted rounded">
            <p className="text-xl font-bold">{result.evaluation.variants.original_count}</p>
            <p className="text-xs text-muted-foreground">Original</p>
          </div>
          <div className="text-center p-3 bg-muted rounded">
            <p className="text-xl font-bold">{result.evaluation.variants.simulated_count}</p>
            <p className="text-xs text-muted-foreground">Simulated</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <p className="text-muted-foreground mb-1">Original (Top 10)</p>
            {result.evaluation.variants.original_frequencies.slice(0, 10).map((f, i) => (
              <div key={i} className="flex justify-between">
                <span>Variant {i + 1}</span><span>{(f * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
          <div>
            <p className="text-muted-foreground mb-1">Simulated (Top 10)</p>
            {result.evaluation.variants.simulated_frequencies.slice(0, 10).map((f, i) => (
              <div key={i} className="flex justify-between">
                <span>Variant {i + 1}</span><span>{(f * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
);

export default SimulationDashboard;
