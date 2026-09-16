// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listAssets, type ProjectAsset } from "@/api/assetsApi";
import {
  CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  LEADING_OBJECT_REPLAY_STRATEGY,
  getEventLogObjectTypes,
  getOCCNReplayUnitDetail,
  runOCCNConformance,
  type OCCNConformanceResponse,
  type OCCNReplayUnitDetailResponse,
} from "@/api/occnConformanceApi";
import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import canonicalOccn from "../../../../docs/examples/model-assets/occn-v1.json";

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
  return {
    ...actual,
    getOCCNReplayUnitDetail: vi.fn(),
    getEventLogEventColumns: vi.fn(),
    getEventLogObjectTypes: vi.fn(),
    runOCCNConformance: vi.fn(),
  };
});

const defaultOptions = {
  executionColumn: null,
  restrictToModelObjectTypes: false,
};

vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));

vi.mock("@/react_component/OCCNVisualizer", () => ({
  default: ({
    conformanceHighlights,
    data,
    missingConformanceActivities,
    unvisitedActivities,
  }: {
    conformanceHighlights: Record<string, string>;
    data: { activities: Array<{ id: string }> };
    missingConformanceActivities: string[];
    unvisitedActivities: string[];
  }) => (
    <div data-testid="occn-conformance-model">
      {JSON.stringify({
        highlights: conformanceHighlights,
        missing: missingConformanceActivities,
        unvisited: unvisitedActivities,
        activities: data.activities.map(({ id }) => id),
      })}
    </div>
  ),
}));

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
const getReplayUnitDetailMock = vi.mocked(getOCCNReplayUnitDetail);
const getEventLogObjectTypesMock = vi.mocked(getEventLogObjectTypes);
const runOCCNConformanceMock = vi.mocked(runOCCNConformance);

const asset: ProjectAsset = {
  id: 42,
  project: 7,
  name: "Reference OCCN",
  asset_type: "OCCN",
  content_json: canonicalOccn,
  metadata: {},
  created_by: 1,
  created_at: "2026-07-22T10:00:00Z",
  updated_at: "2026-07-22T10:00:00Z",
};

const response: OCCNConformanceResponse = {
  file_id: 12,
  asset_id: asset.id,
  replay_unit_strategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  leading_object_type: null,
  max_states: 1_000,
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
      stopping_activity: "Ship Order",
      stopping_phase: "visible_event",
      stopping_reason: "no_enabled_event_binding",
      last_replayed_activity: "Create Order",
      replayed_activities: ["START_Order", "Create Order"],
      stopping_object_types: ["Item", "Order"],
    },
  ],
};

