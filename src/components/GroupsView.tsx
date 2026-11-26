import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Plus,
  RefreshCw,
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
import { getBotVisual, getProfileAvatarByName } from "../lib/botTheme";
import { formatRelativeTime, formatShortTime, randomClientId } from "../lib/format";
import { hermesWs, type WsConnectionState } from "../lib/hermesWs";
import { BotAvatar } from "./BotAvatar";
import { ConfirmSheet } from "./ConfirmSheet";
import { SafeMarkdown } from "./SafeMarkdown";

interface GroupsViewProps {
  profiles: HermesProfile[];
  avatars: Record<string, string>;
  wsState: WsConnectionState;
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string | null) => void;
}

export const GroupsView: React.FC<GroupsViewProps> = ({
  profiles,
  avatars,
  wsState,
  selectedRoomId,
  onSelectRoom,
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
      const members = selectedMembers.map((name) => {
        const p = profiles.find((pr) => pr.name === name);
        const vis = p ? getBotVisual(p) : null;
        return {
          profile: name,
          display_name: vis?.label || name,
        };
      });
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
          {rooms.map((room) => (
            <button
              key={room.room_id}
              type="button"
              className="bot-card"
              onClick={() => onSelectRoom(room.room_id)}
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
                  <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", flexShrink: 0 }}>
                    {formatRelativeTime(room.updated_at)}
                  </span>
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
          ))}
        </div>
      )}

      {showCreateSheet && (
        <div
          className="sheet-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !creating) setShowCreateSheet(false);
          }}
        >
          <div className="sheet">
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
          </div>
        </div>
      )}
    </div>
  );
};

// ── Active Group Room View ────────────────────────────────────────────────────

interface GroupRoomViewProps {
  room: HermesRoom;
  profiles: HermesProfile[];
  avatars: Record<string, string>;
  wsState: WsConnectionState;
  onBack: () => void;
  onDisbanded: () => void;
}

const GroupRoomView: React.FC<GroupRoomViewProps> = ({
  room,
  profiles,
  avatars,
  wsState,
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

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<number>(0);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);

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
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Gruppenverlauf konnte nicht synchronisiert werden."
        );
      } finally {
        setLoading(false);
      }
    },
    [room.room_id, scrollToBottom, wsState]
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
    const raw = roomState?.activities || roomState?.active_members || [];
    return Array.isArray(raw) ? raw : [];
  }, [roomState]);

  const anyBotBusy = activities.some(
    (a) => a.status === "running" || a.status === "queued"
  );

  async function handleSend() {
    const text = input.trim();
    if (!text || wsState !== "connected") return;
    setSending(true);
    setError(null);
    setInput("");
    try {
      await hermesWs.call("groups.send", {
        room_id: room.room_id,
        event_id: randomClientId("msg"),
        payload: { text },
      });
      await syncRoom(true);
    } catch (err) {
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
      await hermesWs.call("groups.context", {
        room_id: room.room_id,
        event_id: randomClientId("ctx"),
        purpose: purpose.trim(),
        notes: notes.trim(),
        routing,
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
    <div className="chat-screen">
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
                  <div className="msg-bubble">
                    <SafeMarkdown text={payloadText} />
                  </div>
                  <div className="msg-time">{formatShortTime(ev.created_at)}</div>
                </div>
              );
            }

            if (ev.kind === "message.member") {
              const botName = ev.actor.profile || ev.actor.display_name || ev.actor.id;
              const vis = getProfileAvatarByName(botName, profiles);
              return (
                <div key={ev.event_id} className="msg-row assistant">
                  <div className="msg-author">
                    <BotAvatar
                      visual={vis}
                      imageUrl={ev.actor.profile ? avatars[ev.actor.profile] : null}
                      size="xs"
                    />
                    <span>{ev.actor.display_name || vis.label}</span>
                  </div>
                  <div className="msg-bubble">
                    <SafeMarkdown text={payloadText} />
                  </div>
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
        <div className="composer-box">
          <textarea
            className="composer-input"
            rows={1}
            enterKeyHint="send"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!sending) void handleSend();
              }
            }}
            placeholder={`An ${room.name} schreiben…`}
          />
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

      {showContextSheet && (
        <div
          className="sheet-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !savingContext) setShowContextSheet(false);
          }}
        >
          <div className="sheet">
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
          </div>
        </div>
      )}

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
    </div>
  );
};
