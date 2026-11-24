/* eslint-disable react-refresh/only-export-components, no-useless-escape, no-empty */
import React, { useState, useEffect, useRef, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardContext } from "@/contexts/DashboardContext";
import { runClientAction } from "./clientActions";
import {
  Bot,
  User,
  Send,
  Square,
  Trash2,
  GraduationCap,
  Zap,
  Sparkles,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Code,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  Key,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PendingActions, PendingActionItem, ActionOutcome } from "./PendingActions";
import {
  streamChat,
  validateApiKey,
  resetConversation,
  AssistantContext,
  AssistantEvent,
  STORAGE_KEY_API_KEY,
  STORAGE_KEY_PROVIDER,
  TourStep,
} from "@/api/assistantApi";
import { ApiKeyModal } from "./ApiKeyModal";
import { useOptionalTourController } from "@/tour/TourController";
import { TOUR_IDS } from "@/tour/tourIds";
import { cn } from "@/lib/utils";

export type ChatMode = "teach" | "act";

export interface ToolExecution {
  id: string;
  name: string;
  summary: string;
  status: "executing" | "completed" | "failed";
  error?: string;
  durationMs?: number;
}

export interface ResolvedAction {
  id: string;
  description: string;
  outcome: ActionOutcome;
  detail?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  mode?: ChatMode;
  isStreaming?: boolean;
  isThinking?: boolean;
  toolExecutions?: ToolExecution[];
  pendingActions?: PendingActionItem[];
  resolvedActions?: ResolvedAction[];
  tourPath?: TourStep[];
  notices?: string[];
  error?: string;
}

/** Apply one streamed assistant event to the assistant message it belongs to. */
export function applyAssistantEvent(msg: ChatMessage, event: AssistantEvent): ChatMessage {
  switch (event.type) {
    case "text":
      return { ...msg, content: msg.content + event.text, isThinking: false };
    case "status":
      return { ...msg, isThinking: true };
    case "tool_start":
      return {
        ...msg,
        isThinking: false,
        toolExecutions: [
          ...(msg.toolExecutions || []),
          { id: event.id, name: event.name, summary: event.summary, status: "executing" },
        ],
      };
    case "tool_end":
      return {
        ...msg,
        toolExecutions: (msg.toolExecutions || []).map((t) =>
          t.id === event.id
            ? { ...t, status: event.ok ? "completed" : "failed", error: event.error, durationMs: event.duration_ms }
            : t
        ),
      };
    case "pending_action":
      return {
        ...msg,
        pendingActions: [
          ...(msg.pendingActions || []),
          { id: event.id, name: event.name, description: event.description, arguments: event.arguments },
        ],
      };
    case "client_action":
      if (event.name === "start_tour" && Array.isArray(event.arguments.steps)) {
        return { ...msg, tourPath: event.arguments.steps as TourStep[] };
      }
      return msg;
    case "notice":
      return { ...msg, notices: [...(msg.notices || []), event.text] };
    case "error":
      return { ...msg, error: event.message, isThinking: false };
    case "done":
      return {
        ...msg,
        isStreaming: false,
        isThinking: false,
        toolExecutions: (msg.toolExecutions || []).map((t) =>
          t.status === "executing" ? { ...t, status: "failed", error: "Interrupted" } : t
        ),
      };
    default:
      return msg;
  }
}

export const STORAGE_MODE_KEY = "totem_chat_mode";
export const STORAGE_CONVERSATION_KEY = (mode: ChatMode) => `totem_chat_conversation_${mode}`;
export const STORAGE_MESSAGES_KEY = "totem_chat_messages";
export const STORAGE_MESSAGES_KEY_TEACH = "totem_chat_messages_teach";
export const STORAGE_MESSAGES_KEY_ACT = "totem_chat_messages_act";
export const STORAGE_DRAWER_WIDTH_KEY = "totem_chat_drawer_width";
export const DEFAULT_DRAWER_WIDTH = 580;
export const WIDE_DRAWER_WIDTH = 840;
export const MIN_DRAWER_WIDTH = 420;

export const QUICK_SUGGESTIONS: Record<ChatMode, { label: string; prompt: string }[]> = {
  teach: [
    {
      label: "Create new dashboard",
      prompt: "Guide me through creating a new dashboard step by step.",
    },
    {
      label: "Where do I select event logs?",
      prompt: "Show me where to select or switch projects and event logs in the top left.",
    },
    {
      label: "Where to run conformance?",
      prompt: "Show me where to navigate and run conformance checking in the interface.",
    },
    {
      label: "How to upload event logs?",
      prompt: "Where do I upload new event log files in Totem?",
    },
    {
      label: "How to discover process model?",
      prompt: "How do I discover and visualize a process model from my event log in the UI?",
    },
    {
      label: "Explain conformance checking",
      prompt: "Explain how conformance checking works in Totem and what alignments mean.",
    },
    {
      label: "What is OCPM?",
      prompt: "What is Object-Centric Process Mining (OCPM) and how does it differ from traditional process mining?",
    },
    {
      label: "Explain process variants",
      prompt: "What are process execution variants and trace frequency distributions, and why are they important?",
    },
  ],
  act: [
    {
      label: "Summarize this log",
      prompt: "Give me an overview of the selected event log: size, time range, object types and the main activities.",
    },
    {
      label: "Find the bottlenecks",
      prompt: "Where are the longest waiting times in this process? Break it down per object type.",
    },
    {
      label: "Top process variants",
      prompt: "What are the most frequent process variants, and how much of the behaviour do the top 5 cover?",
    },
    {
      label: "Lifecycle durations",
      prompt: "How long does each object type take from its first to its last event (median and worst case)?",
    },
    {
      label: "How do object types relate?",
      prompt: "Discover the TOTeM model and explain how the object types relate in time and cardinality.",
    },
    {
      label: "Build an overview dashboard",
      prompt: "Create a dashboard that gives a good overview of this log.",
    },
    {
      label: "Open the process map",
      prompt: "Open the object-centric process map for this log.",
    },
  ],
};

