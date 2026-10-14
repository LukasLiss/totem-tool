/**
 * Formatting toolbar for the Text Box (#373).
 *
 * Bold / italic / underline / colour / size / font act on the **current
 * selection** through TipTap commands; alignment acts on the paragraph the
 * cursor is in. Background colour and vertical alignment are the only
 * box-level settings left, because neither can be expressed per paragraph —
 * those are patched onto the GridStack node through `onFormatChange`.
 *
 * Button state is read back from the editor (`isActive` / `getAttributes`),
 * so what is highlighted is always what the selection actually carries.
 */
import type React from 'react';
import { Bold, Italic, Underline } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import {
  BACKGROUND_COLOR_SWATCHES,
  FONT_FAMILY_OPTIONS,
  FONT_FAMILY_STACKS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_PRESETS,
  TEXT_ALIGN_OPTIONS,
  TEXT_BOX_FORMAT_DEFAULTS,
  TEXT_COLOR_SWATCHES,
  type TextAlign,
  type TextBoxFormat,
  VERTICAL_ALIGN_OPTIONS,
  isHexColor,
} from './textBoxFormat';

/**
 * Stop a toolbar control from taking focus. Without this the editor blurs on
 * mousedown, ProseMirror collapses the selection, and the command lands on a
 * caret instead of the text the user had highlighted — which looked like
 * "colour does nothing".
 */
const keepSelection = (event: React.MouseEvent) => event.preventDefault();

/** Four glyphs rather than four words — the row has to fit a narrow tile. */
const ALIGN_GLYPHS: Record<TextAlign, string> = {
  left: '◧',
  center: '▣',
  right: '◨',
  justify: '▤',
};

const VERTICAL_ALIGN_GLYPHS: Record<'top' | 'middle' | 'bottom', string> = {
  top: '⬒',
  middle: '▣',
  bottom: '⬓',
};

