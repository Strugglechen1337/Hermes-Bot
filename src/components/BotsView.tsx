import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  History,
  MessageSquarePlus,
  RefreshCw,
  Search,
  ShieldAlert,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import type {
  HermesChatMessage,
  HermesPendingApproval,
  HermesProfile,
  HermesSessionSummary,
} from "../../shared/types";
import { getBotVisual } from "../lib/botTheme";
import { formatRelativeTime, formatShortTime } from "../lib/format";
import {
  deleteSession,
  fetchSessionMessages,
  fetchSessions,
  normalizeMessages,
} from "../lib/hermesApi";
import { hermesWs, type WsConnectionState } from "../lib/hermesWs";
import { ConfirmSheet } from "./ConfirmSheet";
import { SafeMarkdown } from "./SafeMarkdown";

interface BotsViewProps {
  profiles: HermesProfile[];
  loading: boolean;
  error: string | null;
  wsState: WsConnectionState;
  selectedBotName: string | null;
  onSelectBot: (name: string | null) => void;
  onRefreshProfiles: () => void;
}

export const BotsView: React.FC<BotsViewProps> = ({
  profiles,
  loading,
  error,
  wsState,
  selectedBotName,
  onSelectBot,
  onRefreshProfiles,
}) => {
  const [query, setQuery] = useState("");
  const [recentByProfile, setRecentByProfile] = useState<Record<string, HermesSessionSummary>>({});

  // Load most recent session preview for the visible profiles (read-only)
  useEffect(() => {
    if (profiles.length === 0) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        profiles.map(async (p) => {
          try {
            const sessions = await fetchSessions(p.name, 1);
            return [p.name, sessions[0]] as const;
          } catch {
            return [p.name, undefined] as const;
          }
        })
      );
      if (cancelled) return;
      const map: Record<string, HermesSessionSummary> = {};
      for (const [name, session] of entries) {
        if (session) map[name] = session;
      }
      setRecentByProfile(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [profiles]);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.name === selectedBotName) || null,
    [profiles, selectedBotName]
  );

  const filteredProfiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...profiles].sort((a, b) => {
      // Pin Mika & default at the top for quick daily access, then alphabetical
      const rank = (n: string) => (n === "mika" ? 0 : n === "default" ? 1 : 2);
      const diff = rank(a.name) - rank(b.name);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name, "de");
    });
    if (!q) return sorted;
    return sorted.filter((p) => {
      const vis = getBotVisual(p);
      return (
        p.name.toLowerCase().includes(q) ||
        vis.label.toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q) ||
        (p.model || "").toLowerCase().includes(q)
      );
    });
  }, [profiles, query]);

  if (selectedProfile) {
    return (
      <DirectChatView
        profile={selectedProfile}
        wsState={wsState}
        onBack={() => onSelectBot(null)}
      />
    );
  }

  return (
    <div>
      <div style={{ position: "relative", marginBottom: 14 }}>
        <Search
          size={16}
          style={{
            position: "absolute",
            left: 13,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-muted)",
            pointerEvents: "none",
          }}
        />
        <input
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Bots durchsuchen (z. B. Mika, Recherche)…"
          style={{ paddingLeft: 38, borderRadius: "var(--radius-pill)" }}
        />
      </div>

      {error && (
        <div className="notice err" style={{ marginBottom: 12 }}>
          <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div>{error}</div>
            <button
              type="button"
              className="btn sm"
              style={{ marginTop: 8 }}
              onClick={onRefreshProfiles}
            >
              <RefreshCw size={14} /> Erneut laden
            </button>
          </div>
        </div>
      )}

      <div className="section-header">
        <h2 className="section-title">Deine Hermes-Bots ({filteredProfiles.length})</h2>
        <button
          type="button"
          className="icon-btn ghost"
          onClick={onRefreshProfiles}
          aria-label="Bots aktualisieren"
          style={{ minWidth: 34, minHeight: 34 }}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {loading && profiles.length === 0 ? (
        <div className="empty-state">
          <p>Lade Hermes-Profile vom Server…</p>
        </div>
      ) : filteredProfiles.length === 0 ? (
        <div className="empty-state">
          <h3>Keine Bots gefunden</h3>
          <p>
            {query
              ? `Kein Hermes-Profil passt zu „${query}“.`
              : "Auf dem Hermes-Server wurden noch keine Profile gefunden."}
          </p>
        </div>
      ) : (
        <div className="card-stack">
          {filteredProfiles.map((profile) => {
            const visual = getBotVisual(profile);
            const recent = recentByProfile[profile.name];
            return (
              <button
                key={profile.name}
                type="button"
                className="bot-card"
                onClick={() => onSelectBot(profile.name)}
              >
                <div className="avatar" style={{ background: visual.gradient }}>
                  {visual.initials}
                  <span
                    className={`avatar-status ${profile.gateway_running ? "online" : ""}`}
                    title={profile.gateway_running ? "Gateway aktiv" : "Offline"}
                  />
                </div>
                <div className="bot-card-body">
                  <div className="bot-card-row">
                    <span className="bot-card-name">{visual.label}</span>
                    {recent?.last_active && (
                      <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", flexShrink: 0 }}>
                        {formatRelativeTime(recent.last_active)}
                      </span>
                    )}
                  </div>
                  <div className="bot-card-meta">
                    {recent?.title || visual.subtitle}
                  </div>
                  <div className="bot-card-tags">
                    {profile.model && <span className="mini-tag">{profile.model}</span>}
                    {profile.name === "mika" && (
                      <span className="mini-tag" style={{ color: "#fde68a" }}>
                        E-Mail-Assistentin
                      </span>
                    )}
                    {profile.is_default && <span className="mini-tag">Standard</span>}
                    {!profile.gateway_running && (
                      <span className="mini-tag" style={{ color: "var(--status-warn)" }}>
                        Gateway inaktiv
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight size={18} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Direct 1:1 Bot Chat Screen ────────────────────────────────────────────────

interface DirectChatViewProps {
  profile: HermesProfile;
  wsState: WsConnectionState;
  onBack: () => void;
}

const DirectChatView: React.FC<DirectChatViewProps> = ({ profile, wsState, onBack }) => {
  const visual = getBotVisual(profile);

  const [sessions, setSessions] = useState<HermesSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState<string>("Neuer Chat");
  const [messages, setMessages] = useState<HermesChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(true);
  const [chatError, setChatError] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<HermesPendingApproval | null>(null);

  const [showSessionsSheet, setShowSessionsSheet] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<HermesSessionSummary | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  activeSessionRef.current = activeSessionId;

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);

  const loadSessionHistory = useCallback(
    async (sessionId: string, titleHint?: string | null) => {
      setLoadingChat(true);
      setChatError(null);
      setActiveSessionId(sessionId);
      setActiveTitle(titleHint?.trim() || "Unterhaltung");
      setIsStreaming(false);
      setLiveStatus(null);
      setActiveTool(null);
      setPendingApproval(null);

      try {
        if (wsState === "connected") {
          const snapshot = await hermesWs.call<{
            session_id?: string;
            messages?: unknown[];
            running?: boolean;
            inflight?: { assistant?: string; streaming?: boolean } | null;
            pending_approval?: HermesPendingApproval | null;
          }>("session.resume", {
            session_id: sessionId,
            profile: profile.name,
          });
          const loaded = normalizeMessages(snapshot?.messages || []);
          if (snapshot?.inflight?.assistant) {
            loaded.push({
              id: "inflight",
              role: "assistant",
              content: snapshot.inflight.assistant,
              streaming: Boolean(snapshot.inflight.streaming || snapshot.running),
            });
          }
          setMessages(loaded);
          setIsStreaming(Boolean(snapshot?.running || snapshot?.inflight?.streaming));
          setPendingApproval(snapshot?.pending_approval || null);
        } else {
          const loaded = await fetchSessionMessages(sessionId, profile.name);
          setMessages(loaded);
        }
        scrollToBottom();
      } catch (err) {
        // Fallback to REST read if resume failed while offline/reconnecting
        try {
          const loaded = await fetchSessionMessages(sessionId, profile.name);
          setMessages(loaded);
        } catch {
          setChatError(
            err instanceof Error ? err.message : "Chatverlauf konnte nicht geladen werden."
          );
        }
      } finally {
        setLoadingChat(false);
      }
    },
    [profile.name, scrollToBottom, wsState]
  );

  const refreshSessionsList = useCallback(
    async (autoOpenFirst = false) => {
      try {
        const list = await fetchSessions(profile.name, 30);
        setSessions(list);
        if (autoOpenFirst) {
          if (list.length > 0) {
            await loadSessionHistory(list[0].id, list[0].title);
          } else {
            setActiveSessionId(null);
            setActiveTitle("Neuer Chat");
            setMessages([]);
            setLoadingChat(false);
          }
        }
      } catch (err) {
        setChatError(err instanceof Error ? err.message : "Sessions konnten nicht geladen werden.");
        setLoadingChat(false);
      }
    },
    [loadSessionHistory, profile.name]
  );

  useEffect(() => {
    void refreshSessionsList(true);
  }, [profile.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to real-time Hermes WebSocket events for the active session
  useEffect(() => {
    const unsubscribe = hermesWs.onEvent((ev) => {
      const currentSid = activeSessionRef.current;
      if (ev.sessionId && currentSid && ev.sessionId !== currentSid) {
        return;
      }

      if (ev.type === "message.start") {
        setIsStreaming(true);
        setLiveStatus(null);
        setMessages((prev) => {
          if (prev.length > 0 && prev[prev.length - 1].streaming) return prev;
          return [
            ...prev,
            {
              id: `stream-${Date.now()}`,
              role: "assistant",
              content: "",
              reasoning: "",
              streaming: true,
              timestamp: Date.now(),
            },
          ];
        });
        scrollToBottom();
      } else if (ev.type === "message.delta") {
        const chunk = typeof ev.payload.text === "string" ? ev.payload.text : "";
        if (!chunk) return;
        setIsStreaming(true);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            next[next.length - 1] = { ...last, content: last.content + chunk };
          } else {
            next.push({
              id: `stream-${Date.now()}`,
              role: "assistant",
              content: chunk,
              streaming: true,
              timestamp: Date.now(),
            });
          }
          return next;
        });
        scrollToBottom();
      } else if (ev.type === "reasoning.delta" || ev.type === "thinking.delta") {
        const chunk = typeof ev.payload.text === "string" ? ev.payload.text : "";
        if (!chunk) return;
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            next[next.length - 1] = {
              ...last,
              reasoning: (last.reasoning || "") + chunk,
            };
          } else {
            next.push({
              id: `stream-${Date.now()}`,
              role: "assistant",
              content: "",
              reasoning: chunk,
              streaming: true,
              timestamp: Date.now(),
            });
          }
          return next;
        });
      } else if (ev.type === "tool.start" || ev.type === "tool.progress") {
        const toolName =
          (typeof ev.payload.tool_name === "string" && ev.payload.tool_name) ||
          (typeof ev.payload.name === "string" && ev.payload.name) ||
          "Werkzeug";
        setActiveTool(toolName);
      } else if (ev.type === "tool.complete" || ev.type === "tool.end") {
        setActiveTool(null);
      } else if (ev.type === "status.update") {
        if (typeof ev.payload.text === "string" && ev.payload.text) {
          setLiveStatus(ev.payload.text);
        }
      } else if (ev.type === "message.complete") {
        const finalText = typeof ev.payload.text === "string" ? ev.payload.text : "";
        const finalReasoning =
          typeof ev.payload.reasoning === "string" ? ev.payload.reasoning : undefined;
        const errMsg = typeof ev.payload.error === "string" ? ev.payload.error : null;

        setIsStreaming(false);
        setActiveTool(null);
        setLiveStatus(null);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            next[next.length - 1] = {
              ...last,
              content: finalText || last.content,
              reasoning: finalReasoning ?? last.reasoning,
              streaming: false,
              error: errMsg,
            };
          } else if (finalText || errMsg) {
            next.push({
              id: `done-${Date.now()}`,
              role: "assistant",
              content: finalText,
              reasoning: finalReasoning,
              streaming: false,
              error: errMsg,
              timestamp: Date.now(),
            });
          }
          return next;
        });
        scrollToBottom();
      } else if (ev.type === "approval.requested") {
        setPendingApproval(ev.payload as HermesPendingApproval);
      } else if (ev.type === "approval.cancelled") {
        setPendingApproval(null);
      } else if (ev.type === "error") {
        setIsStreaming(false);
        setActiveTool(null);
        if (typeof ev.payload.message === "string") {
          setChatError(ev.payload.message);
        }
      }
    });

    return unsubscribe;
  }, [scrollToBottom]);

  async function startNewChat() {
    setShowSessionsSheet(false);
    setChatError(null);
    setActiveSessionId(null);
    setActiveTitle("Neuer Chat");
    setMessages([]);
    setIsStreaming(false);
    setPendingApproval(null);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text) return;
    if (wsState !== "connected") {
      setChatError("Keine Live-Verbindung zum Hermes-Gateway. Bitte kurz warten.");
      return;
    }

    setChatError(null);
    setInput("");

    let sid = activeSessionId;
    try {
      if (!sid) {
        const created = await hermesWs.call<{
          session_id: string;
          stored_session_id?: string;
        }>("session.create", {
          profile: profile.name,
          source: "hermes-pocket",
        });
        sid = created.session_id;
        setActiveSessionId(sid);
        setActiveTitle(text.slice(0, 48));
        void refreshSessionsList(false);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `u-${Date.now()}`,
          role: "user",
          content: text,
          timestamp: Date.now(),
        },
      ]);
      setIsStreaming(true);
      scrollToBottom();

      await hermesWs.call("prompt.submit", {
        session_id: sid,
        profile: profile.name,
        text,
      });
    } catch (err) {
      setIsStreaming(false);
      setChatError(err instanceof Error ? err.message : "Nachricht konnte nicht gesendet werden.");
    }
  }

  async function handleInterrupt() {
    if (!activeSessionId || wsState !== "connected") return;
    try {
      await hermesWs.call("session.interrupt", {
        session_id: activeSessionId,
        profile: profile.name,
      });
      setIsStreaming(false);
      setActiveTool(null);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Konnte Antwort nicht stoppen.");
    }
  }

  async function handleApprovalDecision(approved: boolean) {
    if (!activeSessionId || !pendingApproval) return;
    try {
      await hermesWs.call("approval.respond", {
        session_id: activeSessionId,
        profile: profile.name,
        approval_id: pendingApproval.approval_id || pendingApproval.id,
        approved,
        decision: approved ? "approve" : "deny",
      });
      setPendingApproval(null);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Freigabe konnte nicht übermittelt werden.");
    }
  }

  async function handleConfirmDeleteSession() {
    if (!sessionToDelete) return;
    setDeletingSession(true);
    try {
      await deleteSession(sessionToDelete.id, profile.name);
      const next = sessions.filter((s) => s.id !== sessionToDelete.id);
      setSessions(next);
      if (activeSessionId === sessionToDelete.id) {
        if (next.length > 0) {
          await loadSessionHistory(next[0].id, next[0].title);
        } else {
          await startNewChat();
        }
      }
      setSessionToDelete(null);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Chat konnte nicht gelöscht werden.");
    } finally {
      setDeletingSession(false);
    }
  }

  return (
    <div className="chat-screen">
      <header className="topbar">
        <div className="topbar-title-group">
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Zurück zu Bots"
            onClick={onBack}
            style={{ marginLeft: -6 }}
          >
            <ArrowLeft size={21} />
          </button>
          <div className="avatar sm" style={{ background: visual.gradient }}>
            {visual.initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="topbar-title">{visual.label}</h1>
            <div className="topbar-subtitle">
              {isStreaming
                ? activeTool
                  ? `Nutzt ${activeTool}…`
                  : "schreibt…"
                : activeTitle}
            </div>
          </div>
        </div>

        <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label="Chats wechseln"
            title="Chats wechseln"
            onClick={() => {
              void refreshSessionsList(false);
              setShowSessionsSheet(true);
            }}
          >
            <History size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Neuer Chat"
            title="Neuer Chat"
            onClick={() => void startNewChat()}
          >
            <MessageSquarePlus size={18} />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="chat-messages">
        {wsState !== "connected" && (
          <div className="notice warn">
            <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Gateway-Liveverbindung:{" "}
              {wsState === "connecting" ? "wird aufgebaut…" : "getrennt – verbinde neu…"}
            </span>
          </div>
        )}

        {chatError && (
          <div className="notice err">
            <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{chatError}</span>
          </div>
        )}

        {loadingChat ? (
          <div className="empty-state">
            <p>Lade Verlauf von {visual.label}…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 24 }}>
            <div
              className="avatar"
              style={{ background: visual.gradient, margin: "0 auto 12px" }}
            >
              {visual.initials}
            </div>
            <h3>Chat mit {visual.label}</h3>
            <p>
              {profile.description ||
                `Schreibe eine Nachricht, um eine neue Hermes-Session im Profil „${profile.name}“ zu starten.`}
            </p>
            {profile.model && <span className="pill">{profile.model}</span>}
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={String(msg.id ?? i)} className={`msg-row ${msg.role}`}>
              {msg.role === "assistant" && (
                <div className="msg-author">
                  <span>{visual.label}</span>
                  {msg.streaming && <span className="pulse-dot" />}
                </div>
              )}
              <div className="msg-bubble">
                {msg.reasoning && (
                  <details className="reasoning-box">
                    <summary>Gedankengang</summary>
                    <pre>{msg.reasoning}</pre>
                  </details>
                )}
                {msg.role === "tool" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                    <Wrench size={14} />
                    <span>{msg.tool_name || "Werkzeug"}</span>
                  </div>
                ) : msg.content ? (
                  <SafeMarkdown text={msg.content} />
                ) : msg.streaming ? (
                  <span style={{ color: "var(--text-muted)" }}>…</span>
                ) : null}
                {msg.error && (
                  <div style={{ marginTop: 8, color: "var(--status-err)", fontSize: "0.82rem" }}>
                    Fehler: {msg.error}
                  </div>
                )}
              </div>
              {msg.timestamp && (
                <div className="msg-time">{formatShortTime(msg.timestamp)}</div>
              )}
            </div>
          ))
        )}

        {(activeTool || liveStatus) && (
          <div style={{ alignSelf: "flex-start" }}>
            <span className="pill accent">
              <Wrench size={13} />
              {activeTool ? `Werkzeug aktiv: ${activeTool}` : liveStatus}
            </span>
          </div>
        )}

        {pendingApproval && (
          <div className="card" style={{ borderColor: "rgba(251,191,36,0.4)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, color: "var(--status-warn)", fontWeight: 700 }}>
              <ShieldAlert size={18} />
              <span>Freigabe angefordert</span>
            </div>
            <p style={{ margin: "0 0 12px", fontSize: "0.86rem", color: "var(--text-secondary)" }}>
              {pendingApproval.description ||
                pendingApproval.command ||
                pendingApproval.tool_name ||
                "Der Bot bittet um Erlaubnis für eine Aktion."}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn sm danger full"
                onClick={() => void handleApprovalDecision(false)}
              >
                <X size={15} /> Ablehnen
              </button>
              <button
                type="button"
                className="btn sm primary full"
                onClick={() => void handleApprovalDecision(true)}
              >
                <Check size={15} /> Freigeben
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="composer-wrap">
        <div className="composer-box">
          <textarea
            className="composer-input"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!isStreaming) void handleSend();
              }
            }}
            placeholder={`Nachricht an ${visual.label}…`}
          />
          {isStreaming ? (
            <button
              type="button"
              className="send-btn stop"
              aria-label="Antwort stoppen"
              onClick={() => void handleInterrupt()}
            >
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              className="send-btn"
              aria-label="Nachricht senden"
              disabled={!input.trim() || wsState !== "connected"}
              onClick={() => void handleSend()}
            >
              <ArrowUp size={19} />
            </button>
          )}
        </div>
      </div>

      {showSessionsSheet && (
        <div
          className="sheet-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSessionsSheet(false);
          }}
        >
          <div className="sheet">
            <div className="sheet-header">
              <h2 className="sheet-title">Chats mit {visual.label}</h2>
              <button
                type="button"
                className="icon-btn ghost"
                aria-label="Schließen"
                onClick={() => setShowSessionsSheet(false)}
              >
                <X size={20} />
              </button>
            </div>

            <button
              type="button"
              className="btn primary full"
              style={{ marginBottom: 12 }}
              onClick={() => void startNewChat()}
            >
              <MessageSquarePlus size={17} /> Neuen Chat starten
            </button>

            {sessions.length === 0 ? (
              <div className="empty-state">
                <p>Noch keine gespeicherten Chats für {visual.label}.</p>
              </div>
            ) : (
              <div className="card-stack">
                {sessions.map((s) => {
                  const isCurrent = s.id === activeSessionId;
                  return (
                    <div
                      key={s.id}
                      className="card"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 12px",
                        borderColor: isCurrent ? "rgba(245,158,11,0.45)" : undefined,
                      }}
                    >
                      <button
                        type="button"
                        style={{ flex: 1, textAlign: "left", minWidth: 0 }}
                        onClick={() => {
                          setShowSessionsSheet(false);
                          void loadSessionHistory(s.id, s.title);
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: "0.9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {s.title?.trim() || `Chat ${s.id.slice(0, 8)}`}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>
                          {s.message_count ? `${s.message_count} Nachrichten` : "Session"}
                          {s.last_active ? ` · ${formatRelativeTime(s.last_active)}` : ""}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="icon-btn ghost"
                        aria-label="Chat löschen"
                        onClick={() => setSessionToDelete(s)}
                      >
                        <Trash2 size={16} style={{ color: "var(--text-muted)" }} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmSheet
        open={Boolean(sessionToDelete)}
        title="Chat wirklich löschen?"
        description={`Die Unterhaltung „${sessionToDelete?.title || sessionToDelete?.id || ""}“ wird dauerhaft aus Hermes entfernt.`}
        confirmLabel="Löschen"
        danger
        busy={deletingSession}
        onCancel={() => setSessionToDelete(null)}
        onConfirm={() => void handleConfirmDeleteSession()}
      />
    </div>
  );
};
