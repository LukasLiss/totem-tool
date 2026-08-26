import { useContext, useEffect, useState, type ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  FileText,
  Info,
  LoaderCircle,
  Play,
  RefreshCw,
} from "lucide-react";

import {
  CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  DEFAULT_OCCN_MAX_STATES,
  LEADING_OBJECT_REPLAY_STRATEGY,
  MAX_OCCN_MAX_STATES,
  type OCCNConformanceResponse,
  type OCCNReplayUnitResult,
  type OCCNReplayUnitStrategy,
} from "@/api/occnConformanceApi";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Slider } from "@/components/ui/slider";
import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";

import { OccnAssetSelector } from "./OccnAssetSelector";
import { OccnConformanceVisualization } from "./OccnConformanceVisualization";
import { OccnConformanceSummary } from "./OccnConformanceSummary";
import { OccnReplayUnitDetail } from "./OccnReplayUnitDetail";
import { OccnReplayUnitExplorer } from "./OccnReplayUnitExplorer";
import { useOccnConformanceWorkflow } from "./useOccnConformanceWorkflow";
import { useOccnReplayUnitDetail } from "./useOccnReplayUnitDetail";

type SelectedEventLog = {
  id?: number;
  project?: number;
  file?: string;
};

const REPLAY_UNIT_STRATEGY_LABELS: Record<OCCNReplayUnitStrategy, string> = {
  [CONNECTED_COMPONENTS_REPLAY_STRATEGY]: "Standard",
  [LEADING_OBJECT_REPLAY_STRATEGY]: "Leading object type",
};

interface ReplayUnitSelection {
  contextKey: string;
  result: OCCNConformanceResponse;
  unitId: string;
}

