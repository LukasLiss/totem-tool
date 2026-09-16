// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SelectedFileContext } from "@/contexts/SelectedFileContext";

import {
  createConformanceResponse,
  createTotemAsset,
} from "./testFixtures";
import { TotemConformanceView } from "./TotemConformanceView";
import { useTotemConformanceWorkflow } from "./useTotemConformanceWorkflow";

vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("./TotemAssetSelector", () => ({
  TotemAssetSelector: () => <div data-testid="asset-selector" />,
}));
vi.mock("./TotemConformanceVisualization", () => ({
  TotemConformanceVisualization: ({ model }: { model: { nodes: unknown[] } }) => (
    <div data-testid="totem-visualization">{model.nodes.length} nodes</div>
  ),
}));
vi.mock("./useTotemConformanceWorkflow", () => ({
  useTotemConformanceWorkflow: vi.fn(),
}));

const useWorkflowMock = vi.mocked(useTotemConformanceWorkflow);
const asset = createTotemAsset();

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
    canRun: true,
    running: false,
    result: null,
    error: null,
    run: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useTotemConformanceWorkflow>;
}

function renderView(initialAssetId?: number) {
  return render(
    <SelectedFileContext.Provider
      value={{
        selectedFile: { id: 12, project: 7, file: "ocel2-export.xml" },
        setSelectedFile: vi.fn(),
      }}
    >
      <TotemConformanceView initialAssetId={initialAssetId} />
    </SelectedFileContext.Provider>
  );
}

describe("TotemConformanceView result states", () => {
  beforeEach(() => {
    useWorkflowMock.mockReturnValue(workflowState());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the ready state before a calculation", () => {
    renderView();

    expect(screen.getByText("Ready to calculate")).toBeTruthy();
    expect(screen.queryByTestId("totem-visualization")).toBeNull();
  });

  it("passes an asset requested by the Model Assets action into the workflow", () => {
    renderView(42);

    expect(useWorkflowMock).toHaveBeenCalledWith(12, 7, 42);
  });

  it("renders the visualization after a successful calculation", () => {
    useWorkflowMock.mockReturnValue(
      workflowState({ result: createConformanceResponse() })
    );
    renderView();

    expect(screen.getByText("Conformance result")).toBeTruthy();
    expect(screen.getByText("Reference TOTeM")).toBeTruthy();
    expect(screen.getByTestId("totem-visualization").textContent).toBe("2 nodes");
  });

  it("shows an invalid-model state without mounting the visualization", () => {
    const invalidAsset = createTotemAsset({
      content_json: { schema: "totem", version: 2 },
    });
    useWorkflowMock.mockReturnValue(
      workflowState({
        result: createConformanceResponse(),
        assetSelection: {
          ...workflowState().assetSelection,
          assets: [invalidAsset],
          selectedAsset: invalidAsset,
        },
      })
    );
    renderView();

    expect(screen.getByText("TOTeM model cannot be displayed")).toBeTruthy();
    expect(screen.queryByTestId("totem-visualization")).toBeNull();
  });
});
