"use client"

import React, { useState, useEffect, useContext } from "react";
import { ChevronsUpDown, Plus } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { SelectedFileContext } from "../contexts/SelectedFileContext.tsx";
import { getUserFiles } from "../api/fileApi"


// extend type to allow optional logo component
type Project = {
  id: string | number
  name: string
  logo?: React.ComponentType<{ className?: string }>
}

export function Switcher(){
  const { isMobile } = useSidebar()
  const { selectedFile, setSelectedFile } = useContext(SelectedFileContext);
  console.log('beginning')
  console.log(selectedFile)
  const [files, setFiles] = useState<any[]>([]);
  const [selectedFileId, setSelectedFileId] = useState("");
  // find active project by id, fallback to first
  const displayName = selectedFile?.name ?? "No file selected";
  const displayInitial = selectedFile?.file?.name?.charAt(0) ?? "?";

  useEffect(() => {
      const fetchFiles = async () => {
        const token = localStorage.getItem("access_token");
        try {
          const response = await getUserFiles(token);
          setFiles(response);
          console.log('Loading files successfull')
        } catch (err) {
          console.error(err);
        }
      };
      fetchFiles();
    }, []);
  
  const handleSelectChange = (e) => {
        const fileId = Number(e.target.value);
        setSelectedFileId(fileId);

        const file = files.find((f) => f.id === fileId);
        if (file) {
            setSelectedFile(file); // save into context
            console.log("Saved to context:", file);
        }
    };
  
  
  
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="bg-sidebar-primary flex items-center justify-center rounded-lg">
                <span className="text-xs font-bold">{displayInitial}</span>
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{displayName}</span>
              </div>
              
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Projects
            </DropdownMenuLabel>

            {files.map((project, index) => (
              <DropdownMenuItem
                key={project.id}
                onClick={handleSelectChange}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border">
                    <span className="text-xs">{project.file.charAt(0)}</span>
                </div>
                {project.file.split("/").pop()}
                <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 p-2">
              <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                <Plus className="size-4" />
              </div>
              <div className="text-muted-foreground font-medium">
                Add project
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
