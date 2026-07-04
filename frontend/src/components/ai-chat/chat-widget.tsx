import React, { useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Loader2, Send, Settings2, Trash2, Wrench, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import { getUserFiles } from "@/api/fileApi";
import {
  AiProvider,
  ChatMessage,
  ChatSettings,
  FrontendAction,
  sendChatMessage,
} from "@/api/chatApi";

const SETTINGS_KEY = "totem_ai_settings";
const HISTORY_KEY = "totem_ai_chat_history";

const DEFAULT_SETTINGS: ChatSettings = {
  provider: "ollama",
  model: "",
  apiKey: "",
  ollamaBaseUrl: "http://localhost:11434",
};

const MODEL_PLACEHOLDERS: Record<AiProvider, string> = {
  ollama: "llama3.1",
  anthropic: "claude-opus-4-8",
  openai: "gpt-4o",
};

function loadSettings(): ChatSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* corrupted settings fall back to defaults */
  }
  return DEFAULT_SETTINGS;
}

function loadHistory(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* corrupted history falls back to empty */
  }
  return [];
}

export function AiChatWidget() {
  const navigate = useNavigate();
  const { setViewMode } = useContext(DashboardContext);
  const { selectedFile, setSelectedFile } = useContext(SelectedFileContext);

  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<ChatSettings>(loadSettings);
  const [draftSettings, setDraftSettings] = useState<ChatSettings>(settings);
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(messages));
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy, open]);

  const saveSettings = () => {
    setSettings(draftSettings);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(draftSettings));
    setSettingsOpen(false);
    toast.success("AI settings saved");
  };

  const executeActions = async (actions: FrontendAction[]) => {
    for (const action of actions) {
      if (action.type === "refresh_data") {
        window.dispatchEvent(new Event("totem:refresh-data"));
        continue;
      }
      if (action.type !== "navigate") continue;

      if (action.file_id != null) {
        try {
          const response = await getUserFiles();
          const files = response.results || response;
          const file = (Array.isArray(files) ? files : []).find(
            (f: { id: number }) => f.id === action.file_id
          );
          if (file) setSelectedFile(file);
        } catch (error) {
          console.error("AI navigation: could not select file", error);
        }
      }

      switch (action.target) {
        case "upload":
          navigate("/upload");
          break;
        case "variants_view":
          navigate("/variantsview");
          break;
        case "overview":
          setViewMode({ type: "overview" });
          navigate("/overview");
          break;
        case "dashboard":
          if (action.dashboard_id != null) {
            setViewMode({ type: "dashboard", id: action.dashboard_id });
            navigate("/overview");
          }
          break;
        case "analysis":
          if (!selectedFile && action.file_id == null) {
            toast.warning("Select an event log first to open an analysis view.");
            break;
          }
          if (action.analysis_type) {
            setViewMode({ type: "analysis", component: action.analysis_type });
            navigate("/overview");
          }
          break;
      }
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;

    const history = [...messages, { role: "user" as const, content: text }];
    setMessages(history);
    setInput("");
    setBusy(true);
    try {
      const { messages: newMessages, actions } = await sendChatMessage(
        history,
        settings
      );
      setMessages([...history, ...newMessages]);
      await executeActions(actions);
    } catch (error) {
      const detail =
        (error as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ||
        "The AI request failed. Check your settings and connection.";
      toast.error(detail);
      setMessages([
        ...history,
        { role: "assistant", content: `⚠️ ${detail}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <>
      {/* Floating toggle button */}
      <Button
        size="icon"
        className="fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full shadow-lg"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Open AI assistant"
      >
        {open ? <X className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
      </Button>

      {open && (
        <div className="fixed bottom-22 right-6 z-40 flex h-[560px] max-h-[calc(100dvh-8rem)] w-[380px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Bot className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">TOTeM Assistant</span>
            <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
              {settings.provider}
            </span>
            <div className="ml-auto flex items-center">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Clear conversation"
                onClick={() => setMessages([])}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="AI settings"
                onClick={() => {
                  setDraftSettings(settings);
                  setSettingsOpen(true);
                }}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
            {messages.length === 0 && (
              <div className="mt-8 px-4 text-center text-sm text-muted-foreground">
                <p className="font-medium">Hi! I&apos;m the TOTeM assistant.</p>
                <p className="mt-2">
                  I can create dashboards for you, add analysis components, and
                  guide you to the right view — e.g. &quot;Create a dashboard
                  with the process variants for my log&quot;.
                </p>
              </div>
            )}
            {messages.map((message, index) => {
              if (message.role === "tool") return null;
              if (message.role === "assistant") {
                return (
                  <div key={index} className="space-y-1">
                    {message.tool_calls?.map((call) => (
                      <div
                        key={call.id}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground"
                      >
                        <Wrench className="h-3 w-3" />
                        <span>{call.name}</span>
                      </div>
                    ))}
                    {message.content && (
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">
                        {message.content}
                      </div>
                    )}
                  </div>
                );
              }
              return (
                <div key={index} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {message.content}
                  </div>
                </div>
              );
            })}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking…
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex items-end gap-2 border-t p-3">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask the assistant…"
              className="max-h-28 min-h-9 flex-1 resize-none"
              rows={1}
              disabled={busy}
            />
            <Button
              size="icon"
              onClick={send}
              disabled={busy || !input.trim()}
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>AI assistant settings</DialogTitle>
            <DialogDescription>
              Use a local Ollama model or connect Claude / ChatGPT with your own
              API key. Keys are stored only in this browser.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-provider">Provider</Label>
              <select
                id="ai-provider"
                className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                value={draftSettings.provider}
                onChange={(event) =>
                  setDraftSettings({
                    ...draftSettings,
                    provider: event.target.value as AiProvider,
                  })
                }
              >
                <option value="ollama">Ollama (local)</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (ChatGPT)</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-model">Model</Label>
              <Input
                id="ai-model"
                value={draftSettings.model}
                placeholder={MODEL_PLACEHOLDERS[draftSettings.provider]}
                onChange={(event) =>
                  setDraftSettings({ ...draftSettings, model: event.target.value })
                }
              />
            </div>
            {draftSettings.provider === "ollama" ? (
              <div className="space-y-2">
                <Label htmlFor="ai-ollama-url">Ollama URL</Label>
                <Input
                  id="ai-ollama-url"
                  value={draftSettings.ollamaBaseUrl}
                  placeholder="http://localhost:11434"
                  onChange={(event) =>
                    setDraftSettings({
                      ...draftSettings,
                      ollamaBaseUrl: event.target.value,
                    })
                  }
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="ai-api-key">API key</Label>
                <Input
                  id="ai-api-key"
                  type="password"
                  value={draftSettings.apiKey}
                  placeholder={
                    draftSettings.provider === "anthropic" ? "sk-ant-…" : "sk-…"
                  }
                  onChange={(event) =>
                    setDraftSettings({ ...draftSettings, apiKey: event.target.value })
                  }
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveSettings}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
