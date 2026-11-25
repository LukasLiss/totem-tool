/* eslint-disable react-refresh/only-export-components, no-empty */
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
  cancelTurn,
  AssistantContext,
  AssistantEvent,
  STORAGE_KEY_API_KEY,
  STORAGE_KEY_PROVIDER,
  STORAGE_KEY_MODEL,
  CLAUDE_MODELS,
  usesClaude,
  TourStep,
} from "@/api/assistantApi";
import { ApiKeyModal } from "./ApiKeyModal";
import { useOptionalTourController } from "@/tour/TourController";
import { TOUR_IDS } from "@/tour/tourIds";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ToolChip, type ToolExecution } from "./ToolChip";

export type ChatMode = "teach" | "act";

export type { ToolExecution };

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
            ? { ...t, status: event.ok ? "completed" : "failed", error: event.error, preview: event.preview, durationMs: event.duration_ms }
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

  // Claude model chosen in the header (only shown when the saved key is a Claude key).
  const [claudeModel, setClaudeModel] = useState<string>(() => readStorage(STORAGE_KEY_MODEL) || CLAUDE_MODELS[0].id);
  const [claudeSelected, setClaudeSelected] = useState<boolean>(() =>
    usesClaude(readStorage(STORAGE_KEY_PROVIDER) || "", readStorage(STORAGE_KEY_API_KEY) || "")
  );

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

  // Mode of the reply being generated, so Stop cancels the right conversation.
  const activeTurnMode = useRef<ChatMode | null>(null);

  /** Abort the streaming fetch and tell the server to stop the agent loop. */
  const abortTurn = () => {
    abortController?.abort();
    setAbortController(null);
    const turnMode = activeTurnMode.current;
    const conversationId = turnMode ? conversationIds.current[turnMode] : null;
    if (conversationId) void cancelTurn(conversationId);
    activeTurnMode.current = null;
  };

  // Switch mode while preserving both conversation histories
  const handleModeChange = (newMode: ChatMode) => {
    if (newMode === mode) return;

    if (isStreaming) abortTurn();

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

  // Persist message history per mode. Skipped while an answer streams: saving
  // the whole history on every token is wasted work in long conversations,
  // and the server keeps the transcript anyway. Saves once the stream ends.
  useEffect(() => {
    if (isStreaming) return;
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
  }, [messagesByMode, mode, isStreaming]);

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
    if (isStreaming) abortTurn();
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
    // The server stops the agent loop at the next event or tool and records the
    // interrupted tool calls, so the conversation stays consistent.
    abortTurn();
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((msg) => (msg.isStreaming ? applyAssistantEvent({ ...msg, notices: [...(msg.notices || []), "Stopped."] }, { type: "done" }) : msg))
    );
  };

  const handleSendMessage = async (promptToSend?: string, opts: { resume?: boolean } = {}) => {
    const text = opts.resume ? "" : (promptToSend ?? inputValue).trim();
    if ((!text && !opts.resume) || isStreaming) return;

    if (!readStorage(STORAGE_KEY_API_KEY) && readStorage(STORAGE_KEY_PROVIDER) !== "demo") {
      setIsApiKeyModalOpen(true);
      return;
    }

    if (!promptToSend && !opts.resume) {
      setInputValue("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }

    // Bind the whole turn to the mode it started in, even if the user switches tabs.
    const turnMode = mode;
    activeTurnMode.current = turnMode;
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
        // A resumed turn has no user message: the approval decision is the trigger.
        ...(opts.resume ? [] : [{ id: `usr-${stamp}`, role: "user" as const, content: text, timestamp: stamp, mode: turnMode }]),
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
        resume: opts.resume,
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
    // Once the last open proposal of the latest reply is decided, let the assistant carry on
    // with its task (e.g. add components to the dashboard that was just created).
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const remaining = (lastAssistant?.pendingActions || []).filter((a) => a.id !== actionId);
    const continueTask =
      !!lastAssistant?.pendingActions?.some((a) => a.id === actionId) && remaining.length === 0 && !isStreaming;
    if (continueTask) setTimeout(() => void handleSendMessage(undefined, { resume: true }), 0);
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
                  {claudeSelected && (
                    <select
                      aria-label="Claude model"
                      data-testid="model-picker"
                      value={claudeModel}
                      onChange={(e) => {
                        setClaudeModel(e.target.value);
                        writeStorage(STORAGE_KEY_MODEL, e.target.value);
                      }}
                      disabled={isStreaming}
                      className="mt-1 h-6 rounded border bg-background px-1 text-[11px] text-muted-foreground"
                    >
                      {CLAUDE_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} · {m.hint}
                        </option>
                      ))}
                    </select>
                  )}
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
                                <ToolChip key={tool.id} tool={tool} />
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
        onSuccess={(provider, key) => {
          setApiKeyError(undefined);
          setClaudeSelected(usesClaude(provider, key));
        }}
      />
    </>
  );
}

export default ChatWidget;
