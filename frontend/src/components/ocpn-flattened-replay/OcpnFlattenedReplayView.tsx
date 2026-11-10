import { useCallback, useContext, useEffect, useState } from "react";

import { GlobalFilterToggle } from "@/components/ui/GlobalFilterToggle";
import { LocalFilterDropdown } from "@/components/ui/LocalFilterDropdown";
import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";

import OcpnFlattenedReplay from "./OcpnFlattenedReplay";

/**
 * Conformance → OCPN Flattened Replay: the page around the replay view,
 * laid out like the other conformance pages (title, then the workflow).
 */
export function OcpnFlattenedReplayView({
  initialAssetId,
}: {
  initialAssetId?: number;
}) {
  const { selectedFile } = useContext(SelectedFileContext);
  const { setViewMode } = useContext(DashboardContext);
  const [filterEnabled, setFilterEnabled] = useState(true);
  const toggleFilter = useCallback(() => setFilterEnabled((p) => !p), []);
  const [localFilterParams, setLocalFilterParams] = useState<Record<string, string>>({});

  useEffect(() => {
    setLocalFilterParams({});
  }, [selectedFile?.id]);

  return (
    <div className="flex flex-col md:min-h-screen">
      <main className="flex-1 p-4">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
          <header className="border-b pb-4">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-normal">
                OCPN Flattened Replay
              </h1>
              <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={toggleFilter} />
              <LocalFilterDropdown
                fileId={selectedFile?.id}
                onFilterChange={setLocalFilterParams}
              />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Token-based replay of every object type on its part of a stored
              Object-Centric Petri Net, shown on the combined net.
            </p>
          </header>
          <div className="overflow-hidden rounded-lg border bg-card">
            <OcpnFlattenedReplay
              height={760}
              fileId={selectedFile?.id}
              projectId={selectedFile?.project}
              initialAssetId={initialAssetId ?? null}
              filterEnabled={filterEnabled}
              localFilterParams={localFilterParams}
              onOpenModelAssets={() => setViewMode({ type: "modelAssets" })}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

export default OcpnFlattenedReplayView;
