import { useContext, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { GlobalFilterToggle } from "@/components/ui/GlobalFilterToggle";
import { LocalFilterDropdown } from "@/components/ui/LocalFilterDropdown";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import ProcessArea from "@/react_component/ProcessArea";
import NewOCDFGVariantsVisualizer from "@/react_component/NewOCDFGVariantsVisualizer";
import { OCDFG_PROJECT_LAYOUT_KEY } from "@/react_component/ocdfg-layout/options";
import { useProjectLayoutStorage } from "@/react_component/ocdfg-layout/useLayoutOptions";
import LogStatistics from "@/components/LogStatistics";

/**
 * The Overview page: a first look at the selected event log.
 *
 * Log statistics, the Process Area and the object-centric directly-follows
 * graph. The DFG replaces the causal net that used to be here: it is computed
 * in SQL and renders within seconds even for large logs, while OCCN discovery
 * can take minutes and belongs in the Analysis section, where it can be
 * started deliberately. Everything else this page used to repeat — OC-DFG
 * variants, the variants explorer and the dotted chart — lives there too.
 */
export function DevDashboard() {
  const { selectedFile } = useContext(SelectedFileContext);
  const [dfgFilterEnabled, setDfgFilterEnabled] = useState(true);
  const [dfgLocalFilter, setDfgLocalFilter] = useState<Record<string, string>>({});
  // Same project-stored layout as Analysis → OC-DFG.
  const ocdfgLayout = useProjectLayoutStorage(selectedFile?.project, OCDFG_PROJECT_LAYOUT_KEY);

  return (
    <div>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-4">
        <LogStatistics
          fileId={selectedFile?.id}
          showNumEvents={true}
          showNumActivities={true}
          showNumObjects={true}
          showNumObjectTypes={true}
        />
        <ProcessArea fileId={selectedFile?.id} />
        <Card className="@container/card" data-testid="overview-dfg-card">
          <CardHeader className="items-center relative z-10 justify-between">
            <div className="flex items-center gap-2">
              <CardTitle>Object-Centric Directly-Follows Graph</CardTitle>
              <GlobalFilterToggle filterEnabled={dfgFilterEnabled} onToggle={() => setDfgFilterEnabled(p => !p)} />
              <LocalFilterDropdown fileId={selectedFile?.id} onFilterChange={setDfgLocalFilter} />
            </div>
            <CardDescription>Directly-follows relations per object type with arc weights and automatic layout</CardDescription>
          </CardHeader>
          <CardContent className="h-[640px] p-0">
            <NewOCDFGVariantsVisualizer
              height="100%"
              fileId={selectedFile?.id}
              showControls={true}
              initialInteractionLocked={true}
              layoutDirection="TB"
              filterEnabled={dfgFilterEnabled}
              onToggleFilter={() => setDfgFilterEnabled(p => !p)}
              showTitle={false}
              localFilterParams={dfgLocalFilter}
              storedLayout={ocdfgLayout.stored}
              onLayoutChange={ocdfgLayout.save}
              layoutScope={ocdfgLayout.scope}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default DevDashboard;
