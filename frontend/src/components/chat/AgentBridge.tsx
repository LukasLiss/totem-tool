/**
 * Real-Time WebSocket Agent Bridge for Totem.
 *
 * Connects to Django Channels `/ws/agent/` command bus, processes incoming
 * live-wire agent actions via `handlers.ts`, returns structured correlation acknowledgments,
 * manages connection lifecycle with exponential backoff auto-reconnect, and exposes status indicators.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { executeCommand, HandlerDependencies, AgentCommand } from "./handlers";
import { useTourController, useOptionalTourController } from "@/tour/TourController";
import { useContext } from "react";
import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import { useNavigate } from "react-router-dom";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface AgentBridgeProps {
  wsUrl?: string;
  token?: string;
  sessionId?: string;
  deps?: HandlerDependencies;
  onStatusChange?: (status: ConnectionStatus) => void;
  showIndicator?: boolean;
}

export const STORAGE_SESSION_ID_KEY = "totem_agent_session_id";
export const BACKOFF_INTERVALS = [1000, 2000, 4000, 8000, 10000];
export const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Returns an existing session ID or creates and persists a new one.
 */
export function getOrCreateSessionId(customId?: string): string {
  if (customId) return customId;
  try {
    if (typeof sessionStorage !== "undefined") {
      const stored = sessionStorage.getItem(STORAGE_SESSION_ID_KEY);
      if (stored) return stored;

      const newId = `sess_${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 12) : Date.now().toString(36)}`;
      sessionStorage.setItem(STORAGE_SESSION_ID_KEY, newId);
      return newId;
    }
  } catch {
    // Ignore storage restrictions
  }
  return `sess_${Date.now().toString(36)}`;
}

/**
 * Resolves full WebSocket URL with token and session_id query parameters.
 */
