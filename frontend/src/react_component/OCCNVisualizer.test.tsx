// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OccnNet } from "@/utils/occnTransform";

import OCCNVisualizer from "./OCCNVisualizer";

vi.mock("@/editors/occn/model", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/editors/occn/model")
  >();
  return {
    ...actual,
    elkLayeredPositions: vi.fn(async (nodes: Array<{ id: string }>) =>
      Object.fromEntries(
        nodes.map(({ id }, index) => [id, { x: index * 260, y: 100 }])
      )
    ),
  };
});

const net: OccnNet = {
  object_types: [],
  relative_occurrence_threshold: 0,
  activities: [
    { id: "approve order", count: 1 },
    { id: "ship order", count: 1 },
  ],
  edges: [],
  input_marker_groups: {
    "approve order": [],
    "ship order": [],
  },
  output_marker_groups: {
    "approve order": [],
    "ship order": [],
  },
};

describe("OCCN visualization stopping-point focus", () => {
  afterEach(cleanup);

  it("focuses red points first and cycles through further points", async () => {
    render(
      <div style={{ width: 900, height: 500 }}>
        <ReactFlowProvider>
          <OCCNVisualizer
            data={net}
            conformanceHighlights={{
              "approve order": "inconclusive",
              "ship order": "non_fitting",
            }}
          />
        </ReactFlowProvider>
      </div>
    );

    const firstFocus = await screen.findByRole("button", {
      name: "Focus stopping point ship order",
    });
    expect(firstFocus.textContent).toContain("1/2");

    fireEvent.click(firstFocus);

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Focus stopping point approve order",
        }).textContent
      ).toContain("2/2")
    );
  });

  it("does not offer focus when the model has no stopping point", async () => {
    render(
      <div style={{ width: 900, height: 500 }}>
        <ReactFlowProvider>
          <OCCNVisualizer data={net} />
        </ReactFlowProvider>
      </div>
    );

    await waitFor(() => expect(screen.getByText("approve order")).toBeTruthy());
    expect(
      screen.queryByRole("button", { name: /Focus stopping point/ })
    ).toBeNull();
  });
});
