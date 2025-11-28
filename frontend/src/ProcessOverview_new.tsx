import { AppSidebar } from "@/components/app-sidebar"
import React, { useState, useContext, useEffect } from "react";
import { processFile } from "./api/fileApi";
import { SelectedFileContext } from "./contexts/SelectedFileContext";
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
import { DashboardContext } from "./contexts/DashboardContext"
import { DevDashboard } from "./components/dev_dashboard";
import { DashboardView } from "./components/dashboard_view";


export function ProcessOverview() {
  const [files, setFiles] = useState([]);
      const [processedResult, setProcessedResult] = useState(null);
  
      const { selectedFile } = useContext(SelectedFileContext);
      const { selectedDashboard, setSelectedDashboard } = useContext(DashboardContext);
      const [dashboards, setDashboards] = useState([])
      


      useEffect(() => {
          const handleProcessFile = async () => {
              console.log("handleProcessFile");
  
              if (!selectedFile?.id) {
              alert("Please select a file first");
              return;
              }
          
              const token = localStorage.getItem("access_token");
              console.log('token',token)
              
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
        <div>
          <SidebarTrigger />
          {selectedDashboard === "DevDash" ? (
            <>
              {console.log("DevDash activated")}
              <DevDashboard />
            </>) : (<DashboardView/>)
          }
        </div>


      </SidebarInset>
    </SidebarProvider>
  )
}
 
export default ProcessOverview;