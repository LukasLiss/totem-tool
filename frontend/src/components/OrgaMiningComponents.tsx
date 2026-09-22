/**
 * Dashboard widgets for the organizational mining explorers.
 *
 * Edit mode shows a settings card with two dashboard-level switches — whether
 * the explorer's own settings panel is visible in the dashboard's view mode,
 * and whether the computation starts automatically — followed by the
 * preselected settings the explorer opens with. View mode hosts the explorer
 * itself. All settings persist through the layout (see `OCHandoverComponent`
 * and `ResourceProfilingComponent` on the backend).
 */
import React, { useEffect, useState } from "react";
import type { GridStackNode } from "gridstack";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GlobalFilterToggle } from "@/components/ui/GlobalFilterToggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import OCHandoverExplorer from "@/react_component/OCHandoverExplorer";
import OrgaMiningExplorer from "@/react_component/OrgaMiningExplorer";
import {
  BUSINESS_OBJECT_FEATURE_GROUPS,
  FEATURE_GROUP_OPTIONS,
  HANDOVER_METHODS,
  HANDOVER_METHOD_LABELS,
  HANDOVER_NORMALIZATIONS,
  HANDOVER_VIEW_MODES,
  NORMALIZATION_LABELS,
  PROFILING_CLUSTER_METHODS,
  PROFILING_CLUSTER_METHOD_LABELS,
  PROFILING_DISTANCE_METRICS,
  PROFILING_DISTANCE_METRIC_LABELS,
  PROFILING_VIEW_MODES,
  handoverSettingsFromNode,
  handoverSettingsToNode,
  profilingSettingsFromNode,
  profilingSettingsToNode,
  type FeatureGroup,
  type HandoverSettings,
  type ResourceProfilingSettings,
} from "@/react_component/orgamining/settings";
import { MultiSelectPopover } from "@/react_component/variants/MultiSelectPopover";
import { fetchObjectTypes } from "@/react_component/variants/variantsApi";

import type { ComponentProps } from "./componentMap";

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** Object types of the selected log, loaded only while the edit form is open. */
function useObjectTypes(fileId: number | undefined, enabled: boolean) {
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled || !fileId) return;
    let cancelled = false;
    setLoading(true);
    fetchObjectTypes(fileId)
      .then((result) => { if (!cancelled) setTypes(result); })
      .catch(() => { if (!cancelled) toast.error("Object types could not be loaded"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fileId, enabled]);
  return { types, loading };
}

