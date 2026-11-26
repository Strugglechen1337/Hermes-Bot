import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  Camera,
  Check,
  ChevronRight,
  ExternalLink,
  History,
  Link2,
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
  HermesConnectionRequest,
  HermesPendingApproval,
  HermesProfile,
  HermesSessionSummary,
} from "../../shared/types";
import { clearBotAvatar, prepareAvatarDataUrl, saveBotAvatar } from "../lib/avatarStore";
import { getBotVisual } from "../lib/botTheme";
import { formatRelativeTime, formatShortTime } from "../lib/format";
import {
  deleteSession,
  fetchSessionMessages,
  fetchSessions,
  normalizeMessages,
} from "../lib/hermesApi";
import { hermesWs, type WsConnectionState } from "../lib/hermesWs";
import { BotAvatar } from "./BotAvatar";
import { ConfirmSheet } from "./ConfirmSheet";
import { SafeMarkdown } from "./SafeMarkdown";

interface BotsViewProps {
  profiles: HermesProfile[];
  avatars: Record<string, string>;
  loading: boolean;
  error: string | null;
  wsState: WsConnectionState;
  selectedBotName: string | null;
  onSelectBot: (name: string | null) => void;
  onRefreshProfiles: () => void;
  onAvatarChange: (profileName: string, dataUrl: string | null) => void;
}

