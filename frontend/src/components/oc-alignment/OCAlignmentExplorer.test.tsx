// @vitest-environment happy-dom

import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listAssets, type ProjectAsset } from "@/api/assetsApi";
import {
  computeOCAlignment,
  computeOCAlignmentBatch,
  listOCAlignmentExecutions,
  type OCAlignmentBatchResponse,
  type OCAlignmentResponse,
} from "@/api/ocAlignmentApi";

import { OCAlignmentExplorer } from "./OCAlignmentExplorer";
import { DEFAULT_OC_ALIGNMENT_SETTINGS, type OCAlignmentSettings } from "./settings";

vi.mock("@/api/assetsApi", async () => {
  const actual = await vi.importActual<typeof import("@/api/assetsApi")>("@/api/assetsApi");
  return { ...actual, listAssets: vi.fn() };
});
vi.mock("@/api/ocAlignmentApi", async () => {
  const actual = await vi.importActual<typeof import("@/api/ocAlignmentApi")>("@/api/ocAlignmentApi");
  return {
    ...actual,
    listOCAlignmentExecutions: vi.fn(),
    computeOCAlignment: vi.fn(),
    computeOCAlignmentBatch: vi.fn(),
  };
});
vi.mock("@/api/occnConformanceApi", async () => {
  const actual = await vi.importActual<typeof import("@/api/occnConformanceApi")>("@/api/occnConformanceApi");
  return { ...actual, getEventLogEventColumns: vi.fn().mockResolvedValue([]) };
});
vi.mock("@/react_component/variants/variantsApi", async () => {
  const actual = await vi.importActual<typeof import("@/react_component/variants/variantsApi")>(
    "@/react_component/variants/variantsApi",
  );
  return {
    ...actual,
    fetchObjectTypes: vi.fn().mockResolvedValue(["item", "order", "worker"]),
    fetchActivities: vi.fn().mockResolvedValue(["pick item", "place order"]),
    fetchProcessAreas: vi.fn(),
  };
});

const model: ProjectAsset = {
  id: 5,
  project: 3,
  name: "Orders OCPN",
  asset_type: "OCPN",
  content_json: {},
  metadata: {},
  created_by: 1,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
};

const result: OCAlignmentResponse = {
  file_id: 1,
  asset_id: 5,
  execution_id: "o1",
  source: "area",
  execution_column: null,
  business_object_types: ["item", "order", "worker"],
  business_activities: [],
  max_states: 200000,
  timeout_s: 60,
  model_object_types: ["item", "order"],
  status: "optimal",
  message: "",
  cost: 1,
  exact: true,
  lower_bound: 1,
  restricted_transitions: [],
  moves: [
    {
      index: 0, kind: "sync", silent: false, cost: 0, event_index: 0, event_id: "e1", timestamp_unix: 1,
      log_activity: "place order", log_objects: { order: ["o1"], item: ["i1"] }, transition_id: "t1",
      model_activity: "place order", model_objects: { order: ["o1"], item: ["i1"] },
    },
    {
      index: 1, kind: "model", silent: false, cost: 1, event_index: null, event_id: null, timestamp_unix: null,
      log_activity: null, log_objects: {}, transition_id: "t2", model_activity: "pick item",
      model_objects: { item: ["i1"] },
    },
  ],
  edges: [[0, 1]],
  move_counts: { sync: 1, log: 0, model: 1, silent: 0 },
  synchronous_event_ratio: 1,
  deviations_by_activity: [{ activity: "pick item", sync: 0, log: 0, model: 1 }],
  deviations_by_object: [{ object_type: "item", object_id: "i1", sync: 1, log: 0, model: 1 }],
  unknown_activities: [],
  states_explored: 4,
  states_queued: 9,
  elapsed_ms: 2,
  execution: {
    id: "o1", event_count: 1, object_count: 2, activity_count: 1, start_unix: 1, end_unix: 1,
    object_type_counts: { item: 1, order: 1 }, objects_by_type: { item: ["i1"], order: ["o1"] },
    events: [], edges: [],
  },
  projection: {
    ignored_object_types: ["worker"],
    ignored_object_counts: { worker: 1 },
    ignored_object_count: 1,
    dropped_event_ids: ["e9"],
    dropped_event_count: 1,
  },
};

function Harness({ initial }: { initial: OCAlignmentSettings }) {
  const [settings, setSettings] = useState(initial);
  return <OCAlignmentExplorer fileId={1} projectId={3} settings={settings} onSettingsChange={setSettings} />;
}

