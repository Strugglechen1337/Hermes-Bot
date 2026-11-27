import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  Camera,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Download,
  FileText,
  Gauge,
  History,
  Image as ImageIcon,
  KeyRound,
  Lock,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  Pin,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Star,
  Trash2,
  Unlock,
  Wrench,
  X,
} from "lucide-react";
import type {
  HermesAccountUsageResponse,
  HermesChatMessage,
  HermesConnectionRequest,
  HermesErrorSurface,
  HermesFallbackProvider,
  HermesPendingApproval,
  HermesProfile,
  HermesServerRequest,
  HermesSessionSearchHit,
  HermesSessionSummary,
  HermesUsageLimitError,
} from "../../shared/types";
import { appendAutonomousGuidance } from "../../shared/botAutonomy";
import { clearBotAvatar, prepareAvatarDataUrl, saveBotAvatar } from "../lib/avatarStore";
import { evaluateApprovalPolicy, loadAutoApproveSafe } from "../lib/approvalPolicy";
import {
  BOT_CHAT_TITLE,
  deriveShortBotCallName,
  getBotHandle,
  pickPreferredBotSession,
} from "../lib/botCollaboration";
import {
  getPocketUiMeta,
  loadChiefBot,
  loadPinnedBots,
  resolveChiefBotName,
  resolvePinnedBotNames,
  saveChiefBot,
  savePinnedBots,
} from "../lib/botPinStore";
import { getBotVisual } from "../lib/botTheme";
import {
  formatBadgeCount,
  type BotUnreadInfo,
} from "../lib/unreadStore";
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
  fetchModelOptions,
  fetchProfileFallback,
  fetchProfileSoul,
  fetchSessionMessages,
  fetchSessions,
  normalizeMessages,
  prepareChatImageDataUrl,
  renameSession,
  searchSessions,
  updateProfileDescription,
  updateProfileFallback,
  updateProfileModel,
  updateProfilePrivacy,
  updateProfileSoul,
  uploadChatFile,
} from "../lib/hermesApi";
import { hermesWs, type WsConnectionState } from "../lib/hermesWs";
import { cleanSearchSnippet, PRIVATE_CHAT_TITLE } from "../lib/privateVault";
import { notifyIfBackgrounded, type PushPreferences } from "../lib/pushClient";
import {
  detectBotSecretForm,
  detectBotVaultRequest,
  extractPocketPages,
  extractProductDeals,
  stripSecretRequestTag,
  type DetectedDealCard,
  type DetectedPocketPage,
  type DetectedSecretRequest,
  type DetectedVaultRequest,
} from "../lib/secretDetection";
import {
  EMPTY_CHAT_USAGE,
  formatCompactWindowLabel,
  getPrimaryLimitSummary,
  mergeAccountUsage,
  mergeUsagePayload,
  RECOMMENDED_ANTHROPIC_FALLBACK,
  type ChatUsageState,
} from "../lib/usageLimits";
import { BotAvatar } from "./BotAvatar";
import { BotImportSheet } from "./BotImportSheet";
import { ConfirmSheet } from "./ConfirmSheet";
import { InChatConnectionCard } from "./InChatConnectionCard";
import {
  ApprovalPromptCard,
  ClarifyPromptCard,
  ManualSecretCard,
  PocketPageCard,
  PocketPageViewer,
  ProductDealCard,
  SECRET_REQUEST_METHODS,
  SecretPromptCard,
  UsageLimitCard,
  VaultFormCard,
} from "./InChatPromptCards";
import { LimitSheet } from "./LimitSheet";
import { ModelPickerSheet } from "./ModelPickerSheet";
import { SafeMarkdown } from "./SafeMarkdown";
import { Sheet } from "./Sheet";

interface BotsViewProps {
  profiles: HermesProfile[];
  avatars: Record<string, string>;
  recentByProfile?: Record<string, HermesSessionSummary>;
  unreadByBot?: Record<string, BotUnreadInfo>;
  otherUnreadCount?: number;
  pushPreferences?: PushPreferences;
  hiddenProfiles?: string[];
  privateProfileNames?: string[];
  loading: boolean;
  error: string | null;
  wsState: WsConnectionState;
  selectedBotName: string | null;
  openCreateTrigger?: number;
  createAsPrivate?: boolean;
  onSelectBot: (name: string | null) => void;
  onMarkBotRead?: (
    profileName: string,
    info?: {
      sessionId?: string | null;
      lastActiveMs?: number;
      messageCount?: number;
      messages?: HermesChatMessage[];
    }
  ) => void;
  onRegisterSession?: (profileName: string, sessionId: string | null) => void;
  onToggleBotPush?: (profileName: string, enabled: boolean) => Promise<void> | void;
  onRefreshProfiles: () => Promise<void> | void;
  onAvatarChange: (profileName: string, dataUrl: string | null) => void;
  onToggleHideProfile?: (profileName: string) => void;
  onToggleBotPrivate?: (profile: HermesProfile, makePrivate: boolean) => Promise<void>;
  onOpenPrivateVault?: () => void;
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

const EMPTY_STRING_LIST: string[] = [];
const EMPTY_RECENT_MAP: Record<string, HermesSessionSummary> = {};
const EMPTY_UNREAD_MAP: Record<string, BotUnreadInfo> = {};
const DEFAULT_PUSH_PREFS: PushPreferences = { globalEnabled: true, disabledBots: [] };

export const BotsView: React.FC<BotsViewProps> = ({
  profiles,
  avatars,
  recentByProfile = EMPTY_RECENT_MAP,
  unreadByBot = EMPTY_UNREAD_MAP,
  otherUnreadCount = 0,
  pushPreferences = DEFAULT_PUSH_PREFS,
  hiddenProfiles = EMPTY_STRING_LIST,
  privateProfileNames = EMPTY_STRING_LIST,
  loading,
  error,
  wsState,
  selectedBotName,
  openCreateTrigger = 0,
  createAsPrivate = false,
  onSelectBot,
  onMarkBotRead,
  onRegisterSession,
  onToggleBotPush,
  onRefreshProfiles,
  onAvatarChange,
  onToggleHideProfile,
  onToggleBotPrivate,
  onOpenPrivateVault,
  onOpenConnectors,
}) => {
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<HermesSessionSearchHit[]>([]);
  const [searchingMessages, setSearchingMessages] = useState(false);
  const [openTargetSession, setOpenTargetSession] = useState<{
    botName: string;
    sessionId: string;
    title?: string | null;
  } | null>(null);
  const [localChiefBot, setLocalChiefBot] = useState<string | null>(() => loadChiefBot());
  const [localPinnedBots, setLocalPinnedBots] = useState<string[]>(() => loadPinnedBots());

  // Create Bot & Import Sheets
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const [showImportSheet, setShowImportSheet] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createSoul, setCreateSoul] = useState("");
  const [createAvatarPreview, setCreateAvatarPreview] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastCreateTriggerRef = useRef<number>(openCreateTrigger);

  // Model Picker Sheet (for BotManageSheet)
  const [modelPickerProfile, setModelPickerProfile] = useState<HermesProfile | null>(null);

