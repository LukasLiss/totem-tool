// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import { SidebarProvider } from "@/components/ui/sidebar";

const exportDashboard = vi.fn();
const importDashboard = vi.fn();
const downloadJson = vi.fn();
const openJsonFile = vi.fn();

vi.mock("@/api/dashboardApi", () => ({
  addDashboard: vi.fn(),
  deleteDashboard: vi.fn(),
  renameDashboard: vi.fn(),
  exportDashboard: (...args: unknown[]) => exportDashboard(...args),
  importDashboard: (...args: unknown[]) => importDashboard(...args),
  DASHBOARD_BUNDLE_SCHEMA: "totem-dashboard",
  DASHBOARD_BUNDLE_VERSION: 1,
}));

vi.mock("@/editors/shared/io", () => ({
  downloadJson: (...args: unknown[]) => downloadJson(...args),
  openJsonFile: () => openJsonFile(),
  toFilename: (name: string, fallback: string) => name.toLowerCase() || fallback,
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

const { NavDashboard } = await import("./nav-dashboard");

const DASHBOARDS = [
  { id: 1, project: 9, name: "alpha", order_in_project: 0, created_at: "" },
  { id: 2, project: 9, name: "beta", order_in_project: 1, created_at: "" },
];

const BUNDLE = { schema: "totem-dashboard", version: 1, dashboard: { name: "beta" } };

function renderNav({
  openDashboardId = null as number | null,
  setViewMode = vi.fn(),
  refreshDashboards = vi.fn(),
  withoutProject = false,
} = {}) {
  const viewMode =
    openDashboardId === null
      ? ({ type: "overview" } as const)
      : ({ type: "dashboard", id: openDashboardId } as const);

  const rendered = render(
    <SelectedFileContext.Provider
      value={{
        selectedFile: withoutProject ? { id: 77 } : { id: 77, project: 9 },
        setSelectedFile: vi.fn(),
      }}
    >
      <DashboardContext.Provider
        value={{
          viewMode,
          setViewMode,
          registerNavigationGuard: vi.fn(() => () => {}),
        } as never}
      >
        <SidebarProvider>
          <NavDashboard
            dashboards={DASHBOARDS}
            refreshDashboards={refreshDashboards}
          />
        </SidebarProvider>
      </DashboardContext.Provider>
    </SelectedFileContext.Provider>
  );

  // The section is a Collapsible that starts closed, so the rows are not in
  // the DOM until it is opened.
  fireEvent.click(screen.getByText("Dashboards"));
  return rendered;
}

/** The row button carrying a dashboard's name. */
function row(name: string) {
  const label = screen.getByText(name);
  const button = label.closest("a,button");
  if (!button) throw new Error(`no row button for ${name}`);
  return button;
}

async function openRowMenu(name: string) {
  // Radix opens its menu on pointerdown, not click.
  fireEvent.pointerDown(
    screen.getByLabelText(`Actions for ${name}`),
    { button: 0, ctrlKey: false, pointerType: "mouse" }
  );
  await waitFor(() => screen.getByText("Export"));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("the open dashboard is highlighted", () => {
  it("marks only the dashboard currently being viewed", () => {
    renderNav({ openDashboardId: 2 });
    expect(row("beta").getAttribute("data-active")).toBe("true");
    expect(row("alpha").getAttribute("data-active")).toBe("false");
  });

  it("marks none of them outside dashboard view", () => {
    renderNav({ openDashboardId: null });
    expect(row("alpha").getAttribute("data-active")).toBe("false");
    expect(row("beta").getAttribute("data-active")).toBe("false");
  });
});

describe("export", () => {
  it("writes the fetched bundle to a file named after the dashboard", async () => {
    exportDashboard.mockResolvedValue(BUNDLE);
    renderNav();

    await openRowMenu("beta");
    fireEvent.click(screen.getByText("Export"));

    await waitFor(() => expect(downloadJson).toHaveBeenCalledWith("beta", BUNDLE));
    expect(exportDashboard).toHaveBeenCalledWith(2);
  });

  it("reports a failure instead of writing an empty file", async () => {
    exportDashboard.mockRejectedValue(new Error("boom"));
    renderNav();

    await openRowMenu("beta");
    fireEvent.click(screen.getByText("Export"));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(downloadJson).not.toHaveBeenCalled();
  });
});

describe("import", () => {
  const clickImport = () => fireEvent.click(screen.getByText("Import Dashboard"));

  it("sends the parsed file with the project and its event log", async () => {
    openJsonFile.mockResolvedValue(BUNDLE);
    importDashboard.mockResolvedValue({
      dashboard: { id: 5, name: "beta (imported)" },
      warnings: [],
    });
    const setViewMode = vi.fn();
    const refreshDashboards = vi.fn();
    renderNav({ setViewMode, refreshDashboards });

    clickImport();

    await waitFor(() =>
      expect(importDashboard).toHaveBeenCalledWith(9, 77, BUNDLE)
    );
    expect(refreshDashboards).toHaveBeenCalled();
    // Nothing to fix, so it opens straight away.
    await waitFor(() =>
      expect(setViewMode).toHaveBeenCalledWith({ type: "dashboard", id: 5 })
    );
  });

  it("shows what degraded instead of opening silently", async () => {
    openJsonFile.mockResolvedValue(BUNDLE);
    importDashboard.mockResolvedValue({
      dashboard: { id: 5, name: "beta (imported)" },
      warnings: [
        {
          code: "query_asset_missing",
          component_name: "KpiComponent",
          detail: 'No stored query called "Volumes" in this project',
        },
      ],
    });
    const setViewMode = vi.fn();
    renderNav({ setViewMode });

    clickImport();

    await waitFor(() => screen.getByText(/with 1 issue$/));
    expect(screen.getByText(/No stored query called "Volumes"/)).toBeTruthy();
    // The user decides when to navigate.
    expect(setViewMode).not.toHaveBeenCalled();
  });

  it("does nothing at all when the picker is cancelled", async () => {
    openJsonFile.mockResolvedValue(null);
    renderNav();

    clickImport();

    await waitFor(() => expect(openJsonFile).toHaveBeenCalled());
    expect(importDashboard).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("names the format rather than posting a model file", async () => {
    openJsonFile.mockResolvedValue({ schema: "totem", version: 1 });
    renderNav();

    clickImport();

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('That is a "totem" file, not a dashboard.')
    );
    expect(importDashboard).not.toHaveBeenCalled();
  });

  it("refuses a file from a newer build", async () => {
    openJsonFile.mockResolvedValue({ ...BUNDLE, version: 2 });
    renderNav();

    clickImport();

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "That file was written by a newer version of TOTeM."
      )
    );
    expect(importDashboard).not.toHaveBeenCalled();
  });

  it("asks for an event log before importing without a project", async () => {
    renderNav({ withoutProject: true });

    clickImport();

    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
    expect(openJsonFile).not.toHaveBeenCalled();
  });

  it("imports once however fast the row is double-clicked", async () => {
    openJsonFile.mockResolvedValue(BUNDLE);
    importDashboard.mockResolvedValue({
      dashboard: { id: 5, name: "beta" },
      warnings: [],
    });
    renderNav();

    // Same tick: the state flag has not re-rendered yet, so only the ref guard
    // in `beginSubmit` stops the second one.
    clickImport();
    clickImport();

    await waitFor(() => expect(importDashboard).toHaveBeenCalledTimes(1));
  });
});
