import {
  useCallback,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import { listEventLogs, type EventLog } from "@/api/fileApi";
import type { Project } from "@/api/projectApi";
import { WorkspaceContext } from "./WorkspaceContext";
import {
  initialWorkspaceSelection,
  soleEventLogForProject,
  workspaceSelectionReducer,
} from "./workspaceSelection";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [selection, dispatch] = useReducer(
    workspaceSelectionReducer,
    initialWorkspaceSelection,
  );
  const autoSelectionRequest = useRef(0);

  const selectProject = useCallback((project: Project | null) => {
    const request = ++autoSelectionRequest.current;
    dispatch({ type: "selectProject", project });

    if (!project) return;
    void listEventLogs(project.id)
      .then((eventLogs) => {
        if (request !== autoSelectionRequest.current) return;
        const eventLog = soleEventLogForProject(project.id, eventLogs);
        if (eventLog) dispatch({ type: "selectEventLog", eventLog });
      })
      .catch(() => {
        // Project selection remains valid when its event logs cannot be loaded.
      });
  }, []);

  const selectEventLog = useCallback((eventLog: EventLog | null) => {
    autoSelectionRequest.current += 1;
    dispatch({ type: "selectEventLog", eventLog });
  }, []);

  const value = useMemo(
    () => ({
      ...selection,
      selectProject,
      selectEventLog,
    }),
    [selection, selectProject, selectEventLog],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