export function OccnConformanceView({
  initialAssetId,
}: {
  initialAssetId?: number;
}) {
  const { selectedFile } = useContext(SelectedFileContext);
  const { setViewMode } = useContext(DashboardContext);
  const eventLog = (selectedFile ?? null) as SelectedEventLog | null;
  const eventLogId = positiveId(eventLog?.id);
  const projectId = positiveId(eventLog?.project);
  const workflow = useOccnConformanceWorkflow(
    eventLogId,
    projectId,
    positiveId(initialAssetId)
  );
  const { assetSelection } = workflow;
  const [replayUnitSelection, setReplayUnitSelection] =
    useState<ReplayUnitSelection | null>(null);
  const replayUnitContextKey =
    eventLogId && projectId && assetSelection.selectedAssetId
      ? `${eventLogId}:${projectId}:${assetSelection.selectedAssetId}:${workflow.replayUnitStrategy}:${workflow.leadingObjectType ?? ""}`
      : null;
  const selectedReplayUnit = resolveSelectedReplayUnit(
    replayUnitSelection,
    replayUnitContextKey,
    workflow.result
  );

  useEffect(() => {
    setReplayUnitSelection(null);
  }, [replayUnitContextKey, workflow.result]);

  const replayUnitDetail = useOccnReplayUnitDetail(
    eventLogId,
    selectedReplayUnit,
    workflow.replayUnitStrategy,
    workflow.leadingObjectType
  );

  function selectReplayUnit(unit: OCCNReplayUnitResult) {
    if (!replayUnitContextKey || !workflow.result) return;
    setReplayUnitSelection({
      contextKey: replayUnitContextKey,
      result: workflow.result,
      unitId: unit.unit_id,
    });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SidebarTrigger className="m-2" />
      <main className="flex-1 p-4 pt-0">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
          <header className="border-b pb-4">
            <h1 className="text-2xl font-semibold tracking-normal">
              OCCN Conformance
            </h1>
          </header>

          <section
            className={`grid items-end gap-4 border-b pb-6 md:grid-cols-2 ${
              workflow.replayUnitStrategy === LEADING_OBJECT_REPLAY_STRATEGY
                ? "xl:grid-cols-5"
                : "xl:grid-cols-4"
            }`}
          >
            <div className="space-y-2">
              <Label>Event log</Label>
              <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border bg-background px-3 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span
                  className={
                    eventLogId ? "truncate" : "truncate text-muted-foreground"
                  }
                  title={eventLog?.file}
                >
                  {eventLogId
                    ? eventLogName(eventLog?.file)
                    : "No event log selected"}
                </span>
              </div>
            </div>

            <OccnAssetSelector
              projectId={projectId}
              assets={assetSelection.assets}
              selectedAssetId={assetSelection.selectedAssetId}
              loading={assetSelection.loading}
              error={assetSelection.error}
              onSelectAsset={assetSelection.selectAsset}
              onRetry={assetSelection.retry}
              onOpenModelAssets={() => setViewMode({ type: "modelAssets" })}
              disabled={workflow.running}
            />

            <div className="space-y-2">
              <Label>Replay unit strategy</Label>
              <Select
                value={workflow.replayUnitStrategy}
                onValueChange={(value) =>
                  workflow.setReplayUnitStrategy(
                    value as OCCNReplayUnitStrategy
                  )
                }
                disabled={workflow.running}
              >
                <SelectTrigger aria-label="Replay unit strategy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(REPLAY_UNIT_STRATEGY_LABELS).map(
                    ([strategy, label]) => (
                      <SelectItem key={strategy} value={strategy}>
                        {label}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>

            {workflow.replayUnitStrategy ===
            LEADING_OBJECT_REPLAY_STRATEGY ? (
              <div className="space-y-2">
                <Label>Leading object type</Label>
                <div className="flex gap-2">
                  <Select
                    value={workflow.leadingObjectType ?? undefined}
                    onValueChange={workflow.setLeadingObjectType}
                    disabled={
                      workflow.running ||
                      workflow.objectTypesLoading ||
                      workflow.objectTypesError !== null ||
                      workflow.availableObjectTypes.length === 0
                    }
                  >
                    <SelectTrigger aria-label="Leading object type">
                      <SelectValue
                        placeholder={
                          workflow.objectTypesLoading
                            ? "Loading object types"
                            : workflow.availableObjectTypes.length === 0
                              ? "No object types available"
                              : "Select object type"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {workflow.availableObjectTypes.map((objectType) => (
                        <SelectItem key={objectType} value={objectType}>
                          {objectType}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {workflow.objectTypesError ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Retry loading object types"
                      aria-label="Retry loading object types"
                      onClick={workflow.retryObjectTypes}
                    >
                      <RefreshCw />
                    </Button>
                  ) : null}
                </div>
                {workflow.objectTypesError ? (
                  <p className="text-xs text-destructive">
                    {workflow.objectTypesError}
                  </p>
                ) : null}
              </div>
            ) : null}

            <Button
              type="button"
              className="w-full"
              disabled={!workflow.canRun}
              onClick={() => void workflow.run()}
            >
              {workflow.running ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Play />
              )}
              {workflow.running ? "Running" : "Run conformance"}
            </Button>

            <div className="space-y-3 border-t pt-4 md:col-span-2 xl:col-span-full">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="occn-state-limit">State limit per replay unit</Label>
                <span className="text-sm font-medium tabular-nums">
                  {workflow.maxStates.toLocaleString()}
                </span>
              </div>
              <Slider
                id="occn-state-limit"
                thumbAriaLabel="State limit per replay unit"
                min={DEFAULT_OCCN_MAX_STATES}
                max={MAX_OCCN_MAX_STATES}
                step={100}
                value={[workflow.maxStates]}
                disabled={workflow.running}
                onValueChange={([maxStates]) =>
                  workflow.setMaxStates(maxStates)
                }
              />
              {workflow.maxStates > DEFAULT_OCCN_MAX_STATES ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Higher state limits can significantly increase computation
                    time.
                  </span>
                </div>
              ) : null}
            </div>
          </section>

          {!eventLogId || !projectId ? (
            <StatusMessage
              tone="neutral"
              icon={<AlertCircle />}
              title="No event log selected"
              description="Choose a project from the sidebar to provide the event log context."
            />
          ) : workflow.error ? (
            <StatusMessage
              tone="error"
              icon={<AlertCircle />}
              title="Conformance calculation failed"
              description={workflow.error}
            />
          ) : workflow.running ? (
            <StatusMessage
              tone="neutral"
              icon={<LoaderCircle className="animate-spin" />}
              title="Calculating conformance"
              description="The replay result will appear here when the calculation finishes."
            />
          ) : workflow.result ? (
            <div className="grid gap-4">
              <OccnConformanceSummary result={workflow.result} />
              {assetSelection.selectedAsset ? (
                <OccnConformanceVisualization
                  asset={assetSelection.selectedAsset}
                  result={workflow.result}
                  selectedUnit={selectedReplayUnit}
                  running={workflow.running}
                  onRunLeadingObjectType={workflow.runLeadingObjectType}
                />
              ) : null}
              <OccnReplayUnitExplorer
                units={workflow.result.unit_results}
                selectedUnitId={selectedReplayUnit?.unit_id ?? null}
                onSelectUnit={selectReplayUnit}
              />
              {selectedReplayUnit ? (
                <OccnReplayUnitDetail
                  unit={selectedReplayUnit}
                  detailState={replayUnitDetail}
                />
              ) : null}
            </div>
          ) : assetSelection.selectedAsset ? (
            <StatusMessage
              tone="neutral"
              icon={<Info />}
              title="Ready to calculate"
              description="Run conformance to compare the selected event log and OCCN model."
            />
          ) : !assetSelection.loading &&
            !assetSelection.error &&
            assetSelection.assets.length > 0 ? (
            <StatusMessage
              tone="neutral"
              icon={<Info />}
              title="Select an OCCN model"
              description="Choose a stored model before running conformance."
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

function resolveSelectedReplayUnit(
  selection: ReplayUnitSelection | null,
  contextKey: string | null,
  result: OCCNConformanceResponse | null
): OCCNReplayUnitResult | null {
  if (
    !selection ||
    !contextKey ||
    selection.contextKey !== contextKey ||
    selection.result !== result
  ) {
    return null;
  }

  return (
    result.unit_results.find((unit) => unit.unit_id === selection.unitId) ??
    null
  );
}

function StatusMessage({
  tone,
  icon,
  title,
  description,
}: {
  tone: "neutral" | "error";
  icon: ReactNode;
  title: string;
  description: string;
}) {
  const toneClasses = {
    neutral: "border-border bg-muted/30 text-foreground",
    error: "border-destructive/30 bg-destructive/5 text-destructive",
  }[tone];

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-md border p-4 ${toneClasses}`}
    >
      <span className="mt-0.5 [&_svg]:size-5">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-sm opacity-80">{description}</p>
      </div>
    </div>
  );
}

function positiveId(value: number | undefined): number | null {
  return Number.isInteger(value) && (value as number) > 0
    ? (value as number)
    : null;
}

function eventLogName(value: string | undefined): string {
  if (!value) return "Selected event log";
  const name = value.split("/").filter(Boolean).pop();
  if (!name) return "Selected event log";
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export default OccnConformanceView;