function ColorField({
  id,
  label,
  value,
  swatches,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  swatches: readonly string[];
  onChange: (hex: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 font-normal"
          aria-label={label}
          title={label}
          onMouseDown={keepSelection}
        >
          <span className="size-4 rounded border border-border" style={{ background: value }} />
          <span className="text-xs uppercase">{value}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto space-y-3"
        align="start"
        // Focusing the popover would blur the editor and collapse the
        // selection the colour is meant to apply to.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Label className="text-xs">{label}</Label>
        <div className="grid grid-cols-5 gap-1.5">
          {swatches.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={swatch}
              title={swatch}
              onMouseDown={keepSelection}
              onClick={() => onChange(swatch)}
              className={cn(
                'size-6 rounded border',
                swatch === value ? 'border-primary ring-2 ring-primary/40' : 'border-border',
              )}
              style={{ background: swatch }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${id}-custom`} className="text-xs">
            Custom
          </Label>
          <input
            id={`${id}-custom`}
            type="color"
            value={isHexColor(value) ? value : '#000000'}
            onChange={(event) => onChange(event.target.value)}
            className="h-8 w-14 cursor-pointer rounded border border-border bg-transparent p-0.5"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface TextBoxToolbarProps {
  editor: Editor | null;
  /** Box-level settings: background colour and vertical alignment. */
  format: TextBoxFormat;
  onFormatChange: (patch: Partial<TextBoxFormat>) => void;
  /** Unique per widget — a dashboard can hold several text boxes. */
  idPrefix: string;
}

export function TextBoxToolbar({
  editor,
  format,
  onFormatChange,
  idPrefix,
}: TextBoxToolbarProps) {
  const sizeListId = `${idPrefix}-font-sizes`;

  // Re-reads on every selection or document change, so the buttons follow the
  // caret rather than going stale as it moves through differently styled runs.
  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      if (!instance) return null;
      const textStyle = instance.getAttributes('textStyle') as {
        color?: string;
        fontSize?: string;
        fontFamily?: string;
      };
      const alignment = TEXT_ALIGN_OPTIONS.map((o) => o.value).find((value) =>
        instance.isActive({ textAlign: value }),
      );
      return {
        bold: instance.isActive('bold'),
        italic: instance.isActive('italic'),
        underline: instance.isActive('underline'),
        align: alignment ?? TEXT_BOX_FORMAT_DEFAULTS.text_align,
        color: textStyle.color ?? TEXT_BOX_FORMAT_DEFAULTS.text_color,
        fontSize: Number.parseInt(textStyle.fontSize ?? '', 10),
        fontFamily: textStyle.fontFamily ?? FONT_FAMILY_STACKS.sans,
      };
    },
  });

  const disabled = !editor;
  const fontSize = Number.isFinite(state?.fontSize)
    ? (state!.fontSize as number)
    : TEXT_BOX_FORMAT_DEFAULTS.font_size;

  // Every command re-focuses first, so the selection the user made survives
  // the click on the button.
  const chain = () => editor!.chain().focus();

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-card px-2 py-1.5">
      <input
        type="number"
        list={sizeListId}
        min={FONT_SIZE_MIN}
        max={FONT_SIZE_MAX}
        value={fontSize}
        disabled={disabled}
        aria-label="Font size"
        title="Font size"
        onChange={(event) => {
          const next = Number(event.target.value);
          if (!Number.isFinite(next) || !editor) return;
          const clamped = Math.min(Math.max(Math.round(next), FONT_SIZE_MIN), FONT_SIZE_MAX);
          chain().setFontSize(`${clamped}px`).run();
        }}
        className="h-8 w-16 rounded-md border border-border bg-background px-2 text-xs"
      />
      <datalist id={sizeListId}>
        {FONT_SIZE_PRESETS.map((size) => (
          <option key={size} value={size} />
        ))}
      </datalist>

      <Select
        value={state?.fontFamily ?? FONT_FAMILY_STACKS.sans}
        onValueChange={(value) => editor && chain().setFontFamily(value).run()}
        disabled={disabled}
      >
        <SelectTrigger size="sm" className="w-[120px]" aria-label="Font">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FONT_FAMILY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={FONT_FAMILY_STACKS[option.value]}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant={state?.bold ? 'secondary' : 'outline'}
          aria-label="Bold"
          aria-pressed={Boolean(state?.bold)}
          title="Bold"
          disabled={disabled}
          className="size-8"
          onMouseDown={keepSelection}
          onClick={() => chain().toggleBold().run()}
        >
          <Bold />
        </Button>
        <Button
          type="button"
          size="icon"
          variant={state?.italic ? 'secondary' : 'outline'}
          aria-label="Italic"
          aria-pressed={Boolean(state?.italic)}
          title="Italic"
          disabled={disabled}
          className="size-8"
          onMouseDown={keepSelection}
          onClick={() => chain().toggleItalic().run()}
        >
          <Italic />
        </Button>
        <Button
          type="button"
          size="icon"
          variant={state?.underline ? 'secondary' : 'outline'}
          aria-label="Underline"
          aria-pressed={Boolean(state?.underline)}
          title="Underline"
          disabled={disabled}
          className="size-8"
          onMouseDown={keepSelection}
          onClick={() => chain().toggleUnderline().run()}
        >
          <Underline />
        </Button>
      </div>

      <div className="flex items-center gap-1">
        {TEXT_ALIGN_OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="icon"
            variant={state?.align === option.value ? 'secondary' : 'outline'}
            aria-label={`Align ${option.label.toLowerCase()}`}
            aria-pressed={state?.align === option.value}
            title={`Align ${option.label.toLowerCase()} (this paragraph)`}
            disabled={disabled}
            className="size-8"
            onMouseDown={keepSelection}
            onClick={() => chain().setTextAlign(option.value).run()}
          >
            <span aria-hidden="true">{ALIGN_GLYPHS[option.value]}</span>
          </Button>
        ))}
      </div>

      <ColorField
        id={`${idPrefix}-text-color`}
        label="Text colour"
        value={state?.color ?? TEXT_BOX_FORMAT_DEFAULTS.text_color}
        swatches={TEXT_COLOR_SWATCHES}
        onChange={(hex) => editor && chain().setColor(hex).run()}
      />

      {/* Box-level from here on: neither can be expressed per paragraph. */}
      <ColorField
        id={`${idPrefix}-background-color`}
        label="Background colour"
        value={format.background_color}
        swatches={BACKGROUND_COLOR_SWATCHES}
        onChange={(hex) => onFormatChange({ background_color: hex })}
      />

      <div className="flex items-center gap-1">
        {VERTICAL_ALIGN_OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="icon"
            variant={format.vertical_align === option.value ? 'secondary' : 'outline'}
            aria-label={`Vertical align ${option.label.toLowerCase()}`}
            aria-pressed={format.vertical_align === option.value}
            title={`Vertical align ${option.label.toLowerCase()} (whole box)`}
            className="size-8"
            onClick={() => onFormatChange({ vertical_align: option.value })}
          >
            <span aria-hidden="true">{VERTICAL_ALIGN_GLYPHS[option.value]}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

export default TextBoxToolbar;
