/**
 * Dashboard widgets for the organizational mining explorers.
 *
 * Edit mode shows a draft of the result in the tile; the settings (whether
 * the computation starts automatically, followed by the preselected settings
 * the explorer opens with) open in a popup beside the same draft.
 * View mode hosts the explorer as a full-bleed canvas with its controls
 * floating over it — the settings themselves are not reachable there, which
 * is the same preselection-only contract the OCCN widget follows. All
 * settings persist through the layout (see `OCHandoverComponent` and
 * `ResourceProfilingComponent` on the backend).
 */
import React, { useEffect, useState } from "react";
import type { GridStackNode } from "gridstack";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import {
  ChartSettingsDialog,
  ChartSettingsLayout,
  type ChartSettingsTab,
} from "@/components/sql-widgets/chartSettings";
import { SegmentedControl } from "@/components/sql-widgets/shared";
import { mapTypesToColors } from "@/utils/objectColors";

import type { ComponentProps } from "./componentMap";
import HandoverSketch from "./HandoverSketch";
import ResourceProfilingSketch from "./ResourceProfilingSketch";
import WidgetDraftTile from "./WidgetDraftTile";

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

/** The dashboard-level switch every organizational mining widget has. */
function DashboardSwitches({ id, automaticLoading, onAutomaticLoading }: {
  id: string;
  automaticLoading: boolean;
  onAutomaticLoading: (v: boolean) => void;
}) {
  return (
    <SettingRow
      label="Compute automatically"
      htmlFor={`${id}-auto`}
      hint="Start the computation with the preselected settings when the dashboard opens."
    >
      <Switch id={`${id}-auto`} checked={automaticLoading} onCheckedChange={onAutomaticLoading} />
    </SettingRow>
  );
}

/**
 * Title and filter toggle, floating over the explorer's canvas.
 *
 * It used to be a header bar above the explorer, which cost a row of height
 * in every tile; OCCN puts the same pair in the canvas's top-left corner.
 *
 * It sits at the bottom of the canvas's stacking order (the explorer's own
 * panels are 12–14, its popovers 20, its tooltips 40). The title is a label
 * and everything above it is something the user is operating, so an expanded
 * panel covers the title rather than opening underneath it.
 */
function WidgetTitle({ title, filterEnabled, onToggle }: {
  title: string; filterEnabled: boolean; onToggle: () => void;
}) {
  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 z-[5] flex items-center gap-2 pointer-events-none"
      style={{ fontFamily: "var(--font-primary, Inter, sans-serif)" }}
    >
      <span className="text-sm font-semibold text-slate-900">{title}</span>
      <span className="pointer-events-auto">
        <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={onToggle} stopPropagation />
      </span>
    </div>
  );
}

const VIEW_MODE_LABELS = { graph: "Graph", table: "Table", log: "Event log" } as const;

const POINT_SIZE_OPTIONS = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
] as const;

// ---------------------------------------------------------------------------
// Handover of work
// ---------------------------------------------------------------------------

const HANDOVER_SKETCH_HINT =
  "Layout preview: resources in the colors of the selected resource types (one node per type when clustered by object type), handovers in the colors of the selected business object types.";

/**
 * The handover settings popup's body (the same settings the edit form always
 * had) beside a draft of the graph. It works on a draft of the settings,
 * mounted on every open, and only hands it over on Apply.
 */
