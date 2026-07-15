import { createContext } from "react";

import type { EventLog } from "@/api/fileApi";
import type { Project } from "@/api/projectApi";

export interface WorkspaceContextValue {
  selectedProject: Project | null;
  selectedEventLog: EventLog | null;
  selectProject: (project: Project | null) => void;
  selectEventLog: (eventLog: EventLog | null) => void;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
