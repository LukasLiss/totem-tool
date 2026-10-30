/**
 * Helpers for the log statistics: which statistics exist (with the node
 * field that switches each on), how their values are formatted, and loading
 * them for an event log. Shared by LogStatistics (the view), its dashboard
 * widget's draft and its settings popup.
 */

import { useEffect, useState } from "react";
import axios from "axios";
import { useFilterVersion } from "@/store/filterStore";
import { isCancelledError } from "@/store/computationStore";

export interface Statistics {
  num_events: number;
  num_unique_activities: number;
  num_objects: number;
  num_object_types: number;
  earliest_timestamp: number;
  newest_timestamp: number;
}

/** Node field of the dashboard widget that shows / hides a statistic. */
export type LogStatisticKey =
  | "show_num_events"
  | "show_num_activities"
  | "show_num_objects"
  | "show_num_object_types"
  | "show_earliest_timestamp"
  | "show_newest_timestamp"
  | "show_duration";

export type LogStatisticsSelection = Record<LogStatisticKey, boolean>;

/** Helper function to format duration from seconds */
export const formatDuration = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
};

/** Helper function to format unix timestamp as date string */
export const formatTimestamp = (unix: number): string => {
  const date = new Date(unix * 1000);
  return date.toLocaleDateString();
};

/** All statistics in display order: card label, setting label, group, default, value. */
export const LOG_STATISTICS: {
  key: LogStatisticKey;
  /** As on the card. */
  label: string;
  /** As in the settings. */
  settingLabel: string;
  group: "counts" | "time";
  defaultOn: boolean;
  format: (stats: Statistics) => string;
}[] = [
  {
    key: "show_num_events",
    label: "Events",
    settingLabel: "Number of events",
    group: "counts",
    defaultOn: true,
    format: (s) => s.num_events.toLocaleString(),
  },
  {
    key: "show_num_activities",
    label: "Activities",
    settingLabel: "Number of activities",
    group: "counts",
    defaultOn: true,
    format: (s) => s.num_unique_activities.toLocaleString(),
  },
  {
    key: "show_num_objects",
    label: "Objects",
    settingLabel: "Number of objects",
    group: "counts",
    defaultOn: true,
    format: (s) => s.num_objects.toLocaleString(),
  },
  {
    key: "show_num_object_types",
    label: "Object Types",
    settingLabel: "Number of object types",
    group: "counts",
    defaultOn: true,
    format: (s) => s.num_object_types.toLocaleString(),
  },
  {
    key: "show_earliest_timestamp",
    label: "Earliest",
    settingLabel: "Earliest timestamp",
    group: "time",
    defaultOn: false,
    format: (s) => formatTimestamp(s.earliest_timestamp),
  },
  {
    key: "show_newest_timestamp",
    label: "Newest",
    settingLabel: "Newest timestamp",
    group: "time",
    defaultOn: false,
    format: (s) => formatTimestamp(s.newest_timestamp),
  },
  {
    key: "show_duration",
    label: "Duration",
    settingLabel: "Duration",
    group: "time",
    defaultOn: false,
    format: (s) => formatDuration(s.newest_timestamp - s.earliest_timestamp),
  },
];

/** The widget's selection from its node fields, unset ones at their defaults. */
export function selectionFromNode(node: Partial<Record<LogStatisticKey, boolean>>): LogStatisticsSelection {
  return Object.fromEntries(
    LOG_STATISTICS.map((stat) => [stat.key, node[stat.key] ?? stat.defaultOn])
  ) as LogStatisticsSelection;
}

/** Loads the statistics of an event log; reloads when the filter changes. */
export function useLogStatistics(fileId: number | undefined) {
  const [stats, setStats] = useState<Statistics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filterVersion = useFilterVersion();

  useEffect(() => {
    if (!fileId) {
      setStats(null);
      return;
    }

    const controller = new AbortController();
    const fetchStats = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await axios.get(`/api/files/${fileId}/statistics/`, { signal: controller.signal });
        setStats(data);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(isCancelledError(err) ? "Computation cancelled" : "Failed to load statistics");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    fetchStats();
    // Leaving the page or changing the filter stops the running computation.
    return () => controller.abort();
  }, [fileId, filterVersion]);

  return { stats, loading, error };
}
