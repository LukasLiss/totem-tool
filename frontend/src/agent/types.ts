/** Wire frame types for the agent WebSocket protocol. */

export interface CommandMessage {
  type: "command";
  command: string;
  args: Record<string, unknown>;
}

export interface ResultMessage {
  type: "result";
  command: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface NoticeMessage {
  type: "notice";
  message: string;
}

export type IncomingMessage = CommandMessage | ResultMessage | NoticeMessage;

export type ConnectionState = "connecting" | "connected" | "disconnected";

export type CommandHandler = (
  args: Record<string, unknown>
) => void | Promise<void>;
