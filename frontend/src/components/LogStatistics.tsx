import React from 'react';
import ComputationStatus from "@/components/ComputationStatus";
import {
  LOG_STATISTICS,
  bestStatColumns,
  useElementSize,
  useLogStatistics,
  type LogStatisticKey,
} from "./logStatisticsUtils";

/** Space between the rows (gap-2). */
const ROW_GAP = 8;
/**
 * How the cards are drawn for the height a row has (px): `regular` (label
 * above a large value, ~62 px), `compact` (less padding, smaller value,
 * ~46 px) or `inline` (label and value on one line, ~28 px). So the widget
 * never scrolls: the cards get smaller instead.
 */
type CardDensity = 'regular' | 'compact' | 'inline';
const densityFor = (rowHeight: number): CardDensity =>
  rowHeight <= 0 || rowHeight >= 62 ? 'regular' : rowHeight >= 46 ? 'compact' : 'inline';

interface LogStatisticsProps {
  fileId: number | undefined;
  filterEnabled?: boolean;
  localFilterParams?: Record<string, string>;
  showNumEvents?: boolean;
  showNumActivities?: boolean;
  showNumObjects?: boolean;
  showNumObjectTypes?: boolean;
  showEarliestTimestamp?: boolean;
  showNewestTimestamp?: boolean;
  showDuration?: boolean;
  className?: string;
  /**
   * The box has a set height (a dashboard tile): the cards get more compact
   * when a row has less room than they need, so the box never scrolls.
   * Without it (e.g. the overview page) the box is as tall as its cards.
   */
  fitHeight?: boolean;
}

const LogStatistics: React.FC<LogStatisticsProps> = ({
  fileId,
  filterEnabled = true,
  localFilterParams,
  showNumEvents = true,
  showNumActivities = true,
  showNumObjects = true,
  showNumObjectTypes = true,
  showEarliestTimestamp = false,
  showNewestTimestamp = false,
  showDuration = false,
  className = '',
  fitHeight = false,
}) => {
  const { stats, loading, error } = useLogStatistics(fileId, { filterEnabled, localFilterParams });
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
  // The box's content height (padding excluded) shared by the rows.
  const density: CardDensity = fitHeight
    ? densityFor(box.height > 0 ? (box.height - (rows.length - 1) * ROW_GAP) / rows.length : 0)
    : 'regular';

  return (
    // fitHeight: min-h-0 and overflow hidden, so the box takes the room it is
    // given (a flex child would otherwise grow to its cards and the tile scroll).
    <div
      ref={box.ref}
      // In a tile (fitHeight): right under the card's header (WidgetHeader: its
      // 8 px bottom padding is the gap), at its 16 px side inset, on the card's
      // own background; the rows share the whole height (the cards stretch,
      // their text centred in them). Elsewhere: centred, as before.
      className={`flex flex-col gap-2 ${
        fitHeight ? 'min-h-0 overflow-hidden bg-card px-4 pt-0 pb-4' : 'justify-center p-2 bg-background'
      } ${className}`}
    >
      {rows.map((row, r) => (
        <div key={r} className={`flex gap-2 ${fitHeight ? 'min-h-0 flex-1' : ''}`}>
          {row.map((stat) =>
            density === 'inline' ? (
              <div
                key={stat.key}
                className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-lg border bg-card px-3 py-1 shadow-sm"
              >
                <p className="min-w-0 shrink truncate text-[11px] text-muted-foreground">{stat.label}</p>
                <p className="ml-auto min-w-0 truncate text-sm font-bold">{stat.format(stats)}</p>
              </div>
            ) : (
              <div
                key={stat.key}
                className={`flex flex-1 min-w-0 flex-col justify-center bg-card border rounded-lg shadow-sm px-3 overflow-hidden ${density === 'compact' ? 'py-1' : 'py-2'}`}
              >
                <p className={`${density === 'compact' ? 'text-[11px]' : 'text-xs'} text-muted-foreground truncate`}>{stat.label}</p>
                <p className={`${density === 'compact' ? 'text-base' : 'text-lg'} font-bold truncate`}>{stat.format(stats)}</p>
              </div>
            ),
          )}
        </div>
      ))}
    </div>
  );
};

export default LogStatistics;
