import { describe, expect, it } from "vitest";

import type { OCAlignmentMove } from "@/api/ocAlignmentApi";
import { buildSourceBody } from "@/api/ocAlignmentApi";

import { layoutAlignment, objectShades, visibleAlignment } from "./layout";
import {
  DEFAULT_OC_ALIGNMENT_SETTINGS,
  alignmentBlocker,
  matchingArea,
  settingsFromNode,
  settingsToNode,
  sourceBlocker,
  sourceKey,
  sourceRequest,
} from "./settings";

function move(index: number, kind: OCAlignmentMove["kind"], objects: string[], silent = false): OCAlignmentMove {
  const grouped = { item: objects };
  return {
    index,
    kind,
    silent,
    cost: kind === "sync" || silent ? 0 : objects.length,
    event_index: kind === "model" ? null : index,
    event_id: kind === "model" ? null : `e${index}`,
    timestamp_unix: null,
    log_activity: kind === "model" ? null : `a${index}`,
    log_objects: kind === "model" ? {} : grouped,
    transition_id: kind === "log" ? null : `t${index}`,
    model_activity: kind === "log" || silent ? null : `a${index}`,
    model_objects: kind === "log" ? {} : grouped,
  };
}

describe("oc alignment settings", () => {
  it("round-trips through the persisted widget fields and clamps bad values", () => {
    const settings = settingsFromNode({
      model_asset: 7,
      execution_source: "stored",
      execution_column: "process execution",
      business_object_types: ["order", 3, ""],
      business_activities: ["pick"],
      execution_id: "o1",
      max_states: 1e12,
      timeout_s: "abc",
      show_silent_moves: true,
    });
    expect(settings).toMatchObject({
      assetId: 7,
      source: "stored",
      businessObjectTypes: ["order"],
      maxStates: 2_000_000,
      timeoutS: 60,
      showSilentMoves: true,
    });
    expect(settingsFromNode(settingsToNode(settings))).toEqual(settings);
    expect(settingsFromNode({ execution_source: "bogus", model_asset: -1 })).toMatchObject({
      source: "area",
      assetId: null,
    });
  });

  it("explains what is missing before listing or aligning", () => {
    const base = DEFAULT_OC_ALIGNMENT_SETTINGS;
    expect(sourceBlocker(base)).toMatch(/process area/);
    expect(sourceBlocker({ ...base, source: "stored" })).toMatch(/column/);
    expect(alignmentBlocker(base)).toMatch(/OCPN/);
    const ready = { ...base, assetId: 1, businessObjectTypes: ["order"], executionId: "o1" };
    expect(alignmentBlocker(ready)).toBeNull();
    expect(alignmentBlocker({ ...ready, executionId: "" })).toMatch(/execution/);
  });

  it("builds the request body per source and keys sources order-independently", () => {
    const area = { ...DEFAULT_OC_ALIGNMENT_SETTINGS, businessObjectTypes: ["b", "a"], businessActivities: ["x"] };
    expect(buildSourceBody(sourceRequest(area))).toEqual({
      source: "area",
      business_object_types: ["b", "a"],
      business_activities: ["x"],
    });
    expect(sourceKey(area)).toBe(sourceKey({ ...area, businessObjectTypes: ["a", "b"], executionId: "z" }));
    const stored = { ...area, source: "stored" as const, executionColumn: "col" };
    expect(buildSourceBody(sourceRequest(stored))).toEqual({ source: "stored", execution_column: "col" });
  });

  it("recognises the selected process area", () => {
    const area = { id: "a1", level: 0, label: "order", objectTypes: ["order", "item"], activities: ["pick"] };
    const settings = { ...DEFAULT_OC_ALIGNMENT_SETTINGS, businessObjectTypes: ["item", "order"], businessActivities: ["pick"] };
    expect(matchingArea(settings, [area])).toBe("a1");
    expect(matchingArea({ ...settings, businessActivities: [] }, [area])).toBeNull();
  });
});

describe("oc alignment layout", () => {
  const moves = [
    move(0, "sync", ["i1", "i2"]),
    move(1, "model", ["i1"], true),
    move(2, "sync", ["i1"]),
    move(3, "log", ["i2"]),
    move(4, "model", ["i1"]),
  ];

  it("connects moves sharing an object and bridges hidden silent moves", () => {
    expect(visibleAlignment(moves, true).edges).toEqual([[0, 1], [0, 3], [1, 2], [2, 4]]);
    const hidden = visibleAlignment(moves, false);
    expect(hidden.moves.map((m) => m.index)).toEqual([0, 2, 3, 4]);
    expect(hidden.edges).toEqual([[0, 1], [0, 2], [1, 3]]);
  });

  it("places every move right of its predecessors without overlaps", () => {
    const { moves: visible, edges } = visibleAlignment(moves, false);
    const layout = layoutAlignment(visible, edges);
    const byIndex = Object.fromEntries(layout.nodes.map((n) => [n.move.index, n]));
    expect(byIndex[0].column).toBe(0);
    expect(byIndex[2].column).toBe(1);
    expect(byIndex[3].column).toBe(1);
    expect(byIndex[4].column).toBe(2);
    const cells = new Set(layout.nodes.map((n) => `${n.column}:${n.row}`));
    expect(cells.size).toBe(layout.nodes.length);
    expect(layout.width).toBeGreaterThan(0);
    expect(layoutAlignment([], []).nodes).toEqual([]);
  });

  it("gives objects of one type distinct shades", () => {
    expect(objectShades({ item: ["i2", "i1"], order: ["o1"] })).toEqual({ i1: 0, i2: 1, o1: 0 });
  });
});