export interface MarkdownBlock {
  type:
    | "header"
    | "blockquote"
    | "list-bullet"
    | "list-number"
    | "paragraph"
    | "code"
    | "spacer"
    | "table"
    | "hr";
  content?: string;
  level?: number;
  language?: string;
  isStreaming?: boolean;
  headers?: string[];
  alignments?: ("left" | "center" | "right")[];
  rows?: string[][];
}

/**
 * Repairs Latin-1 / Windows-1252 mojibake where UTF-8 bytes were misdecoded.
 * E.g., 'ð\x9f\x93\x8a' -> '📊'
 */
export function repairMojibake(text: string): string {
  if (!text) return "";
  if (!text.includes("ð") && !text.includes("â") && !text.includes("Ã")) {
    return text;
  }
  try {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      bytes[i] = text.charCodeAt(i) & 0xff;
    }
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (decoded && !decoded.includes("\ufffd")) {
      return decoded;
    }
  } catch {
    // fallback
  }
  return text;
}

/**
 * Parses markdown text into structured blocks for streaming rendering.
 * Supports headers, blockquotes, lists, tables, horizontal rules, code blocks.
 */
export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const normalized = repairMojibake(content);
  const lines = normalized.split("\n");
  const blocks: MarkdownBlock[] = [];
  let inCodeBlock = false;
  let codeLanguage = "";
  let codeBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block start or end
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        // Close code block
        blocks.push({
          type: "code",
          content: codeBuffer.join("\n"),
          language: codeLanguage || "code",
          isStreaming: false,
        });
        inCodeBlock = false;
        codeBuffer = [];
        codeLanguage = "";
      } else {
        // Open code block
        inCodeBlock = true;
        codeLanguage = line.slice(3).trim();
        codeBuffer = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    const trimmed = line.trim();

    // Horizontal rule (--- or *** or ___)
    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      blocks.push({ type: "hr" });
      continue;
    }

    // Markdown Table Detection: line starts and ends with |
    if (trimmed.startsWith("|") && trimmed.endsWith("|") && (trimmed.match(/\|/g) || []).length >= 2) {
      const tableLines: string[] = [];
      const startIndex = i;
      while (i < lines.length) {
        const rowTrim = lines[i].trim();
        if (rowTrim.startsWith("|") && rowTrim.endsWith("|") && (rowTrim.match(/\|/g) || []).length >= 2) {
          tableLines.push(rowTrim);
          i++;
        } else {
          break;
        }
      }
      i--; // adjust loop index

      if (tableLines.length >= 2) {
        const rawHeaders = tableLines[0].split("|").slice(1, -1).map((c) => c.trim());
        const secondLine = tableLines[1];
        const isDelimiter =
          /^\|[\s:\-]+\|$/.test(secondLine) ||
          secondLine.split("|").slice(1, -1).every((c) => /^[\s:\-]+$/.test(c.trim()));

        let alignments: ("left" | "center" | "right")[] = [];
        let dataLines = tableLines.slice(1);

        if (isDelimiter) {
          alignments = secondLine.split("|").slice(1, -1).map((c) => {
            const t = c.trim();
            if (t.startsWith(":") && t.endsWith(":")) return "center";
            if (t.endsWith(":")) return "right";
            return "left";
          });
          dataLines = tableLines.slice(2);
        } else {
          alignments = rawHeaders.map(() => "left");
        }

        const rows = dataLines.map((rowStr) =>
          rowStr.split("|").slice(1, -1).map((c) => c.trim())
        );

        blocks.push({
          type: "table",
          headers: rawHeaders,
          alignments,
          rows,
        });
        continue;
      } else {
        i = startIndex;
        blocks.push({ type: "paragraph", content: lines[startIndex] });
        continue;
      }
    }

    // Headers
    if (line.startsWith("### ")) {
      blocks.push({ type: "header", level: 3, content: line.slice(4) });
    } else if (line.startsWith("## ")) {
      blocks.push({ type: "header", level: 2, content: line.slice(3) });
    } else if (line.startsWith("# ")) {
      blocks.push({ type: "header", level: 1, content: line.slice(2) });
    } else if (line.startsWith("> ")) {
      blocks.push({ type: "blockquote", content: line.slice(2) });
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      blocks.push({ type: "list-bullet", content: line.slice(2) });
    } else if (/^\d+\.\s/.test(line)) {
      blocks.push({ type: "list-number", content: line.replace(/^\d+\.\s/, "") });
    } else if (line.trim() === "") {
      blocks.push({ type: "spacer" });
    } else {
      blocks.push({ type: "paragraph", content: line });
    }
  }

  // If stream ended while still inside an unclosed code block, emit partial code
  if (inCodeBlock && codeBuffer.length > 0) {
    blocks.push({
      type: "code",
      content: codeBuffer.join("\n"),
      language: codeLanguage || "code",
      isStreaming: true,
    });
  }

  return blocks;
}

