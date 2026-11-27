import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  Bot,
  CalendarClock,
  CreditCard,
  FileText,
  Lock,
  LogOut,
  Plug,
  Plus,
  ShieldCheck,
  Smartphone,
  User,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import type {
  HermesAuthUser,
  HermesChatMessage,
  HermesProfile,
  HermesRoom,
  HermesSessionSummary,
  HermesStatusResponse,
} from "../shared/types";
import { BotAvatar } from "./components/BotAvatar";
import { BotsView } from "./components/BotsView";
import { LoginView } from "./components/LoginView";
import { Sheet } from "./components/Sheet";

const ConnectorsView = lazy(() =>
  import("./components/ConnectorsView").then((m) => ({ default: m.ConnectorsView }))
);
const CredentialVaultSheet = lazy(() =>
  import("./components/CredentialVaultSheet").then((m) => ({ default: m.CredentialVaultSheet }))
);
const GroupsView = lazy(() =>
  import("./components/GroupsView").then((m) => ({ default: m.GroupsView }))
);
const PagesArchiveSheet = lazy(() =>
  import("./components/PagesArchiveSheet").then((m) => ({ default: m.PagesArchiveSheet }))
);
const PrivateVaultSheet = lazy(() =>
  import("./components/PrivateVaultSheet").then((m) => ({ default: m.PrivateVaultSheet }))
);
const RoutinesView = lazy(() =>
  import("./components/RoutinesView").then((m) => ({ default: m.RoutinesView }))
);
import { loadAutoApproveSafe, saveAutoApproveSafe } from "./lib/approvalPolicy";
import { fetchBotAvatar } from "./lib/avatarStore";
import { getBotVisual } from "./lib/botTheme";
import { toTimestampMs } from "./lib/format";
import {
  fetchCurrentUser,
  fetchProfiles,
  fetchServerUiPreferences,
  fetchSessionMessages,
  fetchSessions,
  fetchStatus,
  logout,
  updateProfilePrivacy,
  updateServerUiPreferences,
} from "./lib/hermesApi";
import { hermesWs, type WsConnectionState } from "./lib/hermesWs";
import {
  getStoredVaultPinHash,
  hasVaultPin,
  hydrateVaultPinHash,
  isProfilePrivate,
  loadLocalPrivateProfiles,
  saveLocalPrivateProfiles,
} from "./lib/privateVault";
import {
  disablePushNotifications,
  enablePushNotifications,
  fetchPushPreferences,
  fetchPushStatus,
  sendTestPushNotification,
  updatePushPreferences,
  type PushPreferences,
  type PushStatusInfo,
} from "./lib/pushClient";
import {
  buildReadCursorFromSession,
  detectGroupUnread,
  detectUnreadAssistantMessages,
  extractSessionMetrics,
  formatBadgeCount,
  formatUnreadPreview,
  hasSessionNewActivity,
  isSilentBotAck,
  loadBotReadCursors,
  loadGroupReadCursors,
  pickSessionForUnreadCheck,
  saveBotReadCursors,
  saveGroupReadCursors,
  type BotReadCursor,
  type BotUnreadInfo,
  type GroupReadCursor,
  type GroupUnreadInfo,
} from "./lib/unreadStore";
import { useVisualViewport } from "./lib/useVisualViewport";

type TabKey = "bots" | "groups" | "routines" | "connectors";

const TAB_TITLES: Record<TabKey, string> = {
  bots: "Hermes Bots",
  groups: "Gruppen",
  routines: "Routinen",
  connectors: "Connectoren",
};

