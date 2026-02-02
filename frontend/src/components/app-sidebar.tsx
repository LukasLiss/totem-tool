"use client"

import React, { useState, useEffect, useContext } from "react";
import {
  AudioWaveform, Command, GalleryVerticalEnd,
  Map, PieChart, Settings2, FileStack, ArrowUp01,
  ChevronRight, LogOut
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavDashboard } from "@/components/nav-dashboard"
import { NavProjects } from "@/components/nav-projects"
import { Switcher } from "@/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
  SidebarFooter,
  SidebarMenuButton,
} from "@/components/ui/sidebar"
import { SelectedFileContext } from "../contexts/SelectedFileContext";
import { getUserFiles } from "../api/fileApi"
import { NavOverview } from "./nav-overview";
import { NavAnalysis } from "./nav-analysis";
import { getDashboards } from "@/api/dashboardApi";
import { error } from "console";
import { useLocation, useNavigate } from "react-router-dom";

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const navigate = useNavigate();
  const location = useLocation();
  const context = useContext(SelectedFileContext);
  if (!context) {
    console.error('SelectedFileContext not provided');
    return null;
  }
  const { selectedFile } = context;
  const [files, setFiles] = useState<any[]>([]);
  const [dashboards, setDashboards] = useState<any[]>([]);

  console.log("Current selectedFile:", selectedFile);

  useEffect(() => {
    const fetchFiles = async () => {
      const token = localStorage.getItem("access_token");
      if (!token) {
        setFiles([]);
        return;
      }
      try {
        if (!token) {
          console.error("No token found!");
          
        }
        const response = await getUserFiles(token);
        const data = response.results || response;
        setFiles(Array.isArray(data) ? data : []);
      } catch (error: any) {
              if (error.message === "UNAUTHORIZED") {
                  navigate("/login", {
                    replace: true,
                    state: { from: location.pathname },
                  });
                } else {
                  console.error(error);
                  setFiles([]);
            }
          };
    };
    fetchFiles();
  }, []);

  

  useEffect(() => {
  const fetchDashboards = async () => {
    if (!selectedFile?.project) {
      setDashboards([]);
      return;
    }
    const token = localStorage.getItem("access_token");
    if (!token) {
      setDashboards([]);
      
    }
    try {
      const response = await getDashboards(token, selectedFile.project);
      const data = response.results || response;
      setDashboards(Array.isArray(data) ? data : []);
    } catch (error: any) {
              if (error.message === "UNAUTHORIZED") {
                  navigate("/login", {
                    replace: true,
                    state: { from: location.pathname },
                  });
                } else {
                  console.error(error);
                  setDashboards([]);   }
          };
    }
  
  fetchDashboards();
}, [selectedFile]);

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        
          <Switcher/>
        
      </SidebarHeader>
      <SidebarContent>
        <NavOverview />
        <NavAnalysis />
        <NavDashboard 
          dashboards={dashboards} 
          refreshDashboards={async () => {
            if (!selectedFile?.project) return;
            const token = localStorage.getItem("access_token");
            if (!token) return;
            try {
              const response = await getDashboards(token, selectedFile.project);
              const data = response.results || response;
              setDashboards(Array.isArray(data) ? data : []);
            } catch (error: any) {
              if (error.message === "UNAUTHORIZED") {
                  navigate("/login", {
                    replace: true,
                    state: { from: location.pathname },
                  });
                } else {
                  console.error(error);
                  setDashboards([]);
            }
          };
        }}        /> 
        
        
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenuButton tooltip="Log out" onClick={() => navigate("/logout")}>
            <LogOut />
            <span>Log out</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  )
}
