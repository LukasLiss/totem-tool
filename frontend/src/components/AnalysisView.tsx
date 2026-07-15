import React, { useContext } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ReactFlowProvider } from "@xyflow/react";
import { DashboardContext } from "@/contexts/DashboardContext";
import { useWorkspace } from "@/contexts/useWorkspace";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import ProcessArea from "@/react_component/ProcessArea";
import NewOCDFGVariantsVisualizer from "@/react_component/NewOCDFGVariantsVisualizer";
import VariantsExplorer from "@/react_component/VariantsExplorer";
import DottedChart from "@/react_component/DottedChart";

export function AnalysisView() {
  const { viewMode } = useContext(DashboardContext);
  const { selectedEventLog } = useWorkspace();

  if (viewMode.type !== 'analysis') return null;

  const renderComponent = () => {
    switch (viewMode.component) {
      case 'processArea':
        return (
          <div className="w-full max-w-7xl">
            <ProcessArea fileId={selectedEventLog?.id} height={700} />
          </div>
        );

      case 'ocdfg':
        return (
          <div className="w-full max-w-7xl">
            <Card>
              <CardHeader>
                <CardTitle>Object-Centric DFG</CardTitle>
                <CardDescription>Directly-Follows Graph visualization</CardDescription>
              </CardHeader>
              <CardContent className="h-[700px] p-0">
                <ReactFlowProvider>
                  <NewOCDFGVariantsVisualizer height="100%" fileId={selectedEventLog?.id} />
                </ReactFlowProvider>
              </CardContent>
            </Card>
          </div>
        );

      case 'variants':
        return (
          <div className="w-full max-w-7xl">
            <Card className="@container/card">
              <CardHeader className="items-center relative z-10 justify-between">
                <CardTitle>Variants Explorer</CardTitle>
                <CardDescription>Object-centric variant analysis</CardDescription>
              </CardHeader>
              <CardContent className="p-0 pb-0">
                <VariantsExplorer
                  fileId={selectedEventLog?.id}
                  colWidth={120}
                  embedded={true}
                />
              </CardContent>
            </Card>
          </div>
        );

      case 'dottedChart':
        return (
          <div className="w-full max-w-7xl">
            <Card className="@container/card">
              <CardHeader className="items-center relative z-10 justify-between">
                <CardTitle>OC Dotted Chart</CardTitle>
                <CardDescription>Object-centric event distribution</CardDescription>
              </CardHeader>
              <CardContent>
                <DottedChart
                  fileId={selectedEventLog?.id}
                  xAxis={{ type: "time" }}
                  yAxis={{ type: "activity" }}
                  colorBy={{ type: "activity" }}
                  shapeBy={{ type: "none" }}
                  rowOrder="first_occurrence"
                  maxPoints={10000}
                  showControls={true}
                  className="min-h-[700px]"
                />
              </CardContent>
            </Card>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <SidebarTrigger className="m-2" />
      <div className="flex-1 flex justify-center p-4 pt-0">
        {renderComponent()}
      </div>
    </div>
  );
}

export default AnalysisView;
