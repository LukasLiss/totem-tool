import type { OCCNReplayUnitResult } from "@/api/occnConformanceApi";
import { assetToOccnModel } from "@/editors/shared/asset-format";
import type { OccnMarkerGroup } from "@/editors/shared/model-types";
import type { OccnNet } from "@/utils/occnTransform";

export type OCCNConformanceHighlight = "non_fitting" | "inconclusive";

export function canonicalOccnAssetToNet(
  content: Record<string, unknown>,
  name: string
): OccnNet {
  const model = assetToOccnModel(content, name);
  if (model.activities.length === 0) {
    throw new Error("The selected OCCN model contains no activities.");
  }

  const activityCount = isRecord(content.activity_count)
    ? content.activity_count
    : {};
  const threshold = content.relative_occurrence_threshold;

  const input_marker_groups: OccnNet["input_marker_groups"] = {};
  const output_marker_groups: OccnNet["output_marker_groups"] = {};
  for (const activity of model.activities) {
    const groups = model.markerGroups[activity.name];
    input_marker_groups[activity.name] = toVisualizerGroups(groups?.img ?? []);
    output_marker_groups[activity.name] = toVisualizerGroups(groups?.omg ?? []);
  }

  return {
    object_types: model.objectTypes.map(({ name: objectType }) => objectType),
    relative_occurrence_threshold:
      typeof threshold === "number" && Number.isFinite(threshold)
        ? threshold
        : 0,
    activities: model.activities.map(({ name: activity }) => ({
      id: activity,
      count:
        typeof activityCount[activity] === "number"
          ? activityCount[activity]
          : 1,
    })),
    edges: model.arcs.map((arc) => ({
      source: arc.source,
      target: arc.target,
      object_type: arc.objectType,
      dependence_measure: null,
    })),
    input_marker_groups,
    output_marker_groups,
  };
}

export function buildConformanceHighlights(
  units: OCCNReplayUnitResult[]
): Record<string, OCCNConformanceHighlight> {
  const highlights: Record<string, OCCNConformanceHighlight> = {};
  for (const unit of units) {
    const activity = unit.stopping_activity;
    if (!activity || unit.status === "fitting") continue;
    if (unit.status === "non_fitting") {
      highlights[activity] = "non_fitting";
    } else if (!highlights[activity]) {
      highlights[activity] = "inconclusive";
    }
  }
  return highlights;
}

function toVisualizerGroups(groups: OccnMarkerGroup[]) {
  return groups.map((markers) => ({
    support_count: null,
    markers: markers.map(
      ([related_activity, object_type, [min_count, max_count], marker_key]) => ({
        related_activity,
        object_type,
        min_count,
        max_count: max_count === -1 ? null : max_count,
        marker_key,
      })
    ),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
