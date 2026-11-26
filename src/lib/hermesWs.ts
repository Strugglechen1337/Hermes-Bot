import type {
  HermesServerRequest,
  JsonRpcEventFrame,
  JsonRpcResponse,
} from "../../shared/types";

export type WsConnectionState = "disconnected" | "connecting" | "connected" | "unauthorized";

export interface HermesGatewayEvent {
  type: string;
  payload: Record<string, unknown>;
  sessionId?: string;
  seq?: number;
}

type EventListener = (event: HermesGatewayEvent) => void;
type StateListener = (state: WsConnectionState) => void;
type ServerRequestListener = (req: HermesServerRequest) => void;

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class HermesWsClient {
  private ws: WebSocket | null = null;
  private state: WsConnectionState = "disconnected";
  private shouldReconnect = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private nextId = 1;
  private pending = new Map<string, PendingRpc>();
  private eventListeners = new Set<EventListener>();
  private stateListeners = new Set<StateListener>();
  private serverRequestListeners = new Set<ServerRequestListener>();

  getState(): WsConnectionState {
    return this.state;
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  onServerRequest(listener: ServerRequestListener): () => void {
    this.serverRequestListeners.add(listener);
    return () => this.serverRequestListeners.delete(listener);
  }

  private setState(next: WsConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    for (const listener of this.stateListeners) {
      listener(next);
    }
  }

  connect(): void {
    this.shouldReconnect = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.openSocket();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearTimers();
    this.rejectAllPending("Verbindung getrennt");
    if (this.ws) {
      try {
        this.ws.close(1000, "client_disconnect");
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.setState("disconnected");
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private buildWsUrl(): string {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/api/ws`;
  }

  private openSocket(): void {
    this.clearTimers();
    this.setState("connecting");

    const ws = new WebSocket(this.buildWsUrl());
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.reconnectAttempt = 0;
      this.setState("connected");
      this.startHeartbeat();
      // Announce interactive client capabilities so Hermes sends server->client
      // requests (clarify, connection prompts) instead of skipping them.
      this.call("client.capabilities", { server_requests: true }, 10_000).catch(() => {
        // Optional on older servers
      });
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let frame: JsonRpcResponse & Partial<JsonRpcEventFrame> & { method?: string; params?: Record<string, unknown> };
      try {
        frame = JSON.parse(ev.data) as JsonRpcResponse &
          Partial<JsonRpcEventFrame> & { method?: string; params?: Record<string, unknown> };
      } catch {
        return;
      }

      // Server -> Client event notification
      if (frame.method === "event" && frame.params && typeof frame.params.type === "string") {
        const event: HermesGatewayEvent = {
          type: frame.params.type,
          payload: (frame.params.payload && typeof frame.params.payload === "object"
            ? frame.params.payload
            : {}) as Record<string, unknown>,
          sessionId: typeof frame.params.session_id === "string" ? frame.params.session_id : undefined,
          seq: typeof frame.params.seq === "number" ? frame.params.seq : undefined,
        };
        for (const listener of this.eventListeners) {
          listener(event);
        }
        return;
      }

      // Server -> Client RPC request (has both method and id, e.g. clarify)
      if (typeof frame.method === "string" && frame.id !== undefined && frame.id !== null) {
        const req: HermesServerRequest = {
          id: frame.id,
          method: frame.method,
          params: (frame.params && typeof frame.params === "object" ? frame.params : {}) as Record<string, unknown>,
        };
        if (this.serverRequestListeners.size > 0) {
          for (const listener of this.serverRequestListeners) {
            listener(req);
          }
        } else {
          // Decline politely if no handler is mounted for this request
          this.sendErrorResponse(req.id, 4404, "No active view to answer this request.");
        }
        return;
      }

      // RPC response frame
      if (frame.id !== undefined && frame.id !== null) {
        const key = String(frame.id);
        const pending = this.pending.get(key);
        if (pending) {
          this.pending.delete(key);
          clearTimeout(pending.timer);
          if (frame.error) {
            const dataObj =
              frame.error.data && typeof frame.error.data === "object"
                ? (frame.error.data as Record<string, unknown>)
                : null;
            const detail =
              typeof dataObj?.detail === "string" && dataObj.detail.trim()
                ? dataObj.detail.trim()
                : "";
            const msg = detail
              ? `${frame.error.message}: ${detail}`
              : frame.error.message || `RPC-Fehler ${frame.error.code}`;
            pending.reject(new Error(msg));
          } else {
            pending.resolve(frame.result);
          }
        }
      }
    };

    ws.onerror = () => {
      // Close handler will manage state and reconnection
    };

    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      this.rejectAllPending("Gateway-Verbindung unterbrochen");

      if (ev.code === 4401 || ev.code === 4001 || ev.code === 1008) {
        this.shouldReconnect = false;
        this.setState("unauthorized");
        return;
      }

      this.setState("disconnected");
      if (this.shouldReconnect) {
        const delayMs = Math.min(12_000, 1000 * Math.pow(1.6, this.reconnectAttempt));
        this.reconnectAttempt += 1;
        this.reconnectTimer = setTimeout(() => {
          if (this.shouldReconnect) this.openSocket();
        }, delayMs);
      }
    };
  }

  private startHeartbeat(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.call("gateway.ping", {}, 10_000).catch(() => {
          // Heartbeat timeout triggers socket teardown on next tick
        });
      }
    }, 25_000);
  }

  sendResponse(id: string | number, result: Record<string, unknown>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  sendErrorResponse(id: string | number, code: number, message: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
  }

  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30_000
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Keine aktive Verbindung zum Hermes-Gateway.");
    }

    const id = `hp-${this.nextId++}`;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Zeitüberschreitung bei ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (val) => resolve(val as T),
        reject,
        timer,
      });

      try {
        this.ws!.send(payload);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}

export const hermesWs = new HermesWsClient();
