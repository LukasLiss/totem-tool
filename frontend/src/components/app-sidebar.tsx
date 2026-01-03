"use client"

import React, { useState, useEffect, useContext } from "react";
import {
  AudioWaveform, Command, GalleryVerticalEnd,
  Map, PieChart, Settings2, FileStack, ArrowUp01
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
} from "@/components/ui/sidebar"
import { SelectedFileContext } from "../contexts/SelectedFileContext";
import { getUserFiles } from "../api/fileApi"
import { DevDash } from "./nav-dev-dash";
import { getDashboards } from "@/api/dashboardApi";

// sample data
// This is sample data.
const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  packages: [
    {
      name: "Acme Inc",
      logo: GalleryVerticalEnd,
      plan: "Enterprise",
    },
    {
      name: "Acme Corp.",
      logo: AudioWaveform,
      plan: "Startup",
    },
    {
      name: "Evil Corp.",
      logo: Command,
      plan: "Free",
    },
  ],
  dashboards: [
    {
      title: "Dashboards",
      url: "#",
      icon: FileStack,
      isActive: true,
      items: [
        {
          title: "Dashboard #1",
          url: "#",
        },
        {
          title: "Dashboard #2",
          url: "#",
        },
        {
          title: "+ Add New Dashboard",
          url: "#",
        },
      ],
    },
  ],
  filter: [
    
    {
      title: "Filter",
      url: "#",
      icon: ArrowUp01,
      isActive: true,
      items: [
        {
          title: "Filter #1",
          url: "#",
        },
        {
          title: "Filter #2",
          url: "#",
        },
        {
          title: "+ Add Custom Filter",
          url: "#",
        },
      ],
    },
    
  ],
  parameters: [
    {
      name: "Token replay",
      url: "#",
      icon: Settings2,
    },
    {
      name: "τ",
      url: "#",
      icon: PieChart,
    },
    {
      name: "Frequency",
      url: "#",
      icon: Map,
    },
  ],
}


export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
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
          return;
        }
        const response = await getUserFiles(token);
        const data = response.results || response;
        setFiles(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
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
    const token = localStorage.getItem("access_token");
    if (!token) {
      setDashboards([]);
      return;
    }
    try {
      if (!token) {
        console.error("No token found!");
        return;
      }
      const response = await getDashboards(token, selectedFile.project);
      const data = response.results || response;
      setDashboards(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setDashboards([]);
    }
  };
  fetchDashboards();
}, [selectedFile]);

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        {files && Array.isArray(files) && files.length > 0 && (
          <Switcher/>
        )}
      </SidebarHeader>
      <SidebarContent>
        <DevDash />
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
            } catch (err) {
              console.error(err);
              setDashboards([]);
            }
          }} 
        />
        <NavMain items={data.filter} />
        <NavProjects projects={data.parameters} />
      </SidebarContent>
      
    </Sidebar>
  )
}
