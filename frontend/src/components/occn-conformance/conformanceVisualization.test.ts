import { describe, expect, it } from "vitest";

import type { OCCNReplayUnitResult } from "@/api/occnConformanceApi";
import canonicalOccn from "../../../../docs/examples/model-assets/occn-v1.json";

import {
  buildConformanceHighlights,
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
});
