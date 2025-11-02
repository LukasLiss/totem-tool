import { AppSidebar } from "@/components/app-sidebar"
import { useState, useContext, useEffect } from "react";
import { processFile } from "./api/fileApi";
import { SelectedFileContext } from "./contexts/SelectedFileContext";
import {
  SidebarInset,
  SidebarProvider
} from "@/components/ui/sidebar"
import { DashboardContext } from "./contexts/DashboardContext"
import { DevDashboard } from "./components/dev_dashboard";


export function ProcessOverview() {
      const [ setProcessedResult] = useState(null);
  
      const { selectedFile } = useContext(SelectedFileContext);
      const { selectedDashboard } = useContext(DashboardContext);
      
      


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
      
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {selectedDashboard === "DevDash" && (
          <>
            {console.log("DevDash activated")}
            <DevDashboard />
          </>
        )}

      </SidebarInset>
    </SidebarProvider>
  )
}
 
export default ProcessOverview;