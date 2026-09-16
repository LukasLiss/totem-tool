import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  runTotemConformance,
  type TotemConformanceResponse,
} from "./totemConformanceApi";

vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
  },
}));

const post = vi.mocked(axios.post);

const response: TotemConformanceResponse = {
  file_id: 12,
  asset_id: 34,
  overall_metrics: {
    temporal: { fitness: 1, precision: 0.75 },
    log_cardinality: { fitness: 0.8, precision: 0.6 },
    event_cardinality: { fitness: null, precision: null },
  },
  object_type_metrics: {},
  type_pair_metrics: [],
  histograms: {
    temporal: [],
    log_cardinality: [],
    event_cardinality: [],
    event_cardinality_by_activity: [],
    temporal_by_relation_type: [],
    log_cardinality_by_relation_type: [],
  },
};

describe("runTotemConformance", () => {
  beforeEach(() => {
    post.mockReset();
  });

  it("posts the selected model asset to the selected event log endpoint", async () => {
    post.mockResolvedValue({ data: response });

    await expect(runTotemConformance(12, 34)).resolves.toEqual(response);
    expect(post).toHaveBeenCalledWith(
      "/api/files/12/totem_conformance/",
      { asset_id: 34 }
    );
  });

  it("propagates request failures to the workflow controller", async () => {
    post.mockRejectedValue(new Error("Request failed"));

    await expect(runTotemConformance(12, 34)).rejects.toThrow("Request failed");
  });
});
