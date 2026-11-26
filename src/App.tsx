import React, { useCallback, useEffect, useState } from "react";
import {
  Bot,
  CalendarClock,
  LogOut,
  Plug,
  Plus,
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
import { RoutinesView } from "./components/RoutinesView";
import { fetchBotAvatar } from "./lib/avatarStore";
import {
  fetchCurrentUser,
  fetchProfiles,
  fetchStatus,
  logout,
} from "./lib/hermesApi";
import { hermesWs, type WsConnectionState } from "./lib/hermesWs";
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

  const [profiles, setProfiles] = useState<HermesProfile[]>([]);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);

  const [showAccountSheet, setShowAccountSheet] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

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
              width={28}
              height={28}
              style={{ borderRadius: 8, flexShrink: 0 }}
            />
            <div style={{ minWidth: 0 }}>
              <h1 className="topbar-title">{TAB_TITLES[tab]}</h1>
              <div className="topbar-subtitle">
                {status ? `Hermes v${status.version}` : "Hermes Gateway"}
              </div>
            </div>
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
            loading={profilesLoading}
            error={profilesError}
            wsState={wsState}
            selectedBotName={selectedBotName}
            openCreateTrigger={createBotTrigger}
            onSelectBot={setSelectedBotName}
            onRefreshProfiles={() => loadProfiles()}
            onAvatarChange={handleAvatarChange}
            onOpenConnectors={() => {
              setSelectedBotName(null);
              setTab("connectors");
            }}
          />
        ) : (
          <GroupsView
            profiles={profiles}
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
              loading={profilesLoading}
              error={profilesError}
              wsState={wsState}
              selectedBotName={selectedBotName}
              openCreateTrigger={createBotTrigger}
              onSelectBot={setSelectedBotName}
              onRefreshProfiles={() => loadProfiles()}
              onAvatarChange={handleAvatarChange}
              onOpenConnectors={() => setTab("connectors")}
            />
          )}
          {tab === "groups" && (
            <GroupsView
              profiles={profiles}
              avatars={avatars}
              wsState={wsState}
              selectedRoomId={selectedRoomId}
              onSelectRoom={setSelectedRoomId}
            />
          )}
          {tab === "routines" && <RoutinesView profiles={profiles} />}
          {tab === "connectors" && (
            <ConnectorsView
              profiles={profiles}
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

      {showAccountSheet && (
        <div
          className="sheet-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAccountSheet(false);
          }}
        >
          <div className="sheet">
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

            <button
              type="button"
              className="btn danger full"
              disabled={loggingOut}
              onClick={() => void handleLogout()}
            >
              <LogOut size={16} />
              {loggingOut ? "Wird abgemeldet…" : "Von Hermes abmelden"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
