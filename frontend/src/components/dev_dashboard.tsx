import React, { useContext, useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import { processFile } from "@/api/fileApi";
import { ReactFlowProvider } from "@xyflow/react";
import OCDFGVisualizer from "@/react_component/OCDFGVisualizer";
import VariantsExplorer, { type Variant } from "@/react_component/VariantsExplorer";
import TotemVisualizer from "@/react_component/TotemVisualizer";

export function DevDashboard() {
  const [processedResult, setProcessedResult] = useState(null);
  const [totemReloadSignal, setTotemReloadSignal] = useState(0);

  // Variant Explorer state
  const [variants, setVariants] = useState<Variant[]>([]);
  const [variantStatus, setVariantStatus] =
    useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [leadingType, setLeadingType] = useState<string>("");

  const { selectedFile } = useContext(SelectedFileContext);

  // Reset leading type when file changes
  useEffect(() => {
    setLeadingType("");
    setAvailableTypes([]);
  }, [selectedFile]);

  useEffect(() => {
    const handleProcessFile = async () => {
      if (!selectedFile?.id) {
        setProcessedResult(null);
        return;
      }

      const token = localStorage.getItem("access_token");

      try {
        const result = await processFile(token ?? "", selectedFile.id);
        setProcessedResult(result);
      } catch (err) {
        console.error("Failed to process file:", err);
      }
    };

    handleProcessFile();
  }, [selectedFile]);

  // Fetch variants
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const filePath = (selectedFile as any)?.file as string | undefined;
      const fileId = (selectedFile as any)?.id as number | undefined;

      let qs =
        fileId != null
          ? `?file_id=${fileId}`
          : filePath
            ? `?file_path=${encodeURIComponent(filePath)}`
            : "";

      // Only add leading_type parameter if it's set
      if (qs && leadingType) {
        qs += `&leading_type=${encodeURIComponent(leadingType)}`;
      }

      setVariantStatus("loading");
      setErrorMsg("");

      try {
        const url = `/api/variants/${qs}`;
        console.debug("GET", url);

        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          const text = await res.text();
          throw new Error(`Expected JSON, got: ${text.slice(0, 120)}…`);
        }

        const data = await res.json();

        // Extract available object types if provided
        if (data.object_types && Array.isArray(data.object_types)) {
          setAvailableTypes(data.object_types);

          // If leadingType is not set, auto-select the first alphabetically sorted type
          if (!leadingType && data.object_types.length > 0) {
            const sortedTypes = [...data.object_types].sort();
            setLeadingType(sortedTypes[0]);
            return; // Exit early to trigger re-fetch with selected type
          }
        }

        const arr: Variant[] = Array.isArray(data) ? data : data.variants;

        if (!cancelled) {
          setVariants(arr ?? []);
          setVariantStatus(arr && arr.length ? "ready" : "empty");
        }
      } catch (e: any) {
        if (!cancelled) {
          setVariantStatus("error");
          setErrorMsg(e?.message ? String(e.message) : "Unknown error while loading variants.");
        }
      }
    })();

    return () => { cancelled = true; };
  }, [selectedFile, leadingType]);
  return (
    <div>
      <SidebarTrigger/>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <Card className="@container/card">
          <CardHeader className="items-center relative z-10 justify-between">
            <CardTitle>
              Totem Visualizer
            </CardTitle>
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTotemReloadSignal((value) => value + 1)}
                disabled={!selectedFile?.id}
                className="flex items-center gap-2"
              >
                <RefreshCcw className="h-4 w-4" />
                Reload
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="h-[600px] p-0">
            <ReactFlowProvider>
              <TotemVisualizer
                eventLogId={selectedFile?.id}
                height="100%"
                backendBaseUrl="http://localhost:8000"
                reloadSignal={totemReloadSignal}
                title="Totem Visualizer"
              />
            </ReactFlowProvider>
          </CardContent>
        </Card>
        <div className="grid auto-rows-min gap-4 *:data-[slot=card]:bg-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:shadow-xs">
          <Card className="@container/card max-w-sm">
            <CardHeader>
              <CardDescription>Number of Events</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                {processedResult ?? "—"}
              </CardTitle>
              <CardAction>

              </CardAction>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="line-clamp-1 flex gap-2 font-medium">
                Trending up this month
              </div>
              <div className="text-muted-foreground">
                Visitors for the last 6 months
              </div>
            </CardFooter>
          </Card>
          <div className="relative h-[640px] overflow-hidden rounded-xl border bg-card shadow-sm">
            <ReactFlowProvider>
              <OCDFGVisualizer height="100%" fileId={selectedFile?.id} />
            </ReactFlowProvider>
          </div>
        </div>
        <div className="bg-muted/50 min-h-[100vh] flex-1 rounded-xl md:min-h-min" />
      </div>
    </div>
  )
}

export default DevDashboard;
