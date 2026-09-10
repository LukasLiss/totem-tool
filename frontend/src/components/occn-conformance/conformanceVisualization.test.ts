import { describe, expect, it } from "vitest";

import type { OCCNReplayUnitResult } from "@/api/occnConformanceApi";
import canonicalOccn from "../../../../docs/examples/model-assets/occn-v1.json";

import {
  buildConformanceAnnotations,
  buildConformanceHighlights,
  buildUnvisitedActivities,
  canonicalOccnAssetToNet,
} from "./conformanceVisualization";

function unit(
  status: OCCNReplayUnitResult["status"],
  stoppingActivity: string | null
): OCCNReplayUnitResult {
  return {
    unit_id: `${status}-${stoppingActivity ?? "none"}`,
    status,
    replayable: status === "fitting" ? true : status === "non_fitting" ? false : null,
    event_count: 1,
    explored_state_count: 2,
    object_types: ["order"],
    failure_event_index: null,
    failure_event_id: null,
    limit_reason: status === "inconclusive" ? "max_states" : null,
    stopping_activity: stoppingActivity,
  };
}

describe("OCCN conformance visualization preparation", () => {
  it("converts the canonical asset into the Analysis viewer shape", () => {
    const net = canonicalOccnAssetToNet(canonicalOccn, "Canonical OCCN");

    expect(net.activities.map(({ id }) => id)).toContain("a");
    expect(net.object_types).toEqual(["item", "order"]);
    expect(net.edges).toContainEqual({
      source: "START_order",
      target: "a",
      object_type: "order",
      dependence_measure: null,
    });
    expect(net.input_marker_groups.a[0].markers[0].related_activity).toBe(
      "START_item"
    );
  });

  it("does not mark fitting replay units", () => {
    expect(buildConformanceHighlights([unit("fitting", null)])).toEqual({});
  });

  it("marks deviations red and bounded searches yellow", () => {
    expect(
      buildConformanceHighlights([
        unit("non_fitting", "reject order"),
        unit("inconclusive", "ship order"),
      ])
    ).toEqual({
      "reject order": "non_fitting",
      "ship order": "inconclusive",
    });
  });

  it("keeps red when both outcomes stop at the same activity", () => {
    expect(
      buildConformanceHighlights([
        unit("non_fitting", "ship order"),
        unit("inconclusive", "ship order"),
      ])
    ).toEqual({ "ship order": "non_fitting" });
  });

  it("explains how a non-fitting replay stopped", () => {
    const replayUnit = {
      ...unit("non_fitting", "ship order"),
      stopping_phase: "visible_event",
      stopping_reason: "no_enabled_event_binding",
      last_replayed_activity: "pick item",
      stopping_object_types: ["Order", "Item"],
    };

    expect(buildConformanceAnnotations([replayUnit])).toEqual({
      "ship order": {
        status: "non_fitting",
        details: [
          "No enabled binding matched the event",
          "Last replayed: pick item",
        ],
        objectTypes: ["Item", "Order"],
      },
    });
  });

  it("shows bounded replay progress and all final replay points", () => {
    const first = {
      ...unit("inconclusive", "END_items"),
      explored_state_count: 1_000,
      stopping_phase: "object_end",
      stopping_reason: "max_states",
      last_replayed_activity: "ship package",
    };
    const second = {
      ...unit("inconclusive", "END_items"),
      unit_id: "bounded-second",
      explored_state_count: 1_500,
      stopping_phase: "object_end",
      stopping_reason: "max_states",
      last_replayed_activity: "deliver package",
    };

    expect(buildConformanceAnnotations([first, second])).toEqual({
      END_items: {
        status: "inconclusive",
        details: [
          "State limit reached during object completion",
          "Explored states: 1,000, 1,500",
          "Last replayed: ship package, deliver package",
          "Replay units: 2",
        ],
        objectTypes: [],
      },
    });
  });

  it("greys only activities not reached by a displayed non-fitting replay", () => {
    const nonFitting = {
      ...unit("non_fitting", "ship order"),
      replayed_activities: ["START_order", "create order"],
    };

    expect(
      buildUnvisitedActivities(
        [nonFitting],
        ["START_order", "create order", "ship order", "END_order"]
      )
    ).toEqual(["ship order", "END_order"]);
    expect(
      buildUnvisitedActivities(
        [unit("inconclusive", "ship order")],
        ["START_order", "ship order"]
      )
    ).toEqual([]);
  });
});
