// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { afterEach, describe, expect, it } from "vitest";

import OccnNodeComponent from "./OccnNode";
import type { OccnNode } from "./types";

const nodeTypes = { occn: OccnNodeComponent };

function renderNode(
  status: OccnNode["data"]["conformanceStatus"],
  unvisited = false
) {
  const nodes: OccnNode[] = [
    {
      id: "ship order",
      type: "occn",
      position: { x: 20, y: 60 },
      data: {
        label: "ship order",
        kind: "activity",
        conformanceStatus: status,
        conformanceUnvisited: unvisited,
      },
    },
  ];
  return render(
    <div style={{ width: 500, height: 300 }}>
      <ReactFlowProvider>
        <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} />
      </ReactFlowProvider>
    </div>
  );
}

describe("OCCN conformance stopping-point callout", () => {
  afterEach(cleanup);

  it("labels a non-fitting stopping point", () => {
    renderNode("non_fitting");

    expect(screen.getByLabelText("Replay fails here")).toBeTruthy();
  });

  it("labels a bounded stopping point", () => {
    renderNode("inconclusive");

    expect(screen.getByLabelText("State limit reached here")).toBeTruthy();
  });

  it("mutes an activity that replay did not visit", () => {
    renderNode(undefined, true);

    const node = screen.getByText("ship order").closest(
      '[data-conformance-unvisited="true"]'
    );
    expect(node).toBeTruthy();
    expect((node as HTMLElement).style.background).toBe("#E5E7EB");
  });
});
