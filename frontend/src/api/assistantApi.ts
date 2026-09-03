import axios from "axios";
import { getApiUrl } from "@/config/api";

const ASSISTANT_URL = getApiUrl("/api/assistant");

export interface AssistantContext {
  selected_file_id?: number;
  active_file_id?: number;
  current_view?: string;
  view_mode?: string;
  pathname?: string;
  session_id?: string;
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
  | { type: "key_error"; provider?: string; message?: string }
  | { type: "error"; error?: string; message?: string };

export interface ValidateKeyResponse {
  valid: boolean;
  provider: string;
  message?: string;
  error?: string;
}

/**
 * Validate an LLM API key against the backend validation probe.
 */
export async function validateApiKey(
  provider: string,
  apiKey: string
): Promise<ValidateKeyResponse> {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("access_token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token && token !== "null" && token !== "undefined") {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const res = await axios.post<ValidateKeyResponse>(
      `${ASSISTANT_URL}/validate-key/`,
      { provider, api_key: apiKey },
      {
        headers,
        validateStatus: () => true, // resolve promise for 400s
      }
    );
    return res.data;
  } catch (err: any) {
    return {
      valid: false,
      provider,
      error: err?.response?.data?.error || err?.message || "Failed to validate API key.",
    };
  }
}

/**
 * Send a chat message and return an async generator of SSE events.
 * Falls back to non-streaming if the server doesn't support SSE.
 */
export async function* streamChat(
  message: string,
  context: AssistantContext,
  mode: string = "teach",
  apiKey?: string,
  provider?: string
): AsyncGenerator<SSEEvent> {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("access_token") : null;
  const storedKey = apiKey ?? (typeof localStorage !== "undefined" ? localStorage.getItem("totem_llm_api_key") || "" : "");
  const storedProvider = provider ?? (typeof localStorage !== "undefined" ? localStorage.getItem("totem_llm_provider") || "gemini" : "gemini");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (token && token !== "null" && token !== "undefined") {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${ASSISTANT_URL}/chat/`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message,
      context: { ...context, mode, api_key: storedKey, provider: storedProvider },
      mode,
      api_key: storedKey,
      provider: storedProvider,
    }),
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

export interface ConfirmActionResponse {
  status: "executed" | "cancelled" | string;
  pending_action_id?: string;
  result?: any;
}

/**
 * Confirm or reject a pending action.
 */
export async function confirmAction(
  pendingActionId: string,
  approved: boolean
): Promise<ConfirmActionResponse> {
  const { data } = await axios.post<ConfirmActionResponse>(
    `${ASSISTANT_URL}/confirm/`,
    { pending_action_id: pendingActionId, approved }
  );
  return data;
}
