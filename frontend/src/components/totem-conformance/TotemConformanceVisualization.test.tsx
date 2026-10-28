// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createConformanceResponse,
  createTotemAsset,
} from "./testFixtures";
import { TotemConformanceVisualization } from "./TotemConformanceVisualization";
import type {
  TotemConformanceEdgeType,
  TotemConformanceNodeType,
} from "./visualizationFlow";
import { prepareTotemVisualization } from "./visualizationPreparation";

type FlowProps = {
  nodes: TotemConformanceNodeType[];
  edges: TotemConformanceEdgeType[];
  nodesDraggable?: boolean;
  onNodesChange?: (changes: unknown[]) => void;
  onNodeClick?: (event: unknown, node: { id: string }) => void;
};

/** Props of the last `<ReactFlow>` render, so the canvas can be driven headlessly. */
let flowProps: FlowProps | null = null;
const fitView = vi.fn();

vi.mock("@xyflow/react", async () => {
  const actual =
    await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    ReactFlow: (props: FlowProps) => {
      flowProps = props;
      return <div data-testid="react-flow" />;
    },
    ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    Background: () => null,
    Controls: () => null,
    useReactFlow: () => ({ fitView }),
  };
});

const result = createConformanceResponse();

function renderVisualization() {
  const preparation = prepareTotemVisualization(createTotemAsset(), result, 12);
  if (preparation.status !== "ready") {
    throw new Error(`fixture model is not renderable: ${preparation.status}`);
  }
  return render(
    <TotemConformanceVisualization model={preparation.model} result={result} />
  );
}

function flow(): FlowProps {
  if (!flowProps) throw new Error("ReactFlow was not rendered");
  return flowProps;
}

function nodeById(id: string): TotemConformanceNodeType {
  const node = flow().nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`no node ${id} on the canvas`);
  return node;
}

/** Moves a node the way React Flow reports the end of a drag. */
function dragNodeTo(id: string, x: number, y: number) {
  act(() => {
    flow().onNodesChange?.([{ id, type: "position", position: { x, y }, dragging: false }]);
  });
}

beforeEach(() => {
  flowProps = null;
  fitView.mockClear();
});

afterEach(cleanup);

describe("TotemConformanceVisualization", () => {
  it("lets individual nodes be dragged", () => {
    renderVisualization();

    // Left at its default, so dragging a node moves the node instead of
    // falling through to the pane and panning the whole diagram (#405).
    expect(flow().nodesDraggable).toBeUndefined();
    expect(flow().onNodesChange).toBeTypeOf("function");
  });

  it("keeps a dragged position", () => {
    renderVisualization();
    const original = { ...nodeById("Order").position };

    dragNodeTo("Order", 640, 480);

    expect(nodeById("Order").position).toEqual({ x: 640, y: 480 });
    expect(original).not.toEqual({ x: 640, y: 480 });
  });

  it("keeps a dragged position when the dimension changes", () => {
    renderVisualization();
    dragNodeTo("Order", 640, 480);
    const temporalColors = flow().edges.map((edge) => edge.data?.strokeColor);

    fireEvent.click(screen.getByRole("radio", { name: /Log cardinality/ }));

    expect(nodeById("Order").position).toEqual({ x: 640, y: 480 });
    // The edges really were rebuilt for the new dimension; only the nodes stayed.
    expect(flow().edges.map((edge) => edge.data?.strokeColor)).not.toEqual(
      temporalColors
    );
  });

  it("keeps a dragged position when an object type is selected", () => {
    renderVisualization();
    dragNodeTo("Order", 640, 480);

    act(() => {
      flow().onNodeClick?.({}, { id: "Order" });
    });

    expect(nodeById("Order").position).toEqual({ x: 640, y: 480 });
    expect(nodeById("Order").selected).toBe(true);
    expect(nodeById("Item").selected).toBe(false);
  });

  it("restores the generated layout on relayout", () => {
    renderVisualization();
    const original = { ...nodeById("Order").position };
    dragNodeTo("Order", 640, 480);

    fireEvent.click(screen.getByRole("button", { name: /Relayout/ }));

    expect(nodeById("Order").position).toEqual(original);
  });
});