const replayUnitDetail: OCCNReplayUnitDetailResponse = {
  file_id: 12,
  unit_id: response.unit_results[0].unit_id,
  replay_unit_strategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  leading_object_type: null,
  event_count: 3,
  object_types: ["Order"],
  pagination: {
    offset: 0,
    limit: 50,
    returned_count: 3,
    total_count: 3,
    has_previous: false,
    has_next: false,
    previous_offset: null,
    next_offset: null,
  },
  events: [
    {
      event_index: 0,
      event_id: "event-1",
      activity: "Create Order",
      timestamp_unix: 1_735_689_600,
      objects_by_type: { Order: ["order-1"] },
    },
    {
      event_index: 1,
      event_id: "event-2",
      activity: "Ship Order",
      timestamp_unix: 1_735_689_660,
      objects_by_type: {
        Item: ["item-1"],
        Order: ["order-1"],
      },
    },
    {
      event_index: 2,
      event_id: "event-3",
      activity: "Close Order",
      timestamp_unix: 1_735_689_720,
      objects_by_type: { Order: ["order-1"] },
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
    getReplayUnitDetailMock.mockReset();
    getEventLogObjectTypesMock.mockReset();
    runOCCNConformanceMock.mockReset();
    listAssetsMock.mockResolvedValue([asset]);
    getReplayUnitDetailMock.mockResolvedValue(replayUnitDetail);
    getEventLogObjectTypesMock.mockResolvedValue(["Item", "Order"]);
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
      CONNECTED_COMPONENTS_REPLAY_STRATEGY,
      null,
      1_000,
      defaultOptions
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "connected_components:000001",
      })
    );
    await waitFor(() =>
      expect(getReplayUnitDetailMock).toHaveBeenCalledWith(
        12,
        response.unit_results[0].unit_id,
        {
          replayUnitStrategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
          offset: 0,
          limit: 50,
        }
      )
    );
    expect(
      screen.getByRole("region", { name: "Replay unit detail" }).textContent
    ).toContain("Create Order");
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

    fireEvent.click(
      screen.getByRole("button", {
        name: "connected_components:000001",
      })
    );
    expect(
      screen
        .getByRole("button", { name: "connected_components:000001" })
        .getAttribute("aria-pressed")
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Run conformance" }));
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Conformance result" }).textContent
      ).toContain("Deviations found")
    );

    expect(runOCCNConformanceMock).toHaveBeenCalledTimes(2);
    const visualization = JSON.parse(
      screen.getByTestId("occn-conformance-model").textContent ?? "{}"
    );
    expect(visualization.highlights).toEqual({
      "Ship Order": "non_fitting",
    });
    expect(visualization.missing).toEqual(["Ship Order"]);
    expect(visualization.activities).toContain("Ship Order");
    expect(visualization.unvisited).toContain("a");
    const stoppingDetails = screen.getByLabelText(
      "Replay stopping-point details"
    ).textContent;
    expect(stoppingDetails).toContain("Ship Order");
    expect(stoppingDetails).toContain("No enabled binding matched the event");
    expect(stoppingDetails).toContain("Last replayed: Create Order");
    expect(
      screen
        .getByRole("button", { name: "connected_components:000001" })
        .getAttribute("aria-pressed")
    ).toBe("false");
    expect(screen.queryByText("Conformance completed")).toBeNull();
  });

  it("reruns a deviation immediately for a selected leading object type", async () => {
    runOCCNConformanceMock
      .mockResolvedValueOnce(nonFittingResponse)
      .mockResolvedValueOnce({
        ...response,
        replay_unit_strategy: LEADING_OBJECT_REPLAY_STRATEGY,
        leading_object_type: "Order",
      });
    renderWorkflow(asset.id);

    await waitFor(() => expect(screen.getByText("Ready to calculate")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Run conformance" }));
    await waitFor(() => expect(screen.getByText("Deviations found")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Order" }));

    await waitFor(() =>
      expect(runOCCNConformanceMock).toHaveBeenLastCalledWith(
        12,
        asset.id,
        LEADING_OBJECT_REPLAY_STRATEGY,
        "Order",
        1_000,
        defaultOptions
      )
    );
    expect(screen.getByRole("combobox", { name: "Replay unit strategy" }).textContent)
      .toContain("Leading object type");
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
        CONNECTED_COMPONENTS_REPLAY_STRATEGY,
        null,
        1_000,
        defaultOptions
      )
    );
  });

  it("shows a known failure in the loaded replay-unit detail", async () => {
    runOCCNConformanceMock.mockResolvedValue(nonFittingResponse);
    renderWorkflow(asset.id);

    await waitFor(() =>
      expect(screen.getByText("Ready to calculate")).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("button", { name: "Run conformance" }));
    await waitFor(() =>
      expect(screen.getByText("Deviations found")).toBeTruthy()
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "connected_components:000001",
      })
    );

    await waitFor(() => expect(screen.getByText("Failure point")).toBeTruthy());
    expect(
      screen.getByText("First failing event").parentElement?.textContent
    ).toContain("Event 2 of 3 / event-2");
  });

  it("retries a failed replay-detail request", async () => {
    getReplayUnitDetailMock
      .mockRejectedValueOnce(new Error("Detail service unavailable"))
      .mockResolvedValueOnce(replayUnitDetail);
    renderWorkflow(asset.id);

    await waitFor(() =>
      expect(screen.getByText("Ready to calculate")).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("button", { name: "Run conformance" }));
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Conformance result" }).textContent
      ).toContain("Every replay unit can be replayed")
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "connected_components:000001",
      })
    );

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Detail service unavailable"
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("Create Order")).toBeTruthy());
    expect(getReplayUnitDetailMock).toHaveBeenCalledTimes(2);
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
