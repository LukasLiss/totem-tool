import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  runOCCNConformance,
  type OCCNConformanceResponse,
} from "./occnConformanceApi";

vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
  },
}));

const post = vi.mocked(axios.post);

const response: OCCNConformanceResponse = {
  file_id: 12,
  asset_id: 34,
  replay_unit_strategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  fitness: 0.5,
  coverage: 2 / 3,
  total_units: 3,
  fitting_units: 1,
  non_fitting_units: 1,
  inconclusive_units: 1,
  unit_results: [
    {
      unit_id: "connected_components:000001",
      status: "fitting",
      replayable: true,
      event_count: 2,
      explored_state_count: 4,
      object_types: ["Order"],
      failure_event_index: null,
      failure_event_id: null,
      limit_reason: null,
    },
    {
      unit_id: "connected_components:000002",
      status: "non_fitting",
      replayable: false,
      event_count: 1,
      explored_state_count: 2,
      object_types: ["Item", "Order"],
      failure_event_index: 0,
      failure_event_id: "e3",
      limit_reason: null,
    },
    {
      unit_id: "connected_components:000003",
      status: "inconclusive",
      replayable: null,
      event_count: 3,
      explored_state_count: 10_000,
      object_types: ["Order"],
      failure_event_index: null,
      failure_event_id: null,
      limit_reason: "max_states",
    },
  ],
};

describe("runOCCNConformance", () => {
  beforeEach(() => {
    post.mockReset();
  });

  it("posts the selected OCCN asset with the default replay strategy", async () => {
    post.mockResolvedValue({ data: response });

    await expect(runOCCNConformance(12, 34)).resolves.toEqual(response);
    expect(post).toHaveBeenCalledWith(
      "http://localhost:8000/api/files/12/occn_conformance/",
      {
        asset_id: 34,
        replay_unit_strategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
      }
    );
  });

  it("accepts the implemented replay strategy explicitly", async () => {
    post.mockResolvedValue({ data: response });

    await runOCCNConformance(
      12,
      34,
      CONNECTED_COMPONENTS_REPLAY_STRATEGY
    );

    expect(post).toHaveBeenCalledWith(
      "http://localhost:8000/api/files/12/occn_conformance/",
      {
        asset_id: 34,
        replay_unit_strategy: "connected_components",
      }
    );
  });

  it("propagates request failures to the workflow controller", async () => {
    post.mockRejectedValue(new Error("Request failed"));

    await expect(runOCCNConformance(12, 34)).rejects.toThrow("Request failed");
  });
});
