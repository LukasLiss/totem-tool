import React, { useContext } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ReactFlowProvider } from "@xyflow/react";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import VariantsExplorer from "@/react_component/VariantsExplorer";
import ProcessArea from "@/react_component/ProcessArea";
import Totem from "@/react_component/Totem";
import LogStatistics from '@/components/LogStatistics';
import OCDFGVisualizer from "@/react_component/OCDFGVisualizer";

export function DevDashboard() {
  const { selectedFile } = useContext(SelectedFileContext);

  return (
    <div>
      <SidebarTrigger/>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <LogStatistics
          fileId={selectedFile?.id}
          showNumEvents={true}
          showNumActivities={true}
          showNumObjects={true}
          showNumObjectTypes={true}
        />
        <ProcessArea fileId={selectedFile?.id} />
        <Totem fileId={selectedFile?.id} />
        <div className="relative h-[640px] overflow-hidden rounded-xl border bg-card shadow-sm">
          <ReactFlowProvider>
            <OCDFGVisualizer height="100%" fileId={selectedFile?.id} />
          </ReactFlowProvider>
        </div>
        <Card className="@container/card">
          <CardHeader className="items-center relative z-10 justify-between">
            <CardTitle>
              Variants Explorer
            </CardTitle>
            <CardDescription>
              Object-centric variant analysis
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 pb-0">
            <VariantsExplorer
              fileId={selectedFile?.id}
              colWidth={120}
              embedded={true}
            />
          </CardContent>
        </Card>
        <div className="bg-muted/50 min-h-[100vh] flex-1 rounded-xl md:min-h-min" />
      </div>
    </div>
  )
}

export default DevDashboard;
