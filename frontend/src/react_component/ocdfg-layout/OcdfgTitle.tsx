/**
 * The title of a DFG card, drawn on the canvas (top left, see OcdfgView):
 * the name, then the global filter switch and the card's local filter when
 * the host hands over their handlers.
 */
import { GlobalFilterToggle } from '@/components/ui/GlobalFilterToggle';
import { LocalFilterDropdown } from '@/components/ui/LocalFilterDropdown';

export function OcdfgTitle({
  label,
  fileId,
  filterEnabled = true,
  onToggleFilter,
  localFilterParams,
  onLocalFilterChange,
}: {
  label: string;
  fileId?: number;
  filterEnabled?: boolean;
  onToggleFilter?: () => void;
  localFilterParams?: Record<string, string>;
  onLocalFilterChange?: (params: Record<string, string>) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="truncate text-[15px] font-bold text-(--foreground)" title={label}>
        {label}
      </span>
      {onToggleFilter && <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={onToggleFilter} stopPropagation />}
      {onLocalFilterChange && (
        <LocalFilterDropdown fileId={fileId} onFilterChange={onLocalFilterChange} value={localFilterParams} stopPropagation />
      )}
    </div>
  );
}

export default OcdfgTitle;
