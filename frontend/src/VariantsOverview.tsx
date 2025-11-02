import { AppSidebar } from "@/components/app-sidebar"
import { useState, useContext, useEffect } from "react";
import { SelectedFileContext } from "./contexts/SelectedFileContext";
import { NumberofEvents } from './react_component/numberofevents';
import VariantsExplorer, { type Variant } from './react_component/VariantsExplorer';
import FileSelect from './react_component/fileselect';

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"


export function VariantsOverview() {
  const { selectedFile } = useContext(SelectedFileContext);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [status, setStatus] =
    useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const filePath = (selectedFile as any)?.file as string | undefined;
      const fileId = (selectedFile as any)?.id as number | undefined;

      const qs =
        fileId != null
          ? `?file_id=${fileId}`
          : filePath
            ? `?file_path=${encodeURIComponent(filePath)}`
            : "";

      setStatus("loading");
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
        const arr: Variant[] = Array.isArray(data) ? data : data.variants;

        if (!cancelled) {
          setVariants(arr ?? []);
          setStatus(arr && arr.length ? "ready" : "empty");
        }
      } catch (e: any) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(e?.message ? String(e.message) : "Unknown error while loading variants.");
        }
      }
    })();

    return () => { cancelled = true; };
  }, [selectedFile]);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0 ">
          <div className="grid auto-rows-min gap-4 md:grid-cols-3 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs">
            <Card className="@container/card">
              <CardHeader>
                <CardDescription>Number of Events</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                  <NumberofEvents />
                </CardTitle>
                <CardAction>
                  <Badge variant="outline">
                    +12.5%
                  </Badge>
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
            <div className="bg-muted/50 aspect-video rounded-xl" />
            <div className="bg-muted/50 aspect-video rounded-xl" />
          </div>
          <div className="bg-muted/50 min-h-[100vh] flex-1 rounded-xl md:min-h-min p-4">
            <div className="mb-4">
              <FileSelect />
            </div>
            {selectedFile ? (
              <p>Currently selected: {String((selectedFile as any).file || (selectedFile as any).name || "").split("/").pop()}</p>
            ) : (
              <p>No file selected</p>
            )}
            {status === "loading" && <div>Loading variants…</div>}
            {status === "error" && <div style={{ color: "crimson", fontWeight: 600 }}>
              Something went wrong! {errorMsg && <span>({errorMsg})</span>}
            </div>}
            {status === "empty" && <div>No variants.</div>}
            {status === "ready" && <VariantsExplorer variants={variants} />}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default VariantsOverview;
