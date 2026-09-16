import { ReactNode, useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Small building blocks for the editor property panels so the model editors
 * share one visual language.
 */

let fieldIdCounter = 0;

export function PanelSection({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('border-b px-4 py-3', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        {action}
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

export function PanelField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** Native select styled to match the shadcn inputs (no radix select installed). */
export function PanelSelect({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn(
        'border-input h-8 w-full rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Placeholder shown in the side panel when nothing is selected. */
export function PanelEmptyState({
  icon,
  title,
  lines,
}: {
  icon?: ReactNode;
  title: string;
  lines: string[];
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-muted-foreground/60">{icon}</div>}
      <div className="text-sm font-medium">{title}</div>
      <ul className="text-muted-foreground flex list-none flex-col gap-1 p-0 text-xs">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/** Compact color swatch row used to pick object type colors. */
export function ColorSwatches({
  colors,
  value,
  onChange,
}: {
  colors: string[];
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Use color ${color}`}
          onClick={() => onChange(color)}
          className={cn(
            'size-5 rounded-full border transition-transform hover:scale-110',
            value.toLowerCase() === color.toLowerCase()
              ? 'ring-2 ring-ring ring-offset-1'
              : 'border-black/10',
          )}
          style={{ background: color }}
        />
      ))}
    </div>
  );
}

export function nextFieldId(prefix: string) {
  fieldIdCounter += 1;
  return `${prefix}-${fieldIdCounter}`;
}

/** Input that keeps a local draft and commits on blur / Enter (Escape reverts). */
export function CommitInput({
  value,
  onCommit,
  placeholder,
  disabled,
  ariaLabel,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Input
      className="h-8"
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          // Only blur — the onBlur handler performs the single commit
          // (calling commit() here too would commit twice).
          (event.target as HTMLInputElement).blur();
        }
        if (event.key === 'Escape') setDraft(value);
      }}
    />
  );
}
