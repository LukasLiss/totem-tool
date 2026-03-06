import React, { useState, useEffect } from 'react';

// Helper function to format duration from seconds
export const formatDuration = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
};

// Helper function to format unix timestamp as date string
export const formatTimestamp = (unix: number): string => {
  const date = new Date(unix * 1000);
  return date.toLocaleDateString();
};

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

interface Statistics {
  num_events: number;
  num_unique_activities: number;
  num_objects: number;
  num_object_types: number;
  earliest_timestamp: number;
  newest_timestamp: number;
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
  // State for fetched statistics
  const [stats, setStats] = useState<Statistics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch statistics when fileId changes
  useEffect(() => {
    if (!fileId) {
      setStats(null);
      return;
    }

    const fetchStats = async () => {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('access_token');
      try {
        const res = await fetch(`/api/files/${fileId}/statistics/`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        } else {
          setError('Failed to load statistics');
        }
      } catch (err) {
        console.error('Failed to fetch statistics:', err);
        setError('Failed to load statistics');
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, [fileId]);

  // Loading state
  if (loading) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <p className="text-muted-foreground">Loading statistics...</p>
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

  const duration = stats.newest_timestamp - stats.earliest_timestamp;

  return (
    <div className={`flex flex-wrap gap-2 p-2 items-center justify-center bg-background ${className}`}>
      {showNumEvents && (
        <div className="flex-1 min-w-[80px] bg-card border rounded-lg shadow-sm px-3 py-2 overflow-hidden">
          <p className="text-xs text-muted-foreground truncate">Events</p>
          <p className="text-lg font-bold truncate">{stats.num_events.toLocaleString()}</p>
        </div>
      )}
      {showNumActivities && (
        <div className="flex-1 min-w-[80px] bg-card border rounded-lg shadow-sm px-3 py-2 overflow-hidden">
          <p className="text-xs text-muted-foreground truncate">Activities</p>
          <p className="text-lg font-bold truncate">{stats.num_unique_activities.toLocaleString()}</p>
        </div>
      )}
      {showNumObjects && (
        <div className="flex-1 min-w-[80px] bg-card border rounded-lg shadow-sm px-3 py-2 overflow-hidden">
          <p className="text-xs text-muted-foreground truncate">Objects</p>
          <p className="text-lg font-bold truncate">{stats.num_objects.toLocaleString()}</p>
        </div>
      )}
      {showNumObjectTypes && (
        <div className="flex-1 min-w-[80px] bg-card border rounded-lg shadow-sm px-3 py-2 overflow-hidden">
          <p className="text-xs text-muted-foreground truncate">Object Types</p>
          <p className="text-lg font-bold truncate">{stats.num_object_types.toLocaleString()}</p>
        </div>
      )}
      {showEarliestTimestamp && (
        <div className="flex-1 min-w-[80px] bg-card border rounded-lg shadow-sm px-3 py-2 overflow-hidden">
          <p className="text-xs text-muted-foreground truncate">Earliest</p>
          <p className="text-lg font-bold truncate">{formatTimestamp(stats.earliest_timestamp)}</p>
        </div>
      )}
      {showNewestTimestamp && (
        <div className="flex-1 min-w-[80px] bg-card border rounded-lg shadow-sm px-3 py-2 overflow-hidden">
          <p className="text-xs text-muted-foreground truncate">Newest</p>
          <p className="text-lg font-bold truncate">{formatTimestamp(stats.newest_timestamp)}</p>
        </div>
      )}
      {showDuration && (
        <div className="flex-1 min-w-[80px] bg-card border rounded-lg shadow-sm px-3 py-2 overflow-hidden">
          <p className="text-xs text-muted-foreground truncate">Duration</p>
          <p className="text-lg font-bold truncate">{formatDuration(duration)}</p>
        </div>
      )}
    </div>
  );
};

export default LogStatistics;
