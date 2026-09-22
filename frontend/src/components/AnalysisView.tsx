import React, { useCallback, useContext, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import { DashboardContext } from "@/contexts/DashboardContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import ProcessArea from "@/react_component/ProcessArea";
import NewOCDFGVariantsVisualizer from "@/react_component/NewOCDFGVariantsVisualizer";
import OCCNVisualizer from "@/react_component/OCCNVisualizer";
import VariantsExplorer from "@/react_component/VariantsExplorer";
import DottedChart from "@/react_component/DottedChart";
import { GlobalFilterToggle } from "@/components/ui/GlobalFilterToggle";
import OCPNVisualizer from "@/react_component/OCPNVisualizer";
import TotemMiner from "@/react_component/TotemMiner";
import { SqlQueryAnalysis } from "@/components/SqlQueryAnalysis";
import OrgaMiningExplorer from "@/react_component/OrgaMiningExplorer";
import OCHandoverExplorer from "@/react_component/OCHandoverExplorer";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AnalysisView() {
  const { viewMode } = useContext(DashboardContext);
  const { selectedFile } = useContext(SelectedFileContext);
  const [filterEnabled, setFilterEnabled] = useState(true);
  const toggleFilter = useCallback(() => setFilterEnabled(p => !p), []);

  if (viewMode.type !== "analysis") return null;

  const renderComponent = () => {
    switch (viewMode.component) {
      case "processArea":
        return (
          <div className="w-full max-w-7xl">
            <ProcessArea fileId={selectedFile?.id} height={700} />
          </div>
        );

      case "ocdfg":
        return (
          <div className="w-full max-w-7xl">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle>Object-Centric DFG</CardTitle>
                  <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={toggleFilter} />
                </div>
                <CardDescription>Directly-Follows Graph visualization</CardDescription>
              </CardHeader>
              <CardContent className="h-[700px] p-0">
                <ReactFlowProvider>
                  <NewOCDFGVariantsVisualizer
                    height="100%"
                    fileId={selectedFile?.id}
                    filterEnabled={filterEnabled}
                    onToggleFilter={toggleFilter}
                    showTitle={false}
                  />
                </ReactFlowProvider>
              </CardContent>
            </Card>
          </div>
        );

      case "occn":
        return (
          <div className="w-full max-w-7xl">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle>Object-Centric Causal Net</CardTitle>
                  <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={toggleFilter} />
                </div>
                <CardDescription>Causal net with activity bindings and automatic layout</CardDescription>
              </CardHeader>
              <CardContent className="h-[700px] p-0">
                <ReactFlowProvider>
                  <OCCNVisualizer
                    height="100%"
                    fileId={selectedFile?.id}
                    showTitle={false}
                    filterEnabled={filterEnabled}
                    onToggleFilter={toggleFilter}
                  />
                </ReactFlowProvider>
              </CardContent>
            </Card>
          </div>
        );

      case "variants":
        return (
          <div className="w-full max-w-7xl">
            <Card className="@container/card">
              <CardHeader className="items-center relative z-10 justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle>Variants Explorer</CardTitle>
                  <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={toggleFilter} />
                </div>
                <CardDescription>Object-centric variant analysis</CardDescription>
              </CardHeader>
              <CardContent className="p-0 pb-4">
                <VariantsExplorer
                  fileId={selectedFile?.id}
                  colWidth={120}
                  embedded={true}
                  filterEnabled={filterEnabled}
                />
              </CardContent>
            </Card>
          </div>
        );

      case "dottedChart":
        return (
          <div className="w-full max-w-7xl">
            <Card className="@container/card">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle>OC Dotted Chart</CardTitle>
                  <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={toggleFilter} />
                </div>
                <CardDescription>Object-centric event distribution</CardDescription>
              </CardHeader>
              <CardContent>
                <DottedChart
                  fileId={selectedFile?.id}
                  xAxis={{ type: "time" }}
                  yAxis={{ type: "activity" }}
                  colorBy={{ type: "activity" }}
                  shapeBy={{ type: "none" }}
                  rowOrder="first_occurrence"
                  maxPoints={10000}
                  showControls={true}
                  filterEnabled={filterEnabled}
                  className="min-h-[700px]"
                />
              </CardContent>
            </Card>
          </div>
        );

      case 'ocPetriNet':
        return (
          <div className="w-full max-w-7xl">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle>OC Petri Net</CardTitle>
                  <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={toggleFilter} />
                </div>
                <CardDescription>
                  Object-Centric Petri Net discovered from the event log
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[700px] p-0">
                <OCPNVisualizer
                  height="100%"
                  fileId={selectedFile?.id}
                  autoStart={true}
                  showControls={true}
                  filterEnabled={filterEnabled}
                />
              </CardContent>
            </Card>
          </div>
        );

      case 'totemMiner':
        return (
          <div className="w-full max-w-7xl">
            <TotemMiner
              fileId={selectedFile?.id}
              height={700}
              filterEnabled={filterEnabled}
              onToggleFilter={toggleFilter}
            />
          </div>
        );

      case 'sqlQuery':
        return (
          <div className="w-full max-w-7xl">
            <SqlQueryAnalysis
              fileId={selectedFile?.id}
              projectId={selectedFile?.project}
              height={760}
            />
          </div>
        );
      case 'orgaMining':
        return <OrgaMiningView fileId={selectedFile?.id} />;

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      {/* Keyed by component: the cases share a tree shape, so without this
          React reuses the ReactFlowProvider across a switch and the incoming
          view briefly renders the outgoing view's nodes — which is where the
          "Edge type occnArc not found" warnings came from. */}
      <div key={viewMode.component} className="flex-1 flex justify-center p-4 pt-4">
        {renderComponent()}
      </div>
    </div>
  );
}

export default AnalysisView;

const SLIDES = [
  { key: "orga",     label: "Resource Profiling" },
  { key: "handover", label: "Object-Centric Handover of Work" },
] as const;

function OrgaMiningView({ fileId }: { fileId?: number }) {
  const [activeIdx, setActiveIdx] = useState(0);

  return (
    <div className="w-full max-w-7xl flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setActiveIdx(i => (i + SLIDES.length - 1) % SLIDES.length)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium text-muted-foreground">
          {SLIDES[activeIdx].label}
        </span>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setActiveIdx(i => (i + 1) % SLIDES.length)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className={activeIdx !== 0 ? "hidden" : undefined}><OrgaMiningExplorer fileId={fileId} /></div>
      <div className={activeIdx !== 1 ? "hidden" : undefined}><OCHandoverExplorer fileId={fileId} /></div>
    </div>
  );
}