function HandoverSettingsBody({ id, initial, initialAutomaticLoading, types, loading, fileId, onApply, onCancel }: {
  id: string;
  initial: HandoverSettings;
  initialAutomaticLoading: boolean;
  types: string[];
  loading: boolean;
  fileId?: number;
  onApply: (settings: HandoverSettings, automaticLoading: boolean) => void;
  onCancel: () => void;
}) {
  const [settings, setSettings] = useState(initial);
  const [automaticLoading, setAutomaticLoading] = useState(initialAutomaticLoading);
  const [maxGapText, setMaxGapText] = useState(initial.maxGap === null ? "" : String(initial.maxGap));
  const update = (patch: Partial<HandoverSettings>) => setSettings((s) => ({ ...s, ...patch }));

  const businessOptions = types.filter((t) => !settings.resourceTypes.includes(t));
  const resourceOptions = types.filter((t) => !settings.businessObjectTypes.includes(t));

  return (
    <ChartSettingsLayout
      heading="Handover of work settings"
      idPrefix={id}
      onApply={() => onApply(settings, automaticLoading)}
      onCancel={onCancel}
      dataTab={
        <div className="space-y-4 text-left">
          <p className="text-sm text-muted-foreground">
            Which resources hand work over to each other, following the business objects through the log.
          </p>

          <SectionTitle>Dashboard</SectionTitle>
          <DashboardSwitches
            id={id}
            automaticLoading={automaticLoading}
            onAutomaticLoading={setAutomaticLoading}
          />

          <SectionTitle>Preselected settings</SectionTitle>
          <SettingRow label="Resource types">
            <MultiSelectPopover
              label="Resource types"
              options={resourceOptions}
              selected={settings.resourceTypes}
              onChange={(resourceTypes) => update({ resourceTypes })}
              loading={loading}
              disabled={!fileId}
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
              disabled={!fileId}
              placeholder="Select…"
              className="w-[200px]"
            />
          </SettingRow>

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

          <SettingRow label="Default view">
            <ChoiceDropdown
              value={settings.viewMode}
              options={HANDOVER_VIEW_MODES}
              labels={VIEW_MODE_LABELS}
              onChange={(viewMode) => update({ viewMode })}
            />
          </SettingRow>
        </div>
      }
      sketch={
        <HandoverSketch
          resourceTypes={settings.resourceTypes}
          businessObjectTypes={settings.businessObjectTypes}
          typeColors={mapTypesToColors(types)}
          clusterByOt={settings.clusterByOt}
          className="w-full max-w-xs md:max-w-md"
        />
      }
      sketchHint={HANDOVER_SKETCH_HINT}
    />
  );
}

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
  const [automaticLoading, setAutomaticLoading] = useState(node.automatic_loading ?? false);
  const [filterEnabled, setFilterEnabled] = useState(true);

  useEffect(() => { setSettings(handoverSettingsFromNode(JSON.parse(persistedJson))); }, [persistedJson]);
  useEffect(() => { setAutomaticLoading(node.automatic_loading ?? false); }, [node.automatic_loading]);

  const { types, loading } = useObjectTypes(selectedFile?.id, isEditMode);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const applySettings = (next: HandoverSettings, nextAutomaticLoading: boolean) => {
    setSettings(next);
    setAutomaticLoading(nextAutomaticLoading);
    onUpdate?.({
      ...handoverSettingsToNode(next),
      automatic_loading: nextAutomaticLoading,
    } as Partial<GridStackNode>);
  };

  if (isEditMode) {
    // The tile shows a draft of the graph; the settings open in a popup.
    return (
      <WidgetDraftTile
        typeLabel="Handover of work"
        hint={HANDOVER_SKETCH_HINT}
        notice={settings.resourceTypes.length ? undefined : "No resource types selected yet."}
        onConfigure={() => setSettingsOpen(true)}
        sketch={
          <HandoverSketch
            resourceTypes={settings.resourceTypes}
            businessObjectTypes={settings.businessObjectTypes}
            typeColors={mapTypesToColors(types)}
            clusterByOt={settings.clusterByOt}
            className="h-full w-full"
          />
        }
      >
        <ChartSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <HandoverSettingsBody
            id={`handover-${node.component_id}`}
            initial={settings}
            initialAutomaticLoading={automaticLoading}
            types={types}
            loading={loading}
            fileId={selectedFile?.id}
            onApply={(next, nextAutomaticLoading) => {
              applySettings(next, nextAutomaticLoading);
              setSettingsOpen(false);
            }}
            onCancel={() => setSettingsOpen(false)}
          />
        </ChartSettingsDialog>
      </WidgetDraftTile>
    );
  }

  // VIEW MODE: the explorer owns the whole tile and floats its own controls;
  // it is re-mounted whenever the persisted settings change.
  return (
    <div className="w-full h-full relative overflow-hidden bg-background text-left">
      <OCHandoverExplorer
        key={`${persistedJson}|${automaticLoading}`}
        fileId={selectedFile?.id}
        fileName={selectedFile?.file?.split("/").pop()}
        embedded
        initialSettings={settings}
        autoStart={automaticLoading}
        filterEnabled={filterEnabled}
      />
      <WidgetTitle title="Handover of Work" filterEnabled={filterEnabled} onToggle={() => setFilterEnabled((p) => !p)} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Resource profiling
// ---------------------------------------------------------------------------

/**
 * The resource profiling settings popup's body (the same settings the edit
 * form always had) beside a draft of the result. It works on a draft of the
 * settings, mounted on every open, and only hands it over on Apply.
 */
function ResourceProfilingSettingsBody({ id, initial, initialAutomaticLoading, types, loading, fileId, onApply, onCancel }: {
  id: string;
  initial: ResourceProfilingSettings;
  initialAutomaticLoading: boolean;
  types: string[];
  loading: boolean;
  fileId?: number;
  onApply: (settings: ResourceProfilingSettings, automaticLoading: boolean) => void;
  onCancel: () => void;
}) {
  const [settings, setSettings] = useState(initial);
  const [automaticLoading, setAutomaticLoading] = useState(initialAutomaticLoading);
  const [tab, setTab] = useState<ChartSettingsTab>("data");
  const update = (patch: Partial<ResourceProfilingSettings>) => setSettings((s) => ({ ...s, ...patch }));

  // Tooltip-only groups are computed too, so they need business objects as well.
  const needsBusinessObjects = [...settings.featureGroups, ...settings.tooltipFeatureGroups].some((g) =>
    (BUSINESS_OBJECT_FEATURE_GROUPS as string[]).includes(g),
  );
  const businessOptions = types.filter((t) => !settings.resourceTypes.includes(t));
  const tooltipOptions = FEATURE_GROUP_OPTIONS.filter((o) => !settings.featureGroups.includes(o.key));
  // The selected tooltip extras, in the tooltip's order rather than click order.
  const tooltipExtrasLabels = FEATURE_GROUP_OPTIONS.filter((o) => settings.tooltipFeatureGroups.includes(o.key)).map(
    (o) => o.label,
  );

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
    <ChartSettingsLayout
      heading="Resource profiling settings"
      idPrefix={id}
      onApply={() => onApply(settings, automaticLoading)}
      onCancel={onCancel}
      tab={tab}
      onTabChange={setTab}
      dataTab={
        <div className="space-y-4 text-left">
          <p className="text-sm text-muted-foreground">
            Profiles every resource by what it does, when, and with whom; similar resources form organizational units.
          </p>

          <SectionTitle>Dashboard</SectionTitle>
          <DashboardSwitches
            id={id}
            automaticLoading={automaticLoading}
            onAutomaticLoading={setAutomaticLoading}
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
              disabled={!fileId}
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
            {tooltipExtrasLabels.join(", ")}
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
              disabled={!fileId}
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
        </div>
      }
      styleTab={
        <div className="space-y-3 text-left">
          <SettingRow label="Point size" hint="Large is the size of the explorer page; in the dashboard the points also follow the tile's size a little.">
            <SegmentedControl
              ariaLabel="Point size"
              value={settings.pointSize}
              options={POINT_SIZE_OPTIONS}
              onChange={(pointSize) => update({ pointSize })}
            />
          </SettingRow>
          <SettingRow
            label="Transparent points"
            htmlFor={`${id}-transparent`}
            hint="See-through resources, so many at one position stay visible."
          >
            <Switch
              id={`${id}-transparent`}
              checked={settings.transparentPoints}
              onCheckedChange={(transparentPoints) => update({ transparentPoints })}
            />
          </SettingRow>
        </div>
      }
      sketch={
        <ResourceProfilingSketch
          resourceTypes={settings.resourceTypes}
          typeColors={mapTypesToColors(types)}
          computeClusters={settings.computeClusters}
          tooltipGroups={[...settings.featureGroups, ...settings.tooltipFeatureGroups]}
          pointSize={settings.pointSize}
          transparentPoints={settings.transparentPoints}
          className="w-full max-w-xs md:max-w-md"
        />
      }
      sketchHint="Layout preview: resources in the colors of the selected resource types, grouped into clusters, and a cluster tooltip with the selected feature groups. Grey bars stand in for the values."
    />
  );
}

