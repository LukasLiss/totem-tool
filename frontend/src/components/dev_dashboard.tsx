import React, { useContext, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button";
import { GlobalFilterToggle } from "@/components/ui/GlobalFilterToggle";
import { ReactFlowProvider } from "@xyflow/react";
import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import VariantsExplorer from "@/react_component/VariantsExplorer";
import ProcessArea from "@/react_component/ProcessArea";
import LogStatistics from '@/components/LogStatistics';
import NewOCDFGVariantsVisualizer from "@/react_component/NewOCDFGVariantsVisualizer";
import OCCNVisualizer from "@/react_component/OCCNVisualizer";
import OCHandoverExplorer from "@/react_component/OCHandoverExplorer";
import OrgaMiningExplorer from "@/react_component/OrgaMiningExplorer";

export function DevDashboard() {
  const { selectedFile } = useContext(SelectedFileContext);
  const { setViewMode } = useContext(DashboardContext);
  const [ocdfgFilterEnabled, setOcdfgFilterEnabled] = useState(false);
  const [occnFilterEnabled, setOccnFilterEnabled] = useState(false);
  const [variantsFilterEnabled, setVariantsFilterEnabled] = useState(false);

  return (
    <div>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <LogStatistics
          fileId={selectedFile?.id}
          showNumEvents={true}
          showNumActivities={true}
          showNumObjects={true}
          showNumObjectTypes={true}
        />
        {/* <ProcessArea fileId={selectedFile?.id} /> */}
        {/* <div className="relative h-[640px] overflow-hidden rounded-xl border bg-card shadow-sm">
          <ReactFlowProvider>
            <NewOCDFGVariantsVisualizer
              height="100%"
              fileId={selectedFile?.id}
              filterEnabled={ocdfgFilterEnabled}
              onToggleFilter={() => setOcdfgFilterEnabled(p => !p)}
            />
          </ReactFlowProvider>
        </div> */}
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
        <Card className="@container/card">
          <CardHeader className="items-center relative z-10 justify-between">
            <div className="flex items-center gap-2">
              <CardTitle>Variants Explorer</CardTitle>
              <GlobalFilterToggle filterEnabled={variantsFilterEnabled} onToggle={() => setVariantsFilterEnabled(p => !p)} />
            </div>
            <CardDescription>Object-centric variant analysis</CardDescription>
          </CardHeader>
          <CardContent className="p-0 pb-0">
            <VariantsExplorer
              fileId={selectedFile?.id}
              colWidth={120}
              embedded={true}
              filterEnabled={variantsFilterEnabled}
            />
          </CardContent>
        </Card>
        <Card className="@container/card">
          <CardHeader className="items-center relative z-10 justify-between">
            <CardTitle>
              OC Dotted Chart
            </CardTitle>
            <CardDescription>
              Object-centric event distribution
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => setViewMode({ type: "analysis", component: "dottedChart" })}
              disabled={!selectedFile?.id}
            >
              Open OC Dotted Chart
            </Button>
          </CardContent>
        </Card>
        <Card className="@container/card">
          <CardHeader className="items-center relative z-10 justify-between">
            <CardTitle>OC Handover of Work</CardTitle>
            <CardDescription>Object-centric resource handover analysis</CardDescription>
          </CardHeader>
          <CardContent className="p-0 pb-0">
            <OCHandoverExplorer fileId={selectedFile?.id} embedded={true} fileName={selectedFile?.file?.split("/").pop()} />
          </CardContent>
        </Card>
        <Card className="@container/card">
          <CardHeader className="items-center relative z-10 justify-between">
            <CardTitle>Resource-Activity Matrix</CardTitle>
            <CardDescription>Organizational mining — who does what</CardDescription>
          </CardHeader>
          <CardContent className="p-0 pb-0">
            <OrgaMiningExplorer fileId={selectedFile?.id} embedded={true} />
          </CardContent>
        </Card>
        <div className="bg-muted/50 min-h-[100vh] flex-1 rounded-xl md:min-h-min" />
      </div>
    </div>
  )
}

export default DevDashboard;