describe("OCAlignmentExplorer", () => {
  beforeEach(() => {
    vi.mocked(listAssets).mockResolvedValue([model]);
    vi.mocked(listOCAlignmentExecutions).mockResolvedValue({
      file_id: 1,
      source: "area",
      execution_column: null,
      business_object_types: ["item", "order", "worker"],
      business_activities: [],
      model_object_types: ["item", "order"],
      total: 2,
      truncated: false,
      executions: [
        { id: "o1", event_count: 3, object_count: 3, activity_count: 2, start_unix: 1, end_unix: 2,
          object_type_counts: { item: 1, order: 1, worker: 1 }, ignored_object_types: ["worker"] },
        { id: "o2", event_count: 9, object_count: 4, activity_count: 2, start_unix: 3, end_unix: 4,
          object_type_counts: { item: 3, order: 1 }, ignored_object_types: [] },
      ],
    });
    vi.mocked(computeOCAlignment).mockResolvedValue(result);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lists executions, aligns the chosen one and reports ignored object types", async () => {
    render(
      <Harness
        initial={{ ...DEFAULT_OC_ALIGNMENT_SETTINGS, assetId: 5, businessObjectTypes: ["item", "order", "worker"] }}
      />,
    );

    const list = await screen.findByRole("listbox", { name: "Process executions" });
    const option = await within(list).findByText("o1");
    expect(screen.getByLabelText("Has object types the model ignores")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Compute alignment/ }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(option);
    const compute = screen.getByRole("button", { name: /Compute alignment/ });
    await waitFor(() => expect(compute.hasAttribute("disabled")).toBe(false));
    fireEvent.click(compute);

    await screen.findByTestId("oc-alignment-result");
    expect(computeOCAlignment).toHaveBeenCalledWith(
      1,
      5,
      { source: "area", businessObjectTypes: ["item", "order", "worker"], businessActivities: [] },
      "o1",
      expect.objectContaining({ maxStates: 200000, timeoutS: 60 }),
    );
    const notice = screen.getByTestId("oc-alignment-ignored-types");
    expect(notice.textContent).toContain("worker (1 object)");
    expect(notice.textContent).toContain("1 event referred only to such objects");
    expect(screen.getAllByTestId("oc-alignment-move").map((n) => n.getAttribute("data-kind"))).toEqual([
      "sync",
      "model",
    ]);
    expect(screen.getByText("Deviations by activity")).toBeTruthy();
  });

  it("aligns every execution and opens one from the batch table", async () => {
    const batch: OCAlignmentBatchResponse = {
      file_id: 1, asset_id: 5, source: "area", max_states: 50000, timeout_s: 5, total_timeout_s: 240,
      model_object_types: ["item", "order"], total: 2, status_counts: { optimal: 1, no_alignment: 1 },
      aligned: 1, fitting: 0, exact: 1, average_cost: 1, cost_per_event: 0.2, synchronous_event_ratio: 0.8,
      deviations_by_activity: [{ activity: "pick item", sync: 0, log: 0, model: 1, executions: 1 }],
      ignored_object_types: { worker: 1 }, stopped_early: false, elapsed_ms: 12,
      rows: [
        { id: "o1", event_count: 3, object_count: 3, object_type_counts: { item: 1, order: 1 }, start_unix: 1,
          status: "optimal", cost: 1, exact: true, lower_bound: 1,
          move_counts: { sync: 2, log: 0, model: 1, silent: 0 }, ignored_object_types: ["worker"],
          message: "", diagnostics: [], elapsed_ms: 3 },
        { id: "o2", event_count: 9, object_count: 4, object_type_counts: { item: 3, order: 1 }, start_unix: 3,
          status: "no_alignment", cost: null, exact: false, lower_bound: null, move_counts: null,
          ignored_object_types: [], message: "no", diagnostics: ['A "item" object can never get from p1 to p2.'],
          elapsed_ms: 1 },
      ],
    };
    vi.mocked(computeOCAlignmentBatch).mockResolvedValue(batch);
    render(
      <Harness
        initial={{ ...DEFAULT_OC_ALIGNMENT_SETTINGS, assetId: 5, businessObjectTypes: ["item", "order", "worker"] }}
      />,
    );
    const button = await screen.findByRole("button", { name: /Compute for all executions \(2\)/ });
    fireEvent.click(button);

    const view = await screen.findByTestId("oc-alignment-batch");
    expect(computeOCAlignmentBatch).toHaveBeenCalledWith(
      1, 5, { source: "area", businessObjectTypes: ["item", "order", "worker"], businessActivities: [] },
      expect.anything(),
    );
    expect(view.textContent).toContain("No alignment exists for 1 of 2 executions");
    expect(view.textContent).toContain('A "item" object can never get from p1 to p2.');
    expect(view.textContent).toContain("worker (in 1 executions)");

    const table = within(view).getByRole("listbox", { name: "Aligned executions" });
    fireEvent.click(within(table).getByText("o1"));
    await screen.findByTestId("oc-alignment-result");
    expect(computeOCAlignment).toHaveBeenCalledWith(1, 5, expect.anything(), "o1", expect.anything());
  });

  it("asks for a model before anything else", async () => {
    vi.mocked(listAssets).mockResolvedValue([]);
    render(<Harness initial={DEFAULT_OC_ALIGNMENT_SETTINGS} />);
    expect(await screen.findByText(/No object-centric Petri net in this project yet/)).toBeTruthy();
    expect(screen.getByText("Choose an OCPN model.")).toBeTruthy();
    expect(listOCAlignmentExecutions).not.toHaveBeenCalled();
  });
});
