import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ConnectionState, IncomingMessage } from "./types";
import { dispatchCommand, registerBuiltinHandlers } from "./handlers";

const WS_BASE = "ws://localhost:8000/ws/agent";

interface AgentBridgeContextValue {
  connectionState: ConnectionState;
  sendCommand: (command: string, args: Record<string, unknown>) => void;
}

const AgentBridgeContext = createContext<AgentBridgeContextValue>({
  connectionState: "disconnected",
  sendCommand: () => {},
});

export function useAgent(): AgentBridgeContextValue {
  return useContext(AgentBridgeContext);
}

interface AgentBridgeProps {
  children: React.ReactNode;
}

export function AgentBridge({ children }: AgentBridgeProps) {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const token = localStorage.getItem("access_token");
    if (!token) {
      setConnectionState("disconnected");
      return;
    }

    setConnectionState("connecting");

    const ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnectionState("connected");
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg: IncomingMessage = JSON.parse(event.data);
        if (msg.type === "command") {
          dispatchCommand(msg.command, msg.args);
        }
        // result and notice are acknowledged silently
      } catch {
        // malformed message — ignore
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (!mountedRef.current) return;
      setConnectionState("disconnected");
      // Reconnect after a short delay
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    registerBuiltinHandlers();
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendCommand = useCallback(
    (command: string, args: Record<string, unknown>) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "command", command, args }));
      }
    },
    []
  );

  return (
    <AgentBridgeContext.Provider value={{ connectionState, sendCommand }}>
      {children}
    </AgentBridgeContext.Provider>
  );
}
