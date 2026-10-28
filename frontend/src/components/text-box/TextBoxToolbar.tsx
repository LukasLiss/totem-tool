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
import React, { useState } from 'react';
import { Bold, Italic, Link2, Underline } from 'lucide-react';
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
  TEXT_ALIGN_OPTIONS,
  TEXT_BOX_FORMAT_DEFAULTS,
  TEXT_COLOR_SWATCHES,
  type TextAlign,
  type TextBoxFormat,
  VERTICAL_ALIGN_OPTIONS,
  isHexColor,
} from './textBoxFormat';
import { isMailtoHref, isSafeHref } from './richText';
import type { ProjectDashboard } from './useProjectDashboards';

type LinkKind = 'web' | 'email' | 'dashboard';

const LINK_KIND_LABELS: Record<LinkKind, string> = {
  web: 'Web',
  email: 'Email',
  dashboard: 'Dashboard',
};

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

/**
 * Attach a link to the selected text: a web URL, an email address, or another
 * dashboard in this project.
 */
function LinkField({
  editor,
  href,
  dashboardId,
  dashboards,
  canLink,
  inputId,
}: {
  editor: Editor;
  href: string | null;
  dashboardId: number | null;
  dashboards: ProjectDashboard[];
  canLink: boolean;
  /** Unique per widget: two text boxes can have their popovers open at once. */
  inputId: string;
}) {
  const active = Boolean(href) || dashboardId !== null;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LinkKind>('web');
  const [draft, setDraft] = useState('');
  const [target, setTarget] = useState<string>('');

  const resolved = kind === 'email' ? `mailto:${draft.trim()}` : draft.trim();
  const valid =
    kind === 'dashboard'
      ? target !== ''
      : isSafeHref(resolved) && (kind === 'email') === isMailtoHref(resolved);

  // Open on an existing link and it edits that link, not a blank form.
  const seed = () => {
    if (dashboardId !== null) {
      setKind('dashboard');
      setTarget(String(dashboardId));
      setDraft('');
    } else if (href && isMailtoHref(href)) {
      setKind('email');
      setDraft(href.slice('mailto:'.length));
      // Or a dashboard left over from a previous use shows up pre-chosen,
      // one click away from linking this run somewhere never picked.
      setTarget('');
    } else {
      setKind('web');
      setDraft(href ?? '');
      setTarget('');
    }
  };

  // Widen to whichever link the caret sits in, so editing replaces the whole
  // link. The marks exclude each other in the schema, so setting one drops
  // the other with no unsetting here.
  const spanning = () =>
    editor.chain().focus().extendMarkRange('link').extendMarkRange('dashboardLink');

  const apply = () => {
    if (!valid) return;
    if (kind === 'dashboard') {
      spanning().setDashboardLink({ dashboardId: Number(target) }).run();
    } else {
      spanning().setLink({ href: resolved }).run();
    }
    setOpen(false);
  };

  const remove = () => {
    spanning().unsetLink().unsetDashboardLink().run();
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) seed();
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant={active ? 'secondary' : 'outline'}
          aria-label="Link"
          aria-pressed={active}
          title="Link"
          disabled={!canLink}
          className="size-8"
          onMouseDown={keepSelection}
        >
          <Link2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 space-y-3"
        align="start"
        // Radix would otherwise focus the "Web" button, so typing goes
        // nowhere. Unlike ColorField the field must take focus; the selection
        // survives because the trigger keeps it on mousedown.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => inputRef.current?.select());
        }}
      >
        <div className="flex gap-1">
          {(Object.keys(LINK_KIND_LABELS) as LinkKind[]).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={kind === option ? 'secondary' : 'outline'}
              aria-pressed={kind === option}
              className="flex-1 text-xs"
              onMouseDown={keepSelection}
              onClick={() => setKind(option)}
            >
              {LINK_KIND_LABELS[option]}
            </Button>
          ))}
        </div>

        {kind === 'dashboard' ? (
          <>
            <Label className="text-xs">Dashboard</Label>
            {/* Not a <Select>: its options render in their own portal, and
                a click out there closed this popover before Apply. */}
            <div
              role="listbox"
              aria-label="Dashboard"
              className="max-h-40 space-y-1 overflow-auto"
            >
              {dashboards.map((dashboard) => (
                <button
                  key={dashboard.id}
                  type="button"
                  role="option"
                  aria-selected={target === String(dashboard.id)}
                  onMouseDown={keepSelection}
                  onClick={() => setTarget(String(dashboard.id))}
                  className={cn(
                    'w-full truncate rounded-md px-2 py-1 text-left text-xs',
                    target === String(dashboard.id)
                      ? 'bg-secondary text-secondary-foreground'
                      : 'hover:bg-muted',
                  )}
                >
                  {dashboard.name}
                </button>
              ))}
            </div>
            {dashboards.length === 0 && (
              <p className="text-xs text-muted-foreground">
                This project has no other dashboards yet.
              </p>
            )}
          </>
        ) : (
          <>
            <Label className="text-xs" htmlFor={inputId}>
              {kind === 'email' ? 'Email address' : 'URL'}
            </Label>
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              inputMode="url"
              value={draft}
              placeholder={kind === 'email' ? 'someone@example.com' : 'https://example.com'}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  apply();
                }
              }}
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
            />
            {draft.trim() !== '' && !valid && (
              <p className="text-xs text-destructive">
                {kind === 'email'
                  ? 'Enter a single email address.'
                  : 'Only http:// and https:// links are allowed.'}
              </p>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          {active && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onMouseDown={keepSelection}
              onClick={remove}
            >
              Remove
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={!valid}
            onMouseDown={keepSelection}
            onClick={apply}
          >
            Apply
          </Button>
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
  /** Dashboards in this project, for the link popover's picker. */
  dashboards?: ProjectDashboard[];
}

export function TextBoxToolbar({
  editor,
  format,
  onFormatChange,
  idPrefix,
  dashboards = [],
}: TextBoxToolbarProps) {
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
      const dashboardAttrs = instance.getAttributes('dashboardLink') as {
        dashboardId?: number;
      };
      return {
        bold: instance.isActive('bold'),
        italic: instance.isActive('italic'),
        underline: instance.isActive('underline'),
        href: (instance.getAttributes('link') as { href?: string }).href ?? null,
        dashboardId: dashboardAttrs.dashboardId ?? null,
        // Nothing to act on when the caret is collapsed outside a link:
        // there is no text to turn into one and none to edit.
        canLink:
          !instance.state.selection.empty ||
          instance.isActive('link') ||
          instance.isActive('dashboardLink'),
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

  // While typing, `sizeDraft` holds the raw string; null means "show the
  // selection's own size".
  const [sizeDraft, setSizeDraft] = useState<string | null>(null);

  const commitFontSize = () => {
    if (sizeDraft === null) return;
    const next = Number(sizeDraft);
    setSizeDraft(null);
    // A cleared field reverts rather than snapping to the minimum.
    if (!editor || sizeDraft.trim() === '' || !Number.isFinite(next)) return;
    const clamped = Math.min(Math.max(Math.round(next), FONT_SIZE_MIN), FONT_SIZE_MAX);
    chain().setFontSize(`${clamped}px`).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-card px-2 py-1.5">
      {/* Clamped on blur or Enter, never per keystroke: the first digit of
          "24" clamps to the 8 minimum and rewrites the field, so most sizes
          could not be typed at all. */}
      <input
        type="number"
        min={FONT_SIZE_MIN}
        max={FONT_SIZE_MAX}
        value={sizeDraft ?? fontSize}
        disabled={disabled}
        aria-label="Font size"
        title="Font size"
        onChange={(event) => setSizeDraft(event.target.value)}
        onBlur={commitFontSize}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitFontSize();
          } else if (event.key === 'Escape') {
            setSizeDraft(null);
          }
        }}
        className="h-8 w-16 rounded-md border border-border bg-background px-2 text-xs"
      />
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
        {editor && (
          <LinkField
            editor={editor}
            href={state?.href ?? null}
            dashboardId={state?.dashboardId ?? null}
            dashboards={dashboards}
            canLink={Boolean(state?.canLink)}
            inputId={`${idPrefix}-link-target`}
          />
        )}
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
