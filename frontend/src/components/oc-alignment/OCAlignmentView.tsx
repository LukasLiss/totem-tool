import { useContext, useState } from "react";
import { FileText } from "lucide-react";

import { GlobalFilterToggle } from "@/components/ui/GlobalFilterToggle";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";

import { OCAlignmentExplorer } from "./OCAlignmentExplorer";
import { DEFAULT_OC_ALIGNMENT_SETTINGS, type OCAlignmentSettings } from "./settings";

type SelectedEventLog = { id?: number; project?: number; file?: string };

function positiveId(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;
}

function eventLogName(value: string | undefined): string {
  const name = value?.split("/").filter(Boolean).pop();
  if (!name) return "Selected event log";
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** Conformance → Object-Centric Alignments. */
export function OCAlignmentView({ initialAssetId }: { initialAssetId?: number }) {
  const { selectedFile } = useContext(SelectedFileContext);
  const { setViewMode } = useContext(DashboardContext);
  const eventLog = (selectedFile ?? null) as SelectedEventLog | null;
  const fileId = positiveId(eventLog?.id);
  const projectId = positiveId(eventLog?.project);
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [settings, setSettings] = useState<OCAlignmentSettings>(() => ({
    ...DEFAULT_OC_ALIGNMENT_SETTINGS,
    assetId: positiveId(initialAssetId),
  }));
  // Settings belong to one log: switching logs starts over.
  const [settingsFor, setSettingsFor] = useState(fileId);
  if (settingsFor !== fileId) {
    setSettingsFor(fileId);
    setSettings({ ...DEFAULT_OC_ALIGNMENT_SETTINGS });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SidebarTrigger className="m-2" />
      <main className="flex-1 p-4 pt-0">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
          <header className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">Object-Centric Alignments</h1>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                Aligns one process execution with an object-centric Petri net and points out where the
                recorded behaviour deviates from the model — without flattening, so dependencies between
                objects are respected.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border bg-background px-3 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className={fileId ? "truncate" : "truncate text-muted-foreground"} title={eventLog?.file}>
                  {fileId ? eventLogName(eventLog?.file) : "No event log selected"}
                </span>
              </div>
              <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={() => setFilterEnabled((v) => !v)} />
            </div>
          </header>
          <OCAlignmentExplorer
            fileId={fileId}
            projectId={projectId}
            settings={settings}
            onSettingsChange={setSettings}
            filterEnabled={filterEnabled}
            onOpenModelAssets={() => setViewMode({ type: "modelAssets" })}
            graphHeight={480}
          />
        </div>
      </main>
    </div>
  );
}

export default OCAlignmentView;
