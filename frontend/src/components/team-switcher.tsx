"use client"

import { useState, useEffect, useContext } from "react";
import { BookOpen, ChevronsUpDown, Plus } from "lucide-react"
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
import { useNavigate } from "react-router-dom";

// extend type to allow optional logo component


export function Switcher() {
  const { isMobile } = useSidebar()
  const { selectedFile, setSelectedFile } = useContext(SelectedFileContext);
  console.log('beginning')
  console.log(selectedFile)
  const [files, setFiles] = useState<any[]>([]);
  const navigate = useNavigate();
  
  // find active project by id, fallback to first
const displayName = selectedFile?.file
  ? selectedFile.file.split("/").pop()
  : "No file selected";

  useEffect(() => {
      const fetchFiles = async () => {
        const token = localStorage.getItem("access_token");
        try {
          if (!token) {
            console.error("No token found!");
            
          }
          const response = await getUserFiles(token);
          setFiles(response);
          console.log('Loading files successfull')
        } catch (error: any) {
              if (error.message === "UNAUTHORIZED") {
                  navigate("/login", {
                    replace: true,
                    state: { from: location.pathname },
                  });
                } else {
                  console.error(error);
                  }
                };
      };
      fetchFiles();
    }, []);
  
  
  
  
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <BookOpen className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{displayName}</span>
              </div>
              
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-80 rounded-lg"
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
                onClick={() => {
                  setSelectedFile(project); // put entire file into context
                  console.log("Saved to context:", project);
                }}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border">
                  <BookOpen className="size-3.5 shrink-0" />
                </div>
                {project.file.split("/").pop()}
                <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}


            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 p-2" onClick={() => navigate("/upload")}>
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
