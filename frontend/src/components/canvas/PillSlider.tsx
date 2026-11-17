/**
 * A slider in the control pill (the causal net's threshold, TOTeM's τ):
 * lying in a lying pill, label – slider – value; upright in a standing pill
 * (PillVerticalContext), the value below it. It follows the thumb while it is
 * dragged and hands the value over on release (`onCommit`), so a slider that
 * recomputes something does that once, not on every step.
 */
import { useContext, useEffect, useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { PillVerticalContext } from './pillContext';

export interface PillSliderProps {
  /** Short label in a lying pill, e.g. "Threshold", "τ". */
  label: string;
  /** Accessible name of the thumb. */
  ariaLabel: string;
  /** Hover text: what the slider does. */
  title?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** The value on release. */
  onCommit: (value: number) => void;
  disabled?: boolean;
  format?: (value: number) => string;
}

export function PillSlider({
  label,
  ariaLabel,
  title,
  value,
  min,
  max,
  step,
  onCommit,
  disabled = false,
  format = (v) => v.toFixed(2),
}: PillSliderProps) {
  const vertical = useContext(PillVerticalContext);
  // The value while dragging; back to the committed one when that changes.
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const slider = (
    <Slider
      orientation={vertical ? 'vertical' : 'horizontal'}
      className={vertical ? 'data-[orientation=vertical]:h-24 data-[orientation=vertical]:min-h-0' : 'w-28'}
      min={min}
      max={max}
      step={step}
      value={[draft]}
      onValueChange={(v) => setDraft(v[0] ?? min)}
      onValueCommit={(v) => onCommit(v[0] ?? min)}
      disabled={disabled}
      thumbAriaLabel={ariaLabel}
    />
  );
  const shown = <span style={{ fontSize: 11, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>{format(draft)}</span>;

  if (vertical) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '2px 0' }} title={title}>
        {slider}
        {shown}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 4 }} title={title}>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>{label}</span>
      {slider}
      <span style={{ width: 28, display: 'inline-block' }}>{shown}</span>
    </div>
  );
}

export default PillSlider;
