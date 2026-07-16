"use client"

import React, { useEffect, useState } from "react";
import { ChevronRight, LogOut } from "lucide-react"

import { NavDashboard } from "@/components/nav-dashboard"
import { Switcher } from "@/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenuButton,
} from "@/components/ui/sidebar"
import { NavAnalysis } from "./nav-analysis";
import { NavProject } from "./nav-project";
import { NavConformance } from "./nav-conformance";
import { NavEditor } from "./nav-editor";
import { getDashboards } from "@/api/dashboardApi";
import { useWorkspace } from "@/contexts/useWorkspace";
import { useNavigate } from "react-router-dom";

interface DashboardSummary {
  id: number;
  project: number;
  name: string;
  order_in_project: number;
  created_at: string;
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const navigate = useNavigate();
  const { selectedProject } = useWorkspace();
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);

  useEffect(() => {
    const fetchDashboards = async () => {
      if (!selectedProject) {
        setDashboards([]);
        return;
      }
      try {
        const response = await getDashboards(selectedProject.id);
        const data = response.results || response;
        setDashboards(Array.isArray(data) ? data : []);
      } catch (error: unknown) {
        console.error(error);
        setDashboards([]);
      }
    };
    void fetchDashboards();
  }, [selectedProject]);

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <Switcher/>
      </SidebarHeader>
      <SidebarContent>
        <NavProject />
        <NavAnalysis />
        <NavConformance />
        <NavDashboard
          dashboards={dashboards}
          refreshDashboards={async () => {
            if (!selectedProject) return;
            try {
              const response = await getDashboards(selectedProject.id);
              const data = response.results || response;
              setDashboards(Array.isArray(data) ? data : []);
            } catch (error: unknown) {
              console.error(error);
              setDashboards([]);
            }
          }}
        />
        <NavEditor />
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
