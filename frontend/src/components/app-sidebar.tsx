"use client"

import React, { useState, useEffect, useContext } from "react";
import {
  AudioWaveform, BookOpen, Bot, Command, Frame, GalleryVerticalEnd,
  Map, PieChart, Settings2, SquareTerminal, FileStack, ArrowUp01
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavMain2 } from "@/components/nav-main 2"
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
  const { selectedFile, setSelectedFile } = useContext(SelectedFileContext);
  const [files, setFiles] = useState<any[]>([]);
  const [selectedFileId, setSelectedFileId] = useState("");

  useEffect(() => {
    const fetchFiles = async () => {
      const token = localStorage.getItem("access_token");
      try {
        const response = await getUserFiles(token);
        setFiles(response);
      } catch (err) {
        console.error(err);
      }
    };
    fetchFiles();
  }, []);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        {files.length > 0 && (
          <Switcher
            projects={files}
            selectedId={selectedFileId}
            onSelect={(id) => {
              setSelectedFileId(id);
              const file = files.find((f) => f.id === id);
              if (file) setSelectedFile(file);
            }}
          />
        )}
      </SidebarHeader>
      <SidebarContent>
        <DevDash />
        <NavMain2 items={data.dashboards} />
        <NavMain items={data.filter} />
        <NavProjects projects={data.parameters} />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
