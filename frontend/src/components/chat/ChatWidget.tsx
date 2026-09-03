import React, { useState, useEffect, useRef } from "react";
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
import { PendingActions, PendingActionItem } from "./PendingActions";
import {
  streamChat,
  AssistantContext,
  TourStep,
} from "@/api/assistantApi";
import { useOptionalTourController } from "@/tour/TourController";
import { TOUR_IDS } from "@/tour/tourIds";

export type ChatMode = "teach" | "act";

export interface ToolExecution {
  id?: string;
  name: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  status: "executing" | "completed" | "failed";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  mode?: ChatMode;
  isStreaming?: boolean;
  toolExecutions?: ToolExecution[];
  pendingActions?: PendingActionItem[];
  tourPath?: TourStep[];
  error?: string;
}

export const STORAGE_MODE_KEY = "totem_chat_mode";
export const STORAGE_MESSAGES_KEY = "totem_chat_messages";

export const QUICK_SUGGESTIONS: Record<ChatMode, { label: string; prompt: string }[]> = {
  teach: [
    {
      label: "How to discover process model?",
      prompt: "How do I discover and visualize a process model from my event log?",
    },
    {
      label: "Where do I select event logs?",
      prompt: "Show me where to select or switch projects and event logs in the top left.",
    },
    {
      label: "Explain conformance checking",
      prompt: "Explain how conformance checking works in Totem and what alignments mean.",
    },
    {
      label: "Guide me through dashboard creation",
      prompt: "Walk me through creating and configuring a custom analytics dashboard.",
    },
  ],
  act: [
    {
      label: "Create summary dashboard",
      prompt: "Create a new process overview dashboard with variant distribution and throughput cards.",
    },
    {
      label: "Show top 5 process variants",
      prompt: "Analyze the active log and show me the top 5 most frequent process variants.",
    },
    {
      label: "Analyze bottleneck activities",
      prompt: "Identify activities with the longest waiting times and highest bottleneck risk.",
    },
    {
      label: "Calculate case durations",
      prompt: "Calculate the average, median, minimum, and maximum case durations for this log.",
    },
  ],
};

export interface MarkdownBlock {
  type: "header" | "blockquote" | "list-bullet" | "list-number" | "paragraph" | "code" | "spacer";
  content?: string;
  level?: number;
  language?: string;
  isStreaming?: boolean;
}

/**
 * Parses markdown text into structured blocks for streaming rendering.
 */