export const BotsView: React.FC<BotsViewProps> = ({
  profiles,
  avatars,
  loading,
  error,
  wsState,
  selectedBotName,
  onSelectBot,
  onRefreshProfiles,
  onAvatarChange,
}) => {
  const [query, setQuery] = useState("");
  const [recentByProfile, setRecentByProfile] = useState<Record<string, HermesSessionSummary>>({});
  const [avatarSheetProfile, setAvatarSheetProfile] = useState<HermesProfile | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !avatarSheetProfile) return;
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const dataUrl = await prepareAvatarDataUrl(file, 320);
      await saveBotAvatar(avatarSheetProfile.name, dataUrl);
      onAvatarChange(avatarSheetProfile.name, dataUrl);
      setAvatarSheetProfile(null);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Profilbild konnte nicht gespeichert werden.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleClearAvatar() {
    if (!avatarSheetProfile) return;
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      await clearBotAvatar(avatarSheetProfile.name);
      onAvatarChange(avatarSheetProfile.name, null);
      setAvatarSheetProfile(null);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Profilbild konnte nicht entfernt werden.");
    } finally {
      setAvatarBusy(false);
    }
  }

  if (selectedProfile) {
    return (
      <DirectChatView
        profile={selectedProfile}
        avatarUrl={avatars[selectedProfile.name] || null}
        wsState={wsState}
        onBack={() => onSelectBot(null)}
        onOpenAvatarPicker={() => {
          setAvatarError(null);
          setAvatarSheetProfile(selectedProfile);
        }}
      />
    );
  }

  return (
    <div>
      <div style={{ position: "relative", marginBottom: 14 }}>
        <Search
          size={15}
          style={{
            position: "absolute",
            left: 14,
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
          placeholder="Bots suchen…"
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
        <h2 className="section-title">Deine Bots ({filteredProfiles.length})</h2>
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
          <p>Lade Hermes-Profile…</p>
        </div>
      ) : filteredProfiles.length === 0 ? (
        <div className="empty-state">
          <h3>Keine Bots gefunden</h3>
          <p>
            {query
              ? `Kein Hermes-Profil passt zu „${query}“.`
              : "Auf dem Hermes-Server wurden keine Profile gefunden."}
          </p>
        </div>
      ) : (
        <div className="card-stack">
          {filteredProfiles.map((profile) => {
            const visual = getBotVisual(profile);
            const recent = recentByProfile[profile.name];
            return (
              <div key={profile.name} className="bot-row">
                <button
                  type="button"
                  className="avatar-edit-btn"
                  aria-label={`Profilbild von ${visual.label} ändern`}
                  title="Profilbild ändern"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAvatarError(null);
                    setAvatarSheetProfile(profile);
                  }}
                >
                  <BotAvatar
                    visual={visual}
                    imageUrl={avatars[profile.name]}
                    online={profile.gateway_running}
                    showStatus
                  />
                  <span className="avatar-camera-badge">
                    <Camera size={11} />
                  </span>
                </button>

                <button
                  type="button"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                  onClick={() => onSelectBot(profile.name)}
                >
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
                        <span className="mini-tag">E-Mail</span>
                      )}
                      {!profile.gateway_running && (
                        <span className="mini-tag" style={{ color: "var(--status-warn)" }}>
                          Offline
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={17} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Hidden native image picker for iPhone Photo Library / Camera */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => void handleFileSelected(e)}
      />

      {avatarSheetProfile && (
        <div
          className="sheet-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !avatarBusy) setAvatarSheetProfile(null);
          }}
        >
          <div className="sheet">
            <div className="sheet-header">
              <h2 className="sheet-title">
                Profilbild: {getBotVisual(avatarSheetProfile).label}
              </h2>
              <button
                type="button"
                className="icon-btn ghost"
                aria-label="Schließen"
                disabled={avatarBusy}
                onClick={() => setAvatarSheetProfile(null)}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, margin: "8px 0 18px" }}>
              <BotAvatar
                visual={getBotVisual(avatarSheetProfile)}
                imageUrl={avatars[avatarSheetProfile.name]}
                size="lg"
              />
              <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", textAlign: "center" }}>
                Wird direkt im Hermes-Profil gespeichert und ist geräteübergreifend sichtbar.
              </div>
            </div>

            {avatarError && (
              <div className="notice err" style={{ marginBottom: 12 }}>
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{avatarError}</span>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                className="btn primary full"
                disabled={avatarBusy || wsState !== "connected"}
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera size={16} />
                {avatarBusy ? "Speichere Bild…" : "Foto aus Mediathek / Kamera wählen"}
              </button>

              {avatars[avatarSheetProfile.name] && (
                <button
                  type="button"
                  className="btn danger full"
                  disabled={avatarBusy || wsState !== "connected"}
                  onClick={() => void handleClearAvatar()}
                >
                  <Trash2 size={15} /> Profilbild entfernen
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Direct 1:1 Bot Chat Screen ────────────────────────────────────────────────

interface DirectChatViewProps {
  profile: HermesProfile;
  avatarUrl: string | null;
  wsState: WsConnectionState;
  onBack: () => void;
  onOpenAvatarPicker: () => void;
}

const DirectChatView: React.FC<DirectChatViewProps> = ({
  profile,
  avatarUrl,
  wsState,
  onBack,
  onOpenAvatarPicker,
}) => {
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
  const [pendingConnection, setPendingConnection] = useState<HermesConnectionRequest | null>(null);

  const [showSessionsSheet, setShowSessionsSheet] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<HermesSessionSummary | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const attachedOnWsRef = useRef<boolean>(false);
  const execGenerationRef = useRef<number>(0);

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
      setPendingConnection(null);
      attachedOnWsRef.current = false;

      try {
        if (wsState === "connected") {
          const snapshot = await hermesWs.call<{
            session_id?: string;
            messages?: unknown[];
            running?: boolean;
            execution_generation?: number;
            inflight?: { assistant?: string; streaming?: boolean } | null;
            pending_approval?: HermesPendingApproval | null;
            prompts?: HermesPendingApproval[];
            pending_connection?: HermesConnectionRequest | null;
          }>("session.resume", {
            session_id: sessionId,
            profile: profile.name,
          });
          if (snapshot?.session_id) {
            setActiveSessionId(snapshot.session_id);
          }
          if (typeof snapshot?.execution_generation === "number") {
            execGenerationRef.current = snapshot.execution_generation;
          }
          attachedOnWsRef.current = true;
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
          setPendingApproval(snapshot?.pending_approval || snapshot?.prompts?.[0] || null);
          setPendingConnection(snapshot?.pending_connection || null);
        } else {
          const loaded = await fetchSessionMessages(sessionId, profile.name);
          setMessages(loaded);
        }
        scrollToBottom();
      } catch (err) {
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
            attachedOnWsRef.current = false;
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

  // Re-attach current session automatically once WS finishes connecting
  useEffect(() => {
    if (wsState === "connected" && activeSessionId && !attachedOnWsRef.current) {
      void loadSessionHistory(activeSessionId, activeTitle);
    }
  }, [wsState]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unsubscribe = hermesWs.onEvent((ev) => {
      const currentSid = activeSessionRef.current;
      if (ev.sessionId && currentSid && ev.sessionId !== currentSid) {
        return;
      }

      if (typeof ev.payload.execution_generation === "number") {
        execGenerationRef.current = ev.payload.execution_generation;
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
        scrollToBottom();
      } else if (ev.type === "approval.cancelled") {
        setPendingApproval(null);
      } else if (ev.type === "connection.request" || ev.type === "connection.update") {
        const req = ev.payload as unknown as HermesConnectionRequest;
        if (req?.settled) {
          setPendingConnection(null);
        } else if (req?.targets) {
          setPendingConnection(req);
          scrollToBottom();
        }
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

  function autoResizeInput(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(120, el.scrollHeight)}px`;
  }

  async function startNewChat() {
    setShowSessionsSheet(false);
    setChatError(null);
    setActiveSessionId(null);
    setActiveTitle("Neuer Chat");
    setMessages([]);
    setIsStreaming(false);
    setPendingApproval(null);
    setPendingConnection(null);
    attachedOnWsRef.current = false;
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
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    let sid = activeSessionId;
    try {
      if (!sid) {
        // Canonical Hermes v0.23.4 accepts source in {'cli','tui','gui','acp','tool','oneshot'}
        const created = await hermesWs.call<{
          session_id: string;
          stored_session_id?: string;
          execution_generation?: number;
        }>("session.create", {
          profile: profile.name,
          source: "gui",
        });
        sid = created.session_id;
        if (typeof created.execution_generation === "number") {
          execGenerationRef.current = created.execution_generation;
        }
        attachedOnWsRef.current = true;
        setActiveSessionId(sid);
        setActiveTitle(text.slice(0, 48));
        void refreshSessionsList(false);
      } else if (!attachedOnWsRef.current) {
        const resumed = await hermesWs.call<{
          session_id?: string;
          execution_generation?: number;
        }>("session.resume", {
          session_id: sid,
          profile: profile.name,
          omit_messages: true,
        });
        if (resumed?.session_id) sid = resumed.session_id;
        if (typeof resumed?.execution_generation === "number") {
          execGenerationRef.current = resumed.execution_generation;
        }
        attachedOnWsRef.current = true;
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
        execution_generation: execGenerationRef.current,
      });
      setIsStreaming(false);
      setActiveTool(null);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Konnte Antwort nicht stoppen.");
    }
  }

  async function handleApprovalDecision(choice: string) {
    if (!activeSessionId || !pendingApproval) return;
    const promptId =
      pendingApproval.prompt_id ||
      pendingApproval.request_id ||
      pendingApproval.approval_id ||
      pendingApproval.id;
    try {
      await hermesWs.call("approval.respond", {
        session_id: activeSessionId,
        profile: profile.name,
        execution_generation:
          pendingApproval.execution_generation ?? execGenerationRef.current,
        prompt_id: promptId,
        choice,
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
          <button
            type="button"
            className="avatar-edit-btn"
            aria-label="Profilbild ändern"
            onClick={onOpenAvatarPicker}
          >
            <BotAvatar visual={visual} imageUrl={avatarUrl} size="sm" />
          </button>
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
            <History size={17} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Neuer Chat"
            title="Neuer Chat"
            onClick={() => void startNewChat()}
          >
            <MessageSquarePlus size={17} />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="chat-messages">
        {wsState !== "connected" && (
          <div className="notice warn">
            <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Gateway-Verbindung:{" "}
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
          <div className="empty-state" style={{ marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
              <BotAvatar visual={visual} imageUrl={avatarUrl} size="lg" />
            </div>
            <h3>{visual.label}</h3>
            <p>
              {profile.description ||
                `Starte eine Unterhaltung mit ${visual.label}.`}
            </p>
            {profile.model && <span className="pill">{profile.model}</span>}
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={String(msg.id ?? i)} className={`msg-row ${msg.role}`}>
              {msg.role === "assistant" && (
                <div className="msg-author">
                  <BotAvatar visual={visual} imageUrl={avatarUrl} size="xs" />
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                    <Wrench size={13} />
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
              {activeTool ? `${activeTool}…` : liveStatus}
            </span>
          </div>
        )}

        {pendingConnection && pendingConnection.targets.length > 0 && (
          <div className="card" style={{ borderColor: "rgba(165, 180, 252, 0.35)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontWeight: 700 }}>
              <Link2 size={17} style={{ color: "var(--accent-indigo)" }} />
              <span>Connector verbinden</span>
            </div>
            <div className="card-stack">
              {pendingConnection.targets.map((target) => (
                <div key={target.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                      {target.display || target.name}
                    </div>
                    {(target.instructions || target.detail) && (
                      <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                        {target.instructions || target.detail}
                      </div>
                    )}
                  </div>
                  {target.connect_url ? (
                    <a
                      href={target.connect_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn sm primary"
                      style={{ textDecoration: "none" }}
                    >
                      Öffnen <ExternalLink size={13} />
                    </a>
                  ) : (
                    <span className="pill">{target.state}</span>
                  )}
                </div>
              ))}
            </div>
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
                onClick={() => void handleApprovalDecision(pendingApproval.choices?.[1] || "deny")}
              >
                <X size={15} /> Ablehnen
              </button>
              <button
                type="button"
                className="btn sm primary full"
                onClick={() => void handleApprovalDecision(pendingApproval.choices?.[0] || "once")}
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
            ref={textareaRef}
            className="composer-input"
            rows={1}
            value={input}
            onFocus={() => {
              // Keep the newest messages visible right above the iOS keyboard
              setTimeout(scrollToBottom, 160);
            }}
            onChange={(e) => {
              setInput(e.target.value);
              autoResizeInput(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!isStreaming) void handleSend();
              }
            }}
            placeholder={`Frag ${visual.label}…`}
          />
          {isStreaming ? (
            <button
              type="button"
              className="send-btn stop"
              aria-label="Antwort stoppen"
              onClick={() => void handleInterrupt()}
            >
              <Square size={14} fill="currentColor" />
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
                        borderColor: isCurrent ? "rgba(255,255,255,0.4)" : undefined,
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