export function formatInline(text: string): React.ReactNode {
  if (!text) return null;
  const cleanText = repairMojibake(text);

  // 1. Split by HTML break tags: <br>, <br/>, <br /> (case-insensitive)
  const brRegex = /(<br\s*\/?>)/gi;
  const segments = cleanText.split(brRegex);
  const parts: React.ReactNode[] = [];

  segments.forEach((seg, segIdx) => {
    if (brRegex.test(seg)) {
      parts.push(<br key={`br-${segIdx}`} className="my-0.5" />);
      return;
    }

    // 2. Parse inline tokens: **bold**, `code`, *italic*, [link](url)
    const tokenRegex = /(\*\*.*?\*\*|`.*?`|\*.*?\*|\[.*?\]\(.*?\))/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(seg)) !== null) {
      if (match.index > lastIndex) {
        parts.push(seg.substring(lastIndex, match.index));
      }
      const token = match[0];
      const key = `${segIdx}-${match.index}`;

      if (token.startsWith("**") && token.endsWith("**")) {
        parts.push(
          <strong key={key} className="font-semibold text-foreground">
            {token.slice(2, -2)}
          </strong>
        );
      } else if (token.startsWith("`") && token.endsWith("`")) {
        parts.push(
          <code
            key={key}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-primary"
          >
            {token.slice(1, -1)}
          </code>
        );
      } else if (token.startsWith("*") && token.endsWith("*")) {
        parts.push(
          <em key={key} className="italic">
            {token.slice(1, -1)}
          </em>
        );
      } else if (token.startsWith("[") && token.includes("](")) {
        const linkMatch = token.match(/^\[(.*?)\]\((.*?)\)$/);
        if (linkMatch) {
          const rawHref = linkMatch[2].trim();
          // Security: allowlist http(s) and mailto schemes to prevent javascript: or data: injection
          const isSafeScheme = /^(https?:\/\/|mailto:)/i.test(rawHref);
          if (isSafeScheme) {
            parts.push(
              <a
                key={key}
                href={rawHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline font-medium"
              >
                {linkMatch[1]}
              </a>
            );
          } else {
            // Render link text as safe plain text when scheme is untrusted
            parts.push(linkMatch[1]);
          }
        } else {
          parts.push(token);
        }
      }

      lastIndex = tokenRegex.lastIndex;
      if (token.length === 0) {
        tokenRegex.lastIndex++;
      }
    }

    if (lastIndex < seg.length) {
      parts.push(seg.substring(lastIndex));
    }
  });

  return parts.length === 1 ? parts[0] : parts;
}

interface ChatErrorBoundaryProps {
  children: React.ReactNode;
  fallbackText?: string;
}

interface ChatErrorBoundaryState {
  hasError: boolean;
}

