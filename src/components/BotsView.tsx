import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  Download,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Star,
  X,
} from "lucide-react";
import type {
  HermesChatMessage,
  HermesProfile,
  HermesSessionSearchHit,
  HermesSessionSummary,
} from "../../shared/types";
import { appendAutonomousGuidance } from "../../shared/botAutonomy";
import { clearBotAvatar, prepareAvatarDataUrl, saveBotAvatar } from "../lib/avatarStore";
import { deriveShortBotCallName } from "../lib/botCollaboration";
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
import { loadAllBotDrafts } from "../lib/draftStore";
import {
  formatBadgeCount,
  type BotUnreadInfo,
} from "../lib/unreadStore";
import {
  formatRelativeTime,
  toTimestampMs,
} from "../lib/format";
import {
  createProfile,
  deleteProfile,
  fetchModelOptions,
  fetchProfileFallback,
  fetchProfileSoul,
  searchSessions,
  updateProfileDescription,
  updateProfileFallback,
  updateProfileModel,
  updateProfilePrivacy,
  updateProfileSoul,
} from "../lib/hermesApi";
import { recommendGptModelForBot } from "../lib/smartModelRouting";
import { hermesWs, type WsConnectionState } from "../lib/hermesWs";
import { cleanSearchSnippet } from "../lib/privateVault";
import type { PushPreferences } from "../lib/pushClient";
import { RECOMMENDED_ANTHROPIC_FALLBACK } from "../lib/usageLimits";
import { BotAvatar } from "./BotAvatar";
import { BotManageSheet } from "./BotManageSheet";
import { DirectChatView } from "./DirectChatView";
import { ConfirmSheet } from "./ConfirmSheet";
import { Sheet } from "./Sheet";

const BotImportSheet = lazy(() =>
  import("./BotImportSheet").then((m) => ({ default: m.BotImportSheet }))
);
const ModelPickerSheet = lazy(() =>
  import("./ModelPickerSheet").then((m) => ({ default: m.ModelPickerSheet }))
);

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
  layoutMode?: "mobile" | "list-only" | "chat-only";
  draftPrefill?: { botName: string; text: string; id: number } | null;
  pushTargetSession?: { botName: string; sessionId: string | null; nonce: number } | null;
  openCreateTrigger?: number;
  createAsPrivate?: boolean;
  onSelectBot: (name: string | null) => void;
  onForwardToBot?: (targetBotName: string, text: string) => void;
  onConsumeDraftPrefill?: () => void;
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
  layoutMode = "mobile",
  draftPrefill = null,
  pushTargetSession = null,
  openCreateTrigger = 0,
  createAsPrivate = false,
  onSelectBot,
  onForwardToBot,
  onConsumeDraftPrefill,
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
      // Automatically assign the best matching GPT model for this bot's role/profile
      const modelOpts = await fetchModelOptions(finalName).catch(() => null);
      if (modelOpts?.providers?.length) {
        const smartRec = recommendGptModelForBot(
          {
            name: finalName,
            display_name: createName.trim() || finalName,
            description: createDesc.trim(),
            soul: createSoul.trim(),
          },
          modelOpts.providers
        );
        if (smartRec) {
          await updateProfileModel(finalName, smartRec.provider, smartRec.model).catch(() => null);
        }
      }
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

  if (layoutMode === "chat-only" && !selectedProfile) {
    return (
      <div className="desktop-chat-empty">
        <MessageSquare size={34} style={{ color: "var(--text-muted)" }} />
        <h3>Wähle links einen Bot aus</h3>
        <p>
          Deine Bots, Live-Ungelesen-Indikatoren und der Chef-Bereich bleiben links dauerhaft
          sichtbar.
        </p>
      </div>
    );
  }

  if (selectedProfile && layoutMode !== "list-only") {
    const isPrivateSelected = privateSet.has(selectedProfile.name);
    const matchingTargetSession =
      openTargetSession && openTargetSession.botName === selectedProfile.name
        ? openTargetSession
        : null;
    const matchingDraft =
      draftPrefill && draftPrefill.botName === selectedProfile.name ? draftPrefill : null;
    const matchingPush =
      pushTargetSession && pushTargetSession.botName === selectedProfile.name
        ? pushTargetSession
        : null;
    const chatInstanceKey = matchingPush
      ? `${selectedProfile.name}:${matchingPush.nonce}`
      : selectedProfile.name;
    const resolvedInitialSessionId =
      matchingPush?.sessionId || matchingTargetSession?.sessionId || null;

    return (
      <>
        <DirectChatView
          key={chatInstanceKey}
          profile={selectedProfile}
          allProfiles={publicProfiles}
          isPrivateBot={isPrivateSelected}
          hideBackButton={layoutMode === "chat-only"}
          draftPrefill={matchingDraft}
          onConsumeDraftPrefill={onConsumeDraftPrefill}
          onForwardToBot={onForwardToBot}
          initialSessionId={resolvedInitialSessionId}
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
          <Suspense fallback={null}>
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
          </Suspense>
        )}
      </>
    );
  }

  const [pullDistance, setPullDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const pullStartYRef = useRef<number | null>(null);

  const botDrafts = useMemo(() => {
    void selectedBotName;
    void profiles.length;
    return loadAllBotDrafts();
  }, [selectedBotName, profiles.length]);

  return (
    <div
      onTouchStart={(e) => {
        if (e.touches.length !== 1) return;
        const scrollParent = (e.currentTarget as HTMLElement).closest(".app-main");
        const top = scrollParent ? scrollParent.scrollTop : window.scrollY;
        if (top <= 2) {
          pullStartYRef.current = e.touches[0].clientY;
        } else {
          pullStartYRef.current = null;
        }
      }}
      onTouchMove={(e) => {
        if (pullStartYRef.current === null || e.touches.length !== 1) return;
        const dy = e.touches[0].clientY - pullStartYRef.current;
        if (dy > 12) {
          setPullDistance(Math.min(dy * 0.55, 84));
        } else {
          setPullDistance(0);
        }
      }}
      onTouchEnd={() => {
        const shouldRefresh = pullDistance >= 52;
        pullStartYRef.current = null;
        setPullDistance(0);
        if (shouldRefresh && !pullRefreshing) {
          setPullRefreshing(true);
          Promise.resolve(onRefreshProfiles()).finally(() => {
            window.setTimeout(() => setPullRefreshing(false), 350);
          });
        }
      }}
    >
      {(pullDistance > 16 || pullRefreshing) && (
        <div className="pull-refresh-pill" role="status">
          <RefreshCw size={13} className={pullRefreshing ? "spin" : ""} />
          <span>
            {pullRefreshing
              ? "Aktualisiere…"
              : pullDistance >= 52
                ? "Zum Aktualisieren loslassen"
                : "Zum Aktualisieren ziehen"}
          </span>
        </div>
      )}
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
                    className={`bot-list-item ${unread ? "has-unread" : ""} ${selectedBotName === profile.name ? "is-selected" : ""}`}
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
                            {botDrafts[profile.name] ? (
                              <>
                                <span className="bot-card-draft-label">Entwurf: </span>
                                {botDrafts[profile.name]}
                              </>
                            ) : (
                              unread?.preview ||
                              profile.description?.trim() ||
                              recent?.title ||
                              "Bereit zum Chatten"
                            )}
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

      {showImportSheet && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      {modelPickerProfile && (
        <Suspense fallback={null}>
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
        </Suspense>
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