export const App: React.FC = () => {
  useVisualViewport();

  const [booting, setBooting] = useState(true);
  const [status, setStatus] = useState<HermesStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [user, setUser] = useState<HermesAuthUser | null>(null);
  const [wsState, setWsState] = useState<WsConnectionState>("disconnected");

  const [tab, setTab] = useState<TabKey>("bots");
  const [selectedBotName, setSelectedBotName] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [createBotTrigger, setCreateBotTrigger] = useState(0);
  const [createPrivateMode, setCreatePrivateMode] = useState(false);

  // Hidden & isolated Private Bot Vault state
  const [localPrivateProfiles, setLocalPrivateProfiles] = useState<string[]>(() =>
    loadLocalPrivateProfiles()
  );
  const [showVaultSheet, setShowVaultSheet] = useState(false);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);

  const [profiles, setProfiles] = useState<HermesProfile[]>([]);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [hiddenProfiles, setHiddenProfiles] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("hermes-pocket.hiddenProfiles");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);

  const [showAccountSheet, setShowAccountSheet] = useState(false);
  const [showCredentialVault, setShowCredentialVault] = useState(false);
  const [showPagesArchive, setShowPagesArchive] = useState(false);
  const [draftPrefill, setDraftPrefill] = useState<{
    botName: string;
    text: string;
    id: number;
  } | null>(null);
  const [isWideLayout, setIsWideLayout] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(min-width: 740px)").matches
      : false
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(min-width: 740px)");
    const onChange = (ev: MediaQueryListEvent) => setIsWideLayout(ev.matches);
    setIsWideLayout(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [loggingOut, setLoggingOut] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushStatusInfo | null>(null);
  const [pushPreferences, setPushPreferences] = useState<PushPreferences>({
    globalEnabled: true,
    disabledBots: [],
  });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<string | null>(null);
  const [autoApproveSafe, setAutoApproveSafe] = useState<boolean>(() => loadAutoApproveSafe());

  // Live unread / new-bot-message tracking across all bots and groups
  const [recentByProfile, setRecentByProfile] = useState<Record<string, HermesSessionSummary>>({});
  const [unreadByBot, setUnreadByBot] = useState<Record<string, BotUnreadInfo>>({});
  const [unreadByGroup, setUnreadByGroup] = useState<Record<string, GroupUnreadInfo>>({});
  const [newMsgToast, setNewMsgToast] = useState<{
    id: number;
    botName: string;
    botLabel: string;
    preview: string;
  } | null>(null);

  const botReadCursorsRef = useRef<Record<string, BotReadCursor>>(loadBotReadCursors());
  const groupReadCursorsRef = useRef<Record<string, GroupReadCursor>>(loadGroupReadCursors());
  const sessionToProfileRef = useRef<Map<string, string>>(new Map());
  const pollInitializedRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);

  const tabRef = useRef<TabKey>(tab);
  const selectedBotNameRef = useRef<string | null>(selectedBotName);
  const selectedRoomIdRef = useRef<string | null>(selectedRoomId);
  const profilesRef = useRef<HermesProfile[]>(profiles);
  const hiddenProfilesRef = useRef<string[]>(hiddenProfiles);

  tabRef.current = tab;
  selectedBotNameRef.current = selectedBotName;
  selectedRoomIdRef.current = selectedRoomId;
  profilesRef.current = profiles;
  hiddenProfilesRef.current = hiddenProfiles;

  const dismissNewMsgToast = useCallback(() => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setNewMsgToast(null);
  }, []);

  const showNewMsgToast = useCallback(
    (botName: string, preview: string) => {
      const prof = profilesRef.current.find((p) => p.name === botName);
      if (!prof) return;
      if (isProfilePrivate(prof, loadLocalPrivateProfiles())) return;
      if (hiddenProfilesRef.current.includes(botName)) return;
      const label = getBotVisual(prof).label;
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      setNewMsgToast({
        id: Date.now(),
        botName,
        botLabel: label,
        preview: formatUnreadPreview(preview, 96),
      });
      toastTimerRef.current = window.setTimeout(() => {
        setNewMsgToast(null);
        toastTimerRef.current = null;
      }, 5500);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const registerBotSession = useCallback((profileName: string, sessionId: string | null) => {
    if (profileName && sessionId) {
      sessionToProfileRef.current.set(sessionId, profileName);
    }
  }, []);

  const markBotRead = useCallback(
    (
      profileName: string,
      info?: {
        sessionId?: string | null;
        lastActiveMs?: number;
        messageCount?: number;
        messages?: HermesChatMessage[];
      }
    ) => {
      if (!profileName) return;
      if (info?.sessionId) {
        sessionToProfileRef.current.set(info.sessionId, profileName);
      }
      setUnreadByBot((prev) => {
        if (!prev[profileName]) return prev;
        const next = { ...prev };
        delete next[profileName];
        return next;
      });
      setNewMsgToast((cur) => (cur && cur.botName === profileName ? null : cur));

      const existing = botReadCursorsRef.current[profileName];
      const recent = recentByProfile[profileName];
      const recentMetrics = recent ? extractSessionMetrics(recent) : null;
      let latestMs = Math.max(
        existing?.lastActiveMs ?? 0,
        recentMetrics?.lastActiveMs ?? 0,
        info?.lastActiveMs ?? 0
      );
      if (info?.messages && info.messages.length > 0) {
        for (const m of info.messages) {
          const ts = toTimestampMs(m.timestamp);
          if (ts !== null && ts > latestMs) latestMs = ts;
        }
      }
      const msgTurnCount = info?.messages
        ? info.messages.filter((m) => m.role === "user" || m.role === "assistant").length
        : 0;
      const nextSessionId = info?.sessionId || recentMetrics?.sessionId || existing?.sessionId || "";
      const sameSession = !existing?.sessionId || existing.sessionId === nextSessionId;
      const nextCount = Math.max(
        sameSession ? existing?.messageCount ?? 0 : 0,
        sameSession ? recentMetrics?.messageCount ?? 0 : 0,
        info?.messageCount ?? 0,
        msgTurnCount
      );

      botReadCursorsRef.current = {
        ...botReadCursorsRef.current,
        [profileName]: {
          sessionId: nextSessionId,
          lastActiveMs: latestMs,
          messageCount: nextCount,
          readAtMs: Date.now(),
        },
      };
      saveBotReadCursors(botReadCursorsRef.current);
    },
    [recentByProfile]
  );

  const markGroupRead = useCallback((roomId: string, latestSeq?: number, updatedAtMs?: number) => {
    if (!roomId) return;
    setUnreadByGroup((prev) => {
      if (!prev[roomId]) return prev;
      const next = { ...prev };
      delete next[roomId];
      return next;
    });
    const existing = groupReadCursorsRef.current[roomId];
    const nextSeq = Math.max(existing?.latestSeq ?? 0, latestSeq ?? 0);
    const nextUpdated = Math.max(existing?.updatedAtMs ?? 0, updatedAtMs ?? Date.now());
    groupReadCursorsRef.current = {
      ...groupReadCursorsRef.current,
      [roomId]: { latestSeq: nextSeq, updatedAtMs: nextUpdated },
    };
    saveGroupReadCursors(groupReadCursorsRef.current);
  }, []);

  const markBotUnread = useCallback(
    (
      profileName: string,
      opts: {
        preview?: string;
        timestampMs?: number;
        sessionId?: string;
        count?: number;
        increment?: boolean;
        source: "ws" | "poll" | "push";
        allowToast?: boolean;
      }
    ) => {
      if (!profileName) return;
      const isViewingBot =
        tabRef.current === "bots" &&
        selectedBotNameRef.current === profileName &&
        document.visibilityState === "visible";
      if (isViewingBot) return;

      const ts = opts.timestampMs ?? Date.now();
      let shouldToast = false;
      setUnreadByBot((prev) => {
        const cur = prev[profileName];
        const nextCount = opts.increment
          ? (cur?.count ?? 0) + (opts.count ?? 1)
          : Math.max(cur?.count ?? 0, opts.count ?? 1);
        const isNewer = !cur || ts > cur.latestTimestampMs + 500 || nextCount > cur.count;
        if (opts.allowToast && isNewer) {
          shouldToast = true;
        }
        return {
          ...prev,
          [profileName]: {
            count: Math.max(1, nextCount),
            latestTimestampMs: Math.max(cur?.latestTimestampMs ?? 0, ts),
            preview: opts.preview || cur?.preview || "Neue Nachricht",
            sessionId: opts.sessionId || cur?.sessionId,
            source: opts.source,
          },
        };
      });

      if (shouldToast) {
        showNewMsgToast(profileName, opts.preview || "Neue Nachricht");
      }
    },
    [showNewMsgToast]
  );

  // Open specific bot when launched or tapped from a Push Notification,
  // or immediately flag unread when Service Worker receives a push for a bot
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const botParam = params.get("bot")?.trim();
    if (botParam) {
      setTab("bots");
      setSelectedBotName(botParam);
      window.history.replaceState({}, "", window.location.pathname);
    }
    const onSwMessage = (ev: MessageEvent) => {
      const data = ev.data as {
        type?: string;
        bot?: string;
        body?: string;
        title?: string;
      } | null;
      if (data?.type === "hp:open-bot" && data.bot) {
        setTab("bots");
        setSelectedBotName(data.bot);
      } else if (data?.type === "hp:bot-message" && data.bot) {
        markBotUnread(data.bot, {
          preview: data.body || data.title || "Neue Nachricht",
          timestampMs: Date.now(),
          increment: true,
          source: "push",
          allowToast: document.visibilityState === "visible",
        });
      }
    };
    navigator.serviceWorker?.addEventListener("message", onSwMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onSwMessage);
  }, [markBotUnread]);

  useEffect(() => {
    if (showAccountSheet) {
      setPushFeedback(null);
      void fetchPushStatus().then((st) => {
        setPushStatus(st);
        setPushPreferences(st.preferences);
      });
    }
  }, [showAccountSheet]);

  const handleToggleGlobalPush = useCallback(async (nextEnabled: boolean) => {
    setPushPreferences((prev) => ({ ...prev, globalEnabled: nextEnabled }));
    try {
      const updated = await updatePushPreferences({ globalEnabled: nextEnabled });
      setPushPreferences(updated);
      setPushFeedback(
        nextEnabled
          ? "Push für alle öffentlichen Bots aktiviert."
          : "Push für alle Bots pausiert."
      );
    } catch (err) {
      setPushFeedback(err instanceof Error ? err.message : "Push-Einstellung fehlgeschlagen.");
      void fetchPushPreferences().then(setPushPreferences);
    }
  }, []);

  const handleToggleBotPush = useCallback(async (botName: string, nextEnabled: boolean) => {
    setPushPreferences((prev) => ({
      ...prev,
      disabledBots: nextEnabled
        ? prev.disabledBots.filter((b) => b !== botName)
        : Array.from(new Set([...prev.disabledBots, botName])),
    }));
    try {
      const updated = await updatePushPreferences({ bot: botName, enabled: nextEnabled });
      setPushPreferences(updated);
    } catch {
      void fetchPushPreferences().then(setPushPreferences);
    }
  }, []);

  async function handleTogglePush() {
    setPushBusy(true);
    setPushFeedback(null);
    try {
      if (pushStatus?.subscribed) {
        await disablePushNotifications();
        setPushFeedback("Push-Benachrichtigungen auf diesem Gerät deaktiviert.");
      } else {
        const res = await enablePushNotifications();
        if (!res.ok) {
          setPushFeedback(res.error || "Push konnte nicht aktiviert werden.");
        } else {
          setPushFeedback("Push-Benachrichtigungen sind jetzt aktiv!");
        }
      }
      setPushStatus(await fetchPushStatus());
    } finally {
      setPushBusy(false);
    }
  }

  async function handleTestPush() {
    setPushBusy(true);
    setPushFeedback(null);
    try {
      const res = await sendTestPushNotification();
      setPushFeedback(
        res.sent > 0
          ? "Test-Nachricht gesendet! Sollte gleich auf deinem iPhone erscheinen."
          : res.failed > 0
            ? `Push-Zustellung fehlgeschlagen (${res.lastError || "unbekannter Fehler"}). Bitte Push einmal deaktivieren und neu aktivieren.`
            : "Kein aktives Gerät gefunden – bitte Push erst aktivieren."
      );
    } catch (err) {
      setPushFeedback(err instanceof Error ? err.message : "Test-Push fehlgeschlagen.");
    } finally {
      setPushBusy(false);
    }
  }

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true);
    setProfilesError(null);
    try {
      const list = await fetchProfiles();
      setProfiles(list);
    } catch (err) {
      setProfilesError(
        err instanceof Error ? err.message : "Hermes-Profile konnten nicht geladen werden."
      );
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  // Load native Hermes avatars once WebSocket is connected and profiles are known
  useEffect(() => {
    if (wsState !== "connected" || profiles.length === 0) return;
    let cancelled = false;
    void (async () => {
      const results = await Promise.all(
        profiles.map(async (p) => [p.name, await fetchBotAvatar(p.name)] as const)
      );
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const [name, dataUrl] of results) {
        if (dataUrl) map[name] = dataUrl;
      }
      setAvatars(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [profiles, wsState]);

  const handleAvatarChange = useCallback((profileName: string, dataUrl: string | null) => {
    setAvatars((prev) => {
      const next = { ...prev };
      if (dataUrl) {
        next[profileName] = dataUrl;
      } else {
        delete next[profileName];
      }
      return next;
    });
  }, []);

  const handleSelectBot = useCallback(
    (name: string | null) => {
      setCreateBotTrigger(0);
      setCreatePrivateMode(false);
      setSelectedBotName(name);
      if (name) {
        markBotRead(name);
      }
    },
    [markBotRead]
  );

  const handleForwardToBot = useCallback(
    (targetBotName: string, text: string) => {
      setTab("bots");
      setSelectedBotName(targetBotName);
      markBotRead(targetBotName);
      setDraftPrefill({ botName: targetBotName, text, id: Date.now() });
    },
    [markBotRead]
  );

  const handleSelectRoom = useCallback(
    (roomId: string | null) => {
      setSelectedRoomId(roomId);
      if (roomId) {
        markGroupRead(roomId);
      }
    },
    [markGroupRead]
  );

  const privateProfiles = useMemo(
    () => profiles.filter((p) => isProfilePrivate(p, localPrivateProfiles)),
    [profiles, localPrivateProfiles]
  );

  const publicProfiles = useMemo(
    () => profiles.filter((p) => !isProfilePrivate(p, localPrivateProfiles)),
    [profiles, localPrivateProfiles]
  );

  const privateProfileNames = useMemo(
    () => privateProfiles.map((p) => p.name),
    [privateProfiles]
  );

  // Automatically re-lock private vault when app goes to background
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && hasVaultPin()) {
        setVaultUnlocked(false);
        if (selectedBotName && privateProfileNames.includes(selectedBotName)) {
          setSelectedBotName(null);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [privateProfileNames, selectedBotName]);

  const handleToggleBotPrivate = useCallback(
    async (profile: HermesProfile, makePrivate: boolean) => {
      if (profile.is_default || profile.name === "default") return;
      // 1. Real Hermes isolation: disable/enable bot_mode_protocol in profile config.yaml
      await updateProfilePrivacy(profile.name, makePrivate);
      // 2. Persist private marker in Hermes profile.yaml so it syncs across devices
      if (wsState === "connected") {
        await hermesWs
          .call("profiles.configure", {
            name: profile.name,
            ui_meta: {
              "hermes-pocket": makePrivate ? { private: true } : null,
            },
          })
          .catch(() => null);
      }
      // 3. Mirror locally for instant UI update
      setLocalPrivateProfiles((prev) => {
        const next = makePrivate
          ? Array.from(new Set([...prev, profile.name]))
          : prev.filter((n) => n !== profile.name);
        saveLocalPrivateProfiles(next);
        return next;
      });
      if (makePrivate && selectedBotName === profile.name && !vaultUnlocked) {
        setSelectedBotName(null);
      }
      await loadProfiles();
    },
    [loadProfiles, selectedBotName, vaultUnlocked, wsState]
  );

  const handleToggleHideProfile = useCallback((profileName: string) => {
    setHiddenProfiles((prev) => {
      const next = prev.includes(profileName)
        ? prev.filter((n) => n !== profileName)
        : [...prev, profileName];
      try {
        localStorage.setItem("hermes-pocket.hiddenProfiles", JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      void updateServerUiPreferences({ hiddenProfiles: next }).catch(() => null);
      return next;
    });
  }, []);

  const bootstrap = useCallback(async () => {
    setBooting(true);
    setStatusError(null);
    try {
      const [srvStatus, me] = await Promise.all([fetchStatus(), fetchCurrentUser()]);
      setStatus(srvStatus);
      setUser(me);
      if (me || !srvStatus.auth_required) {
        hermesWs.connect();
        await loadProfiles();
        void fetchPushPreferences().then(setPushPreferences);
        void fetchServerUiPreferences()
          .then((srvPrefs) => {
            if (srvPrefs.updatedAt > 0) {
              setHiddenProfiles(srvPrefs.hiddenProfiles);
              try {
                localStorage.setItem(
                  "hermes-pocket.hiddenProfiles",
                  JSON.stringify(srvPrefs.hiddenProfiles)
                );
              } catch {
                // ignore
              }
            } else {
              // First-time migration: push any existing local hidden profiles to server
              let localHidden: string[] = [];
              try {
                const raw = localStorage.getItem("hermes-pocket.hiddenProfiles");
                const parsed = raw ? JSON.parse(raw) : [];
                if (Array.isArray(parsed)) localHidden = parsed;
              } catch {
                // ignore
              }
              if (localHidden.length > 0) {
                void updateServerUiPreferences({ hiddenProfiles: localHidden }).catch(() => null);
              }
            }

            if (srvPrefs.vaultPinHash) {
              hydrateVaultPinHash(srvPrefs.vaultPinHash);
            } else {
              const localHash = getStoredVaultPinHash();
              if (localHash) {
                void updateServerUiPreferences({ vaultPinHash: localHash }).catch(() => null);
              }
            }
          })
          .catch(() => null);
      } else {
        hermesWs.disconnect();
      }
    } catch (err) {
      setStatusError(
        err instanceof Error
          ? err.message
          : "Hermes-Server ist aktuell nicht erreichbar."
      );
      setUser(null);
      hermesWs.disconnect();
    } finally {
      setBooting(false);
    }
  }, [loadProfiles]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    return hermesWs.onStateChange((next) => {
      setWsState(next);
      if (next === "unauthorized") {
        setUser(null);
      }
    });
  }, []);

  // Poll Hermes sessions for all profiles to detect proactive/background bot replies
  const pollBotSessions = useCallback(
    async (allowToast: boolean) => {
      const currentProfiles = profilesRef.current;
      if (currentProfiles.length === 0) return;

      const privateList = loadLocalPrivateProfiles();
      const entries = await Promise.all(
        currentProfiles.map(async (p) => {
          try {
            const list = await fetchSessions(p.name, 5);
            return [p, list] as const;
          } catch {
            return [p, null] as const;
          }
        })
      );

      let cursorsDirty = false;
      const nextRecent: Record<string, HermesSessionSummary> = {};

      for (const [profile, list] of entries) {
        if (!list) continue;
        for (const s of list) {
          if (s.id) sessionToProfileRef.current.set(s.id, profile.name);
        }
        const isPriv = isProfilePrivate(profile, privateList);
        const primary = pickSessionForUnreadCheck(list, isPriv);
        if (!primary) continue;
        nextRecent[profile.name] = primary;

        const isViewingNow =
          tabRef.current === "bots" &&
          selectedBotNameRef.current === profile.name &&
          document.visibilityState === "visible";

        const existingCursor = botReadCursorsRef.current[profile.name];

        if (isViewingNow) {
          const updated = buildReadCursorFromSession(primary);
          if (updated) {
            botReadCursorsRef.current[profile.name] = {
              sessionId: updated.sessionId || existingCursor?.sessionId || "",
              lastActiveMs: Math.max(existingCursor?.lastActiveMs ?? 0, updated.lastActiveMs),
              messageCount: Math.max(
                existingCursor?.sessionId === updated.sessionId ? existingCursor.messageCount : 0,
                updated.messageCount
              ),
              readAtMs: Date.now(),
            };
            cursorsDirty = true;
          }
          continue;
        }

        if (!existingCursor) {
          // First-time baseline seed — avoid false unread badges for existing history
          const seeded = buildReadCursorFromSession(primary);
          if (seeded) {
            botReadCursorsRef.current[profile.name] = seeded;
            cursorsDirty = true;
          }
          continue;
        }

        if (hasSessionNewActivity(primary, existingCursor)) {
          try {
            const msgs = await fetchSessionMessages(primary.id, profile.name);
            const metrics = extractSessionMetrics(primary);
            const detected = detectUnreadAssistantMessages(
              msgs,
              existingCursor,
              metrics.lastActiveMs || Date.now(),
              primary.id
            );
            if (detected) {
              markBotUnread(profile.name, {
                count: detected.count,
                preview: detected.preview,
                timestampMs: detected.latestTimestampMs,
                sessionId: primary.id,
                source: "poll",
                allowToast,
              });
            }
          } catch {
            // Skip transient fetch errors
          }
        }
      }

      if (Object.keys(nextRecent).length > 0) {
        setRecentByProfile((prev) => ({ ...prev, ...nextRecent }));
      }
      if (cursorsDirty) {
        saveBotReadCursors(botReadCursorsRef.current);
      }
    },
    [markBotUnread]
  );

  // Sync group rooms to detect unread bot/group messages
  const syncGroupUnreads = useCallback(async () => {
    if (hermesWs.getState() !== "connected") return;
    try {
      const listRes = await hermesWs.call<{ rooms?: HermesRoom[] }>("groups.list", {
        include_disbanded: false,
        limit: 50,
      });
      const rooms = Array.isArray(listRes?.rooms) ? listRes.rooms : [];
      let cursorsDirty = false;
      const nextUnread: Record<string, GroupUnreadInfo> = {};

      for (const room of rooms) {
        const latestSeq = typeof room.latest_seq === "number" ? room.latest_seq : 0;
        const updatedMs = toTimestampMs(room.updated_at) ?? Date.now();
        const isOpen =
          tabRef.current === "groups" &&
          selectedRoomIdRef.current === room.room_id &&
          document.visibilityState === "visible";

        const existing = groupReadCursorsRef.current[room.room_id];
        if (isOpen || !existing) {
          groupReadCursorsRef.current[room.room_id] = {
            latestSeq: Math.max(existing?.latestSeq ?? 0, latestSeq),
            updatedAtMs: Math.max(existing?.updatedAtMs ?? 0, updatedMs),
          };
          cursorsDirty = true;
          continue;
        }

        const detected = detectGroupUnread(room, existing);
        if (detected) {
          nextUnread[room.room_id] = detected;
        }
      }

      if (cursorsDirty) {
        saveGroupReadCursors(groupReadCursorsRef.current);
      }
      setUnreadByGroup(nextUnread);
    } catch {
      // Optional when groups unavailable
    }
  }, []);

  // Poll on profiles load, every 15s while visible, on tab focus, and on WS reconnect
  useEffect(() => {
    if (profiles.length === 0) return;
    const allowToastOnThisRun = pollInitializedRef.current;
    pollInitializedRef.current = true;
    void pollBotSessions(allowToastOnThisRun);

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void pollBotSessions(true);
      }
    }, 15_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void pollBotSessions(true);
        void syncGroupUnreads();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollBotSessions, profiles, syncGroupUnreads]);

  // Global real-time WebSocket event watcher for instant bot & group message indicators
  useEffect(() => {
    if (wsState === "connected") {
      void syncGroupUnreads();
    }
  }, [syncGroupUnreads, wsState]);

  useEffect(() => {
    return hermesWs.onEvent((ev) => {
      if (ev.type === "groups.changed") {
        void syncGroupUnreads();
        return;
      }

      if (ev.type !== "message.complete" && ev.type !== "approval.requested") {
        return;
      }

      const payloadProfile =
        typeof ev.payload.profile === "string" && ev.payload.profile.trim()
          ? ev.payload.profile.trim()
          : undefined;
      const resolvedProfile =
        payloadProfile || (ev.sessionId ? sessionToProfileRef.current.get(ev.sessionId) : undefined);

      if (!resolvedProfile) return;

      if (ev.type === "message.complete") {
        const finalText = typeof ev.payload.text === "string" ? ev.payload.text.trim() : "";
        if (!finalText || isSilentBotAck(finalText)) return;
        const now = Date.now();
        setRecentByProfile((prev) => {
          const cur = prev[resolvedProfile];
          if (!cur) return prev;
          return {
            ...prev,
            [resolvedProfile]: { ...cur, last_active: now },
          };
        });
        markBotUnread(resolvedProfile, {
          preview: formatUnreadPreview(finalText),
          timestampMs: now,
          sessionId: ev.sessionId,
          increment: true,
          source: "ws",
          allowToast: document.visibilityState === "visible",
        });
      } else if (ev.type === "approval.requested") {
        markBotUnread(resolvedProfile, {
          preview: "Freigabe im Chat erforderlich",
          timestampMs: Date.now(),
          sessionId: ev.sessionId,
          increment: true,
          source: "ws",
          allowToast: document.visibilityState === "visible",
        });
      }
    });
  }, [markBotUnread, syncGroupUnreads]);

  // Public unread totals (strictly excluding private & hidden bots to preserve vault privacy)
  const publicUnreadBotTotal = useMemo(() => {
    const privateSet = new Set(privateProfileNames);
    const hiddenSet = new Set(hiddenProfiles);
    let total = 0;
    for (const [name, info] of Object.entries(unreadByBot)) {
      if (!privateSet.has(name) && !hiddenSet.has(name)) {
        total += Math.max(1, info.count);
      }
    }
    return total;
  }, [hiddenProfiles, privateProfileNames, unreadByBot]);

  const otherPublicBotUnreadTotal = useMemo(() => {
    const privateSet = new Set(privateProfileNames);
    const hiddenSet = new Set(hiddenProfiles);
    let total = 0;
    for (const [name, info] of Object.entries(unreadByBot)) {
      if (name === selectedBotName) continue;
      if (!privateSet.has(name) && !hiddenSet.has(name)) {
        total += Math.max(1, info.count);
      }
    }
    return total;
  }, [hiddenProfiles, privateProfileNames, selectedBotName, unreadByBot]);

  const groupUnreadRoomCount = useMemo(
    () => Object.keys(unreadByGroup).length,
    [unreadByGroup]
  );

  // Sync native PWA Home Screen badge (iOS 16.4+ & desktop PWAs; never includes private bots)
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    const totalPublic = publicUnreadBotTotal + groupUnreadRoomCount;
    try {
      if (totalPublic > 0 && typeof nav.setAppBadge === "function") {
        void nav.setAppBadge(totalPublic).catch(() => undefined);
      } else if (totalPublic === 0 && typeof nav.clearAppBadge === "function") {
        void nav.clearAppBadge().catch(() => undefined);
      }
    } catch {
      // App Badging API optional
    }
  }, [groupUnreadRoomCount, publicUnreadBotTotal]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      hermesWs.disconnect();
      await logout();
    } finally {
      setLoggingOut(false);
      setShowAccountSheet(false);
      setUser(null);
      setProfiles([]);
      setAvatars({});
      setRecentByProfile({});
      setUnreadByBot({});
      setUnreadByGroup({});
      setNewMsgToast(null);
      setSelectedBotName(null);
      setSelectedRoomId(null);
    }
  }

  if (booting) {
    return (
      <div className="login-shell">
        <div style={{ textAlign: "center", color: "var(--text-secondary)" }}>
          <img
            src="/icon-180.png"
            alt="Hermes Bots"
            width={56}
            height={56}
            style={{ borderRadius: 16, marginBottom: 14 }}
          />
          <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>Hermes Bots</div>
          <div style={{ fontSize: "0.84rem", marginTop: 4 }}>Verbinde mit Hermes…</div>
        </div>
      </div>
    );
  }

  const isAuthenticated = Boolean(user) || (status !== null && !status.auth_required);
  if (!isAuthenticated) {
    return (
      <LoginView
        status={status}
        statusError={statusError}
        onLoginSuccess={() => void bootstrap()}
      />
    );
  }

  const useSplitBotsLayout = isWideLayout && tab === "bots";
  const inFullscreenChat =
    (!useSplitBotsLayout && tab === "bots" && Boolean(selectedBotName)) ||
    (tab === "groups" && Boolean(selectedRoomId));

  const renderTopbar = () => (
    <header className="topbar">
      <div className="topbar-title-group">
        <img
          src="/icon-180.png"
          alt=""
          width={26}
          height={26}
          style={{ borderRadius: 7, flexShrink: 0 }}
        />
        <h1 className="topbar-title">{TAB_TITLES[tab]}</h1>
      </div>

      <div className="topbar-actions">
        {wsState !== "connected" && (
          <span className="pill warn" title="Gateway-Verbindung">
            <WifiOff size={12} />
            {wsState === "connecting" ? "Verbinde…" : "Offline"}
          </span>
        )}
        <button
          type="button"
          className="icon-btn ghost"
          aria-label="Briefings & Seiten"
          title="Briefings & Seiten"
          onClick={() => setShowPagesArchive(true)}
        >
          <FileText size={18} />
        </button>
        {tab === "bots" && (
          <button
            type="button"
            className="icon-btn primary"
            aria-label="Neuen Bot erstellen"
            title="Neuen Bot erstellen"
            onClick={() => setCreateBotTrigger((n) => n + 1)}
          >
            <Plus size={18} />
          </button>
        )}
        <button
          type="button"
          className="icon-btn ghost"
          aria-label="Konto und Info"
          onClick={() => setShowAccountSheet(true)}
        >
          <User size={19} />
        </button>
      </div>
    </header>
  );

  const renderTabbar = (inline = false) => (
    <nav className={`tabbar ${inline ? "inline" : ""}`} aria-label="Hauptnavigation">
      <button
        type="button"
        className={`tabbar-item ${tab === "bots" ? "active" : ""}`}
        aria-label={
          publicUnreadBotTotal > 0
            ? `Bots (${publicUnreadBotTotal} ungelesene ${publicUnreadBotTotal === 1 ? "Nachricht" : "Nachrichten"})`
            : "Bots"
        }
        onClick={() => {
          setTab("bots");
          if (!isWideLayout) setSelectedBotName(null);
        }}
      >
        <span className="tabbar-icon-wrap">
          <Bot size={20} />
          {publicUnreadBotTotal > 0 && (
            <span className="tabbar-badge" aria-hidden="true">
              {formatBadgeCount(publicUnreadBotTotal)}
            </span>
          )}
        </span>
        <span>Bots</span>
      </button>

      <button
        type="button"
        className={`tabbar-item ${tab === "groups" ? "active" : ""}`}
        aria-label={
          groupUnreadRoomCount > 0
            ? `Gruppen (${groupUnreadRoomCount} mit neuen Nachrichten)`
            : "Gruppen"
        }
        onClick={() => {
          setTab("groups");
          setSelectedRoomId(null);
        }}
      >
        <span className="tabbar-icon-wrap">
          <Users size={20} />
          {groupUnreadRoomCount > 0 && (
            <span className="tabbar-badge" aria-hidden="true">
              {formatBadgeCount(groupUnreadRoomCount)}
            </span>
          )}
        </span>
        <span>Gruppen</span>
      </button>

      <button
        type="button"
        className={`tabbar-item ${tab === "routines" ? "active" : ""}`}
        onClick={() => setTab("routines")}
      >
        <CalendarClock size={20} />
        <span>Routinen</span>
      </button>

      <button
        type="button"
        className={`tabbar-item ${tab === "connectors" ? "active" : ""}`}
        onClick={() => setTab("connectors")}
      >
        <Plug size={20} />
        <span>Connectoren</span>
      </button>
    </nav>
  );

  return (
    <div className={`app-shell ${useSplitBotsLayout ? "wide-split" : ""}`}>
      {newMsgToast && (
        <div className="new-msg-toast" role="status" aria-live="polite">
          <button
            type="button"
            className="new-msg-toast-main"
            onClick={() => {
              const target = newMsgToast.botName;
              dismissNewMsgToast();
              setTab("bots");
              handleSelectBot(target);
            }}
          >
            <BotAvatar
              visual={getBotVisual(
                profiles.find((p) => p.name === newMsgToast.botName) || {
                  name: newMsgToast.botName,
                  display_name: newMsgToast.botLabel,
                  bot_title: newMsgToast.botLabel,
                  description: "",
                  model: null,
                }
              )}
              imageUrl={avatars[newMsgToast.botName]}
              size="sm"
            />
            <div className="new-msg-toast-body">
              <div className="new-msg-toast-title">
                <span className="unread-dot-inline" aria-hidden="true" />
                <span>{newMsgToast.botLabel}</span>
                <span className="new-msg-toast-tag">Neue Nachricht</span>
              </div>
              <div className="new-msg-toast-preview">{newMsgToast.preview}</div>
            </div>
          </button>
          <button
            type="button"
            className="new-msg-toast-close"
            aria-label="Hinweis schließen"
            onClick={dismissNewMsgToast}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {useSplitBotsLayout ? (
        <div className="desktop-split">
          <aside className="desktop-sidebar">
            {renderTopbar()}
            <div className="desktop-sidebar-scroll">
              <BotsView
                profiles={profiles}
                avatars={avatars}
                recentByProfile={recentByProfile}
                unreadByBot={unreadByBot}
                otherUnreadCount={otherPublicBotUnreadTotal}
                pushPreferences={pushPreferences}
                hiddenProfiles={hiddenProfiles}
                privateProfileNames={privateProfileNames}
                loading={profilesLoading}
                error={profilesError}
                wsState={wsState}
                selectedBotName={selectedBotName}
                layoutMode="list-only"
                openCreateTrigger={createBotTrigger}
                createAsPrivate={createPrivateMode}
                onSelectBot={handleSelectBot}
                onMarkBotRead={markBotRead}
                onRegisterSession={registerBotSession}
                onToggleBotPush={handleToggleBotPush}
                onRefreshProfiles={() => loadProfiles()}
                onAvatarChange={handleAvatarChange}
                onToggleHideProfile={handleToggleHideProfile}
                onToggleBotPrivate={handleToggleBotPrivate}
                onOpenPrivateVault={() => setShowVaultSheet(true)}
                onOpenConnectors={() => setTab("connectors")}
              />
            </div>
            <div className="desktop-sidebar-dock">{renderTabbar(true)}</div>
          </aside>
          <section className="desktop-main">
            <BotsView
              profiles={profiles}
              avatars={avatars}
              recentByProfile={recentByProfile}
              unreadByBot={unreadByBot}
              otherUnreadCount={otherPublicBotUnreadTotal}
              pushPreferences={pushPreferences}
              hiddenProfiles={hiddenProfiles}
              privateProfileNames={privateProfileNames}
              loading={profilesLoading}
              error={profilesError}
              wsState={wsState}
              selectedBotName={selectedBotName}
              layoutMode="chat-only"
              draftPrefill={draftPrefill}
              onConsumeDraftPrefill={() => setDraftPrefill(null)}
              onForwardToBot={handleForwardToBot}
              onSelectBot={handleSelectBot}
              onMarkBotRead={markBotRead}
              onRegisterSession={registerBotSession}
              onToggleBotPush={handleToggleBotPush}
              onRefreshProfiles={() => loadProfiles()}
              onAvatarChange={handleAvatarChange}
              onToggleHideProfile={handleToggleHideProfile}
              onToggleBotPrivate={handleToggleBotPrivate}
              onOpenPrivateVault={() => setShowVaultSheet(true)}
              onOpenConnectors={() => setTab("connectors")}
            />
          </section>
        </div>
      ) : (
        <>
          {!inFullscreenChat && renderTopbar()}

          {inFullscreenChat ? (
            tab === "bots" ? (
              <BotsView
                profiles={profiles}
                avatars={avatars}
                recentByProfile={recentByProfile}
                unreadByBot={unreadByBot}
                otherUnreadCount={otherPublicBotUnreadTotal}
                pushPreferences={pushPreferences}
                hiddenProfiles={hiddenProfiles}
                privateProfileNames={privateProfileNames}
                loading={profilesLoading}
                error={profilesError}
                wsState={wsState}
                selectedBotName={selectedBotName}
                draftPrefill={draftPrefill}
                onConsumeDraftPrefill={() => setDraftPrefill(null)}
                onForwardToBot={handleForwardToBot}
                openCreateTrigger={createBotTrigger}
                createAsPrivate={createPrivateMode}
                onSelectBot={handleSelectBot}
                onMarkBotRead={markBotRead}
                onRegisterSession={registerBotSession}
                onToggleBotPush={handleToggleBotPush}
                onRefreshProfiles={() => loadProfiles()}
                onAvatarChange={handleAvatarChange}
                onToggleHideProfile={handleToggleHideProfile}
                onToggleBotPrivate={handleToggleBotPrivate}
                onOpenPrivateVault={() => setShowVaultSheet(true)}
                onOpenConnectors={() => {
                  setSelectedBotName(null);
                  setTab("connectors");
                }}
              />
            ) : (
              <Suspense fallback={<div className="empty-state"><p>Lade Gruppe…</p></div>}>
                <GroupsView
                  profiles={publicProfiles}
                  avatars={avatars}
                  unreadByGroup={unreadByGroup}
                  wsState={wsState}
                  selectedRoomId={selectedRoomId}
                  onSelectRoom={handleSelectRoom}
                  onMarkGroupRead={markGroupRead}
                />
              </Suspense>
            )
          ) : (
            <main className="main-scroll">
              {tab === "bots" && (
                <BotsView
                  profiles={profiles}
                  avatars={avatars}
                  recentByProfile={recentByProfile}
                  unreadByBot={unreadByBot}
                  otherUnreadCount={otherPublicBotUnreadTotal}
                  pushPreferences={pushPreferences}
                  hiddenProfiles={hiddenProfiles}
                  privateProfileNames={privateProfileNames}
                  loading={profilesLoading}
                  error={profilesError}
                  wsState={wsState}
                  selectedBotName={selectedBotName}
                  draftPrefill={draftPrefill}
                  onConsumeDraftPrefill={() => setDraftPrefill(null)}
                  onForwardToBot={handleForwardToBot}
                  openCreateTrigger={createBotTrigger}
                  createAsPrivate={createPrivateMode}
                  onSelectBot={handleSelectBot}
                  onMarkBotRead={markBotRead}
                  onRegisterSession={registerBotSession}
                  onToggleBotPush={handleToggleBotPush}
                  onRefreshProfiles={() => loadProfiles()}
                  onAvatarChange={handleAvatarChange}
                  onToggleHideProfile={handleToggleHideProfile}
                  onToggleBotPrivate={handleToggleBotPrivate}
                  onOpenPrivateVault={() => setShowVaultSheet(true)}
                  onOpenConnectors={() => setTab("connectors")}
                />
              )}
              {tab === "groups" && (
                <Suspense fallback={<div className="empty-state"><p>Lade Gruppen…</p></div>}>
                  <GroupsView
                    profiles={publicProfiles}
                    avatars={avatars}
                    unreadByGroup={unreadByGroup}
                    wsState={wsState}
                    selectedRoomId={selectedRoomId}
                    onSelectRoom={handleSelectRoom}
                    onMarkGroupRead={markGroupRead}
                  />
                </Suspense>
              )}
              {tab === "routines" && (
                <Suspense fallback={<div className="empty-state"><p>Lade Routinen…</p></div>}>
                  <RoutinesView profiles={publicProfiles} />
                </Suspense>
              )}
              {tab === "connectors" && (
                <Suspense fallback={<div className="empty-state"><p>Lade Connectoren…</p></div>}>
                  <ConnectorsView
                    profiles={publicProfiles}
                    avatars={avatars}
                    wsState={wsState}
                    onOpenBotChat={(name) => {
                      setTab("bots");
                      handleSelectBot(name);
                    }}
                  />
                </Suspense>
              )}
            </main>
          )}

          {!inFullscreenChat && renderTabbar(false)}
        </>
      )}

      <Sheet open={showAccountSheet} onClose={() => setShowAccountSheet(false)}>
        <div className="sheet-header">
          <h2 className="sheet-title">Konto &amp; Verbindung</h2>
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Schließen"
            onClick={() => setShowAccountSheet(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700 }}>
            {user?.display_name || user?.user_id || "Angemeldet"}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 4 }}>
            Anmeldung: {user?.provider || "hermes"} · Hermes{" "}
            {status ? `v${status.version}` : ""}
          </div>
          <div className="bot-card-tags" style={{ marginTop: 10 }}>
            <span className={`pill ${wsState === "connected" ? "ok" : "warn"}`}>
              WebSocket: {wsState === "connected" ? "verbunden" : wsState}
            </span>
            <span className="pill">{profiles.length} Profile</span>
          </div>
        </div>

        <div className="notice" style={{ marginBottom: 14 }}>
          <Smartphone size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            <strong>iPhone Home-Bildschirm:</strong> In Safari auf <em>Teilen</em> tippen und{" "}
            <em>„Zum Home-Bildschirm“</em> wählen – Hermes Bots startet dann im Vollbildmodus.
          </span>
        </div>

        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700, fontSize: "0.9rem" }}>
              {pushStatus?.subscribed ? (
                <Bell size={16} style={{ color: "var(--status-ok)" }} />
              ) : (
                <BellOff size={16} style={{ color: "var(--text-secondary)" }} />
              )}
              <span>Push-Benachrichtigungen</span>
            </div>
            <span className={`pill ${pushStatus?.subscribed ? "ok" : ""}`}>
              {pushStatus?.subscribed ? "Aktiv" : "Aus"}
            </span>
          </div>
          <p style={{ margin: "0 0 10px", fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
            Erhalte native iPhone-Mitteilungen, wenn deine Bots antworten, Rückfragen stellen oder
            dich proaktiv informieren.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className={`btn sm ${pushStatus?.subscribed ? "" : "primary"}`}
              disabled={pushBusy}
              onClick={() => void handleTogglePush()}
            >
              {pushStatus?.subscribed ? <BellOff size={14} /> : <Bell size={14} />}
              {pushBusy
                ? "Bitte warten…"
                : pushStatus?.subscribed
                  ? "Deaktivieren"
                  : "Push aktivieren"}
            </button>
            {pushStatus?.subscribed && (
              <button
                type="button"
                className="btn sm"
                disabled={pushBusy}
                onClick={() => void handleTestPush()}
              >
                Test-Push senden
              </button>
            )}
          </div>
          {pushFeedback && (
            <div style={{ marginTop: 8, fontSize: "0.76rem", color: "var(--accent-indigo)" }}>
              {pushFeedback}
            </div>
          )}

          <div className="push-pref-section">
            <div className="push-pref-row master">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "0.84rem" }}>Alle Bots (Master-Schalter)</div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                  Neue öffentliche Bots sind automatisch an · private Bots pushen niemals
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={pushPreferences.globalEnabled}
                aria-label="Push für alle Bots umschalten"
                className={`push-toggle-switch ${pushPreferences.globalEnabled ? "on" : ""}`}
                onClick={() => void handleToggleGlobalPush(!pushPreferences.globalEnabled)}
              >
                <span className="push-toggle-knob" />
              </button>
            </div>

            {publicProfiles.filter((p) => !hiddenProfiles.includes(p.name)).length > 0 && (
              <div className={`push-pref-list ${!pushPreferences.globalEnabled ? "dimmed" : ""}`}>
                {publicProfiles
                  .filter((p) => !hiddenProfiles.includes(p.name))
                  .map((p) => {
                    const vis = getBotVisual(p);
                    const enabled = !pushPreferences.disabledBots.includes(p.name);
                    return (
                      <div key={p.name} className="push-pref-row">
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <BotAvatar visual={vis} imageUrl={avatars[p.name]} size="xs" />
                          <span className="push-pref-name">{vis.label}</span>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled && pushPreferences.globalEnabled}
                          aria-label={`Push für ${vis.label} umschalten`}
                          disabled={!pushPreferences.globalEnabled}
                          className={`push-toggle-switch ${enabled && pushPreferences.globalEnabled ? "on" : ""}`}
                          onClick={() => void handleToggleBotPush(p.name, !enabled)}
                        >
                          <span className="push-toggle-knob" />
                        </button>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700, fontSize: "0.9rem" }}>
              <ShieldCheck
                size={16}
                style={{ color: autoApproveSafe ? "var(--status-ok)" : "var(--text-secondary)" }}
              />
              <span>Sicherheitsfreigaben</span>
            </div>
            <span className={`pill ${autoApproveSafe ? "ok" : ""}`}>
              {autoApproveSafe ? "Auto (sicher)" : "Manuell"}
            </span>
          </div>
          <p style={{ margin: "0 0 10px", fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
            {autoApproveSafe
              ? "Normale Aktionen werden automatisch akzeptiert. Bei E-Mails, Löschvorgängen und sensiblen Systemdateien wirst du weiterhin gefragt."
              : "Jede geschützte Aktion muss einzeln per Klick im Chat bestätigt werden."}
          </p>
          <button
            type="button"
            className={`btn sm ${autoApproveSafe ? "" : "primary"}`}
            onClick={() => {
              const next = !autoApproveSafe;
              setAutoApproveSafe(next);
              saveAutoApproveSafe(next);
            }}
          >
            {autoApproveSafe ? "Auf manuell umstellen" : "Automatisch aktivieren (außer Mails & Löschen)"}
          </button>
        </div>

        <button
          type="button"
          className="btn full"
          style={{ marginBottom: 10, borderColor: "rgba(165, 180, 252, 0.34)" }}
          onClick={() => {
            setShowAccountSheet(false);
            setShowCredentialVault(true);
          }}
        >
          <CreditCard size={15} style={{ color: "var(--accent-indigo)" }} />
          Hermes Tresor (Karten, Adressen &amp; Logins)
        </button>

        <button
          type="button"
          className="btn full"
          style={{ marginBottom: 10, borderColor: "rgba(52, 211, 153, 0.3)" }}
          onClick={() => {
            setShowAccountSheet(false);
            setShowVaultSheet(true);
          }}
        >
          <Lock size={15} style={{ color: "var(--status-ok)" }} />
          Privater Bereich
        </button>

        {hiddenProfiles.length > 0 && (
          <button
            type="button"
            className="btn full"
            style={{ marginBottom: 10 }}
            onClick={() => {
              setHiddenProfiles([]);
              try {
                localStorage.removeItem("hermes-pocket.hiddenProfiles");
              } catch {
                // ignore
              }
            }}
          >
            Ausgeblendete Bots wieder anzeigen ({hiddenProfiles.length})
          </button>
        )}

        <button
          type="button"
          className="btn danger full"
          disabled={loggingOut}
          onClick={() => void handleLogout()}
        >
          <LogOut size={16} />
          {loggingOut ? "Wird abgemeldet…" : "Von Hermes abmelden"}
        </button>
      </Sheet>

      {showVaultSheet && (
        <Suspense fallback={null}>
          <PrivateVaultSheet
            open={showVaultSheet}
            unlocked={vaultUnlocked}
            privateProfiles={privateProfiles}
            regularProfiles={publicProfiles.filter((p) => !p.is_default && p.name !== "default")}
            avatars={avatars}
            unreadByBot={unreadByBot}
            onUnlocked={() => setVaultUnlocked(true)}
            onLock={() => {
              setVaultUnlocked(false);
              if (selectedBotName && privateProfileNames.includes(selectedBotName)) {
                setSelectedBotName(null);
              }
            }}
            onOpenPrivateBot={(name) => {
              setTab("bots");
              handleSelectBot(name);
            }}
            onToggleBotPrivate={handleToggleBotPrivate}
            onCreatePrivateBot={() => {
              setTab("bots");
              setSelectedBotName(null);
              setCreatePrivateMode(true);
              setCreateBotTrigger((n) => n + 1);
            }}
            onClose={() => setShowVaultSheet(false)}
          />
        </Suspense>
      )}

      {showCredentialVault && (
        <Suspense fallback={null}>
          <CredentialVaultSheet
            open={showCredentialVault}
            wsState={wsState}
            publicProfiles={publicProfiles}
            onClose={() => setShowCredentialVault(false)}
          />
        </Suspense>
      )}

      {showPagesArchive && (
        <Suspense fallback={null}>
          <PagesArchiveSheet
            open={showPagesArchive}
            profiles={profiles}
            privateProfileNames={privateProfileNames}
            avatars={avatars}
            onClose={() => setShowPagesArchive(false)}
          />
        </Suspense>
      )}
    </div>
  );
};