export const ResourceProfilingComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile,
}) => {
  const persistedJson = JSON.stringify(profilingSettingsToNode(profilingSettingsFromNode(node)));
  const [settings, setSettings] = useState<ResourceProfilingSettings>(() => profilingSettingsFromNode(node));
  const [automaticLoading, setAutomaticLoading] = useState(node.automatic_loading ?? false);
  const [filterEnabled, setFilterEnabled] = useState(true);

  useEffect(() => { setSettings(profilingSettingsFromNode(JSON.parse(persistedJson))); }, [persistedJson]);
  useEffect(() => { setAutomaticLoading(node.automatic_loading ?? false); }, [node.automatic_loading]);

  const { types, loading } = useObjectTypes(selectedFile?.id, isEditMode);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const typeColors = mapTypesToColors(types);

  const applySettings = (next: ResourceProfilingSettings, nextAutomaticLoading: boolean) => {
    setSettings(next);
    setAutomaticLoading(nextAutomaticLoading);
    onUpdate?.({
      ...profilingSettingsToNode(next),
      automatic_loading: nextAutomaticLoading,
    } as Partial<GridStackNode>);
  };

  if (isEditMode) {
    // The tile shows a draft of the result; the settings open in a popup.
    return (
      <WidgetDraftTile
        typeLabel="Resource profiling"
        hint="Layout preview: resources in the colors of the selected resource types, grouped into clusters, and a cluster tooltip with the selected feature groups. Grey bars stand in for the values."
        notice={settings.resourceTypes.length ? undefined : "No resource types selected yet."}
        onConfigure={() => setSettingsOpen(true)}
        sketch={
          <ResourceProfilingSketch
            resourceTypes={settings.resourceTypes}
            typeColors={typeColors}
            computeClusters={settings.computeClusters}
            tooltipGroups={[...settings.featureGroups, ...settings.tooltipFeatureGroups]}
            pointSize={settings.pointSize}
            transparentPoints={settings.transparentPoints}
            className="h-full w-full"
          />
        }
      >
        <ChartSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <ResourceProfilingSettingsBody
            id={`profiling-${node.component_id}`}
            initial={settings}
            initialAutomaticLoading={automaticLoading}
            types={types}
            loading={loading}
            fileId={selectedFile?.id}
            onApply={(next, nextAutomaticLoading) => {
              applySettings(next, nextAutomaticLoading);
              setSettingsOpen(false);
            }}
            onCancel={() => setSettingsOpen(false)}
          />
        </ChartSettingsDialog>
      </WidgetDraftTile>
    );
  }

  return (
    <div className="w-full h-full relative overflow-hidden bg-background text-left">
      <OrgaMiningExplorer
        key={`${persistedJson}|${automaticLoading}`}
        fileId={selectedFile?.id}
        embedded
        initialSettings={settings}
        autoStart={automaticLoading}
        filterEnabled={filterEnabled}
      />
      <WidgetTitle title="Resource Profiling" filterEnabled={filterEnabled} onToggle={() => setFilterEnabled((p) => !p)} />
    </div>
  );
};
