/**
 * A round button of the control pill that opens and closes a canvas panel
 * (CanvasPanel): grey while its panel is open, and with a small dot while
 * something keeps running behind a closed panel (e.g. the token animation).
 */
import type React from 'react';
import { Button } from '@/components/ui/button';

export interface PillToggleProps {
  /** Names the panel: the button is labelled "<label>", its title says open/close. */
  label: string;
  open: boolean;
  onToggle: () => void;
  /** The dot: something runs while the panel is closed. */
  running?: boolean;
  /** What runs, for the title, e.g. "the animation is running". */
  runningHint?: string;
  children: React.ReactNode;
}

export function PillToggle({ label, open, onToggle, running = false, runningHint, children }: PillToggleProps) {
  const dot = running && !open;
  return (
    <Button
      type="button"
      variant={open ? 'secondary' : 'outline'}
      size="icon"
      onClick={onToggle}
      className="relative rounded-full h-9 w-9"
      title={`${open ? 'Close' : 'Open'} ${label.toLowerCase()}${dot && runningHint ? ` (${runningHint})` : ''}`}
      aria-label={label}
      aria-pressed={open}
    >
      {children}
      {dot && (
        <span
          data-testid="pill-toggle-running"
          aria-hidden
          className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white"
        />
      )}
    </Button>
  );
}

export default PillToggle;
