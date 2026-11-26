import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  Camera,
  Check,
  ChevronLeft,
  FileText,
  History,
  Image as ImageIcon,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings2,
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
  HermesServerRequest,
  HermesSessionSummary,
} from "../../shared/types";
import { clearBotAvatar, prepareAvatarDataUrl, saveBotAvatar } from "../lib/avatarStore";
import { getBotVisual } from "../lib/botTheme";
import {
  formatChatDividerTime,
  formatRelativeTime,
  randomClientId,
  toTimestampMs,
} from "../lib/format";
import {
  createProfile,
  deleteProfile,
  deleteSession,
  fetchProfileSoul,
  fetchSessionMessages,
  fetchSessions,
  normalizeMessages,
  prepareChatImageDataUrl,
  updateProfileDescription,
  updateProfileSoul,
  uploadChatFile,
} from "../lib/hermesApi";
import { hermesWs, type WsConnectionState } from "../lib/hermesWs";
import { BotAvatar } from "./BotAvatar";
import { ConfirmSheet } from "./ConfirmSheet";
import { InChatConnectionCard } from "./InChatConnectionCard";
import { SafeMarkdown } from "./SafeMarkdown";
import { Sheet } from "./Sheet";

interface BotsViewProps {
  profiles: HermesProfile[];
  avatars: Record<string, string>;
  loading: boolean;
  error: string | null;
  wsState: WsConnectionState;
  selectedBotName: string | null;
  openCreateTrigger?: number;
  onSelectBot: (name: string | null) => void;
  onRefreshProfiles: () => Promise<void> | void;
  onAvatarChange: (profileName: string, dataUrl: string | null) => void;
  onOpenConnectors?: () => void;
}

