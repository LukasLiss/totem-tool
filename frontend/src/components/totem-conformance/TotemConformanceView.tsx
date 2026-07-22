import { useContext, type ReactNode } from "react";
import {
  AlertCircle,
  CircleCheck,
  FileText,
  LoaderCircle,
  Play,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";

import { TotemAssetSelector } from "./TotemAssetSelector";
import { useTotemConformanceWorkflow } from "./useTotemConformanceWorkflow";

type SelectedEventLog = {
  id?: number;
  project?: number;
  file?: string;
};

export function TotemConformanceView() {
  const { selectedFile } = useContext(SelectedFileContext);
  const { setViewMode } = useContext(DashboardContext);
  const eventLog = (selectedFile ?? null) as SelectedEventLog | null;
  const eventLogId = positiveId(eventLog?.id);
  const projectId = positiveId(eventLog?.project);
  const workflow = useTotemConformanceWorkflow(eventLogId, projectId);
  const { assetSelection } = workflow;

  return (
    <div className="flex min-h-screen flex-col">
      <SidebarTrigger className="m-2" />
      <main className="flex-1 p-4 pt-0">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <header className="border-b pb-4">
            <h1 className="text-2xl font-semibold tracking-normal">
              TOTeM Conformance
            </h1>
          </header>

          <section className="grid items-end gap-4 border-b pb-6 lg:grid-cols-[minmax(220px,1fr)_minmax(300px,1.4fr)_auto]">
            <div className="space-y-2">
              <Label>Event log</Label>
              <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border bg-background px-3 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span
                  className={eventLogId ? "truncate" : "truncate text-muted-foreground"}
                  title={eventLog?.file}
                >
                  {eventLogId
                    ? eventLogName(eventLog?.file)
                    : "No event log selected"}
                </span>
              </div>
            </div>

            <TotemAssetSelector
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

            <Button
              type="button"
              className="w-full lg:w-auto"
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

          {!eventLogId ? (
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
          ) : workflow.result ? (
            <StatusMessage
              tone="success"
              icon={<CircleCheck />}
              title="Conformance result ready"
              description={`Calculated with ${assetSelection.selectedAsset?.name ?? "the selected TOTeM model"}.`}
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
  tone: "neutral" | "error" | "success";
  icon: ReactNode;
  title: string;
  description: string;
}) {
  const toneClasses = {
    neutral: "border-border bg-muted/30 text-foreground",
    error: "border-destructive/30 bg-destructive/5 text-destructive",
    success: "border-emerald-600/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300",
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
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;
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

export default TotemConformanceView;
