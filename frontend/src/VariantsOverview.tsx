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
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown } from "lucide-react";


export function VariantsOverview() {
  const { selectedFile } = useContext(SelectedFileContext);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [status, setStatus] =
    useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [leadingType, setLeadingType] = useState<string>("");

  // Reset leading type when file changes
  useEffect(() => {
    setLeadingType("");
    setAvailableTypes([]);
  }, [selectedFile]);

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
  }, [selectedFile, leadingType]);

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
            <div className="mb-4 flex flex-wrap gap-4 items-center">
              <FileSelect />

              {selectedFile && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Perspective:</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="min-w-[150px] justify-between">
                        {leadingType}
                        <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[200px]">
                      <DropdownMenuLabel>Select Object Type</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuRadioGroup value={leadingType} onValueChange={setLeadingType}>
                        {availableTypes.length > 0 ? (
                          availableTypes.map((type) => (
                            <DropdownMenuRadioItem key={type} value={type}>
                              {type}
                            </DropdownMenuRadioItem>
                          ))
                        ) : (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">Loading types...</div>
                        )}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>

            {selectedFile ? (
              <p className="mb-2 text-sm text-muted-foreground">Currently selected: {String((selectedFile as any).file || (selectedFile as any).name || "").split("/").pop()}</p>
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
