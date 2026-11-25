import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Code, Copy } from "lucide-react";
import { isSafeHref, repairMojibake } from "./chatFormat";

type HastNode = { type: string; value?: string; tagName?: string; properties?: object; children?: HastNode[] };

/**
 * Models often put `<br>` inside table cells, where markdown has no line break.
 * Raw HTML is never rendered; this turns just those tags into real line breaks.
 */
function rehypeBreakTags() {
  const walk = (node: HastNode) => {
    node.children?.forEach((child, i, siblings) => {
      if (child.type === "raw" && /^<br\s*\/?>$/i.test((child.value || "").trim())) {
        siblings[i] = { type: "element", tagName: "br", properties: {}, children: [] };
      } else {
        walk(child);
      }
    });
  };
  return (tree: HastNode) => walk(tree);
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const handleCopy = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 overflow-hidden rounded-md border border-border/80 bg-zinc-950 text-zinc-100 text-xs font-mono">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 py-1.5 text-zinc-400">
        <span className="flex items-center gap-1.5">
          <Code className="size-3.5" />
          {language}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-zinc-100 text-zinc-400 transition-colors"
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

const alignClass = (align: unknown) =>
  align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";

const components: Components = {
  h1: ({ children }) => <h2 className="mt-4 mb-2 font-bold text-lg text-foreground">{children}</h2>,
  h2: ({ children }) => <h3 className="mt-3.5 mb-1.5 font-bold text-base text-foreground">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1 font-semibold text-sm text-foreground">{children}</h4>,
  h4: ({ children }) => <h5 className="mt-3 mb-1 font-semibold text-sm text-foreground">{children}</h5>,
  h5: ({ children }) => <h6 className="mt-2 mb-1 font-semibold text-xs text-foreground">{children}</h6>,
  h6: ({ children }) => <h6 className="mt-2 mb-1 font-semibold text-xs text-muted-foreground">{children}</h6>,
  p: ({ children }) => <p className="text-sm leading-relaxed my-1">{children}</p>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-primary/60 pl-3 italic text-muted-foreground text-xs">
      {children}
    </blockquote>
  ),
  ul: ({ children }) => <ul className="my-1 ml-4 list-disc space-y-0.5 text-sm">{children}</ul>,
  ol: ({ children, start }) => (
    <ol start={start} className="my-1 ml-4 list-decimal space-y-0.5 text-sm">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="my-0.5 pl-0.5 [&>p]:my-0">{children}</li>,
  hr: () => <hr className="my-3 border-t border-border/70" />,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) =>
    isSafeHref(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline font-medium">
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  // Inline code only: fenced blocks are rendered whole by `pre` below.
  code: ({ children }) => (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-primary">{children}</code>
  ),
  pre: ({ children }) => {
    const child = React.Children.toArray(children)[0];
    const props = React.isValidElement<{ className?: string; children?: React.ReactNode }>(child) ? child.props : {};
    const language = /language-([\w+#.-]+)/.exec(props.className || "")?.[1] || "code";
    return <CodeBlock language={language} code={textOf(props.children).replace(/\n$/, "")} />;
  },
  // Wide tables scroll sideways inside the bubble instead of squeezing or clipping columns.
  table: ({ children }) => (
    <div
      data-testid="md-table-scroll"
      className="my-3 max-w-full overflow-x-auto rounded-lg border border-border/80 bg-card shadow-2xs"
    >
      <table className="min-w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/70 text-foreground font-semibold border-b border-border/80">{children}</thead>
  ),
  tbody: ({ children }) => <tbody className="divide-y divide-border/40">{children}</tbody>,
  tr: ({ children }) => <tr className="hover:bg-muted/30 transition-colors">{children}</tr>,
  th: ({ children, style }) => (
    <th className={`px-3 py-2 font-semibold text-xs whitespace-nowrap ${alignClass(style?.textAlign)}`}>{children}</th>
  ),
  td: ({ children, style }) => (
    <td
      className={`min-w-24 px-3 py-2 align-top text-xs leading-relaxed text-foreground/90 ${alignClass(style?.textAlign)}`}
    >
      {children}
    </td>
  ),
};

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeBreakTags];

/** Renders assistant markdown (GFM: tables, strikethrough, task lists) without ever rendering raw HTML. */
export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="space-y-1 min-w-0">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {repairMojibake(content)}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownRenderer;
