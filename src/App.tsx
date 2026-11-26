import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  BellOff,
  Bot,
  CalendarClock,
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
  HermesProfile,
  HermesStatusResponse,
} from "../shared/types";
import { BotsView } from "./components/BotsView";
import { ConnectorsView } from "./components/ConnectorsView";
import { GroupsView } from "./components/GroupsView";
import { LoginView } from "./components/LoginView";
import { PrivateVaultSheet } from "./components/PrivateVaultSheet";
import { RoutinesView } from "./components/RoutinesView";
import { Sheet } from "./components/Sheet";
import { loadAutoApproveSafe, saveAutoApproveSafe } from "./lib/approvalPolicy";
import { fetchBotAvatar } from "./lib/avatarStore";
import {
  fetchCurrentUser,
  fetchProfiles,
  fetchStatus,
  logout,
  updateProfilePrivacy,
} from "./lib/hermesApi";
import { hermesWs, type WsConnectionState } from "./lib/hermesWs";
import {
  hasVaultPin,
  isProfilePrivate,
  loadLocalPrivateProfiles,
  saveLocalPrivateProfiles,
} from "./lib/privateVault";
import {
  disablePushNotifications,
  enablePushNotifications,
  fetchPushStatus,
  sendTestPushNotification,
  type PushStatusInfo,
} from "./lib/pushClient";
import { useVisualViewport } from "./lib/useVisualViewport";

type TabKey = "bots" | "groups" | "routines" | "connectors";

const TAB_TITLES: Record<TabKey, string> = {
  bots: "Hermes Pocket",
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
  const [loggingOut, setLoggingOut] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushStatusInfo | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<string | null>(null);
  const [autoApproveSafe, setAutoApproveSafe] = useState<boolean>(() => loadAutoApproveSafe());

  // Open specific bot when launched or tapped from a Push Notification
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const botParam = params.get("bot")?.trim();
    if (botParam) {
      setTab("bots");
      setSelectedBotName(botParam);
      window.history.replaceState({}, "", window.location.pathname);
    }
    const onSwMessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; bot?: string } | null;
      if (data?.type === "hp:open-bot" && data.bot) {
        setTab("bots");
        setSelectedBotName(data.bot);
      }
    };
    navigator.serviceWorker?.addEventListener("message", onSwMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onSwMessage);
  }, []);

  useEffect(() => {
    if (showAccountSheet) {
      setPushFeedback(null);
      void fetchPushStatus().then(setPushStatus);
    }
  }, [showAccountSheet]);

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

  const handleSelectBot = useCallback((name: string | null) => {
    setCreateBotTrigger(0);
    setCreatePrivateMode(false);
    setSelectedBotName(name);
  }, []);

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
      setSelectedBotName(null);
      setSelectedRoomId(null);
    }
  }

  if (booting) {
    return (
      <div className="login-shell">
        <div style={{ textAlign: "center", color: "var(--text-secondary)" }}>
          <img
            src="/icon.svg"
            alt="Hermes Pocket"
            width={56}
            height={56}
            style={{ borderRadius: 16, marginBottom: 14 }}
          />
          <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>Hermes Pocket</div>
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

  const inFullscreenChat =
    (tab === "bots" && Boolean(selectedBotName)) ||
    (tab === "groups" && Boolean(selectedRoomId));

  return (
    <div className="app-shell">
      {!inFullscreenChat && (
        <header className="topbar">
          <div className="topbar-title-group">
            <img
              src="/icon.svg"
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
      )}

      {inFullscreenChat ? (
        tab === "bots" ? (
          <BotsView
            profiles={profiles}
            avatars={avatars}
            hiddenProfiles={hiddenProfiles}
            privateProfileNames={privateProfileNames}
            loading={profilesLoading}
            error={profilesError}
            wsState={wsState}
            selectedBotName={selectedBotName}
            openCreateTrigger={createBotTrigger}
            createAsPrivate={createPrivateMode}
            onSelectBot={handleSelectBot}
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
          <GroupsView
            profiles={publicProfiles}
            avatars={avatars}
            wsState={wsState}
            selectedRoomId={selectedRoomId}
            onSelectRoom={setSelectedRoomId}
          />
        )
      ) : (
        <main className="main-scroll">
          {tab === "bots" && (
            <BotsView
              profiles={profiles}
              avatars={avatars}
              hiddenProfiles={hiddenProfiles}
              privateProfileNames={privateProfileNames}
              loading={profilesLoading}
              error={profilesError}
              wsState={wsState}
              selectedBotName={selectedBotName}
              openCreateTrigger={createBotTrigger}
              createAsPrivate={createPrivateMode}
              onSelectBot={handleSelectBot}
              onRefreshProfiles={() => loadProfiles()}
              onAvatarChange={handleAvatarChange}
              onToggleHideProfile={handleToggleHideProfile}
              onToggleBotPrivate={handleToggleBotPrivate}
              onOpenPrivateVault={() => setShowVaultSheet(true)}
              onOpenConnectors={() => setTab("connectors")}
            />
          )}
          {tab === "groups" && (
            <GroupsView
              profiles={publicProfiles}
              avatars={avatars}
              wsState={wsState}
              selectedRoomId={selectedRoomId}
              onSelectRoom={setSelectedRoomId}
            />
          )}
          {tab === "routines" && <RoutinesView profiles={publicProfiles} />}
          {tab === "connectors" && (
            <ConnectorsView
              profiles={publicProfiles}
              avatars={avatars}
              wsState={wsState}
              onOpenBotChat={(name) => {
                setTab("bots");
                setSelectedBotName(name);
              }}
            />
          )}
        </main>
      )}

      {!inFullscreenChat && (
        <nav className="tabbar" aria-label="Hauptnavigation">
          <button
            type="button"
            className={`tabbar-item ${tab === "bots" ? "active" : ""}`}
            onClick={() => {
              setTab("bots");
              setSelectedBotName(null);
            }}
          >
            <Bot size={20} />
            <span>Bots</span>
          </button>

          <button
            type="button"
            className={`tabbar-item ${tab === "groups" ? "active" : ""}`}
            onClick={() => {
              setTab("groups");
              setSelectedRoomId(null);
            }}
          >
            <Users size={20} />
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
            <em>„Zum Home-Bildschirm“</em> wählen – Hermes Pocket startet dann im Vollbildmodus.
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

      <PrivateVaultSheet
        open={showVaultSheet}
        unlocked={vaultUnlocked}
        privateProfiles={privateProfiles}
        regularProfiles={publicProfiles.filter((p) => !p.is_default && p.name !== "default")}
        avatars={avatars}
        onUnlocked={() => setVaultUnlocked(true)}
        onLock={() => {
          setVaultUnlocked(false);
          if (selectedBotName && privateProfileNames.includes(selectedBotName)) {
            setSelectedBotName(null);
          }
        }}
        onOpenPrivateBot={(name) => {
          setTab("bots");
          setSelectedBotName(name);
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
    </div>
  );
};