function SettingRow({ label, htmlFor, hint, children }: {
  label: string; htmlFor?: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={htmlFor}>{label}</Label>
        {children}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ChoiceDropdown<T extends string>({ value, options, labels, onChange, width = "w-[200px]" }: {
  value: T; options: readonly T[]; labels: Record<T, string>; onChange: (v: T) => void; width?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={`${width} justify-between font-normal`}>
          <span className="truncate">{labels[value]}</span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={width}>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
          {options.map((opt) => (
            <DropdownMenuRadioItem key={opt} value={opt}>{labels[opt]}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">{children}</p>;
}

/** The two dashboard-level switches every organizational mining widget has. */
function DashboardSwitches({ id, showControls, automaticLoading, onShowControls, onAutomaticLoading }: {
  id: string;
  showControls: boolean;
  automaticLoading: boolean;
  onShowControls: (v: boolean) => void;
  onAutomaticLoading: (v: boolean) => void;
}) {
  return (
    <>
      <SettingRow
        label="Show settings in view mode"
        htmlFor={`${id}-show-controls`}
        hint="Off: the dashboard shows only the result (and a compute button when needed)."
      >
        <Switch id={`${id}-show-controls`} checked={showControls} onCheckedChange={onShowControls} />
      </SettingRow>
      <SettingRow
        label="Compute automatically"
        htmlFor={`${id}-auto`}
        hint="Start the computation with the preselected settings when the dashboard opens."
      >
        <Switch id={`${id}-auto`} checked={automaticLoading} onCheckedChange={onAutomaticLoading} />
      </SettingRow>
    </>
  );
}

function WidgetHeader({ title, filterEnabled, onToggle }: {
  title: string; filterEnabled: boolean; onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-background shrink-0">
      <span className="text-sm font-semibold">{title}</span>
      <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={onToggle} />
    </div>
  );
}

const VIEW_MODE_LABELS = { graph: "Graph", table: "Table", log: "Event log" } as const;

// ---------------------------------------------------------------------------
// Handover of work
// ---------------------------------------------------------------------------

export const OCHandoverComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile,
}) => {
  // The persisted fields as one string: a stable dependency for syncing local
  // state after a layout (re)load, without listing every field.
  const persistedJson = JSON.stringify(handoverSettingsToNode(handoverSettingsFromNode(node)));
  const [settings, setSettings] = useState<HandoverSettings>(() => handoverSettingsFromNode(node));
  const [showControls, setShowControls] = useState(node.show_controls ?? true);
  const [automaticLoading, setAutomaticLoading] = useState(node.automatic_loading ?? false);
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [maxGapText, setMaxGapText] = useState(settings.maxGap === null ? "" : String(settings.maxGap));

  useEffect(() => {
    const next = handoverSettingsFromNode(JSON.parse(persistedJson));
    setSettings(next);
    setMaxGapText(next.maxGap === null ? "" : String(next.maxGap));
  }, [persistedJson]);
  useEffect(() => { setShowControls(node.show_controls ?? true); }, [node.show_controls]);
  useEffect(() => { setAutomaticLoading(node.automatic_loading ?? false); }, [node.automatic_loading]);

  const { types, loading } = useObjectTypes(selectedFile?.id, isEditMode);

  const update = (patch: Partial<HandoverSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    onUpdate?.(handoverSettingsToNode(next) as Partial<GridStackNode>);
  };
  const updateShowControls = (checked: boolean) => {
    setShowControls(checked);
    onUpdate?.({ show_controls: checked });
  };
  const updateAutomaticLoading = (checked: boolean) => {
    setAutomaticLoading(checked);
    onUpdate?.({ automatic_loading: checked });
  };

  if (isEditMode) {
    const id = `handover-${node.component_id}`;
    const isOc = settings.method === "oc";
    const businessOptions = types.filter((t) => !settings.resourceTypes.includes(t));
    const resourceOptions = types.filter((t) => !settings.businessObjectTypes.includes(t));
    const typeLabels = Object.fromEntries(types.map((t) => [t, t])) as Record<string, string>;
    const singleTypeOptions = [""].concat(types);
    const singleTypeLabels = { ...typeLabels, "": "Select…" } as Record<string, string>;

    return (
      <Card className="w-full h-full rounded-none overflow-y-auto">
        <CardHeader>
          <CardTitle>Handover of Work Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Which resources hand work over to each other, following the business objects through the log.
          </p>

          <SectionTitle>Dashboard</SectionTitle>
          <DashboardSwitches
            id={id}
            showControls={showControls}
            automaticLoading={automaticLoading}
            onShowControls={updateShowControls}
            onAutomaticLoading={updateAutomaticLoading}
          />

          <SectionTitle>Preselected settings</SectionTitle>
          <SettingRow label="Method">
            <ChoiceDropdown
              value={settings.method}
              options={HANDOVER_METHODS}
              labels={HANDOVER_METHOD_LABELS}
              onChange={(method) => update({ method })}
            />
          </SettingRow>

          {isOc ? (
            <>
              <SettingRow label="Resource types">
                <MultiSelectPopover
                  label="Resource types"
                  options={resourceOptions}
                  selected={settings.resourceTypes}
                  onChange={(resourceTypes) => update({ resourceTypes })}
                  loading={loading}
                  disabled={!selectedFile?.id}
                  placeholder="Select…"
                  className="w-[200px]"
                />
              </SettingRow>
              <SettingRow label="Business object types">
                <MultiSelectPopover
                  label="Business object types"
                  options={businessOptions}
                  selected={settings.businessObjectTypes}
                  onChange={(businessObjectTypes) => update({ businessObjectTypes })}
                  loading={loading}
                  disabled={!selectedFile?.id}
                  placeholder="Select…"
                  className="w-[200px]"
                />
              </SettingRow>
            </>
          ) : (
            <>
              <SettingRow label="Case type">
                <ChoiceDropdown
                  value={singleTypeOptions.includes(settings.caseType) ? settings.caseType : ""}
                  options={singleTypeOptions}
                  labels={singleTypeLabels}
                  onChange={(caseType) => update({ caseType })}
                />
              </SettingRow>
              <SettingRow label="Resource type">
                <ChoiceDropdown
                  value={singleTypeOptions.includes(settings.flatResourceType) ? settings.flatResourceType : ""}
                  options={singleTypeOptions}
                  labels={singleTypeLabels}
                  onChange={(flatResourceType) => update({ flatResourceType })}
                />
              </SettingRow>
            </>
          )}

          <SettingRow
            label="Max gap"
            htmlFor={`${id}-max-gap`}
            hint="Events allowed between two consecutive events of the same object; empty = unlimited."
          >
            <Input
              id={`${id}-max-gap`}
              type="text"
              inputMode="numeric"
              placeholder="∞"
              className="w-24 text-center"
              value={maxGapText}
              onChange={(e) => {
                const raw = e.target.value;
                setMaxGapText(raw);
                if (raw.trim() === "") { update({ maxGap: null }); return; }
                const n = parseInt(raw, 10);
                if (!Number.isNaN(n) && n >= 0) update({ maxGap: n });
              }}
              onBlur={() => setMaxGapText(settings.maxGap === null ? "" : String(settings.maxGap))}
            />
          </SettingRow>

          {isOc && (
            <>
              <SettingRow label="Normalization">
                <ChoiceDropdown
                  value={settings.normalization}
                  options={HANDOVER_NORMALIZATIONS}
                  labels={NORMALIZATION_LABELS}
                  onChange={(normalization) => update({ normalization })}
                />
              </SettingRow>
              <SettingRow label="Normalize per object type" htmlFor={`${id}-scope`}>
                <Switch
                  id={`${id}-scope`}
                  checked={settings.normalizationScope === "per_bo_type"}
                  onCheckedChange={(v) => update({ normalizationScope: v ? "per_bo_type" : "global" })}
                />
              </SettingRow>
              <SettingRow
                label="Parallel filter"
                htmlFor={`${id}-parallel`}
                hint="Removes direct handovers between resources working in parallel."
              >
                <Switch
                  id={`${id}-parallel`}
                  checked={settings.parallelFilterEnabled}
                  onCheckedChange={(parallelFilterEnabled) => update({ parallelFilterEnabled })}
                />
              </SettingRow>
              {settings.parallelFilterEnabled && (
                <div className="space-y-3 pl-3 border-l">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Dependency threshold</Label>
                      <span className="text-sm text-muted-foreground font-mono">
                        {settings.parallelThreshold.toFixed(2)}
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={1}
                      step={0.01}
                      value={[settings.parallelThreshold]}
                      onValueChange={([v]) => update({ parallelThreshold: v })}
                    />
                  </div>
                  <SettingRow label="Min. observations" htmlFor={`${id}-min-obs`}>
                    <Input
                      id={`${id}-min-obs`}
                      type="number"
                      min={1}
                      className="w-24 text-center"
                      value={settings.minParallelObservations}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (!Number.isNaN(n) && n >= 1) update({ minParallelObservations: n });
                      }}
                    />
                  </SettingRow>
                </div>
              )}
              <SettingRow
                label="Cluster by object type"
                htmlFor={`${id}-cluster-ot`}
                hint="Collapse every resource into its object type."
              >
                <Switch
                  id={`${id}-cluster-ot`}
                  checked={settings.clusterByOt}
                  onCheckedChange={(clusterByOt) => update({ clusterByOt })}
                />
              </SettingRow>
            </>
          )}

          <SettingRow label="Default view">
            <ChoiceDropdown
              value={settings.viewMode}
              options={HANDOVER_VIEW_MODES}
              labels={VIEW_MODE_LABELS}
              onChange={(viewMode) => update({ viewMode })}
            />
          </SettingRow>
        </CardContent>
      </Card>
    );
  }

  // VIEW MODE: the explorer, re-mounted whenever the persisted settings change.
  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-background">
      <WidgetHeader title="Handover of Work" filterEnabled={filterEnabled} onToggle={() => setFilterEnabled((p) => !p)} />
      <div className="flex-1 min-h-0 overflow-auto">
        <OCHandoverExplorer
          key={`${persistedJson}|${showControls}|${automaticLoading}`}
          fileId={selectedFile?.id}
          fileName={selectedFile?.file?.split("/").pop()}
          embedded
          initialSettings={settings}
          showControls={showControls}
          autoStart={automaticLoading}
          filterEnabled={filterEnabled}
        />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Resource profiling
// ---------------------------------------------------------------------------

export const ResourceProfilingComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile,
}) => {
  const persistedJson = JSON.stringify(profilingSettingsToNode(profilingSettingsFromNode(node)));
  const [settings, setSettings] = useState<ResourceProfilingSettings>(() => profilingSettingsFromNode(node));
  const [showControls, setShowControls] = useState(node.show_controls ?? true);
  const [automaticLoading, setAutomaticLoading] = useState(node.automatic_loading ?? false);
  const [filterEnabled, setFilterEnabled] = useState(true);

  useEffect(() => { setSettings(profilingSettingsFromNode(JSON.parse(persistedJson))); }, [persistedJson]);
  useEffect(() => { setShowControls(node.show_controls ?? true); }, [node.show_controls]);
  useEffect(() => { setAutomaticLoading(node.automatic_loading ?? false); }, [node.automatic_loading]);

  const { types, loading } = useObjectTypes(selectedFile?.id, isEditMode);

  const update = (patch: Partial<ResourceProfilingSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    onUpdate?.(profilingSettingsToNode(next) as Partial<GridStackNode>);
  };
  const updateShowControls = (checked: boolean) => {
    setShowControls(checked);
    onUpdate?.({ show_controls: checked });
  };
  const updateAutomaticLoading = (checked: boolean) => {
    setAutomaticLoading(checked);
    onUpdate?.({ automatic_loading: checked });
  };

  if (isEditMode) {
    const id = `profiling-${node.component_id}`;
    const needsBusinessObjects = settings.featureGroups.some((g) =>
      (BUSINESS_OBJECT_FEATURE_GROUPS as string[]).includes(g),
    );
    const businessOptions = types.filter((t) => !settings.resourceTypes.includes(t));
    const tooltipOptions = FEATURE_GROUP_OPTIONS.filter((o) => !settings.featureGroups.includes(o.key));
    const featureLabel = (key: string) => FEATURE_GROUP_OPTIONS.find((o) => o.key === key)?.label ?? key;

    const toggleFeatureGroup = (key: FeatureGroup) => {
      const has = settings.featureGroups.includes(key);
      const featureGroups = has
        ? settings.featureGroups.filter((g) => g !== key)
        : [...settings.featureGroups, key];
      update({
        featureGroups,
        tooltipFeatureGroups: settings.tooltipFeatureGroups.filter((g) => !featureGroups.includes(g)),
      });
    };

    return (
      <Card className="w-full h-full rounded-none overflow-y-auto">
        <CardHeader>
          <CardTitle>Resource Profiling Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Profiles every resource by what it does, when, and with whom; similar resources form organizational units.
          </p>

          <SectionTitle>Dashboard</SectionTitle>
          <DashboardSwitches
            id={id}
            showControls={showControls}
            automaticLoading={automaticLoading}
            onShowControls={updateShowControls}
            onAutomaticLoading={updateAutomaticLoading}
          />

          <SectionTitle>Preselected settings</SectionTitle>
          <SettingRow label="Resource types">
            <MultiSelectPopover
              label="Resource types"
              options={types}
              selected={settings.resourceTypes}
              onChange={(resourceTypes) => update({
                resourceTypes,
                businessObjectTypes: settings.businessObjectTypes.filter((t) => !resourceTypes.includes(t)),
              })}
              loading={loading}
              disabled={!selectedFile?.id}
              placeholder="Select…"
              className="w-[200px]"
            />
          </SettingRow>

          <div className="space-y-2">
            <Label>Features</Label>
            <div className="space-y-1.5 pl-3 border-l">
              {FEATURE_GROUP_OPTIONS.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <Label htmlFor={`${id}-fg-${key}`} className="font-normal">{label}</Label>
                  <Switch
                    id={`${id}-fg-${key}`}
                    checked={settings.featureGroups.includes(key)}
                    onCheckedChange={() => toggleFeatureGroup(key)}
                  />
                </div>
              ))}
            </div>
            {settings.featureGroups.length === 0 && (
              <p className="text-xs text-muted-foreground">Without a feature the explorer falls back to activity fractions.</p>
            )}
          </div>

          {tooltipOptions.length > 0 && (
            <SettingRow label="Tooltip extras" hint="Computed for the tooltips only; excluded from distances and clustering.">
              <MultiSelectPopover
                label="Tooltip extras"
                options={tooltipOptions.map((o) => o.key)}
                selected={settings.tooltipFeatureGroups}
                onChange={(groups) => update({ tooltipFeatureGroups: groups as FeatureGroup[] })}
                placeholder="None"
                className="w-[200px]"
              />
            </SettingRow>
          )}
          {settings.tooltipFeatureGroups.length > 0 && (
            <p className="text-xs text-muted-foreground -mt-2">
              {settings.tooltipFeatureGroups.map(featureLabel).join(", ")}
            </p>
          )}

          {needsBusinessObjects && (
            <SettingRow label="Business object types" hint="Empty = every non-resource type.">
              <MultiSelectPopover
                label="Business object types"
                options={businessOptions}
                selected={settings.businessObjectTypes}
                onChange={(businessObjectTypes) => update({ businessObjectTypes })}
                loading={loading}
                disabled={!selectedFile?.id}
                placeholder="All other types"
                className="w-[200px]"
              />
            </SettingRow>
          )}

          <SettingRow label="Clustering" htmlFor={`${id}-clusters`}>
            <Switch
              id={`${id}-clusters`}
              checked={settings.computeClusters}
              onCheckedChange={(computeClusters) => update({ computeClusters })}
            />
          </SettingRow>
          {settings.computeClusters && (
            <div className="space-y-3 pl-3 border-l">
              <SettingRow label="Method">
                <ChoiceDropdown
                  value={settings.clusterMethod}
                  options={PROFILING_CLUSTER_METHODS}
                  labels={PROFILING_CLUSTER_METHOD_LABELS}
                  onChange={(clusterMethod) => update({ clusterMethod })}
                />
              </SettingRow>
              {settings.clusterMethod === "hdbscan" ? (
                <SettingRow label="Min. cluster size" htmlFor={`${id}-min-size`}>
                  <Input
                    id={`${id}-min-size`}
                    type="number"
                    min={2}
                    className="w-24 text-center"
                    value={settings.minClusterSize}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (!Number.isNaN(n) && n >= 2) update({ minClusterSize: n });
                    }}
                  />
                </SettingRow>
              ) : (
                <SettingRow label="Clusters (k)" htmlFor={`${id}-k`}>
                  <Input
                    id={`${id}-k`}
                    type="number"
                    min={1}
                    className="w-24 text-center"
                    value={settings.nClusters}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (!Number.isNaN(n) && n >= 1) update({ nClusters: n });
                    }}
                  />
                </SettingRow>
              )}
              <SettingRow label="Distance">
                <ChoiceDropdown
                  value={settings.distanceMetric}
                  options={PROFILING_DISTANCE_METRICS}
                  labels={PROFILING_DISTANCE_METRIC_LABELS}
                  onChange={(distanceMetric) => update({ distanceMetric })}
                />
              </SettingRow>
            </div>
          )}

          <SettingRow label="Default view">
            <ChoiceDropdown
              value={settings.viewMode}
              options={PROFILING_VIEW_MODES}
              labels={VIEW_MODE_LABELS}
              onChange={(viewMode) => update({ viewMode })}
            />
          </SettingRow>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-background">
      <WidgetHeader title="Resource Profiling" filterEnabled={filterEnabled} onToggle={() => setFilterEnabled((p) => !p)} />
      <div className="flex-1 min-h-0 overflow-auto">
        <OrgaMiningExplorer
          key={`${persistedJson}|${showControls}|${automaticLoading}`}
          fileId={selectedFile?.id}
          embedded
          initialSettings={settings}
          showControls={showControls}
          autoStart={automaticLoading}
          filterEnabled={filterEnabled}
        />
      </div>
    </div>
  );
};