export class ChatErrorBoundary extends React.Component<ChatErrorBoundaryProps, ChatErrorBoundaryState> {
  constructor(props: ChatErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error("Chat rendering error intercepted by boundary:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="text-xs text-foreground whitespace-pre-wrap font-sans leading-relaxed my-1">
          {this.props.fallbackText || "Message content could not be displayed with rich styling."}
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Lightweight streaming Markdown renderer with syntax-styled code blocks & copy button.
 */
export function MarkdownRenderer({ content }: { content: string }) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = (code: string, idx: number) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(code);
      setCopiedIndex(idx);
      setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  let blocks: MarkdownBlock[] = [];
  try {
    blocks = parseMarkdownBlocks(content);
  } catch (err) {
    console.error("Error parsing markdown blocks:", err);
    return (
      <div className="text-xs text-foreground whitespace-pre-wrap font-sans leading-relaxed">
        {content}
      </div>
    );
  }

  let codeBlockCounter = 0;

  return (
    <ChatErrorBoundary fallbackText={content}>
      <div className="space-y-1">
        {blocks.map((block, idx) => {
          switch (block.type) {
            case "header":
              if (block.level === 1) {
                return (
                  <h2 key={idx} className="mt-4 mb-2 font-bold text-lg text-foreground">
                    {formatInline(block.content || "")}
                  </h2>
                );
              }
              if (block.level === 2) {
                return (
                  <h3 key={idx} className="mt-3.5 mb-1.5 font-bold text-base text-foreground">
                    {formatInline(block.content || "")}
                  </h3>
                );
              }
              return (
                <h4 key={idx} className="mt-3 mb-1 font-semibold text-sm text-foreground">
                  {formatInline(block.content || "")}
                </h4>
              );

            case "blockquote":
              return (
                <blockquote
                  key={idx}
                  className="my-2 border-l-2 border-primary/60 pl-3 italic text-muted-foreground text-xs"
                >
                  {formatInline(block.content || "")}
                </blockquote>
              );

            case "list-bullet":
              return (
                <li key={idx} className="ml-4 list-disc text-sm my-0.5">
                  {formatInline(block.content || "")}
                </li>
              );

            case "list-number":
              return (
                <li key={idx} className="ml-4 list-decimal text-sm my-0.5">
                  {formatInline(block.content || "")}
                </li>
              );

            case "spacer":
              return <div key={idx} className="h-2" />;

            case "hr":
              return <hr key={idx} className="my-3 border-t border-border/70" />;

            case "table": {
              const headers = block.headers || [];
              const alignments = block.alignments || [];
              const rows = block.rows || [];

              const getAlignClass = (align?: "left" | "center" | "right") => {
                if (align === "center") return "text-center";
                if (align === "right") return "text-right";
                return "text-left";
              };

              return (
                <div
                  key={idx}
                  className="my-3 w-full overflow-x-auto rounded-lg border border-border/80 bg-card shadow-2xs"
                >
                  <table className="w-full border-collapse text-xs">
                    {headers.length > 0 && (
                      <thead className="bg-muted/70 text-foreground font-semibold border-b border-border/80">
                        <tr>
                          {headers.map((h, hIdx) => (
                            <th
                              key={hIdx}
                              className={`px-3 py-2 font-semibold text-xs whitespace-nowrap ${getAlignClass(
                                alignments[hIdx]
                              )}`}
                            >
                              {formatInline(h)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                    )}
                    <tbody className="divide-y divide-border/40">
                      {rows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-muted/30 transition-colors">
                          {row.map((cell, cIdx) => (
                            <td
                              key={cIdx}
                              className={`px-3 py-2 align-top text-xs leading-relaxed text-foreground/90 ${getAlignClass(
                                alignments[cIdx]
                              )}`}
                            >
                              {formatInline(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }

            case "paragraph":
              return (
                <p key={idx} className="text-sm leading-relaxed my-1">
                  {formatInline(block.content || "")}
                </p>
              );

            case "code": {
              const curIndex = codeBlockCounter++;
              const codeString = block.content || "";
              return (
                <div
                  key={idx}
                  className="my-3 overflow-hidden rounded-md border border-border/80 bg-zinc-950 text-zinc-100 text-xs font-mono"
                >
                  <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 py-1.5 text-zinc-400">
                    <span className="flex items-center gap-1.5">
                      <Code className="size-3.5" />
                      {block.language || "code"}
                      {block.isStreaming ? " (streaming...)" : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(codeString, curIndex)}
                      className="flex items-center gap-1 hover:text-zinc-100 text-zinc-400 transition-colors"
                    >
                      {copiedIndex === curIndex ? (
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
                    <code>{codeString}</code>
                  </pre>
                </div>
              );
            }

            default:
              return null;
          }
        })}
      </div>
    </ChatErrorBoundary>
  );
}

export interface ChatWidgetProps {
  context?: AssistantContext;
  defaultOpen?: boolean;
}

function readStorage(key: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (typeof localStorage === "undefined") return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

function loadStoredMessages(key: string, fallbackKey?: string): ChatMessage[] {
  try {
    if (typeof localStorage !== "undefined") {
      let saved = localStorage.getItem(key);
      if (!saved && fallbackKey) {
        saved = localStorage.getItem(fallbackKey);
      }
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.map((m: ChatMessage) => ({
            ...m,
            isStreaming: false,
          }));
        }
      }
    }
  } catch {}
  return [];
}

export function ChatWidget({ context, defaultOpen = false }: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [mode, setMode] = useState<ChatMode>(() => {
    try {
      if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem(STORAGE_MODE_KEY);
        return saved === "act" ? "act" : "teach";
      }
      return "teach";
    } catch {
      return "teach";
    }
  });

  // Persistent conversation history per mode (Teach and Act kept separate)
  const [messagesByMode, setMessagesByMode] = useState<Record<ChatMode, ChatMessage[]>>(() => {
    return {
      teach: loadStoredMessages(STORAGE_MESSAGES_KEY_TEACH, STORAGE_MESSAGES_KEY),
      act: loadStoredMessages(STORAGE_MESSAGES_KEY_ACT),
    };
  });

  // Active mode messages
  const messages = messagesByMode[mode] || [];

  // Active mode updater helper
  const setMessages = (
    updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
  ) => {
    setMessagesByMode((prev) => {
      const currentList = prev[mode] || [];
      const updatedList = typeof updater === "function" ? updater(currentList) : updater;
      return {
        ...prev,
        [mode]: updatedList,
      };
    });
  };

  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Server-side conversation per mode: the backend keeps the full transcript
  // (tool calls and results), the browser only keeps the id and what it renders.
  const conversationIds = useRef<Record<ChatMode, string | null>>({
    teach: readStorage(STORAGE_CONVERSATION_KEY("teach")),
    act: readStorage(STORAGE_CONVERSATION_KEY("act")),
  });
  const setConversationId = (forMode: ChatMode, id: string | null) => {
    conversationIds.current[forMode] = id;
    writeStorage(STORAGE_CONVERSATION_KEY(forMode), id);
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Optional TourController integration
  const tourController = useOptionalTourController();
  const dashboardCtx = useContext(DashboardContext);
  const navigate = useNavigate();

  // Resizable drawer width (persisted in localStorage)
  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    try {
      if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem(STORAGE_DRAWER_WIDTH_KEY);
        if (saved) {
          const num = parseInt(saved, 10);
          if (!isNaN(num) && num >= MIN_DRAWER_WIDTH && num <= 1600) {
            return num;
          }
        }
      }
    } catch {}
    return DEFAULT_DRAWER_WIDTH;
  });

  const [isResizing, setIsResizing] = useState(false);
  const isWide = drawerWidth >= 750;

  const toggleWideMode = () => {
    const nextWidth = isWide ? DEFAULT_DRAWER_WIDTH : WIDE_DRAWER_WIDTH;
    setDrawerWidth(nextWidth);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_DRAWER_WIDTH_KEY, String(nextWidth));
      }
    } catch {}
  };

  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  // Re-open chat drawer when a guided tour finishes or is skipped
  useEffect(() => {
    const handleTourComplete = () => {
      setIsOpen(true);
    };
    window.addEventListener("agent:tourComplete", handleTourComplete);
    return () => {
      window.removeEventListener("agent:tourComplete", handleTourComplete);
    };
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Drawer is anchored to the right viewport edge
      const calculatedWidth = window.innerWidth - e.clientX;
      const maxWidth = Math.floor(window.innerWidth * 0.94);
      const clamped = Math.max(MIN_DRAWER_WIDTH, Math.min(calculatedWidth, maxWidth));
      setDrawerWidth(clamped);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(STORAGE_DRAWER_WIDTH_KEY, String(drawerWidth));
        }
      } catch {}
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, drawerWidth]);

  // Switch mode while preserving both conversation histories
  const handleModeChange = (newMode: ChatMode) => {
    if (newMode === mode) return;

    if (isStreaming && abortController) {
      abortController.abort();
      setAbortController(null);
    }

    // Ensure any active streaming message in the previous mode is cleanly finalized
    setMessagesByMode((prev) => ({
      ...prev,
      [mode]: (prev[mode] || []).map((msg) =>
        msg.isStreaming ? { ...msg, isStreaming: false } : msg
      ),
    }));

    setIsStreaming(false);
    setInputValue("");
    setMode(newMode);

    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_MODE_KEY, newMode);
      }
    } catch {
      // Ignore storage error
    }
  };

  // Persist message history per mode (sanitizing isStreaming)
  useEffect(() => {
    try {
      if (typeof localStorage !== "undefined") {
        const sanitize = (list: ChatMessage[]) =>
          (list || []).map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m));

        localStorage.setItem(
          STORAGE_MESSAGES_KEY_TEACH,
          JSON.stringify(sanitize(messagesByMode.teach))
        );
        localStorage.setItem(
          STORAGE_MESSAGES_KEY_ACT,
          JSON.stringify(sanitize(messagesByMode.act))
        );
        // Keep legacy STORAGE_MESSAGES_KEY in sync with active mode
        localStorage.setItem(
          STORAGE_MESSAGES_KEY,
          JSON.stringify(sanitize(messagesByMode[mode]))
        );
      }
    } catch {
      // Ignore storage error
    }
  }, [messagesByMode, mode]);

  // Auto-scroll to bottom on new messages or streaming tokens
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isStreaming, isOpen]);

  // Check API key whenever chat drawer opens
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (isOpen) {
      if (typeof localStorage !== "undefined") {
        const savedKey = localStorage.getItem(STORAGE_KEY_API_KEY);
        const savedProvider = localStorage.getItem(STORAGE_KEY_PROVIDER) || "";
        if (savedProvider === "demo") {
          // Offline demo mode needs no key.
        } else if (!savedKey) {
          setIsApiKeyModalOpen(true);
        } else {
          // Probe key validity in background
          validateApiKey(savedProvider, savedKey)
            .then((res) => {
              if (!res.valid) {
                setApiKeyError(
                  res.error ||
                    `The saved ${savedProvider.toUpperCase()} API key failed authentication. Please update it.`
                );
                setIsApiKeyModalOpen(true);
              }
            })
            .catch(() => {
              // Ignore background network check failure
            });
        }
      }
    }
  }, [isOpen]);

  // Auto-resize textarea
  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  };

  const handleClearConversation = () => {
    if (isStreaming && abortController) {
      abortController.abort();
      setAbortController(null);
    }
    // Clear both conversation histories, on the server too
    (["teach", "act"] as ChatMode[]).forEach((m) => {
      const id = conversationIds.current[m];
      if (id) void resetConversation(id);
      setConversationId(m, null);
    });
    setMessagesByMode({ teach: [], act: [] });
    setIsStreaming(false);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(STORAGE_MESSAGES_KEY);
        localStorage.removeItem(STORAGE_MESSAGES_KEY_TEACH);
        localStorage.removeItem(STORAGE_MESSAGES_KEY_ACT);
      }
    } catch {
      // Ignore
    }
  };

  const handleStopStreaming = () => {
    // Aborting the fetch closes the stream; the server stops the agent loop and
    // records the interrupted tool calls so the conversation stays consistent.
    abortController?.abort();
    setAbortController(null);
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((msg) => (msg.isStreaming ? applyAssistantEvent({ ...msg, notices: [...(msg.notices || []), "Stopped."] }, { type: "done" }) : msg))
    );
  };

  const handleSendMessage = async (promptToSend?: string) => {
    const text = (promptToSend ?? inputValue).trim();
    if (!text || isStreaming) return;

    if (!readStorage(STORAGE_KEY_API_KEY) && readStorage(STORAGE_KEY_PROVIDER) !== "demo") {
      setIsApiKeyModalOpen(true);
      return;
    }

    if (!promptToSend) {
      setInputValue("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }

    // Bind the whole turn to the mode it started in, even if the user switches tabs.
    const turnMode = mode;
    const stamp = Date.now();
    const assistantMessageId = `asst-${stamp}`;
    const updateAssistant = (fn: (msg: ChatMessage) => ChatMessage) =>
      setMessagesByMode((prev) => ({
        ...prev,
        [turnMode]: (prev[turnMode] || []).map((m) => (m.id === assistantMessageId ? fn(m) : m)),
      }));

    setMessagesByMode((prev) => ({
      ...prev,
      [turnMode]: [
        ...(prev[turnMode] || []),
        { id: `usr-${stamp}`, role: "user", content: text, timestamp: stamp, mode: turnMode },
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          timestamp: stamp,
          mode: turnMode,
          isStreaming: true,
          isThinking: true,
          toolExecutions: [],
          pendingActions: [],
        },
      ],
    }));
    setIsStreaming(true);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const events = streamChat({
        message: text,
        mode: turnMode,
        context: context ?? {},
        conversationId: conversationIds.current[turnMode],
        signal: controller.signal,
      });
      for await (const event of events) {
        if (controller.signal.aborted) break;
        if (event.type === "conversation" || (event.type === "done" && event.conversation_id)) {
          setConversationId(turnMode, (event as { conversation_id: string }).conversation_id);
        }
        if (event.type === "client_action") {
          const applied = runClientAction(event.name, event.arguments, {
            setViewMode: dashboardCtx?.setViewMode,
            navigate,
            startTour: tourController?.startTour,
            onTourStart: () => setIsOpen(false),
          });
          if (!applied) {
            updateAssistant((m) => ({ ...m, notices: [...(m.notices || []), `Could not run ${event.name} in this view.`] }));
          }
        }
        if (event.type === "error" && (event.code === "auth" || event.code === "session")) {
          if (event.code === "auth") {
            setApiKeyError(event.message);
            setIsApiKeyModalOpen(true);
          }
        }
        updateAssistant((m) => applyAssistantEvent(m, event));
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : "Connection to the assistant failed.";
        updateAssistant((m) => applyAssistantEvent({ ...m, error: message }, { type: "done" }));
      }
    } finally {
      setIsStreaming(false);
      setAbortController(null);
      updateAssistant((m) => (m.isStreaming ? applyAssistantEvent(m, { type: "done" }) : m));
    }
  };

  const handleActionResolved = (actionId: string, outcome: ActionOutcome, detail?: string) => {
    setMessages((prev) =>
      prev.map((msg) => {
        const action = msg.pendingActions?.find((a) => a.id === actionId);
        if (!action) return msg;
        return {
          ...msg,
          pendingActions: msg.pendingActions?.filter((a) => a.id !== actionId),
          resolvedActions: [...(msg.resolvedActions || []), { id: actionId, description: action.description, outcome, detail }],
        };
      })
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <>
      {/* Floating Chat Trigger Button */}
      <Sheet open={isOpen} onOpenChange={setIsOpen} modal={false}>
        <SheetTrigger asChild>
          <Button
            size="icon"
            data-tour-id={TOUR_IDS.CHAT_TOGGLE}
            aria-label="Open AI Assistant"
            // Above in-page overlays (graph controls use z-50); hidden while the drawer is open.
            className={cn(
              "fixed bottom-6 right-6 z-[60] size-12 rounded-full shadow-xl bg-primary text-primary-foreground hover:scale-105 active:scale-95 transition-all duration-200",
              isOpen && "hidden"
            )}
          >
            <Bot className="size-6" />
            <span className="sr-only">Toggle AI Assistant</span>
            {mode === "teach" ? (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 ring-2 ring-background">
                <GraduationCap className="size-2.5 text-white" />
              </span>
            ) : (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-background">
                <Zap className="size-2.5 text-white" />
              </span>
            )}
          </Button>
        </SheetTrigger>

        {/* Collapsible Drawer Sheet */}
        <SheetContent
          side="right"
          hideOverlay
          data-tour-id={TOUR_IDS.CHAT_DRAWER}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex flex-col p-0 gap-0 h-full border-l shadow-2xl bg-background w-full max-w-none sm:max-w-none",
            isResizing && "select-none transition-none"
          )}
          style={{ width: `${drawerWidth}px`, maxWidth: "94vw" }}
        >
          {/* Draggable resize handle on the left edge */}
          <div
            onMouseDown={handleMouseDownResize}
            className="absolute -left-2 top-0 bottom-0 w-4 cursor-ew-resize group z-50 flex items-center justify-center select-none"
            title="Drag to resize chat drawer (or click expand button in header)"
          >
            <div
              className={cn(
                "w-1 h-16 rounded-full bg-border/80 transition-all group-hover:bg-primary group-hover:w-1.5 group-hover:h-24",
                isResizing && "bg-primary w-1.5 h-28 shadow-sm"
              )}
            />
          </div>

          {/* Header */}
          <SheetHeader className="p-4 border-b bg-muted/20 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <Sparkles className="size-4" />
                </div>
                <div>
                  <SheetTitle className="text-base font-semibold">Totem Assistant</SheetTitle>
                  <SheetDescription className="text-xs">
                    {mode === "teach"
                      ? "Teach Mode: Interactive Guided Tours"
                      : "Act Mode: Process Mining Automation"}
                  </SheetDescription>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1 pr-6">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-primary"
                  title="Configure LLM API Key (Gemini, OpenAI, Anthropic)"
                  onClick={() => {
                    setApiKeyError(undefined);
                    setIsApiKeyModalOpen(true);
                  }}
                >
                  <Key className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  title={isWide ? "Restore compact width (580px)" : "Expand width (840px)"}
                  onClick={toggleWideMode}
                >
                  {isWide ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </Button>
                {(messagesByMode.teach.length > 0 || messagesByMode.act.length > 0) && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    title="Clear Conversation"
                    onClick={handleClearConversation}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>

            {/* Mode Toggle Pills */}
            <div className="grid grid-cols-2 p-1 bg-muted rounded-lg text-xs font-medium">
              <button
                type="button"
                data-tour-id={TOUR_IDS.CHAT_MODE_TEACH}
                onClick={() => handleModeChange("teach")}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md transition-all ${
                  mode === "teach"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <GraduationCap className="size-3.5 text-blue-500" />
                <span>Teach Mode</span>
              </button>
              <button
                type="button"
                data-tour-id={TOUR_IDS.CHAT_MODE_ACT}
                onClick={() => handleModeChange("act")}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md transition-all ${
                  mode === "act"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Zap className="size-3.5 text-emerald-500" />
                <span>Act Mode</span>
              </button>
            </div>
          </SheetHeader>

          {/* Message List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col justify-center items-center text-center p-6 space-y-4 text-muted-foreground">
                <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  {mode === "teach" ? (
                    <GraduationCap className="size-6 text-blue-500" />
                  ) : (
                    <Zap className="size-6 text-emerald-500" />
                  )}
                </div>
                <div>
                  <h4 className="font-semibold text-foreground text-sm">
                    {mode === "teach"
                      ? "Welcome to Teach Mode"
                      : "Welcome to Act Mode"}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                    {mode === "teach"
                      ? "Ask questions about Totem features to trigger interactive spotlights and guided step-by-step tours."
                      : "Request process analytics, variant discoveries, or automated dashboard creations."}
                  </p>
                </div>

                {/* Quick Suggestion Chips */}
                <div className="w-full space-y-2 pt-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70 text-left">
                    Suggestions
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {QUICK_SUGGESTIONS[mode].map((sugg, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSendMessage(sugg.prompt)}
                        className="flex items-center justify-between text-left text-xs bg-muted/50 hover:bg-muted p-2.5 rounded-lg border border-border/50 text-foreground transition-all hover:translate-x-0.5"
                      >
                        <span>{sugg.label}</span>
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  data-role={msg.role}
                  className={`flex gap-3 text-sm min-w-0 w-full ${
                    msg.role === "user" ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  {/* Avatar */}
                  <div
                    className={`size-7 rounded-full flex items-center justify-center shrink-0 ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted border text-foreground"
                    }`}
                  >
                    {msg.role === "user" ? (
                      <User className="size-4" />
                    ) : (
                      <Bot className="size-4" />
                    )}
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={`flex flex-col min-w-0 space-y-2 ${
                      msg.role === "user" ? "max-w-[85%] items-end" : "w-full min-w-0 items-start"
                    }`}
                  >
                    <div
                      className={`rounded-2xl px-4 py-2.5 shadow-xs min-w-0 ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground rounded-tr-xs"
                          : "w-full bg-muted/70 text-foreground border rounded-tl-xs overflow-hidden"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">
                          {msg.content}
                        </p>
                      ) : (
                        <div>
                          {/* Tool activity */}
                          {msg.toolExecutions && msg.toolExecutions.length > 0 && (
                            <div className="space-y-1 mb-2" data-testid="tool-activity">
                              {msg.toolExecutions.map((tool) => (
                                <div
                                  key={tool.id}
                                  title={tool.error || tool.name}
                                  className="flex items-center gap-1.5 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded border"
                                >
                                  {tool.status === "executing" ? (
                                    <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
                                  ) : tool.status === "completed" ? (
                                    <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />
                                  ) : (
                                    <AlertCircle className="size-3 shrink-0 text-amber-500" />
                                  )}
                                  <span className="truncate">{tool.summary || tool.name}</span>
                                  {tool.status === "failed" && tool.error && (
                                    <span className="truncate text-amber-600 dark:text-amber-400">· {tool.error}</span>
                                  )}
                                  {tool.durationMs !== undefined && tool.durationMs >= 1000 && (
                                    <span className="ml-auto shrink-0 tabular-nums">{(tool.durationMs / 1000).toFixed(1)}s</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Markdown Response Text */}
                          {msg.content ? (
                            <ChatErrorBoundary fallbackText={msg.content}>
                              <MarkdownRenderer content={msg.content} />
                            </ChatErrorBoundary>
                          ) : null}
                          {msg.isStreaming && (msg.isThinking || !msg.content) && (
                            <div className="flex items-center gap-1.5 py-1 text-muted-foreground text-xs">
                              <Loader2 className="size-3.5 animate-spin" />
                              <span>{msg.toolExecutions?.some((t) => t.status === "executing") ? "Working…" : "Thinking…"}</span>
                            </div>
                          )}

                          {/* Notices from the harness (stopped, step limit, declined, ...) */}
                          {msg.notices?.map((notice, i) => (
                            <p key={i} className="mt-1 text-xs italic text-muted-foreground">
                              {notice}
                            </p>
                          ))}

                          {/* Outcomes of approvals */}
                          {msg.resolvedActions?.map((ra) => (
                            <div key={ra.id} className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                              {ra.outcome === "executed" ? (
                                <CheckCircle2 className="size-3.5 text-emerald-500" />
                              ) : ra.outcome === "cancelled" ? (
                                <Square className="size-3 text-muted-foreground" />
                              ) : (
                                <AlertCircle className="size-3.5 text-destructive" />
                              )}
                              <span>
                                {ra.outcome === "executed" ? "Applied" : ra.outcome === "cancelled" ? "Declined" : "Failed"}: {ra.description}
                                {ra.detail ? ` — ${ra.detail}` : ""}
                              </span>
                            </div>
                          ))}

                          {/* Error Banner */}
                          {msg.error && (
                            <div className="mt-2 text-xs text-destructive bg-destructive/10 p-2 rounded flex items-center gap-1.5">
                              <AlertCircle className="size-3.5 shrink-0" />
                              <span>{msg.error}</span>
                            </div>
                          )}

                          {/* Tour Triggered Badge */}
                          {msg.tourPath && msg.tourPath.length > 0 && (
                            <div className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 dark:bg-blue-950/40 p-2 rounded border border-blue-200 dark:border-blue-900">
                              <GraduationCap className="size-3.5 shrink-0" />
                              <span>Guided tour started ({msg.tourPath.length} steps).</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Pending Action Confirmation Chips */}
                    {msg.pendingActions && msg.pendingActions.length > 0 && (
                      <PendingActions
                        actions={msg.pendingActions}
                        onResolved={handleActionResolved}
                      />
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Footer & Input Area */}
          <div className="p-3 border-t bg-muted/20 space-y-2">
            {isStreaming && (
              <div className="flex justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleStopStreaming}
                  className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground shadow-xs"
                >
                  <Square className="size-3 text-destructive fill-destructive" />
                  <span>Stop generating</span>
                </Button>
              </div>
            )}

            <div className="relative flex items-end gap-2 bg-background rounded-xl border p-1.5 focus-within:ring-2 focus-within:ring-ring/50">
              <textarea
                ref={textareaRef}
                data-tour-id={TOUR_IDS.CHAT_INPUT}
                rows={1}
                value={inputValue}
                onChange={handleTextareaInput}
                onKeyDown={handleKeyDown}
                placeholder={
                  mode === "teach"
                    ? "Ask how to use a feature..."
                    : "Ask to analyze logs or create dashboards..."
                }
                className="flex-1 max-h-40 min-h-9 resize-none bg-transparent px-2.5 py-1.5 text-sm placeholder:text-muted-foreground outline-none disabled:cursor-not-allowed"
                disabled={isStreaming}
              />
              <Button
                size="icon"
                disabled={!inputValue.trim() || isStreaming}
                onClick={() => handleSendMessage()}
                className="size-8 shrink-0 rounded-lg"
              >
                <Send className="size-4" />
                <span className="sr-only">Send</span>
              </Button>
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
              <span>Shift+Enter for newline</span>
              <span className="flex items-center gap-1">
                Active: <strong>{mode === "teach" ? "Teach Mode" : "Act Mode"}</strong>
              </span>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ApiKeyModal
        open={isApiKeyModalOpen}
        onOpenChange={setIsApiKeyModalOpen}
        initialError={apiKeyError}
        onSuccess={() => setApiKeyError(undefined)}
      />
    </>
  );
}

export default ChatWidget;
