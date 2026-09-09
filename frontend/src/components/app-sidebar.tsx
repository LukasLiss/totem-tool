"use client"

import { useState, useEffect, useContext } from "react";
import {
  Settings2,
  ChevronRight, LogOut
} from "lucide-react"

import { NavDashboard } from "@/components/nav-dashboard"
import { Switcher } from "@/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenuButton,
} from "@/components/ui/sidebar"
import { SelectedFileContext } from "../contexts/SelectedFileContext";
import { getUserFiles } from "../api/fileApi"
import { NavOverview } from "./nav-overview";
import { NavAnalysis } from "./nav-analysis";
import { NavProject } from "./nav-project";
import { NavConformance } from "./nav-conformance";
import { NavEditor } from "./nav-editor";
import { NavPlayout } from "./nav-playout";
import { getDashboards } from "@/api/dashboardApi";
import { useNavigate } from "react-router-dom";

export function AppSidebar() {
  const navigate = useNavigate();
  const context = useContext(SelectedFileContext);
  const selectedFile = context?.selectedFile;
  const [, setFiles] = useState<any[]>([]);
  const [dashboards, setDashboards] = useState<any[]>([]);

  useEffect(() => {
    const fetchFiles = async () => {
      try {
        const response = await getUserFiles();
        const data = response.results || response;
        setFiles(Array.isArray(data) ? data : []);
      } catch (error: any) {
        console.error(error);
        setFiles([]);
      }
    };
    fetchFiles();
  }, []);

  useEffect(() => {
    const fetchDashboards = async () => {
      if (!selectedFile?.project) {
        setDashboards([]);
        return;
      }
      try {
        const response = await getDashboards(selectedFile.project);
        const data = response.results || response;
        setDashboards(Array.isArray(data) ? data : []);
      } catch (error: any) {
        console.error(error);
        setDashboards([]);
      }
    };
    fetchDashboards();
  }, [selectedFile]);

  if (!context) {
    console.error('SelectedFileContext not provided');
    return null;
  }

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <Switcher/>
      </SidebarHeader>
      <SidebarContent>
        <NavOverview />
        <NavProject />
        <NavAnalysis />
        <NavConformance />
        <NavDashboard
          dashboards={dashboards}
          refreshDashboards={async () => {
            if (!selectedFile?.project) return;
            try {
              const response = await getDashboards(selectedFile.project);
              const data = response.results || response;
              setDashboards(Array.isArray(data) ? data : []);
            } catch (error: any) {
              console.error(error);
              setDashboards([]);
            }
          }}
        />
        <NavEditor />
        <NavPlayout />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenuButton tooltip="Settings" onClick={() => navigate("/settings")}>
            <Settings2 />
            <span>Settings</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
        </SidebarMenuButton>
        <SidebarMenuButton tooltip="Log out" onClick={() => navigate("/logout")}>
            <LogOut />
            <span>Log out</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  )
}
