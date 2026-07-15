import type { EventLog } from "@/api/fileApi";
import type { Project } from "@/api/projectApi";

export interface WorkspaceSelection {
  selectedProject: Project | null;
  selectedEventLog: EventLog | null;
}

export type WorkspaceSelectionAction =
  | { type: "selectProject"; project: Project | null }
  | { type: "selectEventLog"; eventLog: EventLog | null };

export const initialWorkspaceSelection: WorkspaceSelection = {
  selectedProject: null,
  selectedEventLog: null,
};

export function soleEventLogForProject(
  projectId: number,
  eventLogs: EventLog[],
) {
  if (eventLogs.length !== 1 || eventLogs[0].project !== projectId) return null;
  return eventLogs[0];
}

export function workspaceSelectionReducer(
  state: WorkspaceSelection,
  action: WorkspaceSelectionAction,
): WorkspaceSelection {
  if (action.type === "selectProject") {
    const projectChanged = state.selectedProject?.id !== action.project?.id;
    return {
      selectedProject: action.project,
      selectedEventLog: projectChanged ? null : state.selectedEventLog,
    };
  }

  if (
    action.eventLog !== null &&
    action.eventLog.project !== state.selectedProject?.id
  ) {
    return state;
  }

  return {
    ...state,
    selectedEventLog: action.eventLog,
  };
}
