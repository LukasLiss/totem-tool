import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { streamChat, confirmAction, cancelTurn, usesClaude, AssistantEvent, STORAGE_KEY_API_KEY, STORAGE_KEY_MODEL, STORAGE_KEY_PROVIDER } from "../assistantApi";

vi.mock("axios");
const refreshAccessToken = vi.fn();
vi.mock("@/interceptors/axios", () => ({ refreshAccessToken: () => refreshAccessToken() }));

const store: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => Object.keys(store).forEach((k) => delete store[k]),
  },
  writable: true,
});

function sseResponse(chunks: (string | Uint8Array)[], status = 200) {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        const c = chunks[i++];
        controller.enqueue(typeof c === "string" ? encoder.encode(c) : c);
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

async function collect(gen: AsyncGenerator<AssistantEvent>) {
  const out: AssistantEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const turn = { message: "hi", mode: "act" as const, context: { active_file_id: 3 } };

describe("assistantApi.streamChat", () => {
  beforeEach(() => {
    localStorage.clear();
    refreshAccessToken.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("sends credentials as headers, never in the body", async () => {
    localStorage.setItem("access_token", "jwt");
    localStorage.setItem(STORAGE_KEY_API_KEY, "sk-ant-secret");
    localStorage.setItem(STORAGE_KEY_PROVIDER, "anthropic");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(['data: {"type":"done"}\n\n']));

    await collect(streamChat({ ...turn, conversationId: "conv_abc12345" }));

    const [, init] = fetchSpy.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer jwt");
    expect(headers["X-LLM-Key"]).toBe("sk-ant-secret");
    expect(headers["X-LLM-Provider"]).toBe("anthropic");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ message: "hi", mode: "act", context: { active_file_id: 3 }, conversation_id: "conv_abc12345" });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("sends the chosen Claude model and resume flag, but no Claude model with other providers", async () => {
    localStorage.setItem(STORAGE_KEY_API_KEY, "sk-ant-secret");
    localStorage.setItem(STORAGE_KEY_PROVIDER, "anthropic");
    localStorage.setItem(STORAGE_KEY_MODEL, "claude-sonnet-5-5");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(['data: {"type":"done"}\n\n']));
    await collect(streamChat({ ...turn, resume: true, conversationId: "conv_abc12345" }));
    let body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.resume).toBe(true);

    localStorage.setItem(STORAGE_KEY_PROVIDER, "gemini");
    localStorage.setItem(STORAGE_KEY_API_KEY, "AIza-key");
    fetchSpy.mockResolvedValue(sseResponse(['data: {"type":"done"}\n\n']));
    await collect(streamChat(turn));
    body = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    expect(body.model).toBeUndefined();
    expect(usesClaude("", "sk-ant-x")).toBe(true);
  });

  it("parses frames split across reads, CRLF line endings and multi-byte characters", async () => {
    const bytes = new TextEncoder().encode('data: {"type":"text","text":"Größe ✓"}\r\n\r\n');
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([
        'data: {"type":"conversation","conversation_id":"conv_1"}\n',
        "\n",
        bytes.slice(0, 20),
        bytes.slice(20),
        'data: {"type":"tool_start","id":"t","name":"get_log_overview","summary":"Reading","kind":"read"}\n\ndata: {"type":"done"}\n\n',
      ])
    );
    const events = await collect(streamChat(turn));
    expect(events.map((e) => e.type)).toEqual(["conversation", "text", "tool_start", "done"]);
    expect(events[1]).toEqual({ type: "text", text: "Größe ✓" });
  });

  it("skips malformed frames instead of failing the answer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(['data: {not json}\n\n', 'data: {"type":"text","text":"ok"}\n\n', 'data: {"type":"done"}\n\n'])
    );
    const events = await collect(streamChat(turn));
    expect(events).toEqual([{ type: "text", text: "ok" }, { type: "done" }]);
  });

  it("turns HTTP errors into an error event with the server's message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "No API key is configured for anthropic.", code: "auth" }), { status: 401 })
    );
    const events = await collect(streamChat(turn));
    expect(events[0]).toMatchObject({ type: "error", code: "auth", message: "No API key is configured for anthropic." });
    expect(events[1]).toEqual({ type: "done" });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes an expired session token once and retries", async () => {
    localStorage.setItem("access_token", "old");
    refreshAccessToken.mockResolvedValue("new");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Token expired" }), { status: 401 }))
      .mockResolvedValueOnce(sseResponse(['data: {"type":"done"}\n\n']));
    const events = await collect(streamChat(turn));
    expect(events).toEqual([{ type: "done" }]);
    expect((fetchSpy.mock.calls[1][1]?.headers as Record<string, string>).Authorization).toBe("Bearer new");
  });

  it("passes the abort signal to fetch", async () => {
    const controller = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(['data: {"type":"done"}\n\n']));
    await collect(streamChat({ ...turn, signal: controller.signal }));
    expect(fetchSpy.mock.calls[0][1]?.signal).toBe(controller.signal);
  });
});

describe("assistantApi.confirmAction", () => {
  it("returns the server outcome for every status", async () => {
    const post = vi.mocked(axios.post);
    post.mockResolvedValueOnce({ status: 200, data: { status: "executed", result: { dashboard_id: 4 } } });
    expect(await confirmAction("act_1", true)).toMatchObject({ status: "executed", result: { dashboard_id: 4 } });
    expect(post.mock.calls[0][1]).toEqual({ pending_action_id: "act_1", approved: true });

    post.mockResolvedValueOnce({ status: 404, data: { error: "This action does not exist or has expired." } });
    expect(await confirmAction("act_2", true)).toEqual({ status: "failed", error: "This action does not exist or has expired." });

    post.mockResolvedValueOnce({ status: 422, data: { status: "failed", error: "Dashboard 9 not found" } });
    expect(await confirmAction("act_3", true)).toMatchObject({ status: "failed", error: "Dashboard 9 not found" });
  });
});

describe("assistantApi.cancelTurn", () => {
  it("asks the server to stop the conversation's running turn and never throws", async () => {
    const post = vi.mocked(axios.post);
    post.mockResolvedValueOnce({ status: 200, data: { status: "cancelling" } });
    await cancelTurn("conv_abc12345");
    expect(post).toHaveBeenLastCalledWith(expect.stringMatching(/\/api\/assistant\/cancel\/$/), { conversation_id: "conv_abc12345" });

    post.mockRejectedValueOnce(new Error("offline"));
    await expect(cancelTurn("conv_abc12345")).resolves.toBeUndefined();
  });
});