  // Manage / Edit Bot Sheet
  const [manageProfile, setManageProfile] = useState<HermesProfile | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editSoul, setEditSoul] = useState("");
  const [loadingSoul, setLoadingSoul] = useState(false);
  const [savingBot, setSavingBot] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [confirmDeleteBot, setConfirmDeleteBot] = useState<HermesProfile | null>(null);
  const [deletingBot, setDeletingBot] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (openCreateTrigger > lastCreateTriggerRef.current) {
      lastCreateTriggerRef.current = openCreateTrigger;
      setCreateError(null);
      setCreateName("");
      setCreateDesc("");
      setCreateSoul("");
      setCreateAvatarPreview(null);
      setShowCreateSheet(true);
    } else if (openCreateTrigger < lastCreateTriggerRef.current) {
      lastCreateTriggerRef.current = openCreateTrigger;
    }
  }, [openCreateTrigger]);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.name === selectedBotName) || null,
    [profiles, selectedBotName]
  );

  const privateSet = useMemo(() => new Set(privateProfileNames), [privateProfileNames]);

  const publicProfiles = useMemo(() => {
    const hiddenSet = new Set(hiddenProfiles);
    return profiles.filter((p) => !hiddenSet.has(p.name) && !privateSet.has(p.name));
  }, [profiles, hiddenProfiles, privateSet]);

  const chiefBotName = useMemo(
    () => resolveChiefBotName(publicProfiles, localChiefBot),
    [publicProfiles, localChiefBot]
  );

  const pinnedBotNames = useMemo(
    () => resolvePinnedBotNames(publicProfiles, localPinnedBots, chiefBotName),
    [publicProfiles, localPinnedBots, chiefBotName]
  );

  const showcaseProfiles = useMemo(() => {
    const byName = new Map(publicProfiles.map((p) => [p.name, p]));
    const list: HermesProfile[] = [];
    if (chiefBotName && byName.has(chiefBotName)) {
      list.push(byName.get(chiefBotName)!);
    }
    for (const name of pinnedBotNames) {
      const p = byName.get(name);
      if (p && p.name !== chiefBotName) list.push(p);
    }
    return list;
  }, [chiefBotName, pinnedBotNames, publicProfiles]);

  const showcaseNameSet = useMemo(
    () => new Set(showcaseProfiles.map((p) => p.name)),
    [showcaseProfiles]
  );

  const handleToggleChiefBot = useCallback(
    async (profile: HermesProfile) => {
      const isAlreadyChief = chiefBotName === profile.name;
      const prevChiefProfile =
        chiefBotName && chiefBotName !== profile.name
          ? profiles.find((p) => p.name === chiefBotName) || null
          : null;
      const nextChief = isAlreadyChief ? null : profile.name;
      setLocalChiefBot(nextChief);
      saveChiefBot(nextChief);

      if (!isAlreadyChief && localPinnedBots.includes(profile.name)) {
        const cleaned = localPinnedBots.filter((n) => n !== profile.name);
        setLocalPinnedBots(cleaned);
        savePinnedBots(cleaned);
      }

      if (wsState === "connected") {
        const calls: Promise<unknown>[] = [
          hermesWs
            .call("profiles.configure", {
              name: profile.name,
              ui_meta: {
                "hermes-pocket": {
                  ...getPocketUiMeta(profile),
                  chief: !isAlreadyChief,
                  ...(!isAlreadyChief ? { pinned: false } : {}),
                },
              },
            })
            .catch(() => null),
        ];
        if (prevChiefProfile) {
          calls.push(
            hermesWs
              .call("profiles.configure", {
                name: prevChiefProfile.name,
                ui_meta: {
                  "hermes-pocket": {
                    ...getPocketUiMeta(prevChiefProfile),
                    chief: false,
                  },
                },
              })
              .catch(() => null)
          );
        }
        await Promise.all(calls);
        void onRefreshProfiles();
      }
    },
    [chiefBotName, localPinnedBots, onRefreshProfiles, profiles, wsState]
  );

  const handleTogglePinBot = useCallback(
    async (profile: HermesProfile) => {
      if (chiefBotName === profile.name) return;
      const isPinned = pinnedBotNames.includes(profile.name);
      const nextPinned = isPinned
        ? pinnedBotNames.filter((n) => n !== profile.name)
        : [...pinnedBotNames, profile.name].slice(0, 3);
      setLocalPinnedBots(nextPinned);
      savePinnedBots(nextPinned);

      if (wsState === "connected") {
        await hermesWs
          .call("profiles.configure", {
            name: profile.name,
            ui_meta: {
              "hermes-pocket": {
                ...getPocketUiMeta(profile),
                pinned: !isPinned,
              },
            },
          })
          .catch(() => null);
        void onRefreshProfiles();
      }
    },
    [chiefBotName, onRefreshProfiles, pinnedBotNames, wsState]
  );

  const filteredProfiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...publicProfiles].sort((a, b) => {
      const rank = (n: string) => (n === "mika" ? 0 : n === "default" ? 1 : 2);
      const diff = rank(a.name) - rank(b.name);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name, "de");
    });
    if (!q) {
      return sorted.filter((p) => !showcaseNameSet.has(p.name));
    }
    return sorted.filter((p) => {
      const vis = getBotVisual(p);
      return (
        p.name.toLowerCase().includes(q) ||
        vis.label.toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q)
      );
    });
  }, [publicProfiles, query, showcaseNameSet]);

  // Debounced full-text search across all non-private bot conversations
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.toLowerCase() === "/privat" && onOpenPrivateVault) {
      setQuery("");
      setSearchHits([]);
      onOpenPrivateVault();
      return;
    }
    if (trimmed.length < 2 || publicProfiles.length === 0) {
      setSearchHits((prev) => (prev.length === 0 ? prev : []));
      setSearchingMessages(false);
      return;
    }
    let cancelled = false;
    setSearchingMessages(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const perBot = await Promise.all(
            publicProfiles.map((p) => searchSessions(trimmed, p.name, 5).catch(() => []))
          );
          if (cancelled) return;
          const merged = perBot
            .flat()
            .filter((hit) => !privateSet.has(hit.profile))
            .sort((a, b) => {
              const ta = toTimestampMs(a.last_active ?? a.session_started ?? a.started_at) ?? 0;
              const tb = toTimestampMs(b.last_active ?? b.session_started ?? b.started_at) ?? 0;
              return tb - ta;
            })
            .slice(0, 20);
          setSearchHits(merged);
        } finally {
          if (!cancelled) setSearchingMessages(false);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onOpenPrivateVault, privateSet, publicProfiles, query]);

  async function openManageSheet(profile: HermesProfile) {
    setManageProfile(profile);
    const vis = getBotVisual(profile);
    setEditTitle(profile.bot_title?.trim() || profile.display_name?.trim() || vis.label);
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
        soul: appendAutonomousGuidance(createSoul.trim()),
        mirror_credentials: true,
        share_auth: true,
      });
      const finalName = created?.name || slug;
      // Inherit default Hermes Anthropic fallback automatically on every newly created bot
      const defaultFallbacks = await fetchProfileFallback("default").catch(() => []);
      const targetFallbacks =
        defaultFallbacks.length > 0 ? defaultFallbacks : [RECOMMENDED_ANTHROPIC_FALLBACK];
      await updateProfileFallback(finalName, targetFallbacks).catch(() => null);

      const shortCallName = deriveShortBotCallName(createName || finalName);
      if (createAsPrivate) {
        await updateProfilePrivacy(finalName, true).catch(() => null);
      }
      if (wsState === "connected") {
        await hermesWs
          .call("profiles.configure", {
            name: finalName,
            ui_meta: {
              ...(shortCallName ? { "hermes-bots": { title: shortCallName } } : {}),
              ...(createAsPrivate ? { "hermes-pocket": { private: true } } : {}),
            },
          })
          .catch(() => null);
      }

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
      const cleanTitle = editTitle.trim();
      const existingBotsMeta =
        manageProfile.ui_meta &&
        typeof manageProfile.ui_meta["hermes-bots"] === "object" &&
        manageProfile.ui_meta["hermes-bots"] !== null
          ? (manageProfile.ui_meta["hermes-bots"] as Record<string, unknown>)
          : {};
      await Promise.all([
        updateProfileDescription(manageProfile.name, editDesc.trim()),
        updateProfileSoul(manageProfile.name, editSoul),
        wsState === "connected" && cleanTitle
          ? hermesWs
              .call("profiles.configure", {
                name: manageProfile.name,
                ui_meta: {
                  "hermes-bots": {
                    ...existingBotsMeta,
                    title: cleanTitle,
                  },
                },
              })
              .catch(() => null)
          : Promise.resolve(),
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
    const isPrivateSelected = privateSet.has(selectedProfile.name);
    const matchingTargetSession =
      openTargetSession && openTargetSession.botName === selectedProfile.name
        ? openTargetSession
        : null;
    return (
      <>
        <DirectChatView
          profile={selectedProfile}
          allProfiles={publicProfiles}
          isPrivateBot={isPrivateSelected}
          initialSessionId={matchingTargetSession?.sessionId || null}
          initialSessionTitle={matchingTargetSession?.title || null}
          avatarUrl={avatars[selectedProfile.name] || null}
          otherUnreadCount={otherUnreadCount}
          wsState={wsState}
          onBack={() => {
            setOpenTargetSession(null);
            onSelectBot(null);
          }}
          onMarkBotRead={onMarkBotRead}
          onRegisterSession={onRegisterSession}
          onOpenBotSettings={() => void openManageSheet(selectedProfile)}
          onOpenConnectors={onOpenConnectors}
          onRefreshProfiles={onRefreshProfiles}
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
            editTitle={editTitle}
            editDesc={editDesc}
            editSoul={editSoul}
            loadingSoul={loadingSoul}
            saving={savingBot}
            error={manageError}
            onChangeTitle={setEditTitle}
            onChangeDesc={setEditDesc}
            onChangeSoul={setEditSoul}
            onPickImage={() => editFileInputRef.current?.click()}
            onClearImage={() => void handleClearAvatar()}
            onOpenModelPicker={() => {
              const target = manageProfile;
              setManageProfile(null);
              setModelPickerProfile(target);
            }}
            onSave={handleSaveBotDetails}
            onRequestDelete={() => setConfirmDeleteBot(manageProfile)}
            isPrivate={privateSet.has(manageProfile.name)}
            isChief={chiefBotName === manageProfile.name}
            isPinned={pinnedBotNames.includes(manageProfile.name)}
            pushEnabled={
              !privateSet.has(manageProfile.name) &&
              pushPreferences.globalEnabled &&
              !pushPreferences.disabledBots.includes(manageProfile.name)
            }
            pushGlobalEnabled={pushPreferences.globalEnabled}
            onTogglePush={
              !privateSet.has(manageProfile.name) && onToggleBotPush
                ? () => {
                    const currentlyOn = !pushPreferences.disabledBots.includes(manageProfile.name);
                    void onToggleBotPush(manageProfile.name, !currentlyOn);
                  }
                : undefined
            }
            onToggleChief={
              !privateSet.has(manageProfile.name)
                ? () => void handleToggleChiefBot(manageProfile)
                : undefined
            }
            onTogglePin={
              !privateSet.has(manageProfile.name) && chiefBotName !== manageProfile.name
                ? () => void handleTogglePinBot(manageProfile)
                : undefined
            }
            onTogglePrivate={
              onToggleBotPrivate && !manageProfile.is_default
                ? async () => {
                    const target = manageProfile;
                    const makePriv = !privateSet.has(target.name);
                    setManageProfile(null);
                    await onToggleBotPrivate(target, makePriv);
                  }
                : undefined
            }
            onRequestHide={
              onToggleHideProfile
                ? () => {
                    onToggleHideProfile(manageProfile.name);
                    if (selectedBotName === manageProfile.name) onSelectBot(null);
                    setManageProfile(null);
                  }
                : undefined
            }
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
        {modelPickerProfile && (
          <ModelPickerSheet
            open
            profileName={modelPickerProfile.name}
            botLabel={getBotVisual(modelPickerProfile).label}
            allProfileNames={profiles.map((p) => p.name)}
            currentProvider={modelPickerProfile.provider}
            currentModel={modelPickerProfile.model}
            onSwitched={() => void onRefreshProfiles()}
            onClose={() => setModelPickerProfile(null)}
          />
        )}
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
          placeholder="Bots & Gespräche durchsuchen"
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
      ) : filteredProfiles.length === 0 && (query.trim() || showcaseProfiles.length === 0) ? (
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
        <>
          {!query.trim() && showcaseProfiles.length > 0 && (
            <section className="bot-showcase" aria-label="Chef und angeheftete Bots">
              {showcaseProfiles.map((profile) => {
                const visual = getBotVisual(profile);
                const isChief = chiefBotName === profile.name;
                const unread = unreadByBot[profile.name];
                return (
                  <div key={profile.name} className="bot-showcase-item">
                    <button
                      type="button"
                      className={`bot-showcase-btn ${isChief ? "is-chief" : ""} ${unread ? "has-unread" : ""}`}
                      aria-label={
                        unread
                          ? `${visual.label}${isChief ? " (Chef)" : ""} – ${unread.count} neue ${unread.count === 1 ? "Nachricht" : "Nachrichten"}`
                          : `${visual.label}${isChief ? " (Chef)" : ""}`
                      }
                      onClick={() => onSelectBot(profile.name)}
                    >
                      <span className="bot-showcase-avatar-wrap">
                        <BotAvatar
                          visual={visual}
                          imageUrl={avatars[profile.name]}
                          size="xl"
                          online={profile.gateway_running}
                          showStatus={!isChief}
                        />
                        {isChief && (
                          <span
                            className="chief-star-badge"
                            title="Chef-Bot"
                            aria-hidden="true"
                          >
                            <Star size={14} fill="currentColor" strokeWidth={2.2} />
                          </span>
                        )}
                        {unread && (
                          <span
                            className="showcase-unread-badge"
                            aria-hidden="true"
                          >
                            {formatBadgeCount(unread.count)}
                          </span>
                        )}
                      </span>
                      <span className="bot-showcase-label">{visual.label}</span>
                    </button>
                  </div>
                );
              })}
            </section>
          )}

          {filteredProfiles.length > 0 && (
            <div className="bot-list">
              {filteredProfiles.map((profile) => {
                const visual = getBotVisual(profile);
                const recent = recentByProfile[profile.name];
                const unread = unreadByBot[profile.name];
                const displayTime = unread?.latestTimestampMs || recent?.last_active;
                const isChief = chiefBotName === profile.name;
                return (
                  <div
                    key={profile.name}
                    className={`bot-list-item ${unread ? "has-unread" : ""}`}
                  >
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
                          <span className="bot-card-name-wrap">
                            <span className="bot-card-name">{visual.label}</span>
                            {isChief && (
                              <span className="chief-inline-pill" title="Chef-Bot">
                                <Star size={10} fill="currentColor" />
                                Chef
                              </span>
                            )}
                          </span>
                          {displayTime && (
                            <span className={`bot-list-time ${unread ? "unread" : ""}`}>
                              {formatRelativeTime(displayTime)}
                            </span>
                          )}
                        </div>
                        <div className="bot-card-subrow">
                          <span className={`bot-card-meta ${unread ? "unread" : ""}`}>
                            {unread?.preview ||
                              profile.description?.trim() ||
                              recent?.title ||
                              "Bereit zum Chatten"}
                          </span>
                          {unread && (
                            <span
                              className="unread-badge"
                              aria-label={`${unread.count} neue ${unread.count === 1 ? "Nachricht" : "Nachrichten"}`}
                            >
                              {formatBadgeCount(unread.count)}
                            </span>
                          )}
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
        </>
      )}

      {query.trim().length >= 2 && (
        <div style={{ marginTop: 14 }}>
          <div className="section-header" style={{ marginTop: 4 }}>
            <span className="section-title">
              Treffer in Gesprächen ({searchingMessages ? "…" : searchHits.length})
            </span>
          </div>
          {searchingMessages && searchHits.length === 0 ? (
            <div className="empty-state" style={{ padding: "18px 14px" }}>
              <p style={{ margin: 0 }}>Durchsuche alle Bot-Gespräche…</p>
            </div>
          ) : searchHits.length === 0 ? (
            <div className="empty-state" style={{ padding: "16px 14px" }}>
              <p style={{ margin: 0 }}>Keine passenden Nachrichten gefunden.</p>
            </div>
          ) : (
            <div className="card-stack">
              {searchHits.map((hit) => {
                const prof = profiles.find((p) => p.name === hit.profile);
                const vis = prof
                  ? getBotVisual(prof)
                  : getBotVisual({
                      name: hit.profile,
                      display_name: hit.profile,
                      bot_title: "",
                      description: "",
                      model: null,
                    });
                const snippet = cleanSearchSnippet(hit.snippet || hit.preview);
                const ts = hit.last_active ?? hit.session_started ?? hit.started_at;
                return (
                  <button
                    key={`${hit.profile}:${hit.session_id}`}
                    type="button"
                    className="search-hit-card"
                    onClick={() => {
                      setOpenTargetSession({
                        botName: hit.profile,
                        sessionId: hit.session_id,
                        title: hit.title,
                      });
                      onSelectBot(hit.profile);
                    }}
                  >
                    <BotAvatar visual={vis} imageUrl={avatars[hit.profile]} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="bot-card-row">
                        <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{vis.label}</span>
                        {ts && (
                          <span className="bot-list-time">{formatRelativeTime(ts)}</span>
                        )}
                      </div>
                      {hit.title && (
                        <div style={{ fontSize: "0.74rem", color: "var(--accent-indigo)", marginTop: 1, display: "flex", alignItems: "center", gap: 4 }}>
                          <MessageSquare size={11} />
                          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {hit.title}
                          </span>
                        </div>
                      )}
                      {snippet && <div className="search-hit-snippet">{snippet}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
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
          <h2 className="sheet-title">
            {createAsPrivate ? "Privaten Bot hinzufügen" : "Bot hinzufügen"}
          </h2>
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

        <button
          type="button"
          className="btn full"
          style={{ marginBottom: 16, borderColor: "rgba(245, 158, 11, 0.4)" }}
          disabled={creating}
          onClick={() => {
            setShowCreateSheet(false);
            setShowImportSheet(true);
          }}
        >
          <Download size={16} style={{ color: "var(--accent-send)" }} />
          Aus Grok Bot importieren…
        </button>

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
          editTitle={editTitle}
          editDesc={editDesc}
          editSoul={editSoul}
          loadingSoul={loadingSoul}
          saving={savingBot}
          error={manageError}
          onChangeTitle={setEditTitle}
          onChangeDesc={setEditDesc}
          onChangeSoul={setEditSoul}
          onPickImage={() => editFileInputRef.current?.click()}
          onClearImage={() => void handleClearAvatar()}
          onOpenModelPicker={() => {
            const target = manageProfile;
            setManageProfile(null);
            setModelPickerProfile(target);
          }}
          onSave={handleSaveBotDetails}
          onRequestDelete={() => setConfirmDeleteBot(manageProfile)}
          isPrivate={privateSet.has(manageProfile.name)}
          isChief={chiefBotName === manageProfile.name}
          isPinned={pinnedBotNames.includes(manageProfile.name)}
          pushEnabled={
            !privateSet.has(manageProfile.name) &&
            pushPreferences.globalEnabled &&
            !pushPreferences.disabledBots.includes(manageProfile.name)
          }
          pushGlobalEnabled={pushPreferences.globalEnabled}
          onTogglePush={
            !privateSet.has(manageProfile.name) && onToggleBotPush
              ? () => {
                  const currentlyOn = !pushPreferences.disabledBots.includes(manageProfile.name);
                  void onToggleBotPush(manageProfile.name, !currentlyOn);
                }
              : undefined
          }
          onToggleChief={
            !privateSet.has(manageProfile.name)
              ? () => void handleToggleChiefBot(manageProfile)
              : undefined
          }
          onTogglePin={
            !privateSet.has(manageProfile.name) && chiefBotName !== manageProfile.name
              ? () => void handleTogglePinBot(manageProfile)
              : undefined
          }
          onTogglePrivate={
            onToggleBotPrivate && !manageProfile.is_default
              ? async () => {
                  const target = manageProfile;
                  const makePriv = !privateSet.has(target.name);
                  setManageProfile(null);
                  await onToggleBotPrivate(target, makePriv);
                }
              : undefined
          }
          onRequestHide={
            onToggleHideProfile
              ? () => {
                  onToggleHideProfile(manageProfile.name);
                  setManageProfile(null);
                }
              : undefined
          }
          onClose={() => setManageProfile(null)}
        />
      )}

      <BotImportSheet
        open={showImportSheet}
        wsState={wsState}
        asPrivate={createAsPrivate}
        onClose={() => setShowImportSheet(false)}
        onImported={async (name, avatarData) => {
          if (avatarData) onAvatarChange(name, avatarData);
          await onRefreshProfiles();
          onSelectBot(name);
        }}
      />

      {modelPickerProfile && (
        <ModelPickerSheet
          open
          profileName={modelPickerProfile.name}
          botLabel={getBotVisual(modelPickerProfile).label}
          allProfileNames={profiles.map((p) => p.name)}
          currentProvider={modelPickerProfile.provider}
          currentModel={modelPickerProfile.model}
          onSwitched={() => void onRefreshProfiles()}
          onClose={() => setModelPickerProfile(null)}
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
  editTitle: string;
  editDesc: string;
  editSoul: string;
  loadingSoul: boolean;
  saving: boolean;
  error: string | null;
  onChangeTitle: (val: string) => void;
  onChangeDesc: (val: string) => void;
  onChangeSoul: (val: string) => void;
  onPickImage: () => void;
  onClearImage: () => void;
  onOpenModelPicker: () => void;
  onSave: (e: React.FormEvent) => void;
  onRequestDelete: () => void;
  isPrivate?: boolean;
  isChief?: boolean;
  isPinned?: boolean;
  pushEnabled?: boolean;
  pushGlobalEnabled?: boolean;
  onTogglePush?: () => void;
  onToggleChief?: () => void;
  onTogglePin?: () => void;
  onTogglePrivate?: () => Promise<void> | void;
  onRequestHide?: () => void;
  onClose: () => void;
}

const BotManageSheet: React.FC<BotManageSheetProps> = ({
  profile,
  avatarUrl,
  wsState,
  editTitle,
  editDesc,
  editSoul,
  loadingSoul,
  saving,
  error,
  onChangeTitle,
  onChangeDesc,
  onChangeSoul,
  onPickImage,
  onClearImage,
  onOpenModelPicker,
  onSave,
  onRequestDelete,
  isPrivate = false,
  isChief = false,
  isPinned = false,
  pushEnabled = true,
  pushGlobalEnabled = true,
  onTogglePush,
  onToggleChief,
  onTogglePin,
  onTogglePrivate,
  onRequestHide,
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
        <button
          type="button"
          className="btn sm"
          disabled={saving}
          onClick={onOpenModelPicker}
        >
          <Cpu size={14} />
          {profile.provider ? `${profile.provider} / ` : ""}
          {profile.model || "Modell & Anbieter wählen"}
        </button>

        {(onToggleChief || onTogglePin || onTogglePush || isPrivate) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {onToggleChief && (
              <button
                type="button"
                className={`btn sm ${isChief ? "chief-active-btn" : ""}`}
                disabled={saving}
                onClick={onToggleChief}
              >
                <Star size={14} fill={isChief ? "currentColor" : "none"} />
                {isChief ? "Chef-Bot (entfernen)" : "Als Chef oben markieren"}
              </button>
            )}
            {onTogglePin && (
              <button
                type="button"
                className={`btn sm ${isPinned ? "primary" : ""}`}
                disabled={saving}
                onClick={onTogglePin}
              >
                <Pin size={14} />
                {isPinned ? "Oben angeheftet" : "Oben anheften"}
              </button>
            )}
            {onTogglePush && !isPrivate && (
              <button
                type="button"
                className={`btn sm ${pushEnabled ? "push-active-btn" : ""}`}
                disabled={saving || !pushGlobalEnabled}
                title={
                  !pushGlobalEnabled
                    ? "Master-Schalter für Push ist aus (unter Konto aktivieren)"
                    : undefined
                }
                onClick={onTogglePush}
              >
                {pushEnabled ? <Bell size={14} /> : <BellOff size={14} />}
                {!pushGlobalEnabled
                  ? "Push (alle aus)"
                  : pushEnabled
                    ? "Push: An"
                    : "Push: Aus"}
              </button>
            )}
            {isPrivate && (
              <span className="pill" style={{ fontSize: "0.74rem" }}>
                <BellOff size={12} /> Push dauerhaft aus (Privat)
              </span>
            )}
          </div>
        )}
      </div>

      <form onSubmit={onSave}>
        <div className="field">
          <label htmlFor="edit-bot-title">Rufname (Anzeigename · funktioniert ohne @)</label>
          <input
            id="edit-bot-title"
            className="input"
            value={editTitle}
            onChange={(e) => onChangeTitle(e.target.value)}
            placeholder="z. B. Clara, Anna, Nina, Mika"
          />
        </div>

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

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 8 }}>
        {!profile.is_default && onTogglePrivate && (
          <button
            type="button"
            className="btn full"
            style={{ borderColor: isPrivate ? "rgba(52, 211, 153, 0.35)" : undefined }}
            disabled={saving}
            onClick={() => void onTogglePrivate()}
          >
            {isPrivate ? <Unlock size={15} /> : <Lock size={15} />}
            {isPrivate
              ? "Aus privatem Bereich holen (sichtbar machen)"
              : "In privaten Bereich verschieben (isoliert)"}
          </button>
        )}
        {!profile.is_default ? (
          <button
            type="button"
            className="btn danger full"
            disabled={saving}
            onClick={onRequestDelete}
          >
            <Trash2 size={15} /> Bot dauerhaft aus Hermes löschen
          </button>
        ) : (
          onRequestHide && (
            <>
              <button
                type="button"
                className="btn danger full"
                disabled={saving}
                onClick={onRequestHide}
              >
                Aus meiner Bot-Liste ausblenden
              </button>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center" }}>
                Hinweis: Das System-Basisprofil „default“ trägt den Hermes-Gateway und kann nicht gelöscht, aber jederzeit ausgeblendet werden.
              </span>
            </>
          )
        )}
      </div>
    </Sheet>
  );
};

// ── Direct 1:1 Bot Chat Screen ────────────────────────────────────────────────

interface DirectChatViewProps {
  profile: HermesProfile;
  allProfiles: HermesProfile[];
  isPrivateBot?: boolean;
  initialSessionId?: string | null;
  initialSessionTitle?: string | null;
  avatarUrl: string | null;
  otherUnreadCount?: number;
  wsState: WsConnectionState;
  onBack: () => void;
  onMarkBotRead?: (
    profileName: string,
    info?: {
      sessionId?: string | null;
      lastActiveMs?: number;
      messageCount?: number;
      messages?: HermesChatMessage[];
    }
  ) => void;
  onRegisterSession?: (profileName: string, sessionId: string | null) => void;
  onOpenBotSettings: () => void;
  onOpenConnectors?: () => void;
  onRefreshProfiles: () => Promise<void> | void;
}

interface QueuedAttachment {
  id: string;
  file: File;
  isImage: boolean;
  previewUrl?: string;
}

const DirectChatView: React.FC<DirectChatViewProps> = ({
  profile,
  allProfiles,
  isPrivateBot = false,
  initialSessionId = null,
  initialSessionTitle = null,
  avatarUrl,
  otherUnreadCount = 0,
  wsState,
  onBack,
  onMarkBotRead,
  onRegisterSession,
  onOpenBotSettings,
  onOpenConnectors,
  onRefreshProfiles,
}) => {
  const visual = getBotVisual(profile);
  const allProfileNames = useMemo(() => allProfiles.map((p) => p.name), [allProfiles]);
  const canonicalTitle = isPrivateBot ? PRIVATE_CHAT_TITLE : BOT_CHAT_TITLE;
  const [showAvatarLightbox, setShowAvatarLightbox] = useState(false);

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
  const [pendingSecret, setPendingSecret] = useState<HermesServerRequest | null>(null);
  const [pendingVaultForm, setPendingVaultForm] = useState<DetectedVaultRequest | null>(null);
  const [manualSecret, setManualSecret] = useState<{
    open: boolean;
    formTitle?: string;
    initialKey: string;
    promptText?: string;
    fields?: DetectedSecretRequest[];
  }>({
    open: false,
    initialKey: "",
  });

  // Live Chat & Plan Limit + Automatic Fallback state
  const [usage, setUsage] = useState<ChatUsageState>(EMPTY_CHAT_USAGE);
  const [loadingAccountUsage, setLoadingAccountUsage] = useState(false);
  const [fallbacks, setFallbacks] = useState<HermesFallbackProvider[]>([]);
  const [usageLimitError, setUsageLimitError] = useState<HermesUsageLimitError | null>(null);
  const [switchingFallback, setSwitchingFallback] = useState(false);
  const [showLimitSheet, setShowLimitSheet] = useState(false);

  const [activeModelOverride, setActiveModelOverride] = useState<{
    provider: string;
    model: string;
  } | null>(null);
  const [modelPickerState, setModelPickerState] = useState<{
    open: boolean;
    search: string;
    provider: string;
  }>({ open: false, search: "", provider: "" });

  const [showSessionsSheet, setShowSessionsSheet] = useState(false);
  const [showActionsSheet, setShowActionsSheet] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<HermesSessionSummary | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const [openPocketPage, setOpenPocketPage] = useState<DetectedPocketPage | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imagePickerRef = useRef<HTMLInputElement | null>(null);
  const filePickerRef = useRef<HTMLInputElement | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const attachedOnWsRef = useRef<boolean>(false);
  const execGenerationRef = useRef<number>(0);
  const scrollTimersRef = useRef<number[]>([]);
  const isNearBottomRef = useRef<boolean>(true);

  activeSessionRef.current = activeSessionId;

  const handleMessagesScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distanceFromBottom < 140;
    isNearBottomRef.current = near;
    if (near) {
      setHasNewBelow(false);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        isNearBottomRef.current = true;
        setHasNewBelow(false);
      }
    });
  }, []);

  const scrollIfNearBottom = useCallback(() => {
    if (isNearBottomRef.current) {
      scrollToBottom();
    } else {
      setHasNewBelow(true);
    }
  }, [scrollToBottom]);

  const scrollToBottomWithSettle = useCallback(() => {
    for (const id of scrollTimersRef.current) window.clearTimeout(id);
    scrollTimersRef.current = [];
    scrollToBottom();
    for (const delay of [60, 180, 340]) {
      scrollTimersRef.current.push(window.setTimeout(scrollToBottom, delay));
    }
  }, [scrollToBottom]);

  // Always jump to latest message when mobile keyboard opens
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

  const refreshAccountUsage = useCallback(
    async (sidOverride?: string | null) => {
      if (wsState !== "connected") return;
      const targetSid = sidOverride ?? activeSessionRef.current;
      setLoadingAccountUsage(true);
      try {
        const res = await hermesWs.call<HermesAccountUsageResponse>(
          "session.account_usage",
          {
            ...(targetSid ? { session_id: targetSid } : {}),
            profile: profile.name,
          },
          12_000
        );
        setUsage((prev) => mergeAccountUsage(prev, res));
      } catch {
        // Optional depending on active provider
      } finally {
        setLoadingAccountUsage(false);
      }
    },
    [profile.name, wsState]
  );

  // Load configured automatic fallback chain for this bot
  useEffect(() => {
    let cancelled = false;
    setUsage(EMPTY_CHAT_USAGE);
    setUsageLimitError(null);
    setActiveModelOverride(null);
    void fetchProfileFallback(profile.name)
      .then((list) => {
        if (!cancelled) setFallbacks(list);
      })
      .catch(() => {
        if (!cancelled) setFallbacks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [profile.name]);

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
      setPendingSecret(null);
      setUsageLimitError(null);
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
            usage?: Record<string, unknown> | null;
            info?: { usage?: Record<string, unknown> | null } | null;
          }>("session.resume", {
            session_id: sessionId,
            profile: profile.name,
          });
          const resolvedSid = snapshot?.session_id || sessionId;
          if (snapshot?.session_id) {
            setActiveSessionId(snapshot.session_id);
          }
          if (typeof snapshot?.execution_generation === "number") {
            execGenerationRef.current = snapshot.execution_generation;
          }
          attachedOnWsRef.current = true;
          let loaded = normalizeMessages(snapshot?.messages || []);
          if (loaded.length === 0 && resolvedSid) {
            const restLoaded = await fetchSessionMessages(resolvedSid, profile.name).catch(() => []);
            if (restLoaded.length > 0) loaded = restLoaded;
          }
          if (snapshot?.inflight?.assistant) {
            loaded.push({
              id: "inflight",
              role: "assistant",
              content: snapshot.inflight.assistant,
              streaming: Boolean(snapshot.inflight.streaming || snapshot.running),
            });
          }
          setMessages(loaded);
          onRegisterSession?.(profile.name, resolvedSid);
          onMarkBotRead?.(profile.name, { sessionId: resolvedSid, messages: loaded });
          setIsStreaming(Boolean(snapshot?.running || snapshot?.inflight?.streaming));
          setPendingApproval(snapshot?.pending_approval || snapshot?.prompts?.[0] || null);
          setPendingConnection(snapshot?.pending_connection || null);
          const snapUsage = snapshot?.usage || snapshot?.info?.usage;
          if (snapUsage && typeof snapUsage === "object") {
            setUsage((prev) => mergeUsagePayload(prev, snapUsage));
          }
          void refreshAccountUsage(resolvedSid);
        } else {
          const loaded = await fetchSessionMessages(sessionId, profile.name);
          setMessages(loaded);
          onRegisterSession?.(profile.name, sessionId);
          onMarkBotRead?.(profile.name, { sessionId, messages: loaded });
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

  const openCanonicalBotChat = useCallback(
    async (existingSessions?: HermesSessionSummary[], silentReattach = false) => {
      if (!silentReattach) {
        setLoadingChat(true);
      }
      setChatError(null);
      setPendingApproval(null);
      setPendingConnection(null);
      setPendingClarify(null);
      setPendingSecret(null);
      setUsageLimitError(null);
      attachedOnWsRef.current = false;

      try {
        // If no canonical "Bot Chat" exists yet, promote the bot's existing latest
        // interactive chat (e.g. from before Bot Mode) to "Bot Chat" first so its
        // message history stays right on screen instead of starting blank.
        const list = existingSessions ?? sessions;
        const hasCanonical = list.some((s) => (s.title || "").trim() === canonicalTitle);
        if (!hasCanonical) {
          const existing = pickPreferredBotSession(list);
          if (existing) {
            await renameSession(existing.id, canonicalTitle, profile.name).catch(() => null);
          }
        }

        const snapshot = await hermesWs.call<{
          session_id?: string;
          messages?: unknown[];
          running?: boolean;
          execution_generation?: number;
          inflight?: { assistant?: string; streaming?: boolean } | null;
          pending_approval?: HermesPendingApproval | null;
          prompts?: HermesPendingApproval[];
          pending_connection?: HermesConnectionRequest | null;
          usage?: Record<string, unknown> | null;
          info?: { usage?: Record<string, unknown> | null } | null;
        }>("session.create", {
          profile: profile.name,
          request_id: randomClientId(isPrivateBot ? "privchat" : "botchat"),
          source: "gui",
          title: canonicalTitle,
        });

        const resolvedSid = snapshot?.session_id || null;
        setActiveSessionId(resolvedSid);
        setActiveTitle(canonicalTitle);
        if (typeof snapshot?.execution_generation === "number") {
          execGenerationRef.current = snapshot.execution_generation;
        }
        attachedOnWsRef.current = Boolean(resolvedSid);

        let loaded = normalizeMessages(snapshot?.messages || []);
        if (loaded.length === 0 && resolvedSid) {
          const restLoaded = await fetchSessionMessages(resolvedSid, profile.name).catch(() => []);
          if (restLoaded.length > 0) loaded = restLoaded;
        }
        if (snapshot?.inflight?.assistant) {
          loaded.push({
            id: "inflight",
            role: "assistant",
            content: snapshot.inflight.assistant,
            streaming: Boolean(snapshot.inflight.streaming || snapshot.running),
          });
        }
        if (loaded.length > 0 || !silentReattach) {
          setMessages(loaded);
        }
        onRegisterSession?.(profile.name, resolvedSid);
        onMarkBotRead?.(profile.name, { sessionId: resolvedSid, messages: loaded });
        setIsStreaming(Boolean(snapshot?.running || snapshot?.inflight?.streaming));
        setPendingApproval(snapshot?.pending_approval || snapshot?.prompts?.[0] || null);
        setPendingConnection(snapshot?.pending_connection || null);
        const snapUsage = snapshot?.usage || snapshot?.info?.usage;
        if (snapUsage && typeof snapUsage === "object") {
          setUsage((prev) => mergeUsagePayload(prev, snapUsage));
        }
        void refreshAccountUsage(resolvedSid);
        if (!silentReattach) {
          scrollToBottom();
        }
      } catch (err) {
        setChatError(
          err instanceof Error ? err.message : "Bot-Chat konnte nicht geöffnet werden."
        );
      } finally {
        setLoadingChat(false);
      }
    },
    [profile.name, refreshAccountUsage, scrollToBottom, sessions]
  );

  const refreshSessionsList = useCallback(
    async (autoOpenFirst = false) => {
      try {
        const list = await fetchSessions(profile.name, 30);
        setSessions(list);
        if (autoOpenFirst) {
          if (initialSessionId) {
            await loadSessionHistory(initialSessionId, initialSessionTitle || "Suchtreffer");
            return;
          }
          if (wsState === "connected") {
            await openCanonicalBotChat(list, false);
            const refreshed = await fetchSessions(profile.name, 30).catch(() => list);
            setSessions(refreshed);
            return;
          }
          const preferred = pickPreferredBotSession(list);
          if (preferred) {
            await loadSessionHistory(preferred.id, preferred.title || canonicalTitle);
          } else {
            setActiveSessionId(null);
            setActiveTitle(canonicalTitle);
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
    [
      canonicalTitle,
      initialSessionId,
      initialSessionTitle,
      loadSessionHistory,
      openCanonicalBotChat,
      profile.name,
      wsState,
    ]
  );

  useEffect(() => {
    void refreshSessionsList(true);
  }, [profile.name, initialSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (wsState !== "connected") {
      // Gateway drops WS subscriptions on disconnect/restart — force clean re-attach on reconnect
      attachedOnWsRef.current = false;
      return;
    }
    if (!attachedOnWsRef.current) {
      if (activeSessionId && activeTitle !== canonicalTitle) {
        void loadSessionHistory(activeSessionId, activeTitle);
      } else {
        void openCanonicalBotChat(undefined, messages.length > 0);
      }
    } else {
      void refreshAccountUsage(activeSessionId);
    }
  }, [wsState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle server -> client requests (clarify, approval, secret, sudo, vault.*)
  useEffect(() => {
    return hermesWs.onServerRequest((req) => {
      const reqSid = typeof req.params.session_id === "string" ? req.params.session_id : null;
      if (reqSid && activeSessionRef.current && reqSid !== activeSessionRef.current) {
        hermesWs.sendErrorResponse(req.id, 4404, "Session not shown");
        return;
      }
      if (req.method === "clarify" || req.method === "clarify.request") {
        setPendingClarify(req);
        notifyIfBackgrounded({
          title: visual.label,
          body: "Rückfrage im Chat – bitte kurz auswählen.",
          bot: profile.name,
        });
        scrollToBottomWithSettle();
      } else if (req.method === "approval") {
        const appr: HermesPendingApproval = {
          ...(req.params as HermesPendingApproval),
          server_request_id: req.id,
        };
        const decision = evaluateApprovalPolicy(appr, loadAutoApproveSafe());
        if (decision.action === "auto_once") {
          hermesWs.sendResponse(req.id, { choice: "once" });
          const label = appr.description || appr.command || appr.tool_name || "Aktion";
          appendSystemNotice(`Automatisch freigegeben: ${String(label).slice(0, 90)}`);
        } else {
          setPendingApproval({
            ...appr,
            risk: decision.reason || appr.risk,
          });
          notifyIfBackgrounded({
            title: `${visual.label} · Freigabe nötig`,
            body: decision.reason || "Der Bot bittet um deine Freigabe.",
            bot: profile.name,
          });
          scrollToBottomWithSettle();
        }
      } else if (SECRET_REQUEST_METHODS.has(req.method)) {
        setPendingSecret(req);
        notifyIfBackgrounded({
          title: `${visual.label} · Sichere Abfrage`,
          body: "Passwort oder API-Key wird sicher angefordert.",
          bot: profile.name,
        });
        scrollToBottomWithSettle();
      } else {
        // Decline desktop-only window requests cleanly so the agent doesn't wait 300s
        hermesWs.sendErrorResponse(req.id, 4404, "Not supported on mobile web client");
      }
    });
  }, [scrollToBottomWithSettle]);

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
      } else if (ev.type === "session.usage" || ev.type === "session.info") {
        const usageObj =
          ev.type === "session.info" && ev.payload.usage && typeof ev.payload.usage === "object"
            ? (ev.payload.usage as Record<string, unknown>)
            : ev.payload;
        setUsage((prev) => mergeUsagePayload(prev, usageObj));
      } else if (ev.type === "request.cancel") {
        const cancelledId = ev.payload.request_id;
        if (cancelledId !== undefined) {
          setPendingClarify((cur) => (cur && String(cur.id) === String(cancelledId) ? null : cur));
          setPendingSecret((cur) => (cur && String(cur.id) === String(cancelledId) ? null : cur));
          setPendingApproval((cur) =>
            cur &&
            (String(cur.server_request_id) === String(cancelledId) ||
              String(cur.request_id) === String(cancelledId))
              ? null
              : cur
          );
        }
      } else if (ev.type === "message.complete") {
        const finalText = typeof ev.payload.text === "string" ? ev.payload.text : "";
        const finalReasoning =
          typeof ev.payload.reasoning === "string" ? ev.payload.reasoning : undefined;
        const errMsg = typeof ev.payload.error === "string" ? ev.payload.error : null;

        if (ev.payload.usage && typeof ev.payload.usage === "object") {
          setUsage((prev) => mergeUsagePayload(prev, ev.payload.usage as Record<string, unknown>));
        }
        const errSurface = ev.payload.error_surface as HermesErrorSurface | undefined;
        if (errSurface?.usage_limit) {
          setUsageLimitError(errSurface.usage_limit);
        } else if (
          errSurface?.code &&
          /limit|quota|rate|429|capacity/i.test(errSurface.code)
        ) {
          setUsageLimitError({
            limit_name: "Anbieter-Limit erreicht",
            message: errMsg || "Das Kontingent dieses Anbieters wurde erreicht.",
            resets_at_ms: errSurface.resets_at ? errSurface.resets_at * 1000 : null,
          });
        } else if (!errMsg) {
          setUsageLimitError(null);
        }

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
        // Automatically detect when a bot asks for a Vault entry (card/address/shop login)
        // OR a single/multi-field .env secret form and pop up the protected card in chat.
        if (finalText) {
          const detectedVault = detectBotVaultRequest(finalText);
          if (detectedVault) {
            setPendingVaultForm(detectedVault);
          } else {
            const detectedForm = detectBotSecretForm(finalText);
            if (detectedForm && detectedForm.fields.length > 0) {
              setManualSecret({
                open: true,
                formTitle: detectedForm.title,
                initialKey: detectedForm.fields[0].keyName,
                promptText: detectedForm.fields[0].prompt,
                fields: detectedForm.fields.length > 1 ? detectedForm.fields : undefined,
              });
            }
          }
          if (!isPrivateBot) {
            notifyIfBackgrounded({
              title: visual.label,
              body: stripSecretRequestTag(finalText).slice(0, 180),
              bot: profile.name,
            });
          }
        }
        if (document.visibilityState === "visible") {
          onMarkBotRead?.(profile.name, {
            sessionId: activeSessionRef.current,
            lastActiveMs: Date.now(),
          });
        }
        void refreshAccountUsage(activeSessionRef.current);
        scrollIfNearBottom();
      } else if (ev.type === "approval.requested") {
        const appr = ev.payload as HermesPendingApproval;
        const decision = evaluateApprovalPolicy(appr, loadAutoApproveSafe());
        const sid = activeSessionRef.current;
        const promptId = appr.prompt_id || appr.request_id || appr.approval_id || appr.id;
        if (decision.action === "auto_once" && sid && promptId) {
          void hermesWs
            .call("approval.respond", {
              session_id: sid,
              profile: profile.name,
              execution_generation: appr.execution_generation ?? execGenerationRef.current,
              prompt_id: promptId,
              choice: "once",
            })
            .then(() => {
              const label = appr.description || appr.command || appr.tool_name || "Aktion";
              appendSystemNotice(`Automatisch freigegeben: ${String(label).slice(0, 90)}`);
            })
            .catch(() => {
              setPendingApproval(appr);
            });
        } else {
          setPendingApproval({
            ...appr,
            risk: decision.reason || appr.risk,
          });
          notifyIfBackgrounded({
            title: `${visual.label} · Freigabe nötig`,
            body: decision.reason || "Der Bot bittet um eine Freigabe.",
            bot: profile.name,
          });
          scrollToBottomWithSettle();
        }
      } else if (ev.type === "approval.cancelled") {
        setPendingApproval(null);
      } else if (ev.type === "connection.request" || ev.type === "connection.update") {
        const req = ev.payload as unknown as HermesConnectionRequest;
        if (req?.settled) {
          setPendingConnection(null);
        } else if (req?.targets) {
          setPendingConnection(req);
          scrollToBottomWithSettle();
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
  }, [refreshAccountUsage, scrollToBottom, scrollToBottomWithSettle]);

  function autoResizeInput(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(120, el.scrollHeight)}px`;
  }

  async function startNewChat() {
    setShowSessionsSheet(false);
    setChatError(null);
    setIsStreaming(false);
    setLiveStatus(null);
    setActiveTool(null);
    setPendingApproval(null);
    setPendingConnection(null);
    setPendingClarify(null);
    setPendingSecret(null);
    setUsageLimitError(null);
    setUsage((prev) => ({
      ...prev,
      contextTokens: null,
      contextPercent: 0,
      totalTokens: null,
    }));

    // Archive the current canonical chat cleanly (preserving 100% of its messages in Chat-Verlauf)
    // and immediately create a genuinely new canonical Bot Chat / Privater Chat with 0% context.
    const previousSid = activeSessionRef.current;
    if (previousSid && activeTitle === canonicalTitle) {
      const stamp = new Date().toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const archiveTitle = `Chat ${stamp}`;
      // Update both REST (?profile=...) and WS gateway title so canonical title is freed immediately
      await Promise.all([
        renameSession(previousSid, archiveTitle, profile.name).catch(() => null),
        wsState === "connected"
          ? hermesWs
              .call("session.title", {
                session_id: previousSid,
                profile: profile.name,
                title: archiveTitle,
              })
              .catch(() => null)
          : Promise.resolve(),
      ]);
    }

    if (wsState === "connected") {
      try {
        let created = await hermesWs.call<{
          session_id: string;
          execution_generation?: number;
        }>("session.create", {
          profile: profile.name,
          request_id: randomClientId("new"),
          source: "gui",
          title: canonicalTitle,
        });
        // Safety net: if gateway still resolved to the previous session ID, mint an untitled fresh session
        if (previousSid && created.session_id === previousSid) {
          created = await hermesWs.call<{
            session_id: string;
            execution_generation?: number;
          }>("session.create", {
            profile: profile.name,
            request_id: randomClientId("fresh"),
            source: "gui",
          });
        }
        setActiveSessionId(created.session_id);
        setActiveTitle(canonicalTitle);
        onRegisterSession?.(profile.name, created.session_id);
        onMarkBotRead?.(profile.name, { sessionId: created.session_id, lastActiveMs: Date.now() });
        if (typeof created.execution_generation === "number") {
          execGenerationRef.current = created.execution_generation;
        }
        attachedOnWsRef.current = true;
        setMessages([
          {
            id: `sys-new-${Date.now()}`,
            role: "system",
            content: previousSid
              ? "Neue Session gestartet (vorheriger Chat bleibt im Verlauf gespeichert)."
              : "Neue Session gestartet.",
            timestamp: Date.now(),
          },
        ]);
        void refreshSessionsList(false);
        return;
      } catch (err) {
        setChatError(
          err instanceof Error ? err.message : "Neue Session konnte nicht erstellt werden."
        );
      }
    }

    setActiveSessionId(null);
    setActiveTitle(canonicalTitle);
    setMessages([]);
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

  function appendSystemNotice(text: string) {
    setMessages((prev) => [
      ...prev,
      {
        id: `sys-${Date.now()}`,
        role: "system",
        content: text,
        timestamp: Date.now(),
      },
    ]);
    scrollToBottom();
  }

  async function tryHandleSlashCommand(rawText: string): Promise<boolean> {
    if (!rawText.startsWith("/")) return false;
    const [cmdRaw, ...rest] = rawText.trim().split(/\s+/);
    const cmd = cmdRaw.toLowerCase();
    const arg = rest.join(" ").trim();

    if (cmd === "/new" || cmd === "/neu") {
      await startNewChat();
      return true;
    }

    if (cmd === "/help" || cmd === "/hilfe") {
      appendSystemNotice(
        "Chat-Befehle: /model (Modell & Fallback) · /provider <Anbieter> · /limit (Verbrauch) · /secret [KEY] (Passwort/API-Key sicher speichern) · /new (neuer Chat)"
      );
      return true;
    }

    if (cmd === "/limit" || cmd === "/usage") {
      void refreshAccountUsage(activeSessionId);
      setShowLimitSheet(true);
      return true;
    }

    if (cmd === "/secret" || cmd === "/key" || cmd === "/passwort") {
      setManualSecret({ open: true, initialKey: arg });
      scrollToBottomWithSettle();
      return true;
    }

    if (cmd === "/provider" || cmd === "/anbieter") {
      setModelPickerState({ open: true, search: "", provider: arg });
      return true;
    }

    if (cmd === "/model" || cmd === "/modell") {
      if (!arg) {
        setModelPickerState({ open: true, search: "", provider: "" });
        return true;
      }

      // Support explicit provider/model syntax or fuzzy search across configured Hermes providers
      try {
        const options = await fetchModelOptions(profile.name, false);
        const providers = options.providers || [];

        if (arg.includes("/")) {
          const [provRaw, ...modelParts] = arg.split("/");
          const modelQuery = modelParts.join("/").trim();
          const matchedProv = providers.find(
            (p) =>
              p.slug.toLowerCase() === provRaw.toLowerCase() ||
              p.name.toLowerCase() === provRaw.toLowerCase()
          );
          if (matchedProv && modelQuery) {
            const exactModel =
              matchedProv.models.find((m) => m.toLowerCase() === modelQuery.toLowerCase()) ||
              modelQuery;
            const res = await updateProfileModel(profile.name, matchedProv.slug, exactModel);
            setActiveModelOverride({ provider: res.provider, model: res.model });
            appendSystemNotice(`Modell gewechselt: ${res.provider} / ${res.model}`);
            void onRefreshProfiles();
            return true;
          }
        }

        const q = arg.toLowerCase();
        const matches: Array<{ provider: string; model: string }> = [];
        for (const p of providers) {
          for (const m of p.models || []) {
            if (m.toLowerCase() === q) {
              matches.unshift({ provider: p.slug, model: m });
            } else if (m.toLowerCase().includes(q)) {
              matches.push({ provider: p.slug, model: m });
            }
          }
        }

        const exact = matches.find((m) => m.model.toLowerCase() === q);
        if (exact || matches.length === 1) {
          const target = exact || matches[0];
          const res = await updateProfileModel(profile.name, target.provider, target.model);
          setActiveModelOverride({ provider: res.provider, model: res.model });
          appendSystemNotice(`Modell gewechselt: ${res.provider} / ${res.model}`);
          void onRefreshProfiles();
          return true;
        }

        // Multiple or no exact match: open picker pre-filtered so the user picks with one tap
        setModelPickerState({ open: true, search: arg, provider: "" });
        return true;
      } catch (err) {
        setChatError(
          err instanceof Error ? err.message : "Modellwechsel fehlgeschlagen."
        );
        return true;
      }
    }

    return false;
  }

  async function handleSend() {
    const text = input.trim();
    const pendingFiles = [...attachments];
    if (!text && pendingFiles.length === 0) return;

    // Handle /model, /provider, /new, /help directly in chat
    if (pendingFiles.length === 0 && text.startsWith("/")) {
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      const handled = await tryHandleSlashCommand(text);
      if (handled) return;
      // Unknown slash command falls through as normal text
    }

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
        const hasCanonical = sessions.some((s) => (s.title || "").trim() === canonicalTitle);
        const created = await hermesWs.call<{
          session_id: string;
          stored_session_id?: string;
          execution_generation?: number;
        }>("session.create", {
          profile: profile.name,
          request_id: randomClientId("req"),
          source: "gui",
          ...(!hasCanonical ? { title: canonicalTitle } : {}),
        });
        sid = created.session_id;
        if (typeof created.execution_generation === "number") {
          execGenerationRef.current = created.execution_generation;
        }
        attachedOnWsRef.current = true;
        setActiveSessionId(sid);
        onRegisterSession?.(profile.name, sid);
        setActiveTitle(
          !hasCanonical ? canonicalTitle : (text || pendingFiles[0]?.file.name || "Chat").slice(0, 48)
        );
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
        ...(activeModelOverride ? { model_override: activeModelOverride } : {}),
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

  async function handleApprovalDecision(choice: "once" | "session" | "always" | "deny") {
    if (!pendingApproval) return;
    if (pendingApproval.server_request_id !== undefined) {
      hermesWs.sendResponse(pendingApproval.server_request_id, { choice });
      setPendingApproval(null);
      return;
    }
    if (!activeSessionId) return;
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

  function handleClarifySubmit(
    answers: Record<string, string | null>,
    outcome: "submitted" | "cancelled"
  ) {
    if (!pendingClarify) return;
    if (outcome === "cancelled") {
      hermesWs.sendResponse(pendingClarify.id, { outcome: "cancelled" });
    } else {
      hermesWs.sendResponse(pendingClarify.id, { answers, outcome: "submitted" });
    }
    setPendingClarify(null);
  }

  function handleSecretSubmit(value: string) {
    if (!pendingSecret) return;
    hermesWs.sendResponse(pendingSecret.id, { value });
    setPendingSecret(null);
    appendSystemNotice("Sichere Eingabe verschlüsselt an den Bot übermittelt.");
  }

  function handleSecretCancel() {
    if (!pendingSecret) return;
    hermesWs.sendResponse(pendingSecret.id, { value: "" });
    setPendingSecret(null);
  }

  async function handleQuickSwitchToFallback() {
    const target = fallbacks[0] || RECOMMENDED_ANTHROPIC_FALLBACK;
    setSwitchingFallback(true);
    try {
      const res = await updateProfileModel(profile.name, target.provider, target.model);
      setActiveModelOverride({ provider: res.provider, model: res.model });
      setUsageLimitError(null);
      appendSystemNotice(`Auf Fallback gewechselt: ${res.provider} / ${res.model}`);
      void onRefreshProfiles();
    } catch (err) {
      setChatError(
        err instanceof Error ? err.message : "Wechsel auf Anthropic-Fallback fehlgeschlagen."
      );
    } finally {
      setSwitchingFallback(false);
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

  const teammates = useMemo(() => {
    if (isPrivateBot) return [];
    return allProfiles
      .filter((p) => p.name !== profile.name)
      .map((p) => {
        const vis = getBotVisual(p);
        return {
          name: p.name,
          label: vis.label,
          handle: getBotHandle(p.name, allProfileNames),
        };
      });
  }, [allProfileNames, allProfiles, isPrivateBot, profile.name]);

  const limitSummary = useMemo(() => getPrimaryLimitSummary(usage), [usage]);
  const primaryFallback = fallbacks[0] || RECOMMENDED_ANTHROPIC_FALLBACK;
  const hasAnthropicFallback = fallbacks.some((f) =>
    f.provider.toLowerCase().includes("anthropic")
  );
  const currentActiveModel =
    activeModelOverride?.model || usage.model || profile.model || "Standard";
  const currentActiveProvider =
    activeModelOverride?.provider || usage.provider || profile.provider || null;

  return (
    <div className="chat-screen">
      <header className="chat-floating-header">
        <button
          type="button"
          className="glass-circle-btn"
          aria-label={
            otherUnreadCount > 0
              ? `Zurück zu Bots (${otherUnreadCount} neue ${otherUnreadCount === 1 ? "Nachricht" : "Nachrichten"})`
              : "Zurück zu Bots"
          }
          onClick={onBack}
        >
          <ChevronLeft size={22} />
          {otherUnreadCount > 0 && (
            <span className="back-unread-badge" aria-hidden="true">
              {formatBadgeCount(otherUnreadCount)}
            </span>
          )}
        </button>

        <div className="glass-title-pill-group">
          <button
            type="button"
            className="glass-avatar-trigger"
            aria-label={`Profilbild von ${visual.label} groß anzeigen`}
            onClick={() => setShowAvatarLightbox(true)}
          >
            <BotAvatar visual={visual} imageUrl={avatarUrl} size="sm" />
          </button>
          <button
            type="button"
            className="glass-title-trigger"
            onClick={onOpenBotSettings}
          >
            {isPrivateBot && (
              <Lock size={12} style={{ color: "var(--status-ok)", flexShrink: 0 }} />
            )}
            <span className="glass-title-pill-label">{visual.label}</span>
          </button>
        </div>

        <button
          type="button"
          className="glass-circle-btn"
          aria-label="Chat-Optionen"
          onClick={() => setShowActionsSheet(true)}
        >
          <MoreHorizontal size={20} />
        </button>
      </header>

      <div ref={scrollRef} className="chat-messages" onScroll={handleMessagesScroll}>
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

            const isSilentAck =
              msg.role === "assistant" &&
              !msg.streaming &&
              !msg.error &&
              /^(?:\[SILENT\]|NO_REPLY)$/i.test(msg.content.trim());
            if (isSilentAck) return null;

            const isEmptyAssistant =
              msg.role === "assistant" &&
              !msg.streaming &&
              !msg.content.trim() &&
              !msg.reasoning &&
              !msg.error &&
              (!msg.attachments || msg.attachments.length === 0);
            if (isEmptyAssistant) return null;

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
                      <>
                        {stripSecretRequestTag(msg.content) && (
                          <SafeMarkdown text={stripSecretRequestTag(msg.content)} />
                        )}
                        {(msg.role === "assistant" || msg.role === "user") &&
                          extractPocketPages(msg.content).map((page) => (
                            <PocketPageCard
                              key={page.id}
                              page={page}
                              onOpen={setOpenPocketPage}
                            />
                          ))}
                        {msg.role === "assistant" &&
                          (() => {
                            const deals = extractProductDeals(msg.content);
                            if (deals.length === 0) return null;
                            return (
                              <div
                                className={`deal-carousel ${deals.length === 1 ? "single" : ""}`}
                                aria-label="Gefundene Angebote"
                              >
                                {deals.map((deal, dIdx) => (
                                  <ProductDealCard
                                    key={`${deal.shop}-${deal.title}-${dIdx}`}
                                    deal={deal}
                                    disabled={isStreaming || wsState !== "connected"}
                                    onBuy={(picked: DetectedDealCard) => {
                                      const sid = activeSessionRef.current;
                                      if (!sid || wsState !== "connected" || isStreaming) return;
                                      const buyText = picked.url
                                        ? `Bitte bestelle ${picked.title} bei ${picked.shop} für ${picked.price} (${picked.url}) und bereite alles bis zur finalen Bestellübersicht vor.`
                                        : `Bitte bestelle ${picked.title} bei ${picked.shop} für ${picked.price} und bereite alles bis zur finalen Bestellübersicht vor.`;
                                      setMessages((prev) => [
                                        ...prev,
                                        {
                                          id: `u-buy-${Date.now()}`,
                                          role: "user",
                                          content: buyText,
                                          timestamp: Date.now(),
                                        },
                                      ]);
                                      setIsStreaming(true);
                                      scrollToBottomWithSettle();
                                      void hermesWs
                                        .call("prompt.submit", {
                                          session_id: sid,
                                          profile: profile.name,
                                          submission_id: randomClientId("sub"),
                                          text: buyText,
                                          ...(activeModelOverride ? { model_override: activeModelOverride } : {}),
                                        })
                                        .catch(() => setIsStreaming(false));
                                    }}
                                  />
                                ))}
                              </div>
                            );
                          })()}
                      </>
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
          <ClarifyPromptCard
            request={pendingClarify}
            botLabel={visual.label}
            onSubmit={handleClarifySubmit}
          />
        )}

        {pendingApproval && (
          <ApprovalPromptCard
            approval={pendingApproval}
            botLabel={visual.label}
            onDecide={handleApprovalDecision}
          />
        )}

        {pendingSecret && (
          <SecretPromptCard
            request={pendingSecret}
            botLabel={visual.label}
            onSubmit={handleSecretSubmit}
            onCancel={handleSecretCancel}
          />
        )}

        {pendingVaultForm && (
          <VaultFormCard
            profileName={profile.name}
            botLabel={visual.label}
            allPublicProfileNames={allProfileNames}
            isPrivateBot={isPrivateBot}
            request={pendingVaultForm}
            onSaved={(safeLabel, kind) => {
              setPendingVaultForm(null);
              const kindName =
                kind === "payment"
                  ? "Zahlungskarte"
                  : kind === "address"
                    ? "Lieferadresse"
                    : "Shop-Login";
              appendSystemNotice(
                `Tresor · ${kindName} (${safeLabel}) verschlüsselt gespeichert – ${visual.label} macht weiter…`
              );
              const sid = activeSessionRef.current;
              if (sid && wsState === "connected") {
                const handoffText =
                  `Ich habe ${kindName} (${safeLabel}) soeben verschlüsselt im Hermes-Tresor gespeichert. ` +
                  `Bitte rufe \`browser_vault\` mit \`action="list"\` auf, fülle das Formular direkt per \`browser_vault(action="fill")\` aus und mache weiter.`;
                setIsStreaming(true);
                void hermesWs
                  .call("prompt.submit", {
                    session_id: sid,
                    profile: profile.name,
                    submission_id: randomClientId("sub"),
                    text: handoffText,
                    ...(activeModelOverride ? { model_override: activeModelOverride } : {}),
                  })
                  .catch(() => {
                    setIsStreaming(false);
                  });
              }
            }}
            onClose={() => setPendingVaultForm(null)}
          />
        )}

        {manualSecret.open && (
          <ManualSecretCard
            key={
              manualSecret.fields?.map((f) => f.keyName).join(",") ||
              manualSecret.initialKey ||
              "manual-secret"
            }
            profileName={profile.name}
            botLabel={visual.label}
            formTitle={manualSecret.formTitle}
            initialKey={manualSecret.initialKey}
            promptText={manualSecret.promptText}
            fields={manualSecret.fields}
            onSaved={(savedKeys, envPathHint) => {
              setManualSecret({ open: false, initialKey: "" });
              const envPath =
                envPathHint ||
                (profile.name === "default"
                  ? "~/.hermes/.env"
                  : `~/.hermes/profiles/${profile.name}/.env`);
              const keysSummary = savedKeys.join(", ");
              appendSystemNotice(
                savedKeys.length > 1
                  ? `Gesichertes Formular (${keysSummary}) in ${envPath} gespeichert – ${visual.label} wird informiert…`
                  : `Schlüssel „${keysSummary}“ sicher in ${envPath} gespeichert – ${visual.label} wird informiert…`
              );
              // Automatically notify the bot of the exact variable names & .env path (NEVER secret values!)
              const sid = activeSessionRef.current;
              if (sid && wsState === "connected") {
                const formattedKeys = savedKeys.map((k) => `\`${k}\``).join(", ");
                const handoffText =
                  savedKeys.length > 1
                    ? `Ich habe das gesicherte Formular soeben vollständig in deiner Profil-.env hinterlegt ` +
                      `(Schlüssel: ${formattedKeys}, Datei: \`${envPath}\`, auch als Umgebungsvariablen freigegeben). ` +
                      `Bitte lies die benötigten Werte direkt aus \`${envPath}\` bzw. der Umgebung aus und mache direkt weiter – gib sensible Werte dabei niemals im Chat aus.`
                    : `Ich habe den geheimen Wert für ${formattedKeys} soeben sicher in deiner Profil-.env hinterlegt ` +
                      `(Schlüssel: ${formattedKeys}, Datei: \`${envPath}\`, auch für \`$${savedKeys[0]}\` freigegeben). ` +
                      `Bitte lies ${formattedKeys} direkt aus \`${envPath}\` bzw. der Umgebungsvariable aus und mache direkt weiter – gib den Klartextwert dabei niemals im Chat aus.`;
                setIsStreaming(true);
                void hermesWs
                  .call("prompt.submit", {
                    session_id: sid,
                    profile: profile.name,
                    submission_id: randomClientId("sub"),
                    text: handoffText,
                    ...(activeModelOverride ? { model_override: activeModelOverride } : {}),
                  })
                  .catch(() => {
                    setIsStreaming(false);
                  });
              }
            }}
            onClose={() => setManualSecret({ open: false, initialKey: "" })}
          />
        )}

        {usageLimitError && (
          <UsageLimitCard
            limitError={usageLimitError}
            fallbackTarget={primaryFallback}
            switching={switchingFallback}
            onSwitchToFallback={() => void handleQuickSwitchToFallback()}
            onOpenModelPicker={() => setModelPickerState({ open: true, search: "", provider: "" })}
            onDismiss={() => setUsageLimitError(null)}
          />
        )}
      </div>

      <div className="composer-wrap">
        {hasNewBelow && (
          <div className="new-msg-scroll-wrap">
            <button
              type="button"
              className="new-msg-scroll-pill"
              onClick={scrollToBottom}
            >
              <ArrowDown size={14} />
              <span>Neue Nachricht</span>
            </button>
          </div>
        )}
        <button
          type="button"
          className={`chat-limit-bar ${limitSummary.severity === "normal" ? "" : limitSummary.severity}`}
          onClick={() => {
            void refreshAccountUsage(activeSessionId);
            setShowLimitSheet(true);
          }}
        >
          <span className="chat-limit-left">
            <Gauge size={13} style={{ flexShrink: 0 }} />
            <span className="chat-limit-text">
              {limitSummary.mode === "remaining" && limitSummary.remainingPercent !== null
                ? `${formatCompactWindowLabel(limitSummary.label)}: ${limitSummary.remainingPercent}% frei`
                : limitSummary.mode === "context" && limitSummary.usedPercent !== null
                  ? `Kontext ${limitSummary.usedPercent}%`
                  : `${currentActiveModel}`}
            </span>
            {limitSummary.barPercent !== null && (
              <span className="chat-limit-meter" aria-hidden="true">
                <span
                  className={`chat-limit-meter-fill ${limitSummary.severity === "normal" ? "" : limitSummary.severity}`}
                  style={{ width: `${limitSummary.barPercent}%` }}
                />
              </span>
            )}
          </span>
          <span className="chat-limit-right">
            {usage.contextPercent !== null && limitSummary.mode !== "context" && (
              <span>Kontext {usage.contextPercent}%</span>
            )}
            {hasAnthropicFallback && (
              <span className="chat-limit-fallback-dot" title="Anthropic-Fallback aktiv">
                <ShieldCheck size={11} />
                Fallback
              </span>
            )}
            <ChevronRight size={13} />
          </span>
        </button>

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
            onFocus={scrollToBottomWithSettle}
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

      <PocketPageViewer
        page={openPocketPage}
        onClose={() => setOpenPocketPage(null)}
      />

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
          {teammates.length > 0 && (
            <div className="card" style={{ padding: "11px 12px" }}>
              <div style={{ fontSize: "0.73rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 7 }}>
                Anderen Bot ansprechen (Bot-zu-Bot aktiv)
              </div>
              <div className="chip-row">
                {teammates.map((tm) => (
                  <button
                    key={tm.name}
                    type="button"
                    className="chip"
                    style={{ minHeight: 32, fontSize: "0.78rem" }}
                    onClick={() => {
                      setShowActionsSheet(false);
                      setInput((prev) =>
                        prev.trim() ? `${prev.trim()} ${tm.label} ` : `Frag ${tm.label}: `
                      );
                      requestAnimationFrame(() => textareaRef.current?.focus());
                    }}
                  >
                    {tm.label}
                  </button>
                ))}
              </div>
            </div>
          )}
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
              setModelPickerState({ open: true, search: "", provider: "" });
            }}
          >
            <Cpu size={17} /> Modell &amp; Anthropic-Fallback (
            {currentActiveModel})
          </button>
          <button
            type="button"
            className="btn full"
            onClick={() => {
              setShowActionsSheet(false);
              void refreshAccountUsage(activeSessionId);
              setShowLimitSheet(true);
            }}
          >
            <Gauge size={17} /> Chat-Limit &amp; Verbrauch
          </button>
          <button
            type="button"
            className="btn full"
            onClick={() => {
              setShowActionsSheet(false);
              setManualSecret({ open: true, initialKey: "" });
              scrollToBottomWithSettle();
            }}
          >
            <KeyRound size={17} /> Passwort / API-Key sicher hinterlegen
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

      <LimitSheet
        open={showLimitSheet}
        botLabel={visual.label}
        usage={usage}
        activeProvider={currentActiveProvider}
        activeModel={currentActiveModel}
        fallbacks={fallbacks}
        loading={loadingAccountUsage}
        onRefresh={() => void refreshAccountUsage(activeSessionId)}
        onOpenModelPicker={() => setModelPickerState({ open: true, search: "", provider: "" })}
        onClose={() => setShowLimitSheet(false)}
      />

      <ModelPickerSheet
        open={modelPickerState.open}
        profileName={profile.name}
        botLabel={visual.label}
        allProfileNames={allProfileNames}
        currentProvider={activeModelOverride?.provider || profile.provider}
        currentModel={activeModelOverride?.model || profile.model}
        initialSearch={modelPickerState.search}
        initialProvider={modelPickerState.provider}
        onSwitched={(prov, mod) => {
          setActiveModelOverride({ provider: prov, model: mod });
          appendSystemNotice(`Modell gewechselt: ${prov} / ${mod}`);
          void onRefreshProfiles();
        }}
        onFallbackChanged={(nextFallbacks) => {
          setFallbacks(nextFallbacks);
        }}
        onClose={() => setModelPickerState((s) => ({ ...s, open: false }))}
      />

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

      {showAvatarLightbox &&
        createPortal(
          <div
            className="avatar-lightbox-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={`Profilbild von ${visual.label}`}
            onClick={() => setShowAvatarLightbox(false)}
          >
            <div
              className="avatar-lightbox-content"
              onClick={(e) => e.stopPropagation()}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={visual.label}
                  className="avatar-lightbox-photo"
                />
              ) : (
                <div
                  className="avatar-lightbox-photo"
                  style={{
                    background: visual.gradient,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "4rem",
                    fontWeight: 800,
                    color: "#090b10",
                  }}
                >
                  {visual.initials}
                </div>
              )}

              <div>
                <div style={{ fontSize: "1.2rem", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {isPrivateBot && <Lock size={15} style={{ color: "var(--status-ok)" }} />}
                  <span>{visual.label}</span>
                </div>
                {profile.description && (
                  <p style={{ margin: "6px 0 0", fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
                    {profile.description}
                  </p>
                )}
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    setShowAvatarLightbox(false);
                    onOpenBotSettings();
                  }}
                >
                  <Settings2 size={14} /> Bot bearbeiten
                </button>
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => setShowAvatarLightbox(false)}
                >
                  Schließen
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