export function resolveWebSocketUrl(customUrl?: string, token?: string, sessionId?: string): string {
  let baseUrl = customUrl;

  if (!baseUrl) {
    const envWs = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.VITE_WS_BASE_URL : undefined;
    const envApi = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.VITE_API_BASE_URL : undefined;

    if (envWs) {
      baseUrl = envWs.endsWith("/ws/agent/") || envWs.endsWith("/ws/agent") ? envWs : `${envWs.replace(/\/+$/, "")}/ws/agent/`;
    } else if (envApi) {
      const wsProtocol = envApi.startsWith("https") ? "wss:" : "ws:";
      const hostPath = envApi.replace(/^https?:\/\//, "").replace(/\/+$/, "");
      baseUrl = `${wsProtocol}//${hostPath}/ws/agent/`;
    } else if (typeof window !== "undefined" && window.location) {
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host || "localhost:8000";
      baseUrl = `${wsProtocol}//${host}/ws/agent/`;
    } else {
      baseUrl = "ws://localhost:8000/ws/agent/";
    }
  }

  // Ensure trailing slash on base path if not present before query
  if (!baseUrl.includes("?") && !baseUrl.endsWith("/")) {
    baseUrl += "/";
  }

  const authToken = token || (typeof localStorage !== "undefined" ? localStorage.getItem("access_token") : null);
  const sessId = getOrCreateSessionId(sessionId);

  const urlObj = new URL(baseUrl, "ws://localhost:8000");
  if (authToken) {
    urlObj.searchParams.set("token", authToken);
  }
  urlObj.searchParams.set("session_id", sessId);

  return urlObj.toString();
}

/**
 * Reusable Status Dot Indicator Component.
 */
export function AgentStatusIndicator({
  status,
  className = "",
}: {
  status: ConnectionStatus;
  className?: string;
}) {
  switch (status) {
    case "connected":
      return (
        <span
          className={`inline-flex items-center gap-1.5 text-xs text-emerald-600 font-medium ${className}`}
          title="Agent Live-Wire Connected"
        >
          <span className="size-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" />
          <span className="hidden sm:inline">Connected</span>
        </span>
      );
    case "connecting":
    case "reconnecting":
      return (
        <span
          className={`inline-flex items-center gap-1.5 text-xs text-amber-600 font-medium ${className}`}
          title="Reconnecting agent bridge..."
        >
          <span className="size-2 rounded-full bg-amber-500 animate-pulse ring-2 ring-amber-500/20" />
          <span className="hidden sm:inline">Reconnecting</span>
        </span>
      );
    case "disconnected":
    default:
      return (
        <span
          className={`inline-flex items-center gap-1.5 text-xs text-zinc-400 font-medium ${className}`}
          title="Agent Bridge Disconnected"
        >
          <span className="size-2 rounded-full bg-zinc-400 ring-2 ring-zinc-400/20" />
          <span className="hidden sm:inline">Offline</span>
        </span>
      );
  }
}

/**
 * React Component managing the WebSocket live connection to Django Channels.
 */
export function AgentBridge({
  wsUrl,
  token,
  sessionId,
  deps: propDeps,
  onStatusChange,
  showIndicator = false,
}: AgentBridgeProps) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmountedRef = useRef(false);

  // Optional Context dependencies
  let navHook: ReturnType<typeof useNavigate> | undefined;
  try {
    navHook = useNavigate();
  } catch {
    // router context not present
  }

  let dashboardCtx: { viewMode: any; setViewMode: any } | undefined;
  try {
    dashboardCtx = useContext(DashboardContext);
  } catch {
    // context not present
  }

  let selectedFileCtx: { selectedFile: any } | undefined;
  try {
    selectedFileCtx = useContext(SelectedFileContext);
  } catch {
    // context not present
  }

  const tourCtrl = useOptionalTourController();

  const dependencies: HandlerDependencies = {
    navigate: propDeps?.navigate || navHook,
    setViewMode: propDeps?.setViewMode || dashboardCtx?.setViewMode,
    viewMode: propDeps?.viewMode || dashboardCtx?.viewMode,
    selectedFile: propDeps?.selectedFile || selectedFileCtx?.selectedFile,
    startTour: propDeps?.startTour || tourCtrl?.startTour,
  };

  const updateStatus = useCallback(
    (newStatus: ConnectionStatus) => {
      setStatus(newStatus);
      if (onStatusChange) {
        onStatusChange(newStatus);
      }
    },
    [onStatusChange]
  );

  const connect = useCallback(() => {
    if (isUnmountedRef.current) return;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const fullUrl = resolveWebSocketUrl(wsUrl, token, sessionId);
      updateStatus(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

      const ws = new WebSocket(fullUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmountedRef.current) {
          ws.close();
          return;
        }
        reconnectAttemptRef.current = 0;
        updateStatus("connected");
      };

      ws.onmessage = async (event) => {
        if (isUnmountedRef.current) return;

        try {
          const data: AgentCommand = JSON.parse(event.data);

          // If incoming frame has an action, execute command and reply
          if (data && data.action) {
            const result = await executeCommand(data, dependencies);

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  status: result.status,
                  correlation_id: data.correlation_id,
                  payload: result.payload || {},
                  error: result.error,
                })
              );
            }
          }
        } catch (err) {
          console.error("Error processing agent WebSocket message:", err);
        }
      };

      ws.onclose = (event) => {
        if (isUnmountedRef.current) return;

        updateStatus("disconnected");
        wsRef.current = null;

        // Auto-reconnect with exponential backoff if not cleanly closed
        if (event.code !== 1000 && reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delayIndex = Math.min(reconnectAttemptRef.current, BACKOFF_INTERVALS.length - 1);
          const delay = BACKOFF_INTERVALS[delayIndex];
          reconnectAttemptRef.current += 1;

          updateStatus("reconnecting");
          reconnectTimerRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      ws.onerror = (err) => {
        console.debug("AgentBridge WebSocket error:", err);
      };
    } catch (err) {
      console.error("Failed to initialize AgentBridge WebSocket:", err);
      updateStatus("disconnected");
    }
  }, [wsUrl, token, sessionId, dependencies, updateStatus]);

  useEffect(() => {
    isUnmountedRef.current = false;
    connect();

    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmounted");
        wsRef.current = null;
      }
    };
  }, [connect]);

  if (!showIndicator) {
    return null;
  }

  return (
    <div className="fixed top-3 right-3 z-50 pointer-events-none">
      <AgentStatusIndicator status={status} />
    </div>
  );
}

export default AgentBridge;
