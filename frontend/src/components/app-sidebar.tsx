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
import { NavProject } from "./nav-project";
import { NavConformance } from "./nav-conformance";
import { NavEditor } from "./nav-editor";
import { NavPlayout } from "./nav-playout";
import { getDashboards } from "@/api/dashboardApi";
import { useLocation, useNavigate } from "react-router-dom";

// In the desktop build the only account is the auto-logged-in Guest, so
// "Log out" would just drop the user's place and log them straight back in.
const LOCAL_MODE = Boolean(import.meta.env.VITE_LOCAL_MODE);

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const navigate = useNavigate();
  const location = useLocation();
  // Hooks must run unconditionally; the context has a non-null default.
  const { selectedFile } = useContext(SelectedFileContext);
  const [files, setFiles] = useState<any[]>([]);
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
        {!LOCAL_MODE && (
          <SidebarMenuButton tooltip="Log out" onClick={() => navigate("/logout")}>
              <LogOut />
              <span>Log out</span>
              <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
