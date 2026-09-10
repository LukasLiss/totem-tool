// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listAssets } from "@/api/assetsApi";
import { runTotemConformance } from "@/api/totemConformanceApi";
import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";

import {
  createConformanceResponse,
  createTotemAsset,
} from "./testFixtures";
import { TotemConformanceView } from "./TotemConformanceView";

vi.mock("@/api/assetsApi", async () => {
  const actual = await vi.importActual<typeof import("@/api/assetsApi")>(
    "@/api/assetsApi"
  );
  return {
    ...actual,
    listAssets: vi.fn(),
  };
});

vi.mock("@/api/totemConformanceApi", async () => {
  const actual = await vi.importActual<
    typeof import("@/api/totemConformanceApi")
  >("@/api/totemConformanceApi");
  return {
    ...actual,
    runTotemConformance: vi.fn(),
  };
});

vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));

vi.mock("./TotemAssetSelector", () => ({
  TotemAssetSelector: ({
    assets,
    selectedAssetId,
    onSelectAsset,
  }: {
    assets: Array<{ id: number; name: string }>;
    selectedAssetId: number | null;
    onSelectAsset: (assetId: number) => void;
  }) => (
    <div>
      {assets.map((asset) => (
        <button
          key={asset.id}
          type="button"
          aria-pressed={selectedAssetId === asset.id}
          onClick={() => onSelectAsset(asset.id)}
        >
          Select {asset.name}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./TotemConformanceVisualization", () => ({
  TotemConformanceVisualization: ({
    model,
  }: {
    model: { nodes: unknown[] };
  }) => (
    <div data-testid="totem-visualization">
      Rendered {model.nodes.length} model nodes
    </div>
  ),
}));

const listAssetsMock = vi.mocked(listAssets);
const runTotemConformanceMock = vi.mocked(runTotemConformance);
const asset = createTotemAsset({ id: 42, project: 7 });
const secondAsset = createTotemAsset({
  id: 43,
  project: 7,
  name: "Alternative TOTeM",
});
const response = createConformanceResponse({ file_id: 12, asset_id: 42 });
const secondResponse = createConformanceResponse({
  file_id: 12,
  asset_id: 43,
});

function renderWorkflow(
  selectedFile: {
    id: number;
    project: number;
    file: string;
  } | null = { id: 12, project: 7, file: "event-log.xml" }
) {
  return render(
    <SelectedFileContext.Provider
      value={{
        selectedFile,
        setSelectedFile: vi.fn(),
      }}
    >
      <DashboardContext.Provider
        value={{
          viewMode: { type: "conformance", component: "totem" },
          setViewMode: vi.fn(),
        }}
      >
        <TotemConformanceView />
      </DashboardContext.Provider>
    </SelectedFileContext.Provider>
  );
}

describe("TOTeM conformance workflow integration", () => {
  beforeEach(() => {
    listAssetsMock.mockReset();
    runTotemConformanceMock.mockReset();
    listAssetsMock.mockResolvedValue([asset]);
    runTotemConformanceMock.mockResolvedValue(response);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("selects a stored model, runs conformance, and renders the result", async () => {
    renderWorkflow();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Select Reference TOTeM" })
      ).toBeTruthy()
    );
    expect(listAssetsMock).toHaveBeenCalledWith({
      projectId: 7,
      assetType: "TOTEM",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Select Reference TOTeM" })
    );
    await waitFor(() =>
      expect(screen.getByText("Ready to calculate")).toBeTruthy()
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Run conformance" })
    );

    await waitFor(() =>
      expect(screen.getByText("Conformance result")).toBeTruthy()
    );
    expect(runTotemConformanceMock).toHaveBeenCalledWith(12, 42);
    expect(screen.getByTestId("totem-visualization").textContent).toContain(
      "Rendered 2 model nodes"
    );
  });

  it("clears the old result and reruns against a newly selected model", async () => {
    listAssetsMock.mockResolvedValue([asset, secondAsset]);
    runTotemConformanceMock.mockImplementation(
      async (_eventLogId, assetId) =>
        assetId === secondAsset.id ? secondResponse : response
    );
    renderWorkflow();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Select Reference TOTeM" })
      ).toBeTruthy()
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Select Reference TOTeM" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Run conformance" })
    );
    await waitFor(() =>
      expect(screen.getByText("Conformance result")).toBeTruthy()
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Select Alternative TOTeM" })
    );

    await waitFor(() =>
      expect(screen.getByText("Ready to calculate")).toBeTruthy()
    );
    expect(screen.queryByText("Conformance result")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Run conformance" })
    );
    await waitFor(() =>
      expect(runTotemConformanceMock).toHaveBeenLastCalledWith(12, 43)
    );
    expect(runTotemConformanceMock.mock.calls).toEqual([
      [12, 42],
      [12, 43],
    ]);
  });

  it("does not load models or enable execution without an event log", () => {
    renderWorkflow(null);

    expect(screen.getByRole("status").textContent).toContain(
      "No event log selected"
    );
    expect(listAssetsMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Run conformance" }).hasAttribute(
        "disabled"
      )
    ).toBe(true);
  });
});