export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.split("\n");
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
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*.*?\*\*|`.*?`|\*.*?\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <strong key={match.index} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code
          key={match.index}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex === 0) {
    return text;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts;
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

  const blocks = parseMarkdownBlocks(content);
  let codeBlockCounter = 0;

  return (
    <div className="space-y-1">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case "header":
            if (block.level === 1) {
              return (
                <h2 key={idx} className="mt-4 mb-2 font-bold text-lg">
                  {formatInline(block.content || "")}
                </h2>
              );
            }
            if (block.level === 2) {
              return (
                <h3 key={idx} className="mt-3.5 mb-1.5 font-bold text-base">
                  {formatInline(block.content || "")}
                </h3>
              );
            }
            return (
              <h4 key={idx} className="mt-3 mb-1 font-semibold text-sm">
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
  );
}

export interface ChatWidgetProps {
  context?: AssistantContext;
  defaultOpen?: boolean;
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

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem(STORAGE_MESSAGES_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          return Array.isArray(parsed) ? parsed : [];
        }
      }
      return [];
    } catch {
      return [];
    }
  });

  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Optional TourController integration
  const tourController = useOptionalTourController();

  // Persist mode changes
  const handleModeChange = (newMode: ChatMode) => {
    setMode(newMode);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_MODE_KEY, newMode);
      }
    } catch {
      // Ignore storage error
    }
  };

  // Persist message history
  useEffect(() => {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_MESSAGES_KEY, JSON.stringify(messages));
      }
    } catch {
      // Ignore storage error
    }
  }, [messages]);

  // Auto-scroll to bottom on new messages or streaming tokens
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isStreaming, isOpen]);

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
    }
    setMessages([]);
    setIsStreaming(false);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(STORAGE_MESSAGES_KEY);
      }
    } catch {
      // Ignore
    }
  };

  const handleStopStreaming = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((msg) => (msg.isStreaming ? { ...msg, isStreaming: false } : msg))
    );
  };

  const handleSendMessage = async (promptToSend?: string) => {
    const text = (promptToSend ?? inputValue).trim();
    if (!text || isStreaming) return;

    if (!promptToSend) {
      setInputValue("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }

    const userMessageId = `usr-${Date.now()}`;
    const assistantMessageId = `asst-${Date.now()}`;

    const userMessage: ChatMessage = {
      id: userMessageId,
      role: "user",
      content: text,
      timestamp: Date.now(),
      mode,
    };

    const initialAssistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      mode,
      isStreaming: true,
      toolExecutions: [],
      pendingActions: [],
    };

    setMessages((prev) => [...prev, userMessage, initialAssistantMessage]);
    setIsStreaming(true);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const activeContext: AssistantContext = context ?? {};
      const streamGenerator = streamChat(text, activeContext, mode);

      for await (const event of streamGenerator) {
        if (controller.signal.aborted) {
          break;
        }

        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== assistantMessageId) return msg;

            switch (event.type) {
              case "text":
                return {
                  ...msg,
                  content: msg.content + event.content,
                };

              case "tool_call":
                return {
                  ...msg,
                  toolExecutions: [
                    ...(msg.toolExecutions || []),
                    {
                      id: event.id,
                      name: event.name,
                      arguments: event.arguments,
                      status: "executing",
                    },
                  ],
                };

              case "tool_result":
                return {
                  ...msg,
                  toolExecutions: (msg.toolExecutions || []).map((te) =>
                    te.id === event.id || te.name === event.name
                      ? { ...te, result: event.result, status: "completed" }
                      : te
                  ),
                };

              case "pending_action":
                return {
                  ...msg,
                  pendingActions: [
                    ...(msg.pendingActions || []),
                    {
                      id: event.id,
                      name: event.name,
                      description: event.description,
                      arguments: event.arguments,
                    },
                  ],
                };

              case "tour_path": {
                // If in Teach Mode, launch guided tour
                if (mode === "teach" && tourController && event.steps.length > 0) {
                  tourController.startTour(event.steps);
                }
                return {
                  ...msg,
                  tourPath: event.steps,
                };
              }

              case "error":
                return {
                  ...msg,
                  error: (event as any).error || (event as any).message || "An error occurred during generation",
                };

              case "done":
                return {
                  ...msg,
                  isStreaming: false,
                };

              default:
                return msg;
            }
          })
        );
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        const errorMsg = err instanceof Error ? err.message : "An unexpected error occurred";
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, error: errorMsg, isStreaming: false }
              : msg
          )
        );
      }
    } finally {
      setIsStreaming(false);
      setAbortController(null);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId ? { ...msg, isStreaming: false } : msg
        )
      );
    }
  };

  const handleActionResolved = (actionId: string) => {
    setMessages((prev) =>
      prev.map((msg) => ({
        ...msg,
        pendingActions: msg.pendingActions?.filter((a) => a.id !== actionId),
      }))
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
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button
            size="icon"
            data-tour-id={TOUR_IDS.CHAT_TOGGLE}
            aria-label="Open AI Assistant"
            className="fixed bottom-6 right-6 z-40 size-12 rounded-full shadow-xl bg-primary text-primary-foreground hover:scale-105 active:scale-95 transition-all duration-200"
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
          data-tour-id={TOUR_IDS.CHAT_DRAWER}
          className="flex flex-col w-full sm:max-w-md md:max-w-lg p-0 gap-0 h-full border-l shadow-2xl bg-background"
        >
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
                {messages.length > 0 && (
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
                  className={`flex gap-3 text-sm ${
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
                    className={`flex flex-col max-w-[85%] space-y-2 ${
                      msg.role === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`rounded-2xl px-4 py-2.5 shadow-xs ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground rounded-tr-xs"
                          : "bg-muted/70 text-foreground border rounded-tl-xs"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">
                          {msg.content}
                        </p>
                      ) : (
                        <div>
                          {/* Tool Execution Badges */}
                          {msg.toolExecutions && msg.toolExecutions.length > 0 && (
                            <div className="space-y-1 mb-2">
                              {msg.toolExecutions.map((tool, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center gap-1.5 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded border"
                                >
                                  {tool.status === "executing" ? (
                                    <>
                                      <Loader2 className="size-3 animate-spin text-primary" />
                                      <span>Executing tool: <code>{tool.name}</code></span>
                                    </>
                                  ) : tool.status === "completed" ? (
                                    <>
                                      <CheckCircle2 className="size-3 text-emerald-500" />
                                      <span>Executed: <code>{tool.name}</code></span>
                                    </>
                                  ) : (
                                    <>
                                      <AlertCircle className="size-3 text-destructive" />
                                      <span>Tool error: <code>{tool.name}</code></span>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Markdown Response Text */}
                          {msg.content ? (
                            <MarkdownRenderer content={msg.content} />
                          ) : msg.isStreaming ? (
                            <div className="flex items-center gap-1.5 py-1 text-muted-foreground text-xs">
                              <Loader2 className="size-3.5 animate-spin" />
                              <span>Thinking...</span>
                            </div>
                          ) : msg.pendingActions && msg.pendingActions.length > 0 ? (
                            <p className="text-xs text-muted-foreground">
                              Action prepared. Please review and confirm the action chip below:
                            </p>
                          ) : !msg.error ? (
                            <p className="text-xs text-muted-foreground italic">
                              Process mining co-pilot ready.
                            </p>
                          ) : null}

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
                              <span>Guided tour initiated ({msg.tourPath.length} steps).</span>
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
    </>
  );
}

export default ChatWidget;
