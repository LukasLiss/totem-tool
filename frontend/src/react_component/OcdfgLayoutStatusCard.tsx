import { Button } from '@/components/ui/button';

/**
 * Graphs with more arcs are only laid out on request. ELK can need minutes
 * and more memory than the page has for them, and the result of such a
 * graph is hard to read anyway.
 */
export const AUTO_LAYOUT_MAX_ARCS = 300;

/** 'held': too large to lay out without asking (AUTO_LAYOUT_MAX_ARCS). */
export type OcdfgLayoutState = 'idle' | 'running' | 'failed' | 'held' | 'cancelled';

type Props = {
  state: OcdfgLayoutState;
  nodes: number;
  arcs: number;
  /** How to get a smaller graph; left out where there is no legend. */
  hint?: string;
  /** Small box: a stacked card with the full sentence as tooltip. */
  compact: boolean;
  /** A previous graph is still drawn: the card sits at the top, not centred. */
  graphShown: boolean;
  onCancel: () => void;
  onStart: () => void;
};

/**
 * Status of an OC-DFG layout with its button: running (Cancel), held for its
 * size (Lay out anyway), cancelled or failed (lay out again). Leaves the rest
 * of the canvas — the legend in particular — usable. Nothing while idle.
 */
export default function OcdfgLayoutStatusCard({
  state,
  nodes,
  arcs,
  hint,
  compact,
  graphShown,
  onCancel,
  onStart,
}: Props) {
  const sizeLabel = `${nodes.toLocaleString()} nodes, ${arcs.toLocaleString()} arcs`;
  const hintText = hint ? ` ${hint}` : '';
  const status =
    state === 'running'
      ? {
        text: `Laying out the graph (${sizeLabel})…`,
        short: 'Laying out the graph…',
        shortDetail: sizeLabel,
        action: 'Cancel',
        onClick: onCancel,
      }
      : state === 'held'
        ? {
          text: `This graph is large (${sizeLabel}). Laying it out can take minutes and may crash the page.${hintText}`,
          short: 'Large graph',
          shortDetail: `${sizeLabel} · may take long or crash the page`,
          action: 'Lay out anyway',
          onClick: onStart,
        }
        : state === 'cancelled'
          ? {
            text: `Layout cancelled (${sizeLabel}).`,
            short: 'Layout cancelled',
            shortDetail: sizeLabel,
            action: 'Lay out again',
            onClick: onStart,
          }
          : state === 'failed'
            ? {
              text: `The graph (${sizeLabel}) could not be laid out.${hintText}`,
              short: 'Layout failed',
              shortDetail: sizeLabel,
              action: 'Try again',
              onClick: onStart,
            }
            : null;
  if (!status) return null;

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-20 flex justify-center ${
        compact ? 'p-1' : 'p-4'
      } ${graphShown ? 'items-start' : 'items-center'}`}
    >
      <div
        title={compact ? status.text : undefined}
        className={`pointer-events-auto flex rounded-md border border-slate-200 bg-white font-medium text-slate-700 shadow-lg ${
          compact
            ? 'max-w-full flex-col items-center gap-1.5 px-3 py-2 text-center'
            : 'max-w-md items-center gap-3 px-4 py-3 text-xs'
        }`}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {compact ? (
          <>
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              {state === 'running' && (
                <div className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              )}
              {status.short}
            </div>
            <div className="text-[11px] font-normal leading-snug text-slate-500">
              {status.shortDetail}
            </div>
          </>
        ) : (
          <>
            {state === 'running' && (
              <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            )}
            <span>{status.text}</span>
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          className={compact ? 'h-6 px-2.5 text-[11px]' : 'shrink-0'}
          onClick={status.onClick}
        >
          {status.action}
        </Button>
      </div>
    </div>
  );
}
