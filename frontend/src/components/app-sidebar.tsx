"use client";

import { useState, useEffect, useContext } from "react";
import { Settings2, ChevronRight, LogOut } from "lucide-react";

import { NavDashboard } from "@/components/nav-dashboard";
import { Switcher } from "@/components/team-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import {
  SelectedFileContext,
  type SelectedFile,
} from "../contexts/SelectedFileContext";
import { getUserFiles } from "../api/fileApi";
import { NavOverview } from "./nav-overview";
import { NavAnalysis } from "./nav-analysis";
import { NavProject } from "./nav-project";
import { NavConformance } from "./nav-conformance";
import { NavEditor } from "./nav-editor";
import { NavPlayout } from "./nav-playout";
import { getDashboards } from "@/api/dashboardApi";
import { useNavigate } from "react-router-dom";

// In the desktop build the only account is the auto-logged-in Guest, so
// "Log out" would just drop the user's place and log them straight back in.
const LOCAL_MODE = Boolean(import.meta.env.VITE_LOCAL_MODE);

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const navigate = useNavigate();
  // Hooks must run unconditionally; the context has a non-null default.
  const { selectedFile } = useContext(SelectedFileContext);
  const [, setFiles] = useState<SelectedFile[]>([]);
  const [dashboards, setDashboards] = useState<
    {
      id: number;
      project: number;
      name: string;
      order_in_project: number;
      created_at: string;
    }[]
  >([]);

  useEffect(() => {
    const fetchFiles = async () => {
      try {
        const response = await getUserFiles();
        const data = response.results || response;
        setFiles(Array.isArray(data) ? data : []);
      } catch (error: unknown) {
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
      } catch (error: unknown) {
        console.error(error);
        setDashboards([]);
      }
    };
    fetchDashboards();
  }, [selectedFile]);

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <Switcher />
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
            } catch (error: unknown) {
              console.error(error);
              setDashboards([]);
            }
          }}
        />
        <NavEditor />
        <NavPlayout />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenuButton
          tooltip="Settings"
          onClick={() => navigate("/settings")}
        >
          <Settings2 />
          <span>Settings</span>
          <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
        </SidebarMenuButton>
        {!LOCAL_MODE && (
          <SidebarMenuButton
            tooltip="Log out"
            onClick={() => navigate("/logout")}
          >
            <LogOut />
            <span>Log out</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
