import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Mic,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Reply,
  Share2,
  Square,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type {
  HermesGroupsCapabilities,
  HermesProfile,
  HermesRoom,
  HermesRoomContext,
  HermesRoomEvent,
  HermesRoomMemberActivity,
  HermesRoomState,
} from "../../shared/types";
import { buildGroupMembersPayload } from "../lib/botCollaboration";
import { getBotVisual, getProfileAvatarByName } from "../lib/botTheme";
import { formatRelativeTime, formatShortTime, randomClientId, toTimestampMs } from "../lib/format";
import { hermesWs, type WsConnectionState } from "../lib/hermesWs";
import { isSpeechDictationSupported, speechDictation } from "../lib/speechDictation";
import {
  extractPocketPages,
  stripSecretRequestTag,
  type DetectedPocketPage,
} from "../lib/secretDetection";
import type { GroupUnreadInfo } from "../lib/unreadStore";
import { BotAvatar } from "./BotAvatar";
import { ConfirmSheet } from "./ConfirmSheet";
import { PocketPageCard, PocketPageViewer } from "./InChatPromptCards";
import { SafeMarkdown } from "./SafeMarkdown";
import { Sheet } from "./Sheet";

interface GroupsViewProps {
  profiles: HermesProfile[];
  avatars: Record<string, string>;
  unreadByGroup?: Record<string, GroupUnreadInfo>;
  wsState: WsConnectionState;
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string | null) => void;
  onMarkGroupRead?: (roomId: string, latestSeq?: number, updatedAtMs?: number) => void;
}

