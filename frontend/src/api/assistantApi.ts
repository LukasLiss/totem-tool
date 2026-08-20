import axios from "axios";

const ASSISTANT_URL = "http://localhost:8000/api/assistant";

export interface AssistantContext {
  selected_file_id?: number;
  current_view?: string;
  current_dashboard_id?: number;
}

export interface PendingAction {
  id: string;
  name: string;
  description: string;
  arguments: Record<string, unknown>;
}

export interface TourStep {
  tour_id: string;
  label: string;
}

export interface ChatResponse {
  text: string;
  tool_calls: Array<{
    id: string;
    name: string;
    result: unknown;
  }>;
  pending_actions: PendingAction[];
  tour_path: TourStep[] | null;
}

export type SSEEvent =
  | { type: "text"; content: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; result: unknown }
  | { type: "pending_action"; id: string; name: string; description: string; arguments: Record<string, unknown> }
  | { type: "tour_path"; steps: TourStep[] }
  | { type: "done"; usage: Record<string, unknown> }
  | { type: "error"; error: string };

/**
 * Send a chat message and return an async generator of SSE events.
 * Falls back to non-streaming if the server doesn't support SSE.
 */
export async function* streamChat(
  message: string,
  context: AssistantContext
): AsyncGenerator<SSEEvent> {
  const token = localStorage.getItem("access_token");

  const response = await fetch(`${ASSISTANT_URL}/chat/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ message, context }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    yield { type: "error", error: `HTTP ${response.status}: ${errorText}` };
    return;
  }

  const contentType = response.headers.get("content-type") || "";

  // If server returned SSE, parse the stream
  if (contentType.includes("text/event-stream") && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            try {
              const event = JSON.parse(jsonStr) as SSEEvent;
              yield event;
              if (event.type === "done" || event.type === "error") return;
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }

  // Non-streaming fallback: parse the JSON response
  const data = (await response.json()) as ChatResponse;
  yield { type: "text", content: data.text };
  for (const tc of data.tool_calls) {
    yield { type: "tool_result", id: tc.id, name: tc.name, result: tc.result };
  }
  for (const pa of data.pending_actions) {
    yield {
      type: "pending_action",
      id: pa.id,
      name: pa.name,
      description: pa.description,
      arguments: pa.arguments,
    };
  }
  if (data.tour_path && data.tour_path.length > 0) {
    yield { type: "tour_path", steps: data.tour_path };
  }
  yield { type: "done", usage: {} };
}

/**
 * Send a non-streaming chat message (JSON response).
 */
export async function sendChat(
  message: string,
  context: AssistantContext
): Promise<ChatResponse> {
  const { data } = await axios.post<ChatResponse>(
    `${ASSISTANT_URL}/chat/`,
    { message, context },
    { headers: { Accept: "application/json" } }
  );
  return data;
}

/**
 * Confirm or reject a pending action.
 */
export async function confirmAction(
  pendingActionId: string,
  approved: boolean
): Promise<{ status: string }> {
  const { data } = await axios.post<{ status: string }>(
    `${ASSISTANT_URL}/confirm/`,
    { pending_action_id: pendingActionId, approved }
  );
  return data;
}
