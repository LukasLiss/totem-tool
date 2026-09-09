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
  max_states: 1_000,
  fitness: 0.5,
  coverage: 1,
  total_units: 2,
  fitting_units: 1,
  non_fitting_units: 1,
  inconclusive_units: 0,
  unit_results: [
    {
      unit_id: "connected_components:000001",
      status: "fitting",
      replayable: true,
      event_count: 12,
      explored_state_count: 20,
      object_types: ["Item", "Order"],
      failure_event_index: null,
      failure_event_id: null,
      limit_reason: null,
    },
    {
      unit_id: "connected_components:000002",
      status: "non_fitting",
      replayable: false,
      event_count: 8,
      explored_state_count: 9,
      object_types: ["Order"],
      failure_event_index: 3,
      failure_event_id: "e4",
      limit_reason: null,
    },
  ],
};

const detailResponse: OCCNReplayUnitDetailResponse = {
  file_id: 12,
  unit_id: "connected_components:000002",
  replay_unit_strategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  leading_object_type: null,
  event_count: 8,
  object_types: ["Order"],
  pagination: {
    offset: 0,
    limit: DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT,
    returned_count: 1,
    total_count: 8,
    has_previous: false,
    has_next: false,
    previous_offset: null,
    next_offset: null,
  },
  events: [
    {
      event_index: 0,
      event_id: "e1",
      activity: "place order",
      timestamp_unix: 1,
      objects_by_type: { Order: ["o2"] },
    },
  ],
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
