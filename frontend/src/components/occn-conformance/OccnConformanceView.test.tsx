// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectAsset } from "@/api/assetsApi";
import {
  CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  type OCCNConformanceResponse,
} from "@/api/occnConformanceApi";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";

import { OccnConformanceView } from "./OccnConformanceView";
import { useOccnConformanceWorkflow } from "./useOccnConformanceWorkflow";

vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("./OccnAssetSelector", () => ({
  OccnAssetSelector: () => <div data-testid="asset-selector" />,
}));
vi.mock("./useOccnConformanceWorkflow", () => ({
  useOccnConformanceWorkflow: vi.fn(),
}));

const useWorkflowMock = vi.mocked(useOccnConformanceWorkflow);

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

function workflowState(overrides: Record<string, unknown> = {}) {
  return {
    assetSelection: {
      assets: [asset],
      selectedAssetId: asset.id,
      selectedAsset: asset,
      loading: false,
      error: null,
      selectAsset: vi.fn(),
      retry: vi.fn(),
    },
    replayUnitStrategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
    canRun: true,
    running: false,
    result: null,
    error: null,
    run: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useOccnConformanceWorkflow>;
}

function renderView(
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
      <OccnConformanceView initialAssetId={initialAssetId} />
    </SelectedFileContext.Provider>
  );
}

describe("OccnConformanceView", () => {
  beforeEach(() => {
    useWorkflowMock.mockReturnValue(workflowState());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the selected inputs and ready state before a calculation", () => {
    renderView();

    expect(screen.getByText("OCCN Conformance")).toBeTruthy();
    expect(screen.getByText("event-log.xml")).toBeTruthy();
    expect(screen.getByText("Connected components")).toBeTruthy();
    expect(screen.getByText("Ready to calculate")).toBeTruthy();
  });

  it("passes a Model Assets row selection into the workflow", () => {
    renderView(42);

    expect(useWorkflowMock).toHaveBeenCalledWith(12, 7, 42);
  });

  it("shows running, failure, and result states", () => {
    useWorkflowMock.mockReturnValue(
      workflowState({ running: true, canRun: false })
    );
    renderView();
    expect(screen.getByText("Calculating conformance")).toBeTruthy();

    cleanup();
    useWorkflowMock.mockReturnValue(
      workflowState({ error: "Replay failed", canRun: true })
    );
    renderView();
    expect(screen.getByRole("alert").textContent).toContain("Replay failed");

    cleanup();
    useWorkflowMock.mockReturnValue(workflowState({ result: response }));
    renderView();
    expect(
      screen.getByRole("region", { name: "Conformance result" }).textContent
    ).toContain("Every replay unit can be replayed");
    expect(
      screen.getByRole("region", { name: "Replay units" }).textContent
    ).toContain("connected_components:000001");
    expect(screen.queryByText("Conformance completed")).toBeNull();
  });

  it("renders an inconclusive response without a success claim", () => {
    useWorkflowMock.mockReturnValue(
      workflowState({
        result: {
          ...response,
          fitness: null,
          coverage: 0,
          fitting_units: 0,
          inconclusive_units: 1,
          unit_results: [
            {
              ...response.unit_results[0],
              status: "inconclusive",
              replayable: null,
              explored_state_count: 1000,
              limit_reason: "max_states",
            },
          ],
        },
      })
    );
    renderView();

    const summary = screen.getByRole("region", { name: "Conformance result" });
    expect(summary.textContent).toContain("Inconclusive");
    expect(summary.textContent).toContain("Not available");
    expect(summary.textContent).toContain("0%");
    expect(screen.queryByText("Conformance completed")).toBeNull();
  });

  it("disables execution without an event log", () => {
    useWorkflowMock.mockReturnValue(
      workflowState({
        canRun: false,
        assetSelection: {
          ...workflowState().assetSelection,
          assets: [],
          selectedAssetId: null,
          selectedAsset: null,
        },
      })
    );
    renderView(undefined, null);

    expect(screen.getByRole("status").textContent).toContain(
      "No event log selected"
    );
    expect(
      screen.getByRole("button", { name: "Run conformance" }).hasAttribute(
        "disabled"
      )
    ).toBe(true);
  });
});
