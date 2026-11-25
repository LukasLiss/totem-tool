/**
 * The title of a dashboard card, the same on every card: the name (cut off
 * with an ellipsis when too long, the full name on hover), then the global
 * filter switch and the card's local filter when the host hands over their
 * handlers.
 *
 * Canvas cards (the DFGs, the OCCN) draw `WidgetTitle` on the canvas, 16 px
 * from its top-left corner. Cards without a canvas put it into a
 * `WidgetHeader`, which places it at the same 16 px, so both read alike.
 */
import type { ReactNode } from 'react';
import { GlobalFilterToggle } from '@/components/ui/GlobalFilterToggle';
import { LocalFilterDropdown } from '@/components/ui/LocalFilterDropdown';
import { cn } from '@/lib/utils';

export interface WidgetTitleProps {
  label: string;
  fileId?: number | string | null;
  filterEnabled?: boolean;
  /** Given: the title shows the global filter switch. */
  onToggleFilter?: () => void;
  localFilterParams?: Record<string, string>;
  /** Given: the title shows the local filter. */
  onLocalFilterChange?: (params: Record<string, string>) => void;
}

export function WidgetTitle({
  label,
  fileId,
  filterEnabled = true,
  onToggleFilter,
  localFilterParams,
  onLocalFilterChange,
}: WidgetTitleProps) {
  return (
    <div
      className="flex min-h-[30px] min-w-0 items-center gap-1.5 text-left"
      style={{ fontFamily: 'var(--font-primary, Inter, sans-serif)' }}
    >
      {label && (
        <span className="truncate text-[15px] font-bold text-(--foreground)" title={label}>
          {label}
        </span>
      )}
      {/* Clicks stay with the controls, so they start no canvas drag. */}
      {onToggleFilter && <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={onToggleFilter} stopPropagation />}
      {onLocalFilterChange && (
        <LocalFilterDropdown
          fileId={fileId}
          onFilterChange={onLocalFilterChange}
          value={localFilterParams}
          stopPropagation
        />
      )}
    </div>
  );
}

/**
 * The header row of a card without a canvas: the `WidgetTitle` 16 px from
 * the card's top-left corner and, on the right, the card's own controls
 * (`children`). The card must not pad its top itself (shadcn's `Card` does:
 * give it `pt-0 gap-0`).
 */
export function WidgetHeader({
  children,
  className,
  ...title
}: WidgetTitleProps & { children?: ReactNode; className?: string }) {
  return (
    <div
      data-testid="widget-header"
      className={cn(
        'relative z-10 flex flex-shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-card px-4 pt-4 pb-2',
        className,
      )}
    >
      <WidgetTitle {...title} />
      {children && <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>}
    </div>
  );
}
