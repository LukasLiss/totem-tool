import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT,
  LEADING_OBJECT_REPLAY_STRATEGY,
  getEventLogObjectTypes,
  getOCCNReplayUnitDetail,
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

const detailResponse: OCCNReplayUnitDetailResponse = {
  file_id: 12,
  unit_id: "connected_components:000002",
  replay_unit_strategy: CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  leading_object_type: null,
  event_count: 75,
  object_types: ["Item", "Order"],
  pagination: {
    offset: 50,
    limit: 25,
    returned_count: 25,
    total_count: 75,
    has_previous: true,
    has_next: false,
    previous_offset: 25,
    next_offset: null,
  },
  events: [
    {
      event_index: 50,
      event_id: "event-50",
      activity: "Ship Order",
      timestamp_unix: 1_735_689_600,
      objects_by_type: {
        Item: ["item-1"],
        Order: ["order-1"],
      },
    },
  ],
};

describe("OCCN conformance API", () => {
  beforeEach(() => {
    get.mockReset();
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

  it("posts the selected type for leading-object replay", async () => {
    post.mockResolvedValue({ data: response });

    await runOCCNConformance(
      12,
      34,
      LEADING_OBJECT_REPLAY_STRATEGY,
      "Order"
    );

    expect(post).toHaveBeenCalledWith(
      "http://localhost:8000/api/files/12/occn_conformance/",
      {
        asset_id: 34,
        replay_unit_strategy: "leading_object",
        leading_object_type: "Order",
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
      "http://localhost:8000/api/files/12/object_types/"
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
      "http://localhost:8000/api/files/12/occn_replay_unit_detail/",
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
      "http://localhost:8000/api/files/12/occn_replay_unit_detail/",
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
      "http://localhost:8000/api/files/12/occn_replay_unit_detail/",
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