function slugifyProfileName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export const BotsView: React.FC<BotsViewProps> = ({
  profiles,
  avatars,
  loading,
  error,
  wsState,
  selectedBotName,
  openCreateTrigger = 0,
  onSelectBot,
  onRefreshProfiles,
  onAvatarChange,
  onOpenConnectors,
}) => {
  const [query, setQuery] = useState("");
  const [recentByProfile, setRecentByProfile] = useState<Record<string, HermesSessionSummary>>({});

  // Create Bot Sheet
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createSoul, setCreateSoul] = useState("");
  const [createAvatarPreview, setCreateAvatarPreview] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createFileInputRef = useRef<HTMLInputElement | null>(null);

  // Manage / Edit Bot Sheet
  const [manageProfile, setManageProfile] = useState<HermesProfile | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [editSoul, setEditSoul] = useState("");
  const [loadingSoul, setLoadingSoul] = useState(false);
  const [savingBot, setSavingBot] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [confirmDeleteBot, setConfirmDeleteBot] = useState<HermesProfile | null>(null);
  const [deletingBot, setDeletingBot] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (openCreateTrigger > 0) {
      setCreateError(null);
      setCreateName("");
      setCreateDesc("");
      setCreateSoul("");
      setCreateAvatarPreview(null);
      setShowCreateSheet(true);
    }
  }, [openCreateTrigger]);

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
        (p.description || "").toLowerCase().includes(q)
      );
    });
  }, [profiles, query]);

  async function openManageSheet(profile: HermesProfile) {
    setManageProfile(profile);
    setEditDesc(profile.description || "");
    setEditSoul("");
    setManageError(null);
    setLoadingSoul(true);
    try {
      const soul = await fetchProfileSoul(profile.name);
      setEditSoul(soul);
    } catch {
      setEditSoul("");
    } finally {
      setLoadingSoul(false);
    }
  }

  async function handleCreatePickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await prepareAvatarDataUrl(file, 320);
      setCreateAvatarPreview(dataUrl);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Bild konnte nicht verarbeitet werden.");
    }
  }

  async function handleCreateBot(e: React.FormEvent) {
    e.preventDefault();
    const slug = slugifyProfileName(createName);
    if (!slug) {
      setCreateError("Bitte einen gültigen Bot-Namen (Buchstaben/Zahlen) eingeben.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createProfile({
        name: slug,
        description: createDesc.trim() || undefined,
        soul: createSoul.trim() || undefined,
        mirror_credentials: true,
        share_auth: true,
      });
      const finalName = created?.name || slug;
      if (createAvatarPreview && wsState === "connected") {
        await saveBotAvatar(finalName, createAvatarPreview).catch(() => null);
        onAvatarChange(finalName, createAvatarPreview);
      }
      setShowCreateSheet(false);
      await onRefreshProfiles();
      onSelectBot(finalName);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Bot konnte nicht erstellt werden.");
    } finally {
      setCreating(false);
    }
  }

  async function handleEditPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !manageProfile) return;
    setSavingBot(true);
    setManageError(null);
    try {
      const dataUrl = await prepareAvatarDataUrl(file, 320);
      await saveBotAvatar(manageProfile.name, dataUrl);
      onAvatarChange(manageProfile.name, dataUrl);
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Profilbild konnte nicht gespeichert werden.");
    } finally {
      setSavingBot(false);
    }
  }

  async function handleClearAvatar() {
    if (!manageProfile) return;
    setSavingBot(true);
    setManageError(null);
    try {
      await clearBotAvatar(manageProfile.name);
      onAvatarChange(manageProfile.name, null);
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Profilbild konnte nicht entfernt werden.");
    } finally {
      setSavingBot(false);
    }
  }

  async function handleSaveBotDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!manageProfile) return;
    setSavingBot(true);
    setManageError(null);
    try {
      await Promise.all([
        updateProfileDescription(manageProfile.name, editDesc.trim()),
        updateProfileSoul(manageProfile.name, editSoul),
      ]);
      setManageProfile(null);
      await onRefreshProfiles();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Änderungen konnten nicht gespeichert werden.");
    } finally {
      setSavingBot(false);
    }
  }

  async function handleConfirmDeleteBot() {
    if (!confirmDeleteBot) return;
    setDeletingBot(true);
    try {
      await deleteProfile(confirmDeleteBot.name);
      onAvatarChange(confirmDeleteBot.name, null);
      if (selectedBotName === confirmDeleteBot.name) {
        onSelectBot(null);
      }
      setConfirmDeleteBot(null);
      setManageProfile(null);
      await onRefreshProfiles();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Bot konnte nicht entfernt werden.");
      setConfirmDeleteBot(null);
    } finally {
      setDeletingBot(false);
    }
  }

  if (selectedProfile) {
    return (
      <>
        <DirectChatView
          profile={selectedProfile}
          avatarUrl={avatars[selectedProfile.name] || null}
          wsState={wsState}
          onBack={() => onSelectBot(null)}
          onOpenBotSettings={() => void openManageSheet(selectedProfile)}
          onOpenConnectors={onOpenConnectors}
        />
        <input
          ref={editFileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => void handleEditPickImage(e)}
        />
        {manageProfile && (
          <BotManageSheet
            profile={manageProfile}
            avatarUrl={avatars[manageProfile.name] || null}
            wsState={wsState}
            editDesc={editDesc}
            editSoul={editSoul}
            loadingSoul={loadingSoul}
            saving={savingBot}
            error={manageError}
            onChangeDesc={setEditDesc}
            onChangeSoul={setEditSoul}
            onPickImage={() => editFileInputRef.current?.click()}
            onClearImage={() => void handleClearAvatar()}
            onSave={handleSaveBotDetails}
            onRequestDelete={() => setConfirmDeleteBot(manageProfile)}
            onClose={() => setManageProfile(null)}
          />
        )}
        <ConfirmSheet
          open={Boolean(confirmDeleteBot)}
          title="Bot wirklich entfernen?"
          description={`Das Hermes-Profil „${confirmDeleteBot?.name || ""}“ wird dauerhaft gelöscht.`}
          warning="Gespeicherte Chats, Erinnerungen und Routinen dieses Bots gehen dabei verloren."
          confirmLabel="Bot entfernen"
          danger
          busy={deletingBot}
          onCancel={() => setConfirmDeleteBot(null)}
          onConfirm={() => void handleConfirmDeleteBot()}
        />
      </>
    );
  }

  return (
    <div>
      <div className="search-wrap">
        <Search size={15} className="search-icon" />
        <input
          className="search-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Suchen"
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
              onClick={() => void onRefreshProfiles()}
            >
              <RefreshCw size={14} /> Erneut laden
            </button>
          </div>
        </div>
      )}

      {loading && profiles.length === 0 ? (
        <div className="empty-state">
          <p>Lade Bots…</p>
        </div>
      ) : filteredProfiles.length === 0 ? (
        <div className="empty-state">
          <h3>Keine Bots gefunden</h3>
          <p>
            {query
              ? `Kein Bot passt zu „${query}“.`
              : "Erstelle deinen ersten Hermes-Bot."}
          </p>
          <button
            type="button"
            className="btn primary sm"
            onClick={() => setShowCreateSheet(true)}
          >
            <Plus size={15} /> Neuer Bot
          </button>
        </div>
      ) : (
        <div className="bot-list">
          {filteredProfiles.map((profile) => {
            const visual = getBotVisual(profile);
            const recent = recentByProfile[profile.name];
            return (
              <div key={profile.name} className="bot-list-item">
                <button
                  type="button"
                  className="bot-list-main"
                  onClick={() => onSelectBot(profile.name)}
                >
                  <BotAvatar
                    visual={visual}
                    imageUrl={avatars[profile.name]}
                    online={profile.gateway_running}
                    showStatus
                  />
                  <div className="bot-card-body">
                    <div className="bot-card-row">
                      <span className="bot-card-name">{visual.label}</span>
                      {recent?.last_active && (
                        <span className="bot-list-time">
                          {formatRelativeTime(recent.last_active)}
                        </span>
                      )}
                    </div>
                    <div className="bot-card-meta">
                      {profile.description?.trim() || recent?.title || "Bereit zum Chatten"}
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  className="icon-btn ghost"
                  aria-label={`${visual.label} verwalten`}
                  style={{ minWidth: 36, minHeight: 36, color: "var(--text-muted)" }}
                  onClick={() => void openManageSheet(profile)}
                >
                  <MoreHorizontal size={18} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <input
        ref={createFileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => void handleCreatePickImage(e)}
      />
      <input
        ref={editFileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => void handleEditPickImage(e)}
      />

      {/* Create Bot Sheet */}
      <Sheet
        open={showCreateSheet}
        onClose={() => {
          if (!creating) setShowCreateSheet(false);
        }}
      >
        <div className="sheet-header">
          <h2 className="sheet-title">Neuer Bot</h2>
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

        <form onSubmit={handleCreateBot}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <button
              type="button"
              className="avatar-edit-btn"
              onClick={() => createFileInputRef.current?.click()}
            >
              <BotAvatar
                visual={getBotVisual({
                  name: createName || "bot",
                  display_name: createName,
                  bot_title: "",
                  description: "",
                  model: null,
                })}
                imageUrl={createAvatarPreview}
                size="lg"
              />
              <span className="avatar-camera-badge" style={{ width: 24, height: 24 }}>
                <Camera size={13} />
              </span>
            </button>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              Optionales Profilbild wählen
            </span>
          </div>

          <div className="field">
            <label htmlFor="new-bot-name">Name</label>
            <input
              id="new-bot-name"
              className="input"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="z. B. Coach, Finanzen, Assistent"
              required
            />
            {createName.trim() && (
              <span style={{ fontSize: "0.73rem", color: "var(--text-muted)" }}>
                Hermes-Profil: <code>{slugifyProfileName(createName) || "—"}</code>
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="new-bot-desc">Kurzbeschreibung</label>
            <input
              id="new-bot-desc"
              className="input"
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
              placeholder="Wofür ist dieser Bot zuständig?"
            />
          </div>

          <div className="field">
            <label htmlFor="new-bot-soul">Persönlichkeit &amp; Anweisungen (optional)</label>
            <textarea
              id="new-bot-soul"
              className="textarea"
              value={createSoul}
              onChange={(e) => setCreateSoul(e.target.value)}
              placeholder="Beschreibe Rolle, Tonfall und Aufgaben des Bots…"
            />
          </div>

          {createError && (
            <div className="notice err" style={{ marginBottom: 12 }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{createError}</span>
            </div>
          )}

          <button type="submit" className="btn primary full" disabled={creating}>
            {creating ? "Erstelle Bot…" : "Bot erstellen"}
          </button>
        </form>
      </Sheet>

      {manageProfile && (
        <BotManageSheet
          profile={manageProfile}
          avatarUrl={avatars[manageProfile.name] || null}
          wsState={wsState}
          editDesc={editDesc}
          editSoul={editSoul}
          loadingSoul={loadingSoul}
          saving={savingBot}
          error={manageError}
          onChangeDesc={setEditDesc}
          onChangeSoul={setEditSoul}
          onPickImage={() => editFileInputRef.current?.click()}
          onClearImage={() => void handleClearAvatar()}
          onSave={handleSaveBotDetails}
          onRequestDelete={() => setConfirmDeleteBot(manageProfile)}
          onClose={() => setManageProfile(null)}
        />
      )}

      <ConfirmSheet
        open={Boolean(confirmDeleteBot)}
        title="Bot wirklich entfernen?"
        description={`Das Hermes-Profil „${confirmDeleteBot?.name || ""}“ wird dauerhaft gelöscht.`}
        warning="Gespeicherte Chats, Erinnerungen und Routinen dieses Bots gehen dabei verloren."
        confirmLabel="Bot entfernen"
        danger
        busy={deletingBot}
        onCancel={() => setConfirmDeleteBot(null)}
        onConfirm={() => void handleConfirmDeleteBot()}
      />
    </div>
  );
};

// ── Manage / Edit Bot Bottom Sheet ────────────────────────────────────────────

interface BotManageSheetProps {
  profile: HermesProfile;
  avatarUrl: string | null;
  wsState: WsConnectionState;
  editDesc: string;
  editSoul: string;
  loadingSoul: boolean;
  saving: boolean;
  error: string | null;
  onChangeDesc: (val: string) => void;
  onChangeSoul: (val: string) => void;
  onPickImage: () => void;
  onClearImage: () => void;
  onSave: (e: React.FormEvent) => void;
  onRequestDelete: () => void;
  onClose: () => void;
}

const BotManageSheet: React.FC<BotManageSheetProps> = ({
  profile,
  avatarUrl,
  wsState,
  editDesc,
  editSoul,
  loadingSoul,
  saving,
  error,
  onChangeDesc,
  onChangeSoul,
  onPickImage,
  onClearImage,
  onSave,
  onRequestDelete,
  onClose,
}) => {
  const vis = getBotVisual(profile);

  return (
    <Sheet
      open
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <div className="sheet-header">
        <h2 className="sheet-title">{vis.label}</h2>
        <button
          type="button"
          className="icon-btn ghost"
          aria-label="Schließen"
          disabled={saving}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button
          type="button"
          className="avatar-edit-btn"
          disabled={saving || wsState !== "connected"}
          onClick={onPickImage}
        >
          <BotAvatar visual={vis} imageUrl={avatarUrl} size="lg" />
          <span className="avatar-camera-badge" style={{ width: 24, height: 24 }}>
            <Camera size={13} />
          </span>
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn sm"
            disabled={saving || wsState !== "connected"}
            onClick={onPickImage}
          >
            <Camera size={14} /> Bild ändern
          </button>
          {avatarUrl && (
            <button
              type="button"
              className="btn sm"
              disabled={saving || wsState !== "connected"}
              onClick={onClearImage}
            >
              Entfernen
            </button>
          )}
        </div>
        {profile.model && (
          <span className="mini-tag">Modell: {profile.model} · Profil: {profile.name}</span>
        )}
      </div>

      <form onSubmit={onSave}>
        <div className="field">
          <label htmlFor="edit-bot-desc">Kurzbeschreibung</label>
          <input
            id="edit-bot-desc"
            className="input"
            value={editDesc}
            onChange={(e) => onChangeDesc(e.target.value)}
            placeholder="Rolle des Bots"
          />
        </div>

        <div className="field">
          <label htmlFor="edit-bot-soul">Persönlichkeit / Anweisungen (SOUL)</label>
          <textarea
            id="edit-bot-soul"
            className="textarea"
            value={loadingSoul ? "Lade…" : editSoul}
            disabled={loadingSoul}
            onChange={(e) => onChangeSoul(e.target.value)}
            placeholder="Anweisungen für diesen Bot…"
          />
        </div>

        {error && (
          <div className="notice err" style={{ marginBottom: 12 }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" className="btn primary full" disabled={saving || loadingSoul}>
          {saving ? "Speichere…" : "Änderungen speichern"}
        </button>
      </form>

      {!profile.is_default && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
          <button
            type="button"
            className="btn danger full"
            disabled={saving}
            onClick={onRequestDelete}
          >
            <Trash2 size={15} /> Bot aus Hermes entfernen
          </button>
        </div>
      )}
    </Sheet>
  );
};

// ── Direct 1:1 Bot Chat Screen ────────────────────────────────────────────────

interface DirectChatViewProps {
  profile: HermesProfile;
  avatarUrl: string | null;
  wsState: WsConnectionState;
  onBack: () => void;
  onOpenBotSettings: () => void;
  onOpenConnectors?: () => void;
}

interface QueuedAttachment {
  id: string;
  file: File;
  isImage: boolean;
  previewUrl?: string;
}

const DirectChatView: React.FC<DirectChatViewProps> = ({
  profile,
  avatarUrl,
  wsState,
  onBack,
  onOpenBotSettings,
  onOpenConnectors,
}) => {
  const visual = getBotVisual(profile);

  const [sessions, setSessions] = useState<HermesSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState<string>("Neuer Chat");
  const [messages, setMessages] = useState<HermesChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(true);
  const [chatError, setChatError] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<QueuedAttachment[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<HermesPendingApproval | null>(null);
  const [pendingConnection, setPendingConnection] = useState<HermesConnectionRequest | null>(null);
  const [pendingClarify, setPendingClarify] = useState<HermesServerRequest | null>(null);
  const [clarifyCustomAnswer, setClarifyCustomAnswer] = useState("");

  const [showSessionsSheet, setShowSessionsSheet] = useState(false);
  const [showActionsSheet, setShowActionsSheet] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<HermesSessionSummary | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imagePickerRef = useRef<HTMLInputElement | null>(null);
  const filePickerRef = useRef<HTMLInputElement | null>(null);
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
      setPendingClarify(null);
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

  useEffect(() => {
    if (wsState === "connected" && activeSessionId && !attachedOnWsRef.current) {
      void loadSessionHistory(activeSessionId, activeTitle);
    }
  }, [wsState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle server -> client requests (e.g. clarify questions from Mika)
  useEffect(() => {
    return hermesWs.onServerRequest((req) => {
      const reqSid = typeof req.params.session_id === "string" ? req.params.session_id : null;
      if (reqSid && activeSessionRef.current && reqSid !== activeSessionRef.current) {
        hermesWs.sendErrorResponse(req.id, 4404, "Session not shown");
        return;
      }
      if (req.method === "clarify" || req.method === "clarify.request") {
        setPendingClarify(req);
        setClarifyCustomAnswer("");
        scrollToBottom();
      } else {
        // Decline desktop-only window requests cleanly so the agent doesn't wait 300s
        hermesWs.sendErrorResponse(req.id, 4404, "Not supported on mobile web client");
      }
    });
  }, [scrollToBottom]);

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
    setPendingClarify(null);
    attachedOnWsRef.current = false;
  }

  function handleAddFiles(fileList: FileList | null, forceImage = false) {
    if (!fileList || fileList.length === 0) return;
    const added: QueuedAttachment[] = [];
    for (const file of Array.from(fileList).slice(0, 6)) {
      const isImage = forceImage || file.type.startsWith("image/");
      added.push({
        id: randomClientId("att"),
        file,
        isImage,
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
      });
    }
    setAttachments((prev) => [...prev, ...added].slice(0, 8));
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  async function handleSend() {
    const text = input.trim();
    const pendingFiles = [...attachments];
    if (!text && pendingFiles.length === 0) return;
    if (wsState !== "connected") {
      setChatError("Keine Live-Verbindung zum Hermes-Gateway. Bitte kurz warten.");
      return;
    }

    setChatError(null);
    setInput("");
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    let sid = activeSessionId;
    const optimisticId = `u-${Date.now()}`;
    let appendedOptimistic = false;
    try {
      if (!sid) {
        const created = await hermesWs.call<{
          session_id: string;
          stored_session_id?: string;
          execution_generation?: number;
        }>("session.create", {
          profile: profile.name,
          request_id: randomClientId("req"),
          source: "gui",
        });
        sid = created.session_id;
        if (typeof created.execution_generation === "number") {
          execGenerationRef.current = created.execution_generation;
        }
        attachedOnWsRef.current = true;
        setActiveSessionId(sid);
        setActiveTitle((text || pendingFiles[0]?.file.name || "Chat").slice(0, 48));
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

      // Stage any selected images and files natively in Hermes before prompt.submit
      const imageAttachments: Array<{ path: string; mime: string }> = [];
      const fileRefs: string[] = [];

      if (pendingFiles.length > 0) {
        setUploadingAttachments(true);
        for (const item of pendingFiles) {
          if (item.isImage) {
            const dataUrl = await prepareChatImageDataUrl(item.file, 1600);
            const staged = await hermesWs.call<{ path?: string; mime?: string }>(
              "image.attach_bytes",
              {
                session_id: sid,
                profile: profile.name,
                content_base64: dataUrl,
                filename: item.file.name || "photo.jpg",
              },
              30_000
            );
            if (staged?.path) {
              imageAttachments.push({
                path: staged.path,
                mime: staged.mime || "image/jpeg",
              });
            }
          } else {
            const uploaded = await uploadChatFile(item.file, profile.name);
            const attached = await hermesWs.call<{ ref_text?: string; path?: string }>(
              "file.attach",
              {
                session_id: sid,
                profile: profile.name,
                ...(uploaded.staged_upload
                  ? { staged_upload: uploaded.staged_upload }
                  : { path: uploaded.path }),
                name: item.file.name,
              },
              30_000
            );
            if (attached?.ref_text) {
              fileRefs.push(attached.ref_text);
            } else if (uploaded.path) {
              fileRefs.push(`[Datei: ${item.file.name} (${uploaded.path})]`);
            }
          }
        }
        setUploadingAttachments(false);
      }

      const combinedText = [
        ...fileRefs,
        text || (imageAttachments.length > 0 ? "Bitte schau dir dieses Bild an." : ""),
      ]
        .filter(Boolean)
        .join("\n\n");

      setMessages((prev) => [
        ...prev,
        {
          id: optimisticId,
          role: "user",
          content: text,
          timestamp: Date.now(),
          attachments: pendingFiles.map((a) => ({
            name: a.file.name,
            isImage: a.isImage,
            previewUrl: a.previewUrl,
          })),
        },
      ]);
      appendedOptimistic = true;
      setIsStreaming(true);
      scrollToBottom();

      await hermesWs.call("prompt.submit", {
        session_id: sid,
        profile: profile.name,
        submission_id: randomClientId("sub"),
        text: combinedText,
        ...(imageAttachments.length > 0 ? { attachments: imageAttachments } : {}),
      });
    } catch (err) {
      setUploadingAttachments(false);
      setIsStreaming(false);
      if (appendedOptimistic) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      }
      setInput(text);
      if (pendingFiles.length > 0) setAttachments(pendingFiles);
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

  function handleClarifyAnswer(answer: string) {
    if (!pendingClarify) return;
    hermesWs.sendResponse(pendingClarify.id, { answer });
    setPendingClarify(null);
    setClarifyCustomAnswer("");
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

  const clarifyQuestion =
    typeof pendingClarify?.params.question === "string"
      ? pendingClarify.params.question
      : "Rückfrage";
  const clarifyChoices = Array.isArray(pendingClarify?.params.choices)
    ? (pendingClarify.params.choices.filter((c): c is string => typeof c === "string"))
    : [];

  return (
    <div className="chat-screen">
      <header className="chat-floating-header">
        <button
          type="button"
          className="glass-circle-btn"
          aria-label="Zurück zu Bots"
          onClick={onBack}
        >
          <ChevronLeft size={22} />
        </button>

        <button
          type="button"
          className="glass-title-pill"
          onClick={onOpenBotSettings}
        >
          <BotAvatar visual={visual} imageUrl={avatarUrl} size="sm" />
          <span className="glass-title-pill-label">{visual.label}</span>
        </button>

        <button
          type="button"
          className="glass-circle-btn"
          aria-label="Chat-Optionen"
          onClick={() => setShowActionsSheet(true)}
        >
          <MoreHorizontal size={20} />
        </button>
      </header>

      <div ref={scrollRef} className="chat-messages">
        {wsState !== "connected" && (
          <div className="notice warn">
            <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Verbindung: {wsState === "connecting" ? "wird aufgebaut…" : "getrennt – verbinde neu…"}
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
          <div className="empty-state" style={{ background: "transparent", border: "none" }}>
            <p>Lade Verlauf…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 32, background: "transparent", border: "none" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
              <BotAvatar visual={visual} imageUrl={avatarUrl} size="lg" />
            </div>
            <h3>{visual.label}</h3>
            <p>{profile.description || `Schreibe eine Nachricht an ${visual.label}.`}</p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const curMs = toTimestampMs(msg.timestamp);
            const prevMs = i > 0 ? toTimestampMs(messages[i - 1].timestamp) : null;
            const showDivider =
              curMs !== null && (prevMs === null || curMs - prevMs > 10 * 60 * 1000);

            return (
              <React.Fragment key={String(msg.id ?? i)}>
                {showDivider && (
                  <div className="chat-time-divider">
                    {formatChatDividerTime(msg.timestamp)}
                  </div>
                )}
                <div className={`msg-row ${msg.role}`}>
                  {msg.role === "assistant" && msg.streaming && (
                    <div className="msg-author">
                      <span className="pulse-dot" />
                      <span>{visual.label} schreibt…</span>
                    </div>
                  )}
                  <div className="msg-bubble">
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="msg-attachments">
                        {msg.attachments.map((att, attIdx) =>
                          att.isImage && att.previewUrl ? (
                            <img
                              key={attIdx}
                              src={att.previewUrl}
                              alt={att.name}
                              className="msg-attachment-img"
                            />
                          ) : (
                            <span key={attIdx} className="msg-attachment-file">
                              <FileText size={14} />
                              {att.name}
                            </span>
                          )
                        )}
                      </div>
                    )}
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
                </div>
              </React.Fragment>
            );
          })
        )}

        {(activeTool || liveStatus) && (
          <div style={{ alignSelf: "flex-start" }}>
            <span className="pill accent">
              <Wrench size={13} />
              {activeTool ? `${activeTool}…` : liveStatus}
            </span>
          </div>
        )}

        {pendingConnection && activeSessionId && pendingConnection.targets.length > 0 && (
          <InChatConnectionCard
            profileName={profile.name}
            sessionId={activeSessionId}
            request={pendingConnection}
            onUpdated={setPendingConnection}
          />
        )}

        {pendingClarify && (
          <div className="card" style={{ borderColor: "rgba(255,255,255,0.22)" }}>
            <div style={{ fontWeight: 700, fontSize: "0.92rem", marginBottom: 8 }}>
              {clarifyQuestion}
            </div>
            {clarifyChoices.length > 0 && (
              <div className="chip-row" style={{ marginBottom: 10 }}>
                {clarifyChoices.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    className="btn sm"
                    onClick={() => handleClarifyAnswer(choice)}
                  >
                    {choice}
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input"
                value={clarifyCustomAnswer}
                onChange={(e) => setClarifyCustomAnswer(e.target.value)}
                placeholder="Eigene Antwort…"
              />
              <button
                type="button"
                className="btn sm primary"
                disabled={!clarifyCustomAnswer.trim()}
                onClick={() => handleClarifyAnswer(clarifyCustomAnswer.trim())}
              >
                Senden
              </button>
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
        {attachments.length > 0 && (
          <div className="attachment-tray">
            {attachments.map((att) => (
              <div key={att.id} className="attachment-chip">
                {att.isImage && att.previewUrl ? (
                  <img
                    src={att.previewUrl}
                    alt={att.file.name}
                    className="attachment-chip-thumb"
                  />
                ) : (
                  <FileText size={16} style={{ flexShrink: 0, color: "var(--accent-indigo)" }} />
                )}
                <span className="attachment-chip-name">{att.file.name}</span>
                <button
                  type="button"
                  className="attachment-chip-remove"
                  aria-label="Anhang entfernen"
                  onClick={() => removeAttachment(att.id)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="composer-box">
          <button
            type="button"
            className="composer-plus-btn"
            aria-label="Anhang oder Aktionen"
            onClick={() => setShowActionsSheet(true)}
          >
            <Plus size={19} />
          </button>
          <textarea
            ref={textareaRef}
            className="composer-input"
            rows={1}
            enterKeyHint="send"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoResizeInput(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!isStreaming && !uploadingAttachments) void handleSend();
              }
            }}
            placeholder={
              uploadingAttachments ? "Lade Anhang hoch…" : `${visual.label} fragen`
            }
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
              disabled={
                uploadingAttachments ||
                (!input.trim() && attachments.length === 0) ||
                wsState !== "connected"
              }
              onClick={() => void handleSend()}
            >
              <ArrowUp size={18} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      <input
        ref={imagePickerRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          handleAddFiles(e.target.files, true);
          e.target.value = "";
        }}
      />
      <input
        ref={filePickerRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          handleAddFiles(e.target.files, false);
          e.target.value = "";
        }}
      />

      <Sheet open={showActionsSheet} onClose={() => setShowActionsSheet(false)}>
        <div className="sheet-header">
          <h2 className="sheet-title">{visual.label}</h2>
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Schließen"
            onClick={() => setShowActionsSheet(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="card-stack">
          <button
            type="button"
            className="btn primary full"
            onClick={() => {
              setShowActionsSheet(false);
              imagePickerRef.current?.click();
            }}
          >
            <ImageIcon size={17} /> Foto / Bild senden
          </button>
          <button
            type="button"
            className="btn full"
            onClick={() => {
              setShowActionsSheet(false);
              filePickerRef.current?.click();
            }}
          >
            <Paperclip size={17} /> Datei oder PDF senden
          </button>
          <button
            type="button"
            className="btn full"
            onClick={() => {
              setShowActionsSheet(false);
              void startNewChat();
            }}
          >
            <MessageSquarePlus size={17} /> Neuen Chat starten
          </button>
          <button
            type="button"
            className="btn full"
            onClick={() => {
              setShowActionsSheet(false);
              void refreshSessionsList(false);
              setShowSessionsSheet(true);
            }}
          >
            <History size={17} /> Chat-Verlauf ({sessions.length})
          </button>
          {onOpenConnectors && (
            <button
              type="button"
              className="btn full"
              onClick={() => {
                setShowActionsSheet(false);
                onOpenConnectors();
              }}
            >
              <Plug size={17} /> Connectoren &amp; E-Mail
            </button>
          )}
          <button
            type="button"
            className="btn full"
            onClick={() => {
              setShowActionsSheet(false);
              onOpenBotSettings();
            }}
          >
            <Settings2 size={17} /> Bot &amp; Profilbild bearbeiten
          </button>
        </div>
      </Sheet>

      <Sheet open={showSessionsSheet} onClose={() => setShowSessionsSheet(false)}>
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
      </Sheet>

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
