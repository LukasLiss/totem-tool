import { useContext, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { GlobalFilterToggle } from "@/components/ui/GlobalFilterToggle";
import { ReactFlowProvider } from "@xyflow/react";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import ProcessArea from "@/react_component/ProcessArea";
import OCCNVisualizer from "@/react_component/OCCNVisualizer";

/**
 * The Overview page: a first look at the selected event log.
 *
 * Deliberately only the Process Area and the OCCN. Everything else this page
 * used to repeat — log statistics, OC-DFG variants, the variants explorer and
 * the dotted chart — lives in the Analysis section, where it can be worked
 * with properly.
 */
export function DevDashboard() {
  const { selectedFile } = useContext(SelectedFileContext);
  const [occnFilterEnabled, setOccnFilterEnabled] = useState(true);

  return (
    <div>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <ProcessArea fileId={selectedFile?.id} />
        <Card className="@container/card">
          <CardHeader className="items-center relative z-10 justify-between">
            <div className="flex items-center gap-2">
              <CardTitle>Object-Centric Causal Net</CardTitle>
              <GlobalFilterToggle filterEnabled={occnFilterEnabled} onToggle={() => setOccnFilterEnabled(p => !p)} />
            </div>
            <CardDescription>Causal net with activity bindings and automatic layout</CardDescription>
          </CardHeader>
          <CardContent className="h-[640px] p-0">
            <ReactFlowProvider>
              <OCCNVisualizer
                height="100%"
                fileId={selectedFile?.id}
                showTitle={false}
                filterEnabled={occnFilterEnabled}
                onToggleFilter={() => setOccnFilterEnabled(p => !p)}
              />
            </ReactFlowProvider>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default DevDashboard;
