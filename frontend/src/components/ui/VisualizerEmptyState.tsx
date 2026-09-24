/**
 * The card a visualizer shows while no event log is selected. Shared so every
 * view says it the same way.
 */
import { Badge } from '@/components/ui/badge';

interface VisualizerEmptyStateProps {
  label: string;
  message: string;
  /** Covers the canvas — the parent must be positioned. Pass false to fill a card slot instead. */
  overlay?: boolean;
}

export function VisualizerEmptyState({ label, message, overlay = true }: VisualizerEmptyStateProps) {
  return (
    <div
      role="status"
      className={
        overlay
          ? 'absolute inset-0 z-20 flex items-center justify-center bg-white/80 p-4 backdrop-blur-sm'
          : 'flex h-full w-full items-center justify-center p-4'
      }
    >
      <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-5 text-center shadow-md">
        <Badge variant="outline">{label}</Badge>
        <p className="text-sm text-slate-600">{message}</p>
      </div>
    </div>
  );
}
