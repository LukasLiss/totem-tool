import { useEffect, useId, useMemo, useRef, useState } from "react";

import { VariantRow } from "./VariantRow";
import type { ProcessAreaVariants } from "./types";

export type ProcessAreaVariantTabsProps = {
  areas: ProcessAreaVariants[];
  zoom: number;
  labelMode: "compact" | "full";
  colWidth: number;
  typeColors?: Record<string, string>;
};

/**
 * One tab per process area, each holding that area's variant list. The tab
 * names are the area's object types. Follows the WAI-ARIA tabs pattern:
 * arrow keys / Home / End move between tabs.
 */
export function ProcessAreaVariantTabs({
  areas,
  zoom,
  labelMode,
  colWidth,
  typeColors,
}: ProcessAreaVariantTabsProps) {
  const baseId = useId();
  const [active, setActive] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // A new result may have fewer areas than the tab that was selected.
  useEffect(() => {
    if (active >= areas.length) setActive(0);
  }, [areas.length, active]);

  const current = areas[Math.min(active, areas.length - 1)];
  const sortedVariants = useMemo(
    () => [...(current?.variants ?? [])].sort((a, b) => b.support - a.support),
    [current],
  );
  const totalSupport = useMemo(
    () => sortedVariants.reduce((sum, v) => sum + v.support, 0),
    [sortedVariants],
  );

  if (!current) {
    return <div className="text-sm text-muted-foreground">No process areas found for this log.</div>;
  }

  const focusTab = (index: number) => {
    const next = (index + areas.length) % areas.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight") focusTab(index + 1);
    else if (event.key === "ArrowLeft") focusTab(index - 1);
    else if (event.key === "Home") focusTab(0);
    else if (event.key === "End") focusTab(areas.length - 1);
    else return;
    event.preventDefault();
  };

  const panelId = `${baseId}-panel`;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div
        role="tablist"
        aria-label="Process areas"
        className="flex min-w-0 gap-1 overflow-x-auto border-b"
      >
        {areas.map((area, index) => {
          const selected = index === active;
          return (
            <button
              key={`${area.label}-${index}`}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${index}`}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              title={area.label}
              className={`-mb-px flex max-w-[260px] shrink-0 items-center gap-1.5 border-b-2 px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selected
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="truncate">{area.label}</span>
              <span
                className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                  selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                }`}
              >
                {area.variant_count}
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${baseId}-tab-${active}`}
        className="flex min-w-0 flex-col gap-3"
      >
        <AreaSummary area={current} variantCount={sortedVariants.length} totalSupport={totalSupport} />
        {sortedVariants.map((v) => (
          <VariantRow
            key={v.id}
            v={v}
            totalSupport={totalSupport}
            zoom={zoom}
            labelMode={labelMode}
            colWidth={colWidth}
            typeColorsOverride={typeColors}
          />
        ))}
      </div>
    </div>
  );
}

function AreaSummary({
  area,
  variantCount,
  totalSupport,
}: {
  area: ProcessAreaVariants;
  variantCount: number;
  totalSupport: number;
}) {
  const activities = area.activities.length;
  return (
    <div className="space-y-0.5 text-sm text-muted-foreground" aria-live="polite">
      {area.skipped_reason ? (
        <p>{area.skipped_reason} No process executions were computed for it.</p>
      ) : variantCount === 0 ? (
        <p>
          {area.execution_count === 0
            ? "No process executions found in this area."
            : `${area.execution_count} process execution${area.execution_count === 1 ? "" : "s"}, but none with more than one event, so there are no variants to show.`}
        </p>
      ) : (
        <p>
          Found <span className="font-medium text-foreground">{variantCount}</span> variant
          {variantCount === 1 ? "" : "s"} across{" "}
          <span className="font-medium text-foreground">{totalSupport}</span> process execution
          {totalSupport === 1 ? "" : "s"}
        </p>
      )}
      <p className="text-xs">
        Object types: {area.object_types.join(", ")} · {activities} activit{activities === 1 ? "y" : "ies"}
      </p>
    </div>
  );
}

export default ProcessAreaVariantTabs;
