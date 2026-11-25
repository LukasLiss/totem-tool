import axios from "axios";
import { getApiUrl } from "@/config/api";

const ASSISTANT_URL = getApiUrl("/api/assistant");

export const STORAGE_KEY_API_KEY = "totem_llm_api_key";
export const STORAGE_KEY_PROVIDER = "totem_llm_provider";

export type ChatMode = "teach" | "act";

/** UI state sent with every message. Never contains credentials. */
export interface AssistantContext {
  active_file_id?: number;
  project_id?: number;
  view_mode?: string;
  pathname?: string;
  current_dashboard_id?: number;
}

export interface TourStep {
  tour_id: string;
  label: string;
}

export interface PendingAction {
  id: string;
  name: string;
  description: string;
  arguments: Record<string, unknown>;
}

/** Events streamed by POST /api/assistant/chat/ (see backend assistant/harness.py). */
export type AssistantEvent =
  | { type: "conversation"; conversation_id: string }
  | { type: "text"; text: string }
  | { type: "status"; status: "thinking" }
  | { type: "tool_start"; id: string; name: string; summary: string; kind: "read" | "propose" | "client" }
  | { type: "tool_end"; id: string; name: string; ok: boolean; error?: string; duration_ms: number }
  | { type: "pending_action"; id: string; name: string; description: string; arguments: Record<string, unknown> }
  | { type: "client_action"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "notice"; text: string }
  | { type: "error"; code: string; message: string; retryable?: boolean }
  | { type: "done"; usage?: Record<string, number>; conversation_id?: string };

export interface ValidateKeyResponse {
  valid: boolean;
  provider: string;
  message?: string;
  error?: string;
}

function storedCredentials(): { apiKey: string; provider: string } {
  try {
    return {
      apiKey: localStorage.getItem(STORAGE_KEY_API_KEY) || "",
      provider: localStorage.getItem(STORAGE_KEY_PROVIDER) || "",
    };
  } catch {
    return { apiKey: "", provider: "" };
  }
}

function accessToken(): string | null {
  try {
    const token = localStorage.getItem("access_token");
    return token && token !== "null" && token !== "undefined" ? token : null;
  } catch {
    return null;
  }
}

export async function validateApiKey(provider: string, apiKey: string): Promise<ValidateKeyResponse> {
  try {
    const res = await axios.post<ValidateKeyResponse>(
      `${ASSISTANT_URL}/validate-key/`,
      { provider, api_key: apiKey },
      { validateStatus: (s) => s < 500 }
    );
    return res.data;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to validate API key.";
    return { valid: false, provider, error: message };
  }
}

/** Parse a text/event-stream body into JSON events. */
export async function* parseEventStream(body: ReadableStream<Uint8Array>): AsyncGenerator<AssistantEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (data) {
          try {
            yield JSON.parse(data) as AssistantEvent;
          } catch {
            // ignore a malformed frame rather than abort the whole answer
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export interface StreamChatOptions {
  message: string;
  mode: ChatMode;
  context?: AssistantContext;
  conversationId?: string | null;
  signal?: AbortSignal;
}

async function postChat(opts: StreamChatOptions, token: string | null): Promise<Response> {
  const { apiKey, provider } = storedCredentials();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Credentials go in headers, never in the body that the server may log or store.
  if (apiKey) headers["X-LLM-Key"] = apiKey;
  if (provider) headers["X-LLM-Provider"] = provider;
  return fetch(`${ASSISTANT_URL}/chat/`, {
    method: "POST",
    headers,
    signal: opts.signal,
    body: JSON.stringify({
      message: opts.message,
      mode: opts.mode,
      context: opts.context ?? {},
      conversation_id: opts.conversationId || undefined,
    }),
  });
}

/**
 * Run one assistant turn and yield its events. Non-2xx responses become a
 * single `error` event; an expired session token is refreshed once.
 */
export async function* streamChat(opts: StreamChatOptions): AsyncGenerator<AssistantEvent> {
  let response = await postChat(opts, accessToken());
  if (response.status === 401) {
    const body = await response.clone().json().catch(() => ({}));
    // A 401 with code "auth" means the LLM key is missing, not the session.
    if (body?.code !== "auth") {
      try {
        // Loaded lazily: the interceptor module has import-time side effects.
        const { refreshAccessToken } = await import("@/interceptors/axios");
        response = await postChat(opts, await refreshAccessToken());
      } catch {
        // fall through and report the original 401
      }
    }
  }

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}) as Record<string, unknown>);
    const code = typeof body?.code === "string" ? body.code : response.status === 401 ? "session" : "http";
    const message =
      (typeof body?.error === "string" && body.error) ||
      (typeof body?.detail === "string" && body.detail) ||
      `The assistant request failed (HTTP ${response.status}).`;
    yield { type: "error", code, message, retryable: response.status >= 500 };
    yield { type: "done" };
    return;
  }

  yield* parseEventStream(response.body);
}

export interface ConfirmActionResponse {
  status: "executed" | "cancelled" | "failed" | "executing" | string;
  pending_action_id?: string;
  tool_name?: string;
  result?: Record<string, unknown> | null;
  error?: string;
}

/** Approve or decline a proposed change. Resolves for every HTTP status. */
export async function confirmAction(pendingActionId: string, approved: boolean): Promise<ConfirmActionResponse> {
  const { data, status } = await axios.post<ConfirmActionResponse>(
    `${ASSISTANT_URL}/confirm/`,
    { pending_action_id: pendingActionId, approved },
    { validateStatus: () => true }
  );
  if (status === 404) return { status: "failed", error: data?.error || "This proposal expired. Ask the assistant again." };
  if (status >= 500 && !data?.status) return { status: "failed", error: "The server could not apply the change." };
  return data;
}

/**
 * Ask the server to stop the reply being generated. Aborting the fetch alone
 * is not enough: the server may not notice the closed connection and would
 * keep calling the model until the turn finished.
 */
export async function cancelTurn(conversationId: string): Promise<void> {
  await axios.post(`${ASSISTANT_URL}/cancel/`, { conversation_id: conversationId }).catch(() => undefined);
}

export async function resetConversation(conversationId: string): Promise<void> {
  await axios.post(`${ASSISTANT_URL}/reset/`, { conversation_id: conversationId }).catch(() => undefined);
}
