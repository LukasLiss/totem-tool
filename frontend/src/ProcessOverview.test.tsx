// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listAssets, type ProjectAsset } from "@/api/assetsApi";
import { DashboardProvider } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";

import { ProcessOverview } from "./ProcessOverview";

vi.mock("@/api/assetsApi", async () => {
  const actual = await vi.importActual<typeof import("@/api/assetsApi")>(
    "@/api/assetsApi"
  );
  return {
    ...actual,
    listAssets: vi.fn(),
  };
});

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: ReactNode }) => <>{children}</>,
  CollapsibleContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  CollapsibleTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/sidebar", () => {
  const Container = ({ children }: { children: ReactNode }) => <>{children}</>;
  const Button = ({
    children,
    ...props
  }: ComponentProps<"button"> & { tooltip?: string }) => (
    <button {...props}>{children}</button>
  );

  return {
    SidebarProvider: Container,
    SidebarInset: Container,
    SidebarGroup: Container,
    SidebarMenu: Container,
    SidebarMenuItem: Container,
    SidebarMenuSub: Container,
    SidebarMenuSubItem: Container,
    SidebarMenuButton: Button,
    SidebarMenuSubButton: Button,
    SidebarTrigger: () => null,
  };
});

vi.mock("@/components/app-sidebar", async () => {
  const React = await import("react");
  const { DashboardContext } = await import("@/contexts/DashboardContext");
  const { NavAnalysis } = await import("@/components/nav-analysis");
  const { NavConformance } = await import("@/components/nav-conformance");

  return {
    AppSidebar: () => {
      const { setViewMode } = React.useContext(DashboardContext);

      return (
        <nav aria-label="Test application navigation">
          <NavAnalysis />
          <NavConformance />
          <button
            type="button"
            onClick={() => setViewMode({ type: "modelAssets" })}
          >
            Model Assets
          </button>
        </nav>
      );
    },
  };
});

vi.mock("@/components/dev_dashboard", () => ({
  DevDashboard: () => <div>Overview page</div>,
}));
vi.mock("@/components/AnalysisView", () => ({
  AnalysisView: () => <div>Analysis page</div>,
}));
vi.mock("@/components/occn-conformance/OccnConformanceView", () => ({
  OccnConformanceView: ({ initialAssetId }: { initialAssetId?: number }) => (
    <div data-testid="occn-workflow">
      OCCN workflow
      {initialAssetId ? ` for asset ${initialAssetId}` : ""}
    </div>
  ),
}));
vi.mock("@/components/totem-conformance/TotemConformanceView", () => ({
  TotemConformanceView: ({ initialAssetId }: { initialAssetId?: number }) => (
    <div data-testid="totem-workflow">
      TOTeM workflow
      {initialAssetId ? ` for asset ${initialAssetId}` : ""}
    </div>
  ),
}));
vi.mock("@/editors/EditorView", () => ({
  EditorView: () => <div>Editor page</div>,
}));
vi.mock("@/components/grid", () => ({
  default: () => <div>Dashboard page</div>,
}));

const listAssetsMock = vi.mocked(listAssets);

const totemAsset: ProjectAsset = {
  id: 42,
  project: 7,
  name: "Reference TOTeM",
  asset_type: "TOTEM",
  content_json: {},
  metadata: {},
  created_by: 1,
  created_at: "2026-07-22T10:00:00Z",
  updated_at: "2026-07-22T10:00:00Z",
};

const occnAsset: ProjectAsset = {
  ...totemAsset,
  id: 43,
  name: "Reference OCCN",
  asset_type: "OCCN",
};

function renderOverview() {
  return render(
    <MemoryRouter initialEntries={["/overview"]}>
      <SelectedFileContext.Provider
        value={{
          selectedFile: { id: 12, project: 7, file: "event-log.xml" },
          setSelectedFile: vi.fn(),
        }}
      >
        <DashboardProvider>
          <ProcessOverview />
        </DashboardProvider>
      </SelectedFileContext.Provider>
    </MemoryRouter>
  );
}

describe("ProcessOverview conformance routing", () => {
  beforeEach(() => {
    listAssetsMock.mockReset();
    listAssetsMock.mockResolvedValue([totemAsset, occnAsset]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens the real TOTeM workflow from Conformance navigation", () => {
    renderOverview();

    fireEvent.click(screen.getByRole("button", { name: "TOTeM Conformance" }));

    expect(screen.getByTestId("totem-workflow").textContent).toContain(
      "TOTeM workflow"
    );
  });

  it("carries a Model Assets row selection into the TOTeM workflow", async () => {
    renderOverview();

    fireEvent.click(screen.getByRole("button", { name: "Model Assets" }));
    await waitFor(() => expect(screen.getByText("Reference TOTeM")).toBeTruthy());

    fireEvent.click(
      screen.getByRole("button", {
        name: "Use Reference TOTeM for conformance",
      })
    );

    expect(screen.getByTestId("totem-workflow").textContent).toContain(
      "asset 42"
    );
  });

  it("opens the real OCCN workflow from Conformance navigation", () => {
    renderOverview();

    fireEvent.click(screen.getByRole("button", { name: "OCCN Conformance" }));

    expect(screen.getByTestId("occn-workflow").textContent).toContain(
      "OCCN workflow"
    );
  });

  it("carries a Model Assets row selection into the OCCN workflow", async () => {
    renderOverview();

    fireEvent.click(screen.getByRole("button", { name: "Model Assets" }));
    await waitFor(() => expect(screen.getByText("Reference OCCN")).toBeTruthy());

    fireEvent.click(
      screen.getByRole("button", {
        name: "Use Reference OCCN for conformance",
      })
    );

    expect(screen.getByTestId("occn-workflow").textContent).toContain(
      "asset 43"
    );
  });

  it("keeps Analysis navigation outside the conformance workflows", () => {
    renderOverview();

    fireEvent.click(screen.getByRole("button", { name: "Process Area" }));
    expect(screen.getByText("Analysis page")).toBeTruthy();
    expect(screen.queryByTestId("totem-workflow")).toBeNull();
    expect(screen.queryByTestId("occn-workflow")).toBeNull();
  });
});
