import React, { useContext } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
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
import OCDFGVisualizer from "@/react_component/OCDFGVisualizer";
import VariantsExplorer from "@/react_component/VariantsExplorer";

export function AnalysisView() {
  const { viewMode } = useContext(DashboardContext);
  const { selectedFile } = useContext(SelectedFileContext);

  if (viewMode.type !== 'analysis') return null;

  const renderComponent = () => {
    switch (viewMode.component) {
      case 'processArea':
        return (
          <div className="w-full max-w-7xl">
            <ProcessArea fileId={selectedFile?.id} height={700} />
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
                  <OCDFGVisualizer height="100%" fileId={selectedFile?.id} />
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
                  fileId={selectedFile?.id}
                  colWidth={120}
                  embedded={true}
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
