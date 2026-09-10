/**
 * A textarea with SQL syntax highlighting. The textarea keeps the text (so
 * selection, caret, undo and IME all work natively) and is rendered with a
 * transparent text color on top of a `<pre>` that shows the same text as
 * colored tokens. Both share font metrics and padding so glyphs line up.
 */

import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { SQL_TOKEN_COLORS, tokenizeSql } from "./sqlHighlight";

export interface SqlHighlightedTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
  value: string;
  onChange?: (value: string) => void;
  /** class applied to the wrapper; use it for height / borders */
  className?: string;
  /** class applied to both text layers; use it for font / padding */
  textClassName?: string;
}

const LAYER_BASE =
  "m-0 whitespace-pre-wrap break-words font-mono text-[13px] leading-[22px] tracking-normal";

export const SqlHighlightedTextarea = forwardRef<HTMLTextAreaElement, SqlHighlightedTextareaProps>(
  function SqlHighlightedTextarea(
    { value, onChange, className, textClassName, style, readOnly, ...rest },
    ref
  ) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const preRef = useRef<HTMLPreElement | null>(null);
    useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement, []);

    const tokens = useMemo(() => tokenizeSql(value), [value]);

    const syncScroll = useCallback(() => {
      const ta = textareaRef.current;
      const pre = preRef.current;
      if (!ta || !pre) return;
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
    }, []);

    const layerClass = cn(LAYER_BASE, "px-3.5 py-2.5", textClassName);

    return (
      <div className={cn("relative min-h-0 w-full", className)} style={style}>
        <pre
          ref={preRef}
          aria-hidden
          className={cn(
            layerClass,
            "pointer-events-none absolute inset-0 overflow-hidden text-foreground"
          )}
        >
          {tokens.map((t, i) => (
            <span key={i} style={{ color: SQL_TOKEN_COLORS[t.kind] }}>
              {t.text}
            </span>
          ))}
          {/* a trailing newline needs a visible line to keep heights equal */}
          {"\n"}
        </pre>
        <textarea
          ref={textareaRef}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange?.(e.target.value)}
          onScroll={syncScroll}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className={cn(
            layerClass,
            "relative block h-full w-full resize-none border-0 bg-transparent text-transparent caret-foreground outline-none placeholder:text-muted-foreground",
            readOnly && "cursor-default"
          )}
          {...rest}
        />
      </div>
    );
  }
);

export default SqlHighlightedTextarea;
