import axios from "axios";

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type FrontendAction =
  | { type: "refresh_data" }
  | {
      type: "navigate";
      target: "overview" | "upload" | "variants_view" | "analysis" | "dashboard";
      dashboard_id?: number;
      analysis_type?: "processArea" | "ocdfg" | "variants" | "dottedChart";
      file_id?: number;
    };

export type AiProvider = "ollama" | "anthropic" | "openai";

export type ChatSettings = {
  provider: AiProvider;
  model: string;
  apiKey: string;
  ollamaBaseUrl: string;
};

export type ChatResponse = {
  messages: ChatMessage[];
  actions: FrontendAction[];
};

export async function sendChatMessage(
  messages: ChatMessage[],
  settings: ChatSettings
): Promise<ChatResponse> {
  const { data } = await axios.post("http://localhost:8000/api/ai/chat/", {
    messages,
    settings: {
      provider: settings.provider,
      model: settings.model,
      api_key: settings.apiKey,
      ollama_base_url: settings.ollamaBaseUrl,
    },
  });
  return data;
}

export async function getAiConfig() {
  const { data } = await axios.get("http://localhost:8000/api/ai/config/");
  return data;
}
