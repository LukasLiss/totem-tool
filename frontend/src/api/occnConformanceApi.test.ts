import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT,
  getEventLogObjectTypes,
  getOCCNReplayUnitDetail,
  LEADING_OBJECT_REPLAY_STRATEGY,
  runOCCNConformance,
  type OCCNConformanceResponse,
  type OCCNReplayUnitDetailResponse,
} from "./occnConformanceApi";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const get = vi.mocked(axios.get);
const post = vi.mocked(axios.post);

const response: OCCNConformanceResponse = {
  file_id: 12,
  asset_id: 34,
  replay_unit_strategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  leading_object_type: null,
  overall_metrics: {
    fitness: 0.92,
    precision: null,
  },
  object_type_metrics: {
    Order: {
      fitness: 0.95,
      precision: null,
      consumed_tokens: 100,
      produced_tokens: 100,
      missing_tokens: 5,
      remaining_tokens: 5,
      num_units: 10,
      fitted_units: 9,
    },
  },
  type_pair_metrics: [
    {
      source_type: "Order",
      target_type: "Item",
      fitness: 0.9,
      precision: null,
      consumed_tokens: 50,
      produced_tokens: 50,
      missing_tokens: 5,
      remaining_tokens: 5,
      num_units: 10,
      fitted_units: 8,
    },
  ],
  replay_units: [
    {
      unit_id: "connected_components:000001",
      label: "Unit 1",
      fitness: 1,
      is_fitted: true,
      num_events: 12,
      num_objects: 3,
      missing_tokens: 0,
      remaining_tokens: 0,
      consumed_tokens: 12,
      produced_tokens: 12,
      object_types: ["Order", "Item"],
      object_ids: ["o1", "i1", "i2"],
    },
  ],
  histograms: {
    replay_unit_fitness: [
      {
        bin_start: 0.9,
        bin_end: 1,
        count: 1,
        is_fitted_bucket: true,
      },
    ],
  },
  summary: {
    num_units: 1,
    fitted_units: 1,
    non_fitted_units: 0,
    partially_fitted_units: 0,
    min_fitness: 1,
    max_fitness: 1,
    avg_fitness: 1,
  },
  computation_time_ms: 123,
};

const detailResponse: OCCNReplayUnitDetailResponse = {
  file_id: 12,
  asset_id: 34,
  unit_id: "connected_components:000002",
  replay_unit_strategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  leading_object_type: null,
  total_units: 100,
  offset: 0,
  limit: DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT,
  unit: {
    unit_id: "connected_components:000002",
    label: "Unit 2",
    fitness: 0.75,
    is_fitted: false,
    num_events: 8,
    num_objects: 2,
    missing_tokens: 2,
    remaining_tokens: 2,
    consumed_tokens: 8,
    produced_tokens: 8,
    object_types: ["Order"],
    object_ids: ["o2", "o3"],
  },
  replay_history: [],
  token_diagnostics: [],
};

describe("occnConformanceApi", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it("posts the selected OCCN asset with the default replay strategy", async () => {
    post.mockResolvedValue({ data: response });

    await expect(runOCCNConformance(12, 34)).resolves.toEqual(response);
    expect(post).toHaveBeenCalledWith(
      "/api/files/12/occn_conformance/",
      {
        asset_id: 34,
        max_states: 1_000,
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
      "/api/files/12/occn_conformance/",
      {
        asset_id: 34,
        max_states: 1_000,
        replay_unit_strategy: "connected_components",
      }
    );
  });

  it("posts the selected type for leading-object replay", async () => {
    post.mockResolvedValue({ data: response });

    await runOCCNConformance(
      12,
      34,
      LEADING_OBJECT_REPLAY_STRATEGY,
      "Order",
      10_000
    );

    expect(post).toHaveBeenCalledWith(
      "/api/files/12/occn_conformance/",
      {
        asset_id: 34,
        replay_unit_strategy: "leading_object",
        leading_object_type: "Order",
        max_states: 10_000,
      }
    );
  });

  it("loads the object types of the selected event log", async () => {
    get.mockResolvedValue({ data: ["Order", "Item"] });

    await expect(getEventLogObjectTypes(12)).resolves.toEqual([
      "Order",
      "Item",
    ]);
    expect(get).toHaveBeenCalledWith(
      "/api/files/12/object_types/"
    );
  });

  it("propagates request failures to the workflow controller", async () => {
    post.mockRejectedValue(new Error("Request failed"));

    await expect(runOCCNConformance(12, 34)).rejects.toThrow("Request failed");
  });

  it("loads the first replay-unit detail page by default", async () => {
    get.mockResolvedValue({ data: detailResponse });

    await expect(
      getOCCNReplayUnitDetail(12, "connected_components:000002")
    ).resolves.toEqual(detailResponse);
    expect(get).toHaveBeenCalledWith(
      "/api/files/12/occn_replay_unit_detail/",
      {
        params: {
          unit_id: "connected_components:000002",
          replay_unit_strategy: "connected_components",
          offset: 0,
          limit: DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT,
        },
      }
    );
  });

  it("loads an explicit replay-unit detail page", async () => {
    get.mockResolvedValue({ data: detailResponse });

    await getOCCNReplayUnitDetail(12, "connected_components:000002", {
      replayUnitStrategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
      offset: 50,
      limit: 25,
    });

    expect(get).toHaveBeenCalledWith(
      "/api/files/12/occn_replay_unit_detail/",
      {
        params: {
          unit_id: "connected_components:000002",
          replay_unit_strategy: "connected_components",
          offset: 50,
          limit: 25,
        },
      }
    );
  });

  it("retains the leading object type when loading replay detail", async () => {
    get.mockResolvedValue({ data: detailResponse });

    await getOCCNReplayUnitDetail(12, "leading_object:order-1", {
      replayUnitStrategy: LEADING_OBJECT_REPLAY_STRATEGY,
      leadingObjectType: "Order",
    });

    expect(get).toHaveBeenCalledWith(
      "/api/files/12/occn_replay_unit_detail/",
      {
        params: {
          unit_id: "leading_object:order-1",
          replay_unit_strategy: "leading_object",
          leading_object_type: "Order",
          offset: 0,
          limit: DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT,
        },
      }
    );
  });
});