export const GroupsView: React.FC<GroupsViewProps> = ({
  profiles,
  avatars,
  unreadByGroup = {},
  wsState,
  selectedRoomId,
  onSelectRoom,
  onMarkGroupRead,
}) => {
  const [rooms, setRooms] = useState<HermesRoom[]>([]);
  const [capabilities, setCapabilities] = useState<HermesGroupsCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateSheet, setShowCreateSheet] = useState(false);

  // Create group form state
  const [newName, setNewName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [newPurpose, setNewPurpose] = useState("");
  const [newRouting, setNewRouting] = useState<"auto" | "everyone" | "lead">("auto");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadRooms = useCallback(async () => {
    if (wsState !== "connected") {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [caps, listRes] = await Promise.all([
        hermesWs.call<HermesGroupsCapabilities>("groups.capabilities", {}).catch(() => null),
        hermesWs.call<{ rooms?: HermesRoom[] }>("groups.list", {
          include_disbanded: false,
          limit: 50,
        }),
      ]);
      if (caps) setCapabilities(caps);
      setRooms(Array.isArray(listRes?.rooms) ? listRes.rooms : []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gruppenräume konnten nicht geladen werden."
      );
    } finally {
      setLoading(false);
    }
  }, [wsState]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    return hermesWs.onEvent((ev) => {
      if (ev.type === "groups.changed") {
        void loadRooms();
      }
    });
  }, [loadRooms]);

  const seatableProfiles = useMemo(() => {
    if (capabilities?.seatable_profiles && capabilities.seatable_profiles.length > 0) {
      const allowed = new Set(capabilities.seatable_profiles);
      const matched = profiles.filter((p) => allowed.has(p.name));
      if (matched.length > 0) return matched;
    }
    return profiles;
  }, [capabilities, profiles]);

  const selectedRoom = useMemo(
    () => rooms.find((r) => r.room_id === selectedRoomId) || null,
    [rooms, selectedRoomId]
  );

  function toggleMember(name: string) {
    setSelectedMembers((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]
    );
  }

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) {
      setCreateError("Bitte einen Gruppennamen eingeben.");
      return;
    }
    if (selectedMembers.length < 2) {
      setCreateError("Bitte mindestens 2 Hermes-Bots auswählen.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const roomId = randomClientId("room");
      const members = buildGroupMembersPayload(selectedMembers, profiles);
      const res = await hermesWs.call<{ room: HermesRoom }>("groups.create", {
        room_id: roomId,
        name: newName.trim(),
        members,
      });

      if (newPurpose.trim() || newRouting !== "auto") {
        await hermesWs
          .call("groups.context", {
            room_id: res.room.room_id,
            event_id: randomClientId("ctx"),
            purpose: newPurpose.trim(),
            notes: "",
            routing: newRouting,
            ...(newRouting === "lead" && members[0]?.member_id
              ? { lead_member_id: members[0].member_id }
              : {}),
          })
          .catch(() => {
            // Optional context setup
          });
      }

      setShowCreateSheet(false);
      setNewName("");
      setSelectedMembers([]);
      setNewPurpose("");
      setNewRouting("auto");
      await loadRooms();
      onSelectRoom(res.room.room_id);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Gruppe konnte nicht erstellt werden."
      );
    } finally {
      setCreating(false);
    }
  }

  if (selectedRoom) {
    return (
      <GroupRoomView
        room={selectedRoom}
        profiles={profiles}
        avatars={avatars}
        wsState={wsState}
        onMarkGroupRead={onMarkGroupRead}
        onBack={() => {
          onSelectRoom(null);
          void loadRooms();
        }}
        onDisbanded={() => {
          onSelectRoom(null);
          void loadRooms();
        }}
      />
    );
  }

  return (
    <div>
      {wsState !== "connected" && (
        <div className="notice warn" style={{ marginBottom: 12 }}>
          <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            Gruppenchats nutzen das Hermes-Gateway über WebSocket. Verbindung:{" "}
            {wsState === "connecting" ? "wird aufgebaut…" : "getrennt"}.
          </span>
        </div>
      )}

      {error && (
        <div className="notice err" style={{ marginBottom: 12 }}>
          <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div>{error}</div>
            <button
              type="button"
              className="btn sm"
              style={{ marginTop: 8 }}
              onClick={() => void loadRooms()}
            >
              <RefreshCw size={14} /> Erneut laden
            </button>
          </div>
        </div>
      )}

      <div className="section-header">
        <h2 className="section-title">Gruppenchats ({rooms.length})</h2>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Gruppen aktualisieren"
            style={{ minWidth: 34, minHeight: 34 }}
            onClick={() => void loadRooms()}
          >
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            className="btn sm primary"
            disabled={wsState !== "connected"}
            onClick={() => {
              setCreateError(null);
              setShowCreateSheet(true);
            }}
          >
            <Plus size={15} /> Neue Gruppe
          </button>
        </div>
      </div>

      {loading && rooms.length === 0 ? (
        <div className="empty-state">
          <p>Lade Gruppenräume vom Hermes-Gateway…</p>
        </div>
      ) : rooms.length === 0 ? (
        <div className="empty-state">
          <Users size={30} style={{ color: "var(--accent-indigo)" }} />
          <h3>Noch keine Gruppenchats</h3>
          <p>
            Erstelle eine Gruppe aus mehreren Hermes-Bots (z. B. Mika + Recherche + Entwickler),
            damit sie gemeinsam an Aufgaben arbeiten können.
          </p>
          <button
            type="button"
            className="btn primary"
            disabled={wsState !== "connected"}
            onClick={() => setShowCreateSheet(true)}
          >
            <Plus size={16} /> Erste Gruppe erstellen
          </button>
        </div>
      ) : (
        <div className="card-stack">
          {rooms.map((room) => {
            const unread = unreadByGroup[room.room_id];
            return (
              <button
                key={room.room_id}
                type="button"
                className={`bot-card ${unread ? "has-unread-card" : ""}`}
                onClick={() => {
                  onMarkGroupRead?.(
                    room.room_id,
                    typeof room.latest_seq === "number" ? room.latest_seq : undefined,
                    toTimestampMs(room.updated_at) ?? Date.now()
                  );
                  onSelectRoom(room.room_id);
                }}
              >
                <div
                  className="avatar"
                  style={{ background: "linear-gradient(135deg, #6366f1 0%, #f59e0b 100%)" }}
                >
                  <Users size={20} color="#090b10" />
                </div>
                <div className="bot-card-body">
                  <div className="bot-card-row">
                    <span className="bot-card-name">{room.name}</span>
                    <div className="bot-list-right-meta">
                      <span
                        className={`bot-list-time ${unread ? "unread" : ""}`}
                      >
                        {formatRelativeTime(room.updated_at)}
                      </span>
                      {unread && (
                        <span
                          className="unread-badge"
                          aria-label="Neue Nachrichten in dieser Gruppe"
                        >
                          Neu
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="bot-card-meta">
                    {room.members
                      .map((m) => m.display_name || m.profile || m.member_id || "Bot")
                      .join(" · ")}
                  </div>
                  <div className="bot-card-tags">
                    <span className="mini-tag">{room.members.length} Bots</span>
                    {typeof room.latest_seq === "number" && (
                      <span className="mini-tag">{room.latest_seq} Ereignisse</span>
                    )}
                  </div>
                </div>
                <ChevronRight size={18} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      )}

      <Sheet
        open={showCreateSheet}
        onClose={() => {
          if (!creating) setShowCreateSheet(false);
        }}
      >
        <div className="sheet-header">
          <h2 className="sheet-title">Neue Bot-Gruppe</h2>
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Schließen"
            disabled={creating}
            onClick={() => setShowCreateSheet(false)}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleCreateGroup}>
          <div className="field">
            <label htmlFor="grp-name">Gruppenname</label>
            <input
              id="grp-name"
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="z. B. Morgen-Briefing oder Projektteam"
              required
            />
          </div>

          <div className="field">
            <label>Teilnehmende Bots (mind. 2)</label>
            <div className="chip-row">
              {seatableProfiles.map((p) => {
                const vis = getBotVisual(p);
                const picked = selectedMembers.includes(p.name);
                return (
                  <button
                    key={p.name}
                    type="button"
                    className={`chip ${picked ? "selected" : ""}`}
                    onClick={() => toggleMember(p.name)}
                  >
                    <BotAvatar visual={vis} imageUrl={avatars[p.name]} size="xs" />
                    {vis.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="field">
            <label htmlFor="grp-routing">Zusammenarbeits-Modus</label>
            <select
              id="grp-routing"
              className="select"
              value={newRouting}
              onChange={(e) =>
                setNewRouting(e.target.value as "auto" | "everyone" | "lead")
              }
            >
              <option value="auto">Automatisch (passende Bots antworten)</option>
              <option value="everyone">Alle Bots antworten nacheinander</option>
              <option value="lead">Lead-Bot koordiniert die Runde</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="grp-purpose">Ziel / Kontext (optional)</label>
            <textarea
              id="grp-purpose"
              className="textarea"
              value={newPurpose}
              onChange={(e) => setNewPurpose(e.target.value)}
              placeholder="Woran soll diese Gruppe gemeinsam arbeiten?"
            />
          </div>

          {createError && (
            <div className="notice err" style={{ marginBottom: 12 }}>
              <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{createError}</span>
            </div>
          )}

          <button type="submit" className="btn primary full" disabled={creating}>
            {creating ? "Erstelle Gruppe…" : "Gruppe erstellen"}
          </button>
        </form>
      </Sheet>
    </div>
  );
};

// ── Active Group Room View ────────────────────────────────────────────────────

interface GroupRoomViewProps {
  room: HermesRoom;
  profiles: HermesProfile[];
  avatars: Record<string, string>;
  wsState: WsConnectionState;
  onMarkGroupRead?: (roomId: string, latestSeq?: number, updatedAtMs?: number) => void;
  onBack: () => void;
  onDisbanded: () => void;
}

const GroupRoomView: React.FC<GroupRoomViewProps> = ({
  room,
  profiles,
  avatars,
  wsState,
  onMarkGroupRead,
  onBack,
  onDisbanded,
}) => {
  const [events, setEvents] = useState<HermesRoomEvent[]>([]);
  const [roomState, setRoomState] = useState<HermesRoomState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const [showContextSheet, setShowContextSheet] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const [routing, setRouting] = useState<"auto" | "everyone" | "lead">("auto");
  const [savingContext, setSavingContext] = useState(false);
  const [confirmDisband, setConfirmDisband] = useState(false);
  const [disbanding, setDisbanding] = useState(false);
  const [openPocketPage, setOpenPocketPage] = useState<DetectedPocketPage | null>(null);
  const [replyTo, setReplyTo] = useState<{ author: string; excerpt: string } | null>(null);
  const [contextMsg, setContextMsg] = useState<{ author: string; text: string } | null>(null);
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const cursorRef = useRef<number>(0);
  const scrollTimersRef = useRef<number[]>([]);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  const stopDictation = useCallback(() => {
    speechDictation.stop();
    setDictating(false);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  const startLongPress = useCallback(
    (e: React.TouchEvent, author: string, text: string) => {
      if (e.touches.length !== 1 || !text.trim()) return;
      cancelLongPress();
      const t = e.touches[0];
      longPressStartRef.current = { x: t.clientX, y: t.clientY };
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        longPressStartRef.current = null;
        try {
          navigator.vibrate?.(12);
        } catch {
          // ignore
        }
        setContextMsg({ author, text });
      }, 420);
    },
    [cancelLongPress]
  );

  const moveLongPress = useCallback(
    (e: React.TouchEvent) => {
      const start = longPressStartRef.current;
      if (!start || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - start.x) > 10 || Math.abs(t.clientY - start.y) > 10) {
        cancelLongPress();
      }
    },
    [cancelLongPress]
  );

  const handleToggleDictation = useCallback(() => {
    if (dictating) {
      stopDictation();
      return;
    }
    if (!isSpeechDictationSupported()) {
      setError("Spracheingabe wird in diesem Browser leider nicht unterstützt.");
      return;
    }
    speechDictation.start({
      baseText: input,
      onTranscript: (fullText) => setInput(fullText),
      onStateChange: (active) => setDictating(active),
      onError: (msg) => setError(msg),
    });
  }, [dictating, input, stopDictation]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);

  const scrollToBottomWithSettle = useCallback(() => {
    for (const id of scrollTimersRef.current) window.clearTimeout(id);
    scrollTimersRef.current = [];
    scrollToBottom();
    for (const delay of [60, 180, 340]) {
      scrollTimersRef.current.push(window.setTimeout(scrollToBottom, delay));
    }
  }, [scrollToBottom]);

  useEffect(() => {
    const onViewportChange = (ev: Event) => {
      const detail = (ev as CustomEvent<{ keyboardOpen?: boolean }>).detail;
      if (detail?.keyboardOpen) {
        scrollToBottomWithSettle();
      }
    };
    window.addEventListener("hp:viewport-change", onViewportChange);
    return () => {
      window.removeEventListener("hp:viewport-change", onViewportChange);
      for (const id of scrollTimersRef.current) window.clearTimeout(id);
      scrollTimersRef.current = [];
    };
  }, [scrollToBottomWithSettle]);

  const syncRoom = useCallback(
    async (incremental = false) => {
      if (wsState !== "connected") return;
      try {
        const [stateRes, logRes] = await Promise.all([
          hermesWs.call<HermesRoomState>("groups.state", { room_id: room.room_id }),
          hermesWs.call<{
            events: HermesRoomEvent[];
            cursor: number;
            latest_seq: number;
          }>("groups.log", {
            room_id: room.room_id,
            since_seq: incremental ? cursorRef.current : 0,
            limit: 120,
          }),
        ]);

        setRoomState(stateRes);
        const ctx: HermesRoomContext | null | undefined = stateRes?.context;
        if (!incremental && ctx) {
          setPurpose(ctx.purpose || "");
          setNotes(ctx.notes || "");
          if (ctx.routing) setRouting(ctx.routing);
        }

        const incoming = Array.isArray(logRes?.events) ? logRes.events : [];
        if (incremental && incoming.length > 0) {
          setEvents((prev) => {
            const seen = new Set(prev.map((e) => e.event_id));
            const merged = [...prev];
            for (const ev of incoming) {
              if (!seen.has(ev.event_id)) merged.push(ev);
            }
            return merged.sort((a, b) => a.seq - b.seq);
          });
          scrollToBottom();
        } else if (!incremental) {
          setEvents(incoming);
          scrollToBottom();
        }
        if (typeof logRes?.cursor === "number") {
          cursorRef.current = Math.max(cursorRef.current, logRes.cursor);
        }
        const latestSeq = Math.max(
          typeof logRes?.latest_seq === "number" ? logRes.latest_seq : 0,
          typeof stateRes?.latest_seq === "number" ? stateRes.latest_seq : 0,
          cursorRef.current
        );
        onMarkGroupRead?.(room.room_id, latestSeq, Date.now());
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Gruppenverlauf konnte nicht synchronisiert werden."
        );
      } finally {
        setLoading(false);
      }
    },
    [onMarkGroupRead, room.room_id, scrollToBottom, wsState]
  );

  useEffect(() => {
    cursorRef.current = 0;
    setLoading(true);
    void syncRoom(false);
  }, [syncRoom]);

  useEffect(() => {
    return hermesWs.onEvent((ev) => {
      if (ev.type === "groups.changed") {
        void syncRoom(true);
      }
    });
  }, [syncRoom]);

  const activities: HermesRoomMemberActivity[] = useMemo(() => {
    const raw =
      roomState?.driver_status?.member_activity ||
      roomState?.activities ||
      roomState?.active_members ||
      [];
    return Array.isArray(raw) ? raw : [];
  }, [roomState]);

  const anyBotBusy =
    Boolean(roomState?.driver_status?.working) ||
    activities.some((a) => a.status === "running" || a.status === "queued");

  // Backstop poll while bots are actively discussing so replies appear immediately
  useEffect(() => {
    if (!anyBotBusy || wsState !== "connected") return;
    const timer = window.setInterval(() => {
      void syncRoom(true);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [anyBotBusy, syncRoom, wsState]);

  async function handleSend() {
    stopDictation();
    const rawText = (textareaRef.current?.value ?? input).trim();
    if (!rawText || wsState !== "connected") return;
    const text = replyTo ? `> ${replyTo.author}: ${replyTo.excerpt}\n\n${rawText}` : rawText;
    setSending(true);
    setError(null);
    setInput("");
    setReplyTo(null);
    if (textareaRef.current) {
      textareaRef.current.value = "";
    }
    window.setTimeout(() => {
      setInput((cur) => (cur.trim() === rawText ? "" : cur));
    }, 90);
    try {
      await hermesWs.call("groups.send", {
        room_id: room.room_id,
        event_id: randomClientId("msg"),
        payload: {
          text,
          thread_id: room.room_id,
        },
      });
      await syncRoom(true);
    } catch (err) {
      setInput(rawText);
      setError(err instanceof Error ? err.message : "Gruppennachricht fehlgeschlagen.");
    } finally {
      setSending(false);
    }
  }

  async function handleStopRoom() {
    try {
      await hermesWs.call("groups.stop", { room_id: room.room_id });
      await syncRoom(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Konnte Bot-Runde nicht stoppen.");
    }
  }

  async function handleSaveContext(e: React.FormEvent) {
    e.preventDefault();
    setSavingContext(true);
    try {
      const leadId = room.members[0]?.member_id || room.members[0]?.handle || undefined;
      await hermesWs.call("groups.context", {
        room_id: room.room_id,
        event_id: randomClientId("ctx"),
        purpose: purpose.trim(),
        notes: notes.trim(),
        routing,
        ...(routing === "lead" && leadId ? { lead_member_id: leadId } : {}),
      });
      setShowContextSheet(false);
      await syncRoom(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gruppenkontext konnte nicht gespeichert werden.");
    } finally {
      setSavingContext(false);
    }
  }

  async function handleDisbandRoom() {
    setDisbanding(true);
    try {
      await hermesWs.call("groups.disband", {
        room_id: room.room_id,
        cancel_id: randomClientId("disband"),
      });
      setConfirmDisband(false);
      onDisbanded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gruppe konnte nicht aufgelöst werden.");
    } finally {
      setDisbanding(false);
    }
  }

  const visibleEvents = useMemo(
    () =>
      events.filter(
        (ev) =>
          ev.kind === "message.user" ||
          ev.kind === "message.member" ||
          ev.kind === "room.context_set" ||
          ev.kind === "turn.failed" ||
          ev.kind === "member.unavailable"
      ),
    [events]
  );

  return (
    <div
      className="chat-screen"
      onTouchStart={(e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        swipeStartRef.current = t.clientX <= 28 ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={(e) => {
        const start = swipeStartRef.current;
        swipeStartRef.current = null;
        if (!start || e.changedTouches.length !== 1) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = Math.abs(t.clientY - start.y);
        if (dx > 72 && dx > dy * 1.6) {
          onBack();
        }
      }}
    >
      <header className="chat-floating-header">
        <button
          type="button"
          className="glass-circle-btn"
          aria-label="Zurück zu Gruppen"
          onClick={onBack}
        >
          <ChevronLeft size={22} />
        </button>

        <button
          type="button"
          className="glass-title-pill"
          onClick={() => setShowContextSheet(true)}
        >
          <Users size={16} />
          <span className="glass-title-pill-label">{room.name}</span>
        </button>

        <button
          type="button"
          className="glass-circle-btn"
          aria-label="Gruppenkontext bearbeiten"
          onClick={() => setShowContextSheet(true)}
        >
          <MoreHorizontal size={20} />
        </button>
      </header>

      <div ref={scrollRef} className="chat-messages">
        {error && (
          <div className="notice err">
            <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="empty-state">
            <p>Lade Gruppennachrichten…</p>
          </div>
        ) : visibleEvents.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 20 }}>
            <h3>{room.name}</h3>
            <p>
              Schreibe eine Aufgabe in die Runde – die beteiligten Bots antworten direkt im
              Hermes-Gruppenraum.
            </p>
          </div>
        ) : (
          visibleEvents.map((ev) => {
            const payloadText =
              typeof ev.payload.text === "string"
                ? ev.payload.text
                : typeof ev.payload.content === "string"
                  ? ev.payload.content
                  : typeof ev.payload.message === "string"
                    ? ev.payload.message
                    : "";

            if (ev.kind === "message.user") {
              return (
                <div key={ev.event_id} className="msg-row user">
                  <div
                    className="msg-bubble"
                    onTouchStart={(e) => startLongPress(e, "Du", payloadText)}
                    onTouchMove={moveLongPress}
                    onTouchEnd={cancelLongPress}
                    onTouchCancel={cancelLongPress}
                    onContextMenu={(e) => {
                      if (!payloadText.trim()) return;
                      e.preventDefault();
                      setContextMsg({ author: "Du", text: payloadText });
                    }}
                  >
                    <SafeMarkdown text={payloadText} />
                  </div>
                  <div className="msg-time">{formatShortTime(ev.created_at)}</div>
                </div>
              );
            }

            if (ev.kind === "message.member") {
              const botName = ev.actor.profile || ev.actor.display_name || ev.actor.id;
              const vis = getProfileAvatarByName(botName, profiles);
              const cleanText = stripSecretRequestTag(payloadText);
              const pocketPages = extractPocketPages(payloadText);
              const memberLabel = ev.actor.display_name || vis.label;
              return (
                <div key={ev.event_id} className="msg-row assistant">
                  <div className="msg-author">
                    <BotAvatar
                      visual={vis}
                      imageUrl={ev.actor.profile ? avatars[ev.actor.profile] : null}
                      size="xs"
                    />
                    <span>{memberLabel}</span>
                  </div>
                  <div
                    className="msg-bubble"
                    onTouchStart={(e) => startLongPress(e, memberLabel, cleanText)}
                    onTouchMove={moveLongPress}
                    onTouchEnd={cancelLongPress}
                    onTouchCancel={cancelLongPress}
                    onContextMenu={(e) => {
                      if (!cleanText.trim()) return;
                      e.preventDefault();
                      setContextMsg({ author: memberLabel, text: cleanText });
                    }}
                  >
                    {cleanText && <SafeMarkdown text={cleanText} />}
                    {pocketPages.map((page) => (
                      <PocketPageCard
                        key={page.id}
                        page={page}
                        onOpen={setOpenPocketPage}
                      />
                    ))}
                  </div>
                  {cleanText && (
                    <div className="msg-actions-row">
                      <button
                        type="button"
                        className="msg-action-btn"
                        aria-label="Auf Nachricht antworten"
                        onClick={() => {
                          const flat = cleanText.replace(/\s+/g, " ").trim();
                          setReplyTo({
                            author: ev.actor.display_name || vis.label,
                            excerpt: flat.length > 140 ? `${flat.slice(0, 140)}…` : flat,
                          });
                          requestAnimationFrame(() => textareaRef.current?.focus());
                        }}
                      >
                        <Reply size={12} /> Antworten
                      </button>
                      <button
                        type="button"
                        className="msg-action-btn"
                        aria-label="Nachricht kopieren"
                        onClick={() => {
                          void navigator.clipboard?.writeText(cleanText).then(() => {
                            setCopiedEventId(ev.event_id);
                            window.setTimeout(() => {
                              setCopiedEventId((cur) => (cur === ev.event_id ? null : cur));
                            }, 1600);
                          });
                        }}
                      >
                        {copiedEventId === ev.event_id ? (
                          <>
                            <Check size={12} /> Kopiert
                          </>
                        ) : (
                          <>
                            <Copy size={12} /> Kopieren
                          </>
                        )}
                      </button>
                      {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
                        <button
                          type="button"
                          className="msg-action-btn"
                          aria-label="Nachricht teilen"
                          onClick={() => {
                            void navigator
                              .share({ title: ev.actor.display_name || vis.label, text: cleanText })
                              .catch(() => undefined);
                          }}
                        >
                          <Share2 size={12} /> Teilen
                        </button>
                      )}
                    </div>
                  )}
                  <div className="msg-time">{formatShortTime(ev.created_at)}</div>
                </div>
              );
            }

            return (
              <div key={ev.event_id} className="msg-row system">
                <div className="msg-bubble">
                  {ev.kind === "room.context_set"
                    ? "Gruppenkontext aktualisiert"
                    : ev.kind === "turn.failed"
                      ? `Hinweis (${ev.actor.display_name || ev.actor.profile || "Bot"}): ${payloadText || "Antwort fehlgeschlagen"}`
                      : payloadText || ev.kind}
                </div>
              </div>
            );
          })
        )}

        {activities.length > 0 && (
          <div className="chip-row" style={{ marginTop: 4 }}>
            {activities.map((act) => (
              <span key={`${act.member_id}-${act.status}`} className="pill accent">
                <span className="pulse-dot" />
                {act.profile || act.member_id}: {act.tool ? `${act.tool}…` : act.status}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="composer-wrap">
        {replyTo && (
          <div className="reply-preview-bar" role="status">
            <Reply size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
            <div className="reply-preview-text">
              <span className="reply-preview-author">{replyTo.author}</span>
              <span className="reply-preview-excerpt">{replyTo.excerpt}</span>
            </div>
            <button
              type="button"
              className="icon-btn ghost"
              aria-label="Zitat entfernen"
              onClick={() => setReplyTo(null)}
            >
              <X size={15} />
            </button>
          </div>
        )}
        <div className="composer-box">
          <textarea
            ref={textareaRef}
            className="composer-input"
            rows={1}
            enterKeyHint="send"
            value={input}
            onFocus={scrollToBottomWithSettle}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!sending) void handleSend();
              }
            }}
            placeholder={dictating ? "Höre zu… sprich jetzt" : `An ${room.name} schreiben…`}
          />
          {!anyBotBusy && (
            <button
              type="button"
              className={`composer-mic-btn${dictating ? " recording" : ""}`}
              aria-label={dictating ? "Spracheingabe stoppen" : "Spracheingabe starten"}
              onClick={handleToggleDictation}
            >
              <Mic size={17} />
            </button>
          )}
          {anyBotBusy ? (
            <button
              type="button"
              className="send-btn stop"
              aria-label="Bot-Runde stoppen"
              onClick={() => void handleStopRoom()}
            >
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              className="send-btn"
              aria-label="In Gruppe senden"
              disabled={!input.trim() || sending || wsState !== "connected"}
              onClick={() => void handleSend()}
            >
              <ArrowUp size={19} />
            </button>
          )}
        </div>
      </div>

      <Sheet
        open={showContextSheet}
        onClose={() => {
          if (!savingContext) setShowContextSheet(false);
        }}
      >
        <div className="sheet-header">
          <h2 className="sheet-title">Gruppen-Einstellungen</h2>
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Schließen"
            onClick={() => setShowContextSheet(false)}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSaveContext}>
          <div className="field">
            <label htmlFor="edit-routing">Routing</label>
            <select
              id="edit-routing"
              className="select"
              value={routing}
              onChange={(e) =>
                setRouting(e.target.value as "auto" | "everyone" | "lead")
              }
            >
              <option value="auto">Automatisch</option>
              <option value="everyone">Alle Bots</option>
              <option value="lead">Lead-Bot</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="edit-purpose">Ziel</label>
            <input
              id="edit-purpose"
              className="input"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Gemeinsames Ziel der Gruppe"
            />
          </div>
          <div className="field">
            <label htmlFor="edit-notes">Geteilte Notizen</label>
            <textarea
              id="edit-notes"
              className="textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Hinweise für alle Bots ab der nächsten Nachricht"
            />
          </div>

          <button type="submit" className="btn primary full" disabled={savingContext}>
            {savingContext ? "Speichere…" : "Kontext speichern"}
          </button>
        </form>

        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
          <button
            type="button"
            className="btn danger full"
            onClick={() => {
              setShowContextSheet(false);
              setConfirmDisband(true);
            }}
          >
            <Trash2 size={16} /> Gruppe auflösen
          </button>
        </div>
      </Sheet>

      <ConfirmSheet
        open={confirmDisband}
        title="Gruppe wirklich auflösen?"
        description={`Der Gruppenraum „${room.name}“ wird dauerhaft geschlossen.`}
        confirmLabel="Gruppe auflösen"
        danger
        busy={disbanding}
        onCancel={() => setConfirmDisband(false)}
        onConfirm={() => void handleDisbandRoom()}
      />

      <PocketPageViewer
        page={openPocketPage}
        onClose={() => setOpenPocketPage(null)}
      />

      <Sheet open={Boolean(contextMsg)} onClose={() => setContextMsg(null)}>
        {contextMsg && (
          <>
            <div className="sheet-header">
              <h2 className="sheet-title">{contextMsg.author}</h2>
              <button
                type="button"
                className="icon-btn ghost"
                aria-label="Schließen"
                onClick={() => setContextMsg(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div
              className="card"
              style={{
                marginBottom: 12,
                fontSize: "0.84rem",
                color: "var(--text-secondary)",
                maxHeight: 96,
                overflow: "hidden",
              }}
            >
              {contextMsg.text.slice(0, 220)}
              {contextMsg.text.length > 220 ? "…" : ""}
            </div>
            <div className="card-stack">
              <button
                type="button"
                className="btn primary full"
                onClick={() => {
                  const flat = contextMsg.text.replace(/\s+/g, " ").trim();
                  setReplyTo({
                    author: contextMsg.author,
                    excerpt: flat.length > 140 ? `${flat.slice(0, 140)}…` : flat,
                  });
                  setContextMsg(null);
                  requestAnimationFrame(() => textareaRef.current?.focus());
                }}
              >
                <Reply size={16} /> Antworten
              </button>
              <button
                type="button"
                className="btn full"
                onClick={() => {
                  void navigator.clipboard?.writeText(contextMsg.text);
                  setContextMsg(null);
                }}
              >
                <Copy size={16} /> Kopieren
              </button>
              {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
                <button
                  type="button"
                  className="btn full"
                  onClick={() => {
                    const txt = contextMsg.text;
                    const auth = contextMsg.author;
                    setContextMsg(null);
                    void navigator.share({ title: auth, text: txt }).catch(() => undefined);
                  }}
                >
                  <Share2 size={16} /> Teilen
                </button>
              )}
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
};
