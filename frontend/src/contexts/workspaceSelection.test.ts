import { describe, expect, it } from "vitest";

import type { EventLog } from "@/api/fileApi";
import type { Project } from "@/api/projectApi";
import {
  initialWorkspaceSelection,
  soleEventLogForProject,
  workspaceSelectionReducer,
} from "./workspaceSelection";

const firstProject: Project = {
  id: 1,
  name: "First",
  display_name: "First",
  created_at: "2026-07-14T10:00:00Z",
};

const renamedFirstProject: Project = {
  ...firstProject,
  name: "Renamed",
  display_name: "Renamed",
};

const secondProject: Project = {
  id: 2,
  name: "Second",
  display_name: "Second",
  created_at: "2026-07-14T11:00:00Z",
};

const firstLog: EventLog = {
  id: 10,
  project: firstProject.id,
  file: "/files/first.json",
  uploaded_at: "2026-07-14T10:30:00Z",
  updated_at: "2026-07-14T10:30:00Z",
};

const secondLog: EventLog = {
  id: 20,
  project: secondProject.id,
  file: "/files/second.json",
  uploaded_at: "2026-07-14T11:30:00Z",
  updated_at: "2026-07-14T11:30:00Z",
};

describe("workspaceSelectionReducer", () => {
  it("selects a project without selecting an event log", () => {
    const state = workspaceSelectionReducer(initialWorkspaceSelection, {
      type: "selectProject",
      project: firstProject,
    });

    expect(state).toEqual({
      selectedProject: firstProject,
      selectedEventLog: null,
    });
  });

  it("accepts an event log from the selected project", () => {
    const state = workspaceSelectionReducer(
      { selectedProject: firstProject, selectedEventLog: null },
      { type: "selectEventLog", eventLog: firstLog },
    );

    expect(state.selectedEventLog).toEqual(firstLog);
  });

  it("refuses an event log when no project is selected", () => {
    const state = workspaceSelectionReducer(initialWorkspaceSelection, {
      type: "selectEventLog",
      eventLog: firstLog,
    });

    expect(state).toBe(initialWorkspaceSelection);
  });

  it("refuses an event log from another project", () => {
    const state = {
      selectedProject: secondProject,
      selectedEventLog: null,
    };
    const result = workspaceSelectionReducer(state, {
      type: "selectEventLog",
      eventLog: firstLog,
    });

    expect(result).toBe(state);
  });

  it("clears the event log when the selected project changes", () => {
    const state = workspaceSelectionReducer(
      { selectedProject: firstProject, selectedEventLog: firstLog },
      { type: "selectProject", project: secondProject },
    );

    expect(state).toEqual({
      selectedProject: secondProject,
      selectedEventLog: null,
    });
  });

  it("preserves the event log when refreshing the same project", () => {
    const state = workspaceSelectionReducer(
      { selectedProject: firstProject, selectedEventLog: firstLog },
      { type: "selectProject", project: renamedFirstProject },
    );

    expect(state).toEqual({
      selectedProject: renamedFirstProject,
      selectedEventLog: firstLog,
    });
  });

  it("clears the event log when the project selection is cleared", () => {
    const state = workspaceSelectionReducer(
      { selectedProject: firstProject, selectedEventLog: firstLog },
      { type: "selectProject", project: null },
    );

    expect(state).toEqual({
      selectedProject: null,
      selectedEventLog: null,
    });
  });

  it("rejects a stale log after switching projects and accepts a matching log", () => {
    const switchedState = workspaceSelectionReducer(
      { selectedProject: firstProject, selectedEventLog: firstLog },
      { type: "selectProject", project: secondProject },
    );
    const staleSelection = workspaceSelectionReducer(switchedState, {
      type: "selectEventLog",
      eventLog: firstLog,
    });
    const matchingSelection = workspaceSelectionReducer(staleSelection, {
      type: "selectEventLog",
      eventLog: secondLog,
    });

    expect(staleSelection).toBe(switchedState);
    expect(matchingSelection).toEqual({
      selectedProject: secondProject,
      selectedEventLog: secondLog,
    });
  });
});

describe("soleEventLogForProject", () => {
  it("returns the only event log belonging to the project", () => {
    expect(soleEventLogForProject(firstProject.id, [firstLog])).toBe(firstLog);
  });

  it("does not choose between multiple event logs", () => {
    const anotherFirstLog = {
      ...firstLog,
      id: 11,
      file: "/files/another.json",
    };

    expect(
      soleEventLogForProject(firstProject.id, [firstLog, anotherFirstLog]),
    ).toBeNull();
  });

  it("does not return an event log belonging to another project", () => {
    expect(soleEventLogForProject(firstProject.id, [secondLog])).toBeNull();
  });

  it("returns null for a project without event logs", () => {
    expect(soleEventLogForProject(firstProject.id, [])).toBeNull();
  });
});
