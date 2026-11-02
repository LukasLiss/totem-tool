// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectAsset } from "@/api/assetsApi";
import type { OcpnFlattenedReplayResponse } from "@/api/ocpnFlattenedReplayApi";

import OcpnFlattenedReplay from "./OcpnFlattenedReplay";

const listAssets = vi.fn();
const runOcpnFlattenedReplay = vi.fn();

vi.mock("@/api/assetsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/assetsApi")>()),
  listAssets: (...args: unknown[]) => listAssets(...args),
}));

vi.mock("@/api/ocpnFlattenedReplayApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/ocpnFlattenedReplayApi")>()),
  runOcpnFlattenedReplay: (...args: unknown[]) => runOcpnFlattenedReplay(...args),
}));

vi.mock("@/editors/ocpn/layout", () => ({
  layoutOcpn: vi.fn(async (nodes: Array<{ id: string }>) =>
    nodes.map((node, index) => ({ ...node, position: { x: index * 150, y: 100 } }))
  ),
}));

const model = {
  format: "ocpn" as const,
  version: 1 as const,
  name: "net",
  objectTypes: [{ name: "order" }],
  places: [
    { id: "p1", objectType: "order", initial: true },
    { id: "p2", objectType: "order" },
    { id: "p3", objectType: "order", final: true },
  ],
  transitions: [
    { id: "t1", label: "a" },
    { id: "t2", label: "b" },
  ],
  arcs: [
    { id: "a1", source: "p1", target: "t1" },
    { id: "a2", source: "t1", target: "p2" },
    { id: "a3", source: "p2", target: "t2" },
    { id: "a4", source: "t2", target: "p3" },
  ],
};

const asset: ProjectAsset = {
  id: 7,
  project: 3,
  name: "Order net",
  asset_type: "OCPN",
  content_json: model,
  metadata: {},
  created_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const response: OcpnFlattenedReplayResponse = {
  file_id: 1,
  asset_id: 7,
  asset_name: "Order net",
  model,
  average_fitness: 0.75,
  object_types: [
    {
      object_type: "order",
      fitness: 0.75,
      num_objects: 4,
      num_variants: 2,
      fitting_objects: 2,
      produced: 12,
      consumed: 12,
      missing: 3,
      remaining: 3,
      unmapped_activities: {},
      silent_search_limit_hits: 0,
      warnings: [],
    },
  ],
  places: [
    { place_id: "p1", object_type: "order", produced: 4, consumed: 4, missing: 0, remaining: 0, deviation: 0 },
    { place_id: "p2", object_type: "order", produced: 2, consumed: 4, missing: 3, remaining: 1, deviation: 0.8 },
    { place_id: "p3", object_type: "order", produced: 4, consumed: 4, missing: 0, remaining: 2, deviation: 0.5 },
  ],
  log_object_types_not_in_model: ["worker"],
};

describe("OcpnFlattenedReplay", () => {
  beforeEach(() => {
    listAssets.mockResolvedValue([asset]);
    runOcpnFlattenedReplay.mockResolvedValue(response);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("runs the replay for the preselected model and shows fitness and highlights", async () => {
    render(
      <div style={{ width: 900, height: 600 }}>
        <OcpnFlattenedReplay fileId={1} projectId={3} initialAssetId={7} height={600} />
      </div>
    );

    const run = await screen.findByRole("button", { name: /run replay/i });
    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(run);

    await waitFor(() =>
      expect(screen.getByTestId("replay-average-fitness").textContent).toBe("75.0%")
    );
    expect(runOcpnFlattenedReplay).toHaveBeenCalledWith(1, 7, expect.any(Object));
    expect(screen.getByTestId("replay-type-order").textContent).toContain("75.0%");
    expect(screen.getByText(/Not in model/).textContent).toContain("worker");

    await waitFor(() => expect(screen.getByTestId("replay-place-p2")).toBeTruthy());
    const p1 = Number(screen.getByTestId("replay-place-p1").dataset.intensity);
    const p2 = Number(screen.getByTestId("replay-place-p2").dataset.intensity);
    const p3 = Number(screen.getByTestId("replay-place-p3").dataset.intensity);
    expect(p1).toBe(0);
    expect(p2).toBeGreaterThan(p3);
    expect(p3).toBeGreaterThan(0);
    expect(screen.getByTestId("replay-place-p2").textContent).toContain("−3");
  });

  it("starts automatically and shows backend errors such as duplicate labels", async () => {
    runOcpnFlattenedReplay.mockRejectedValue(
      new Error("OCPN flattened replay requires unique labels for non-silent transitions")
    );
    render(<OcpnFlattenedReplay fileId={1} projectId={3} initialAssetId={7} autoStart height={600} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("unique labels");
  });
});
