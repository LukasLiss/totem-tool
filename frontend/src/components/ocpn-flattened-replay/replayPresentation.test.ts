import { describe, expect, it } from "vitest";

import type { OcpnReplayPlaceStats } from "@/api/ocpnFlattenedReplayApi";

import {
  fitnessTone,
  formatFitness,
  highlightIntensity,
  highlightShadow,
} from "./replayPresentation";

const place = (overrides: Partial<OcpnReplayPlaceStats>): OcpnReplayPlaceStats => ({
  place_id: "p1",
  object_type: "order",
  produced: 10,
  consumed: 10,
  missing: 0,
  remaining: 0,
  deviation: 0,
  ...overrides,
});

describe("OCPN replay presentation", () => {
  it("does not highlight places without deviations", () => {
    expect(highlightIntensity(undefined)).toBe(0);
    expect(highlightIntensity(place({}))).toBe(0);
    expect(highlightShadow(0)).toBeUndefined();
  });

  it("highlights stronger the higher the deviation", () => {
    const small = highlightIntensity(place({ missing: 1, consumed: 11, deviation: 1 / 11 }));
    const large = highlightIntensity(place({ missing: 5, remaining: 5, deviation: 10 / 15 }));
    const full = highlightIntensity(place({ produced: 0, missing: 3, consumed: 3, deviation: 1 }));
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
    expect(full).toBe(1);
    expect(highlightShadow(full)).toContain("rgba(220, 38, 38");
  });

  it("formats fitness values", () => {
    expect(formatFitness(null)).toBe("–");
    expect(formatFitness(1)).toBe("100.0%");
    expect(formatFitness(0.6667)).toBe("66.7%");
    expect(fitnessTone(1)).toContain("emerald");
    expect(fitnessTone(0.5)).toContain("red");
    expect(fitnessTone(null)).toContain("muted");
  });
});
