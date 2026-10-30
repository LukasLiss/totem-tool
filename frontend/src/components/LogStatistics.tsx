import React from 'react';
import ComputationStatus from "@/components/ComputationStatus";
import { LOG_STATISTICS, useLogStatistics, type LogStatisticKey } from "./logStatisticsUtils";

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

  return (
    <div className={`flex flex-wrap gap-2 p-2 items-center justify-center bg-background ${className}`}>
      {LOG_STATISTICS.filter((stat) => shown[stat.key]).map((stat) => (
        <div key={stat.key} className="flex-1 min-w-[80px] bg-card border rounded-lg shadow-sm px-3 py-2 overflow-hidden">
          <p className="text-xs text-muted-foreground truncate">{stat.label}</p>
          <p className="text-lg font-bold truncate">{stat.format(stats)}</p>
        </div>
      ))}
    </div>
  );
};

export default LogStatistics;
