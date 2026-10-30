import React from 'react';
import ComputationStatus from "@/components/ComputationStatus";
import {
  LOG_STATISTICS,
  bestStatColumns,
  useElementSize,
  useLogStatistics,
  type LogStatisticKey,
} from "./logStatisticsUtils";

interface LogStatisticsProps {
  fileId: number | undefined;
  showNumEvents?: boolean;
  showNumActivities?: boolean;
  showNumObjects?: boolean;
  showNumObjectTypes?: boolean;
  showEarliestTimestamp?: boolean;
  showNewestTimestamp?: boolean;
  showDuration?: boolean;
  className?: string;
}

const LogStatistics: React.FC<LogStatisticsProps> = ({
  fileId,
  showNumEvents = true,
  showNumActivities = true,
  showNumObjects = true,
  showNumObjectTypes = true,
  showEarliestTimestamp = false,
  showNewestTimestamp = false,
  showDuration = false,
  className = '',
}) => {
  const { stats, loading, error } = useLogStatistics(fileId);
  const box = useElementSize();

  const shown: Record<LogStatisticKey, boolean> = {
    show_num_events: showNumEvents,
    show_num_activities: showNumActivities,
    show_num_objects: showNumObjects,
    show_num_object_types: showNumObjectTypes,
    show_earliest_timestamp: showEarliestTimestamp,
    show_newest_timestamp: showNewestTimestamp,
    show_duration: showDuration,
  };

  // Loading state
  if (loading) {
    return (
      <div className={`flex items-center justify-center h-full min-h-[64px] ${className}`}>
        <ComputationStatus
          fileId={fileId}
          urlIncludes="/statistics/"
          fallback={<p className="text-muted-foreground">Loading statistics...</p>}
        />
      </div>
    );
  }

  // Error or no file selected
  if (error || !stats) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <p className="text-muted-foreground">{error || 'Select an event log to view statistics'}</p>
      </div>
    );
  }

  // Cards wrap into evenly filled rows that fit the box best (one row when
  // wide, several when tall), the same arrangement as the edit-mode draft.
  // The cards keep their natural height; the rows sit centered in the box.
  const visible = LOG_STATISTICS.filter((stat) => shown[stat.key]);
  const columns = bestStatColumns(visible.length, box.width, box.height);
  const rows = Array.from({ length: Math.ceil(visible.length / columns) }, (_, r) =>
    visible.slice(r * columns, (r + 1) * columns)
  );

  return (
    <div ref={box.ref} className={`flex flex-col justify-center gap-2 p-2 bg-background ${className}`}>
      {rows.map((row, r) => (
        <div key={r} className="flex gap-2">
          {row.map((stat) => (
            <div key={stat.key} className="flex-1 min-w-0 bg-card border rounded-lg shadow-sm px-3 py-2 overflow-hidden">
              <p className="text-xs text-muted-foreground truncate">{stat.label}</p>
              <p className="text-lg font-bold truncate">{stat.format(stats)}</p>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default LogStatistics;
