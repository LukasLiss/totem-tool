import type { OCCNReplayUnitResult } from "@/api/occnConformanceApi";
import { assetToOccnModel } from "@/editors/shared/asset-format";
import type { OccnMarkerGroup } from "@/editors/shared/model-types";
import type { OccnNet } from "@/utils/occnTransform";

export type OCCNConformanceHighlight = "non_fitting" | "inconclusive";

export interface OCCNConformanceAnnotation {
  status: OCCNConformanceHighlight;
  details: string[];
}

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

export function buildConformanceAnnotations(
  units: OCCNReplayUnitResult[]
): Record<string, OCCNConformanceAnnotation> {
  const grouped = new Map<string, OCCNReplayUnitResult[]>();
  for (const unit of units) {
    if (!unit.stopping_activity || unit.status === "fitting") continue;
    const group = grouped.get(unit.stopping_activity) ?? [];
    group.push(unit);
    grouped.set(unit.stopping_activity, group);
  }

  return Object.fromEntries(
    [...grouped.entries()].map(([activity, activityUnits]) => {
      const status = activityUnits.some((unit) => unit.status === "non_fitting")
        ? "non_fitting"
        : "inconclusive";
      const details = unique(
        activityUnits.map((unit) => stoppingExplanation(unit))
      );
      const inconclusiveUnits = activityUnits.filter(
        (unit) => unit.status === "inconclusive"
      );
      if (inconclusiveUnits.length > 0) {
        const exploredStates = unique(
          inconclusiveUnits.map((unit) => unit.explored_state_count.toLocaleString())
        );
        details.push(`Explored states: ${summarize(exploredStates)}`);
        const lastReplayed = unique(
          inconclusiveUnits.map((unit) =>
            unit.last_replayed_activity
              ? formatActivity(unit.last_replayed_activity)
              : "Initial state"
          )
        );
        details.push(`Last replayed: ${summarize(lastReplayed)}`);
      } else {
        const lastReplayed = unique(
          activityUnits
            .map((unit) => unit.last_replayed_activity)
            .filter((activity): activity is string => Boolean(activity))
            .map(formatActivity)
        );
        if (lastReplayed.length > 0) {
          details.push(`Last replayed: ${summarize(lastReplayed)}`);
        }
      }
      if (activityUnits.length > 1) {
        details.push(`Replay units: ${activityUnits.length.toLocaleString()}`);
      }
      return [activity, { status, details }];
    })
  );
}

function stoppingExplanation(unit: OCCNReplayUnitResult): string {
  if (unit.stopping_reason === "no_enabled_object_start") {
    return "Required object could not start";
  }
  if (unit.stopping_reason === "no_enabled_event_binding") {
    return "No enabled binding matched the event";
  }
  if (unit.stopping_reason === "no_enabled_object_end") {
    return "Object could not complete";
  }
  if (unit.stopping_reason === "remaining_obligations") {
    return "Replay ended with unresolved obligations";
  }
  if (unit.stopping_reason === "max_states") {
    if (unit.stopping_phase === "object_start") {
      return "State limit reached while starting an object";
    }
    if (unit.stopping_phase === "object_end") {
      return "State limit reached during object completion";
    }
    if (unit.stopping_phase === "visible_event") {
      return "State limit reached while replaying the event";
    }
    return "State limit reached during replay";
  }
  return unit.status === "non_fitting"
    ? "No valid continuation was available"
    : "Replay stopped before a conclusion";
}

function formatActivity(activity: string): string {
  if (activity.startsWith("START_")) {
    return `Start ${activity.slice(6).replaceAll("_", " ")}`;
  }
  if (activity.startsWith("END_")) {
    return `End ${activity.slice(4).replaceAll("_", " ")}`;
  }
  return activity;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function summarize(values: string[]): string {
  if (values.length <= 3) return values.join(", ");
  return `${values.slice(0, 3).join(", ")} +${values.length - 3}`;
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
