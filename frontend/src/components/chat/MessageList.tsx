import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  pendingActions?: Array<{
    id: string;
    name: string;
    description: string;
    arguments: Record<string, unknown>;
  }>;
}

interface MessageListProps {
  messages: Message[];
  isStreaming?: boolean;
}

function renderMarkdown(text: string): string {
  let html = text;

  // Fenced code blocks: ```lang\n...\n```
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, lang: string, code: string) => {
      const escaped = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<pre class="bg-muted rounded-md p-3 my-2 overflow-x-auto text-sm"><code class="language-${lang}">${escaped}</code></pre>`;
    }
  );

  // Inline code: `...`
  html = html.replace(
    /`([^`]+)`/g,
    '<code class="bg-muted px-1.5 py-0.5 rounded text-sm">$1</code>'
  );

  // Bold: **...**
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic: *...*
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");

  // Unordered list items: - ...
  html = html.replace(
    /^- (.+)$/gm,
    '<li class="ml-4 list-disc">$1</li>'
  );
  // Wrap consecutive <li> in <ul>
  html = html.replace(
    /((?:<li[^>]*>.*?<\/li>\n?)+)/g,
    '<ul class="my-1">$1</ul>'
  );

  // Ordered list items: 1. ...
  html = html.replace(
    /^\d+\. (.+)$/gm,
    '<li class="ml-4 list-decimal">$1</li>'
  );

  // Paragraphs: double newline
  html = html.replace(/\n\n/g, '</p><p class="my-1">');

  // Single newlines to <br>
  html = html.replace(/\n/g, "<br>");

  return html;
}

export function MessageList({ messages, isStreaming }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={cn(
            "flex",
            msg.role === "user" ? "justify-end" : "justify-start"
          )}
        >
          <div
            className={cn(
              "max-w-[85%] rounded-lg px-3 py-2 text-sm",
              msg.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-muted"
            )}
          >
            {msg.role === "assistant" ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{
                  __html: `<p class="my-1">${renderMarkdown(msg.content)}</p>`,
                }}
              />
            ) : (
              <span className="whitespace-pre-wrap">{msg.content}</span>
            )}
          </div>
        </div>
      ))}
      {isStreaming && messages[messages.length - 1]?.role === "assistant" && (
        <div className="flex justify-start">
          <div className="bg-muted rounded-lg px-3 py-2 text-sm">
            <span className="inline-block w-2 h-4 bg-foreground/30 animate-pulse" />
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
