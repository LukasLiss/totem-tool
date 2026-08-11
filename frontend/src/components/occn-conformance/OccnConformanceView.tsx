import { useContext, type ReactNode } from "react";
import {
  AlertCircle,
  FileText,
  Info,
  LoaderCircle,
  Network,
  Play,
} from "lucide-react";

import {
  CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  type OCCNReplayUnitStrategy,
} from "@/api/occnConformanceApi";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";

import { OccnAssetSelector } from "./OccnAssetSelector";
import { OccnConformanceSummary } from "./OccnConformanceSummary";
import { OccnReplayUnitExplorer } from "./OccnReplayUnitExplorer";
import { useOccnConformanceWorkflow } from "./useOccnConformanceWorkflow";

type SelectedEventLog = {
  id?: number;
  project?: number;
  file?: string;
};

const REPLAY_UNIT_STRATEGY_LABELS: Record<OCCNReplayUnitStrategy, string> = {
  [CONNECTED_COMPONENTS_REPLAY_STRATEGY]: "Connected components",
};

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

          <section className="grid items-end gap-4 border-b pb-6 md:grid-cols-2 xl:grid-cols-[minmax(200px,1fr)_minmax(280px,1.3fr)_minmax(200px,1fr)_auto]">
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
              <div
                aria-label="Replay unit strategy"
                className="flex h-9 min-w-0 items-center gap-2 rounded-md border bg-muted/30 px-3 text-sm"
              >
                <Network className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {REPLAY_UNIT_STRATEGY_LABELS[workflow.replayUnitStrategy]}
                </span>
              </div>
            </div>

            <Button
              type="button"
              className="w-full xl:w-auto"
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
              <OccnReplayUnitExplorer units={workflow.result.unit_results} />
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
