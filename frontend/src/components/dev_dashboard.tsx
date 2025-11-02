import { useState, useContext, useEffect } from "react";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Badge } from "./ui/badge";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import { processFile } from "@/api/fileApi";

export function DevDashboard() {
    const [processedResult, setProcessedResult] = useState(null);

    const { selectedFile } = useContext(SelectedFileContext);
    useEffect(() => {
              const handleProcessFile = async () => {
                  console.log("handleProcessFile");
      
                  if (!selectedFile?.id) {
                  alert("Please select a file first");
                  return;
                  }
              
                  const token = localStorage.getItem("access_token");
      
                  try {
                  const result = await processFile(token, selectedFile.id);
                  setProcessedResult(result);
                  console.log(result);
                  } catch (err) {
                  console.error("Failed to process file:", err);
                  }
              };
      
              handleProcessFile();
          }, [selectedFile]);
    return(
      <div>
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
                  {processedResult}
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
          <div className="bg-muted/50 min-h-[100vh] flex-1 rounded-xl md:min-h-min" />
        </div>
      </div>
    )
}

export default DevDashboard;