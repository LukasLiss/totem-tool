// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listAssets, type ProjectAsset } from "@/api/assetsApi";
import {
  CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  runOCCNConformance,
  type OCCNConformanceResponse,
} from "@/api/occnConformanceApi";
import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";

import { OccnConformanceView } from "./OccnConformanceView";

vi.mock("@/api/assetsApi", async () => {
  const actual = await vi.importActual<typeof import("@/api/assetsApi")>(
    "@/api/assetsApi"
  );
  return { ...actual, listAssets: vi.fn() };
});

vi.mock("@/api/occnConformanceApi", async () => {
  const actual = await vi.importActual<
    typeof import("@/api/occnConformanceApi")
  >("@/api/occnConformanceApi");
  return { ...actual, runOCCNConformance: vi.fn() };
});

vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));

vi.mock("./OccnAssetSelector", () => ({
  OccnAssetSelector: ({
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

const listAssetsMock = vi.mocked(listAssets);
const runOCCNConformanceMock = vi.mocked(runOCCNConformance);

const asset: ProjectAsset = {
  id: 42,
  project: 7,
  name: "Reference OCCN",
  asset_type: "OCCN",
  content_json: {},
  metadata: {},
  created_by: 1,
  created_at: "2026-07-22T10:00:00Z",
  updated_at: "2026-07-22T10:00:00Z",
};

const response: OCCNConformanceResponse = {
  file_id: 12,
  asset_id: asset.id,
  replay_unit_strategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  fitness: 1,
  coverage: 1,
  total_units: 1,
  fitting_units: 1,
  non_fitting_units: 0,
  inconclusive_units: 0,
  unit_results: [
    {
      unit_id: "connected_components:000001",
      status: "fitting",
      replayable: true,
      event_count: 3,
      explored_state_count: 7,
      object_types: ["Order"],
      failure_event_index: null,
      failure_event_id: null,
      limit_reason: null,
    },
  ],
};

const nonFittingResponse: OCCNConformanceResponse = {
  ...response,
  fitness: 0,
  fitting_units: 0,
  non_fitting_units: 1,
  unit_results: [
    {
      ...response.unit_results[0],
      status: "non_fitting",
      replayable: false,
      failure_event_index: 1,
      failure_event_id: "event-2",
    },
  ],
};

function renderWorkflow(
  initialAssetId?: number,
  selectedFile: { id: number; project: number; file: string } | null = {
    id: 12,
    project: 7,
    file: "event-log.xml",
  }
) {
  return render(
    <SelectedFileContext.Provider
      value={{ selectedFile, setSelectedFile: vi.fn() }}
    >
      <DashboardContext.Provider
        value={{
          viewMode: { type: "conformance", component: "occn" },
          setViewMode: vi.fn(),
        }}
      >
        <OccnConformanceView initialAssetId={initialAssetId} />
      </DashboardContext.Provider>
    </SelectedFileContext.Provider>
  );
}

describe("OCCN conformance workflow integration", () => {
  beforeEach(() => {
    listAssetsMock.mockReset();
    runOCCNConformanceMock.mockReset();
    listAssetsMock.mockResolvedValue([asset]);
    runOCCNConformanceMock.mockResolvedValue(response);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("selects a stored model, runs conformance, and renders its result", async () => {
    renderWorkflow();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Select Reference OCCN" })
      ).toBeTruthy()
    );
    expect(listAssetsMock).toHaveBeenCalledWith({
      projectId: 7,
      assetType: "OCCN",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Select Reference OCCN" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Run conformance" }));

    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Conformance result" }).textContent
      ).toContain("Every replay unit can be replayed")
    );
    expect(
      screen.getByRole("region", { name: "Replay units" }).textContent
    ).toContain("connected_components:000001");
    expect(runOCCNConformanceMock).toHaveBeenCalledWith(
      12,
      asset.id,
      CONNECTED_COMPONENTS_REPLAY_STRATEGY
    );
  });

  it("replaces the visible result when conformance is run again", async () => {
    runOCCNConformanceMock
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(nonFittingResponse);
    renderWorkflow(asset.id);

    await waitFor(() => expect(screen.getByText("Ready to calculate")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Run conformance" }));
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Conformance result" }).textContent
      ).toContain("Every replay unit can be replayed")
    );

    fireEvent.click(screen.getByRole("button", { name: "Run conformance" }));
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Conformance result" }).textContent
      ).toContain("Deviations found")
    );

    expect(runOCCNConformanceMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Conformance completed")).toBeNull();
  });

  it("runs directly with an asset preselected by Model Assets", async () => {
    renderWorkflow(asset.id);

    await waitFor(() =>
      expect(screen.getByText("Ready to calculate")).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("button", { name: "Run conformance" }));

    await waitFor(() =>
      expect(runOCCNConformanceMock).toHaveBeenCalledWith(
        12,
        asset.id,
        CONNECTED_COMPONENTS_REPLAY_STRATEGY
      )
    );
  });

  it("does not load models or enable execution without an event log", () => {
    renderWorkflow(undefined, null);

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
