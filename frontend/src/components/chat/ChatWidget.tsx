import React, { useState, useCallback, useRef } from "react";
import { MessageSquare, X, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { streamChat } from "@/api/assistantApi";
import type { PendingAction, TourStep } from "@/api/assistantApi";
import { useAssistantContext } from "@/hooks/useAssistantContext";
import { useTourController } from "@/tour/TourController";
import { MessageList, type Message } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { PendingActions } from "./PendingActions";

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const context = useAssistantContext();
  const { startTour } = useTourController();

  const handleSend = useCallback(
    async (text: string) => {
      setError(null);

      // Add user message
      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
      };
      setMessages((prev) => [...prev, userMsg]);

      // Start streaming
      const assistantId = `assistant-${Date.now()}`;
      setIsStreaming(true);

      try {
        let accumulated = "";
        const actions: PendingAction[] = [];

        for await (const event of streamChat(text, context)) {
          switch (event.type) {
            case "text":
              accumulated += event.content;
              setMessages((prev) => {
                const existing = prev.find((m) => m.id === assistantId);
                if (existing) {
                  return prev.map((m) =>
                    m.id === assistantId ? { ...m, content: accumulated } : m
                  );
                }
                return [
                  ...prev,
                  { id: assistantId, role: "assistant", content: accumulated },
                ];
              });
              break;

            case "pending_action":
              actions.push({
                id: event.id,
                name: event.name,
                description: event.description,
                arguments: event.arguments,
              });
              setPendingActions([...actions]);
              break;

            case "tour_path":
              if (event.steps && event.steps.length > 0) {
                startTour(event.steps as TourStep[]);
              }
              break;

            case "error":
              setError(event.error);
              break;

            case "done":
              break;
          }
        }

        // Ensure the assistant message exists even if no text was streamed
        if (!accumulated) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === assistantId)) return prev;
            return [
              ...prev,
              {
                id: assistantId,
                role: "assistant",
                content: "Done.",
              },
            ];
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Connection failed.");
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [context]
  );

  const handlePendingResolved = useCallback((id: string) => {
    setPendingActions((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return (
    <>
      {/* Toggle button — fixed bottom-right */}
      {!open && (
        <Button
          size="icon"
          onClick={() => setOpen(true)}
          className={cn(
            "fixed bottom-6 right-6 z-50 size-12 rounded-full shadow-lg",
            "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          <MessageSquare className="size-5" />
        </Button>
      )}

      {/* Chat drawer */}
      {open && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 flex flex-col",
            "w-[380px] max-w-[calc(100vw-2rem)] h-[520px] max-h-[calc(100vh-4rem)]",
            "rounded-lg border bg-background shadow-xl",
            "animate-in fade-in slide-in-from-bottom-2 duration-200"
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Assistant</h3>
            <div className="flex gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => setOpen(false)}
              >
                <Minus className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <MessageList messages={messages} isStreaming={isStreaming} />

          {/* Error banner */}
          {error && (
            <div className="mx-4 mb-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* Pending actions */}
          <PendingActions
            actions={pendingActions}
            onResolved={handlePendingResolved}
          />

          {/* Input */}
          <MessageInput onSend={handleSend} disabled={isStreaming} />
        </div>
      )}
    </>
  );
}
