import { useContext } from "react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";

const CONFORMANCE_LABELS = {
  totem: "TOTeM Conformance",
  occn: "OCCN Conformance",
};

export function ConformancePlaceholderView() {
  const { viewMode } = useContext(DashboardContext);
  const { selectedFile } = useContext(SelectedFileContext);

  if (viewMode.type !== "conformance") return null;

  return (
    <div className="flex min-h-screen flex-col">
      <SidebarTrigger className="m-2" />
      <main className="flex-1 p-4 pt-0">
        <div className="mx-auto w-full max-w-6xl">
          <Card>
            <CardHeader>
              <CardTitle>{CONFORMANCE_LABELS[viewMode.component]}</CardTitle>
              <CardDescription>
                {selectedFile?.project
                  ? "This conformance workflow will use the selected project context."
                  : "Select an event log before running conformance checking."}
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </main>
    </div>
  );
}

export default ConformancePlaceholderView;
